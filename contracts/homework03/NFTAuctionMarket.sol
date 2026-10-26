// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AggregatorV3Interface} from "./interfaces/AggregatorV3Interface.sol";

contract NFTAuctionMarket is Initializable, UUPSUpgradeable, OwnableUpgradeable {
    using SafeERC20 for IERC20;

    struct Auction {
        address seller;
        address nft;
        uint256 tokenId;
        address payToken;
        uint256 startPrice;
        uint256 highestBid;
        address highestBidder;
        uint64 endTime;
        bool active;
    }

    uint256 public auctionCount;
    mapping(uint256 => Auction) public auctions;
    //auctionId => 出价人 => 金额
    mapping(uint256 => mapping(address => uint256)) public pendingReturns;

    address public feeRecipient;

    uint96 public feeBps;

    address public ethUsdFeed;

    mapping(address => address) public tokenUsdFeed;

    uint256 private _status;

    modifier nonReentrant() {
        if (_status == 2) revert ReentrantCall();
        _status = 2;
        _;
        _status = 1;
    }

    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant MIN_DURATION = 1 minutes;
    uint256 public constant MAX_DURATION = 30 days;
    uint256 public constant MIN_BID_STEP_BPS = 500; // 每次加价5%
    // 测试网上的稳定币 feed 心跳通常为 24 小时，这里留 2 倍余量
    uint256 public constant MAX_PRICE_AGE = 48 hours;

    event AuctionCreated(
        uint256 indexed auctionId,
        address seller,
        address nft,
        uint256 tokenId,
        address payToken,
        uint256 startPrice,
        uint64 endTime
    );

    event BidPlaced(
        uint256 indexed auctionId,
        address indexed bidder,
        uint256 amount,
        uint256 usdValue
    );

    event RefundWithdrawn(
        uint256 indexed auctionId,
        address indexed bidder,
        uint256 amount
    );
    event AuctionSettled(
        uint256 indexed auctionId,
        address indexed winner,
        uint256 finalPrice,
        uint256 fee
    );

    event AuctionCanceled(
        uint256 indexed auctionId
    );

    //=========================
    error ZeroAddress();
    error FeeTooHigh();
    error NotTokenOwner();
    error MarketNotApproved();
    error BadDuration();
    error BadPrice();
    error UnsupportedToken();
    error AuctionNotActive();
    error AuctionEndedAlready();
    error AuctionNotEndedYet();
    error SellerCannotBid();
    error BidTooLow(uint256 given, uint256 minimum);
    error NoBidYet();
    error NothingToRefund();
    error EthAmountMismatch();
    error PayoutFailed();
    error ReentrantCall();

    constructor() {
        _disableInitializers();
    }

    function initialize(
        address initialOwner,
        address feeRecipient_,
        uint96 feeBps_,
        address ethUsdFeed_
    ) external initializer {
        if (initialOwner == address(0) || feeRecipient_ == address(0) || ethUsdFeed_ == address(0)) revert ZeroAddress();
        
        if(feeBps_ > 1000) revert FeeTooHigh();

        __Ownable_init(initialOwner);
        feeRecipient = feeRecipient_;
        feeBps = feeBps_;
        ethUsdFeed = ethUsdFeed_;
        _status = 1;
    }

    function createAuction(
        address nft,
        uint256 tokenId,
        address payToken,
        uint256 startPrice,
        uint64 duration
    ) external returns (uint256 auctionId) {
        if (startPrice == 0) revert BadPrice();
        if(duration<MIN_DURATION || duration>MAX_DURATION) revert BadDuration();

        address feed = payToken == address(0) ? ethUsdFeed : tokenUsdFeed[payToken];
        if (feed == address(0)) revert UnsupportedToken();

        IERC721 token = IERC721(nft);
        if(token.ownerOf(tokenId) != msg.sender) revert NotTokenOwner();
        if(
            token.getApproved(tokenId) != address(this) &&
            !token.isApprovedForAll(msg.sender, address(this))
        ) {
            revert MarketNotApproved();
        }

        auctionId = auctionCount++;
        // 托管 NFT：拍卖期间由市场持有，卖家无法转走或撤销授权
        token.transferFrom(msg.sender, address(this), tokenId);

        auctions[auctionId] = Auction(
            {
                seller: msg.sender,
                nft: nft,
                tokenId: tokenId,
                payToken: payToken,
                startPrice: startPrice,
                highestBid: 0,
                highestBidder: address(0),
                endTime: uint64(block.timestamp) + duration,
                active: true
            }
        );
        emit AuctionCreated(auctionId, msg.sender, nft, tokenId, payToken, startPrice, auctions[auctionId].endTime);
        return auctionId;   
    }

    function cancelAuction(uint256 auctionId) external {
        Auction storage a = auctions[auctionId];
        if(!a.active) revert AuctionNotActive();
        if(a.seller != msg.sender) revert NotTokenOwner();
        if(a.highestBidder != address(0)) revert NoBidYet();
        a.active = false;
        // 退回托管的 NFT
        IERC721(a.nft).transferFrom(address(this), a.seller, a.tokenId);
        emit AuctionCanceled(auctionId);
    }

    function bid(uint256 auctionId, uint256 amount) external payable nonReentrant {
        Auction storage a = auctions[auctionId];

        if(!a.active) revert AuctionNotActive();
        if(block.timestamp >= a.endTime) revert AuctionEndedAlready();
        if(msg.sender ==  a.seller) revert SellerCannotBid();

        uint256 minBid = a.highestBid == 0 ? a.startPrice :a.highestBid + (a.highestBid*MIN_BID_STEP_BPS)/BPS_DENOMINATOR;

        if(amount < minBid) revert BidTooLow(amount, minBid);

        if(a.highestBidder != address(0)) {
            pendingReturns[auctionId][a.highestBidder] += a.highestBid;
        }

        a.highestBid = amount;
        a.highestBidder = msg.sender;
        
        // CEI 先改状态再转账
        if(a.payToken == address(0)) {
            if (msg.value != amount) revert EthAmountMismatch();
        } else {
            if(msg.value!=0) revert EthAmountMismatch();
            IERC20(a.payToken).safeTransferFrom(msg.sender, address(this), amount);
        }
        emit BidPlaced(auctionId, msg.sender, amount, usdValueOf(a.payToken, amount));
    }

    function WithdrawRefund(uint256 auctionId) external nonReentrant {
        uint256 amount = pendingReturns[auctionId][msg.sender];
        if(amount == 0) revert NothingToRefund();
        pendingReturns[auctionId][msg.sender] = 0;
        _payout(auctions[auctionId].payToken,msg.sender,amount);
        emit RefundWithdrawn(auctionId, msg.sender, amount);
    }

    function endAuction(uint256 auctionId) external nonReentrant {
        Auction storage a = auctions[auctionId];
        
        if(!a.active) revert AuctionNotActive();
        if(block.timestamp<a.endTime) revert AuctionNotEndedYet();
        a.active = false;

        if(a.highestBidder == address(0)) {
            // 无人出价：把托管的 NFT 还给卖家
            IERC721(a.nft).transferFrom(address(this), a.seller, a.tokenId);
            emit AuctionSettled(auctionId, address(0),0,0);
            return;
        }

        uint256 fee = _calcFee(a.highestBid);
        uint256 proceeds = a.highestBid - fee;

        // NFT 由市场托管，结算时直接转给最高出价者
        IERC721(a.nft).transferFrom(address(this), a.highestBidder, a.tokenId);

        _payout(a.payToken,a.seller,proceeds);
        _payout(a.payToken,feeRecipient,fee);

        emit AuctionSettled(auctionId, a.highestBidder, a.highestBid, fee);
    }

    function usdValueOf(address payToken, uint256 amount) public view returns (uint256) {
        address feed = payToken == address(0) ? ethUsdFeed : tokenUsdFeed[payToken];
        if(feed == address(0)) revert UnsupportedToken();
        
        uint256 price18 = _readPrice18(feed);
        uint dec = payToken == address(0) ? 18 : IERC20Metadata(payToken).decimals();

        return amount*price18/10**dec;
    }

    function getAuctionUsdValue(uint256 auctionId) external view returns (uint256) {
        Auction storage a = auctions[auctionId];
        uint256 price = a.highestBid == 0 ? a.startPrice : a.highestBid;
        return usdValueOf(a.payToken, price);
    }

    function _readPrice18(address feed) internal view returns (uint256) {
        (, int256 answer, , uint256 updatedAt, ) = AggregatorV3Interface(feed).latestRoundData();

        if (answer <= 0) revert BadPrice(); // 价格必须为正
        if (updatedAt == 0 || block.timestamp - updatedAt > MAX_PRICE_AGE) revert BadPrice(); // 过期数据不能用

        uint8 d = AggregatorV3Interface(feed).decimals();
        require(d <= 18, "feed decimals > 18");

        // 把 8 位小数的价格统一放大成 18 位小数
        return uint256(answer) * (10 ** (18 - d));
    }

    function _calcFee(uint256 amount) internal view virtual returns (uint256) {
        return (amount * feeBps) / BPS_DENOMINATOR;
    }

    function _payout(address payToken, address to, uint256 amount) internal {
        if (amount == 0) return;

        if (payToken == address(0)) {
            (bool ok, ) = payable(to).call{value: amount}("");
            if (!ok) revert PayoutFailed();
        } else {
            IERC20(payToken).safeTransfer(to, amount);
        }
    }

    function getAuction(uint256 auctionId) external view returns (Auction memory) {
        return auctions[auctionId];
    }

    function isActive(uint256 auctionId) external view returns (bool) {
        Auction storage a = auctions[auctionId];
        return a.active && block.timestamp < a.endTime;
    }

    function setFeeRecipient(address newRecipient) external onlyOwner {
        if (newRecipient == address(0)) revert ZeroAddress();
        feeRecipient = newRecipient;
    }

    function setFeeBps(uint96 newFeeBps) public virtual onlyOwner {
        if (newFeeBps > 1000) revert FeeTooHigh();
        feeBps = newFeeBps;
    }

    function setEthUsdFeed(address newFeed) external onlyOwner {
        if (newFeed == address(0)) revert ZeroAddress();
        ethUsdFeed = newFeed;
    }

    function setTokenFeed(address token, address feed) external onlyOwner {
        tokenUsdFeed[token] = feed;
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    function version() external pure virtual returns (string memory) {
        return "v1";
    }



}

