// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {NFTAuctionMarket} from "./NFTAuctionMarket.sol";

// V2: 动态手续费

contract NFTAuctionMarketV2 is NFTAuctionMarket {
    uint96 public highValueFeeBps;

    uint256 public highValueThreshold;

    event FeeTiersUpdated(uint96 highValueFeeBps, uint256 highValueThreshold);

    function initializeV2(
        uint96 highValueFeeBps_,
        uint256 highValueThreshold_
    ) external reinitializer(2) onlyOwner {
        require(highValueFeeBps_ <= feeBps, "V2: high fee must be lower");
        highValueFeeBps = highValueFeeBps_;
        highValueThreshold = highValueThreshold_;
        emit FeeTiersUpdated(highValueFeeBps_, highValueThreshold_);
    }
    
    /// @notice 金额越大手续费越低
     function _calcFee(uint256 amount) internal view override returns (uint256) {
        uint96 bps = (highValueThreshold > 0 && amount >= highValueThreshold)
            ? highValueFeeBps
            : feeBps;
        return (amount * bps) / BPS_DENOMINATOR;
    }

    function version() external pure override returns (string memory) {
        return "v2";
    }

    function setFeeTiers(uint96 highValueFeeBps_, uint256 highValueThreshold_) external onlyOwner {
        require(highValueFeeBps_ <= feeBps, "V2: high fee must be lower");
        highValueFeeBps = highValueFeeBps_;
        highValueThreshold = highValueThreshold_;
        emit FeeTiersUpdated(highValueFeeBps_, highValueThreshold_);
    }

    /// @notice V2 下调普通费率时必须保持 highValueFeeBps <= feeBps，
    ///         否则“金额越大手续费越低”的不变量会被打破
    function setFeeBps(uint96 newFeeBps) public override onlyOwner {
        require(newFeeBps >= highValueFeeBps, "V2: fee below high-value tier");
        super.setFeeBps(newFeeBps);
    }
}