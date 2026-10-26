import { expect } from "chai";
import { network } from "hardhat";

const { ethers, networkHelpers } = await network.create();

const ZERO = ethers.ZeroAddress;
const FEE_BPS = 500n;
const HOUR = 3600;
const DAY = 24 * HOUR;
const MIN_DURATION = 60;
const MAX_DURATION = 30 * DAY;
const ETH_USD_8 = 2000n * 10n ** 8n;
const USDC_USD_8 = 1n * 10n ** 8n;

const usdcUnits = (n) => BigInt(n) * 10n ** 6n;
const eth = (s) => ethers.parseEther(s);

async function deployProxy(implAddress, initData, signer) {
  const proxy = await ethers.deployContract(
    "NFTAuctionMarketProxy",
    [implAddress, initData],
    signer,
  );
  await proxy.waitForDeployment();
  return proxy;
}

async function deployFixture() {
  const [owner, seller, bidder1, bidder2, feeRecipient, stranger] =
    await ethers.getSigners();

  const nft = await ethers.deployContract("MyNFT");
  const usdc = await ethers.deployContract("MockERC20", ["USD Coin", "USDC", 6]);
  const ethFeed = await ethers.deployContract("MockV3Aggregator", [8, ETH_USD_8]);
  const usdcFeed = await ethers.deployContract("MockV3Aggregator", [8, USDC_USD_8]);
  await nft.waitForDeployment();
  await usdc.waitForDeployment();
  await ethFeed.waitForDeployment();
  await usdcFeed.waitForDeployment();

  const impl = await ethers.deployContract("NFTAuctionMarket");
  await impl.waitForDeployment();

  const initData = impl.interface.encodeFunctionData("initialize", [
    owner.address,
    feeRecipient.address,
    FEE_BPS,
    await ethFeed.getAddress(),
  ]);
  const proxy = await deployProxy(await impl.getAddress(), initData, owner);
  const market = await ethers.getContractAt("NFTAuctionMarket", await proxy.getAddress());

  const usdcAddr = await usdc.getAddress();
  await market
    .connect(owner)
    .setTokenFeed(usdcAddr, await usdcFeed.getAddress());

  for (const bidder of [bidder1, bidder2]) {
    await usdc.mint(bidder.address, 1_000_000n * 10n ** 6n);
    await usdc.connect(bidder).approve(await market.getAddress(), ethers.MaxUint256);
  }

  // tokenId 1、2 归卖家，并授权市场托管
  await nft.mint(seller.address, "ipfs://token/1");
  await nft.mint(seller.address, "ipfs://token/2");
  await nft.connect(seller).setApprovalForAll(await market.getAddress(), true);

  return {
    owner,
    seller,
    bidder1,
    bidder2,
    feeRecipient,
    stranger,
    nft,
    usdc,
    usdcAddr,
    ethFeed,
    usdcFeed,
    impl,
    proxy,
    market,
  };
}

const load = () => networkHelpers.loadFixture(deployFixture);

async function createEthAuction(ctx, tokenId, startPrice, duration = HOUR) {
  const tx = await ctx.market
    .connect(ctx.seller)
    .createAuction(await ctx.nft.getAddress(), tokenId, ZERO, startPrice, duration);
  await tx.wait();
  return tx;
}

async function createUsdcAuction(ctx, tokenId, startPrice, duration = HOUR) {
  const tx = await ctx.market
    .connect(ctx.seller)
    .createAuction(await ctx.nft.getAddress(), tokenId, ctx.usdcAddr, startPrice, duration);
  await tx.wait();
  return tx;
}

async function expectProxyDeployRevert(ctx, args, errorName) {
  const data = ctx.impl.interface.encodeFunctionData("initialize", args);
  const factory = await ethers.getContractFactory("NFTAuctionMarketProxy", ctx.owner);
  const tx = await factory.getDeployTransaction(await ctx.impl.getAddress(), data);
  await expect(ctx.owner.sendTransaction(tx)).to.be.revertedWithCustomError(
    ctx.impl,
    errorName,
  );
}

describe("作业三 · NFT 拍卖市场", function () {
  // ============================================================
  // MyNFT
  // ============================================================
  describe("MyNFT", function () {
    it("名称和符号正确", async function () {
      const { nft } = await load();
      expect(await nft.name()).to.equal("Homework Auction NFT");
      expect(await nft.symbol()).to.equal("HWNFT");
    });

    it("owner 铸造：tokenId 从 1 自增，tokenURI 正确", async function () {
      const { nft, owner } = await load();
      expect(await nft.totalMinted()).to.equal(2n);

      await expect(nft.mint(owner.address, "ipfs://token/3"))
        .to.emit(nft, "Minted")
        .withArgs(owner.address, 3n, "ipfs://token/3");

      expect(await nft.ownerOf(3n)).to.equal(owner.address);
      expect(await nft.tokenURI(3n)).to.equal("ipfs://token/3");
      expect(await nft.totalMinted()).to.equal(3n);
    });

    it("非 owner 不能铸造", async function () {
      const { nft, stranger } = await load();
      await expect(nft.connect(stranger).mint(stranger.address, "ipfs://x"))
        .to.be.revertedWithCustomError(nft, "OwnableUnauthorizedAccount")
        .withArgs(stranger.address);
    });

    it("NFT 可以转移", async function () {
      const { nft, seller, bidder1 } = await load();
      await nft
        .connect(seller)
        .transferFrom(seller.address, bidder1.address, 1n);
      expect(await nft.ownerOf(1n)).to.equal(bidder1.address);
      expect(await nft.balanceOf(seller.address)).to.equal(1n);
    });
  });

  // ============================================================
  // 部署与初始化（UUPS 代理）
  // ============================================================
  describe("部署与初始化", function () {
    it("通过代理初始化后状态正确", async function () {
      const { market, owner, feeRecipient, ethFeed } = await load();
      expect(await market.owner()).to.equal(owner.address);
      expect(await market.feeRecipient()).to.equal(feeRecipient.address);
      expect(await market.feeBps()).to.equal(FEE_BPS);
      expect(await market.ethUsdFeed()).to.equal(await ethFeed.getAddress());
      expect(await market.auctionCount()).to.equal(0n);
      expect(await market.version()).to.equal("v1");
    });

    it("实现合约自身不能被初始化", async function () {
      const { impl, owner, feeRecipient, ethFeed } = await load();
      await expect(
        impl.initialize(
          owner.address,
          feeRecipient.address,
          FEE_BPS,
          await ethFeed.getAddress(),
        ),
      ).to.be.revertedWithCustomError(impl, "InvalidInitialization");
    });

    it("代理不能重复初始化", async function () {
      const { market, impl, owner, feeRecipient, ethFeed } = await load();
      await expect(
        market.initialize(
          owner.address,
          feeRecipient.address,
          FEE_BPS,
          await ethFeed.getAddress(),
        ),
      ).to.be.revertedWithCustomError(impl, "InvalidInitialization");
    });

    it("initialOwner 为零地址时回滚", async function () {
      const ctx = await load();
      await expectProxyDeployRevert(
        ctx,
        [ZERO, ctx.feeRecipient.address, FEE_BPS, await ctx.ethFeed.getAddress()],
        "ZeroAddress",
      );
    });

    it("feeRecipient 为零地址时回滚", async function () {
      const ctx = await load();
      await expectProxyDeployRevert(
        ctx,
        [ctx.owner.address, ZERO, FEE_BPS, await ctx.ethFeed.getAddress()],
        "ZeroAddress",
      );
    });

    it("ethUsdFeed 为零地址时回滚", async function () {
      const ctx = await load();
      await expectProxyDeployRevert(
        ctx,
        [ctx.owner.address, ctx.feeRecipient.address, FEE_BPS, ZERO],
        "ZeroAddress",
      );
    });

    it("feeBps 超过 10% 时回滚", async function () {
      const ctx = await load();
      await expectProxyDeployRevert(
        ctx,
        [
          ctx.owner.address,
          ctx.feeRecipient.address,
          1001n,
          await ctx.ethFeed.getAddress(),
        ],
        "FeeTooHigh",
      );
    });
  });

  // ============================================================
  // createAuction
  // ============================================================
  describe("createAuction", function () {
    it("创建 ETH 拍卖：ID 从 0 开始、NFT 托管、状态正确", async function () {
      const ctx = await load();
      const { market, nft, seller } = ctx;
      const startPrice = eth("1");

      await expect(
        market
          .connect(seller)
          .createAuction(await nft.getAddress(), 1n, ZERO, startPrice, HOUR),
      ).to.emit(market, "AuctionCreated");

      expect(await market.auctionCount()).to.equal(1n);
      expect(await nft.ownerOf(1n)).to.equal(await market.getAddress());

      const a = await market.getAuction(0n);
      expect(a.seller).to.equal(seller.address);
      expect(a.nft).to.equal(await nft.getAddress());
      expect(a.tokenId).to.equal(1n);
      expect(a.payToken).to.equal(ZERO);
      expect(a.startPrice).to.equal(startPrice);
      expect(a.highestBid).to.equal(0n);
      expect(a.highestBidder).to.equal(ZERO);
      expect(a.active).to.equal(true);
      expect(await market.isActive(0n)).to.equal(true);
    });

    it("创建 ERC20 拍卖", async function () {
      const ctx = await load();
      const { market, nft, seller, usdcAddr } = ctx;
      const startPrice = usdcUnits(1000);

      await createUsdcAuction(ctx, 1n, startPrice);

      const a = await market.getAuction(0n);
      expect(a.payToken).to.equal(usdcAddr);
      expect(a.startPrice).to.equal(startPrice);
      expect(await nft.ownerOf(1n)).to.equal(await market.getAddress());
    });

    it("拍卖 ID 自增，不会互相覆盖", async function () {
      const ctx = await load();
      const { market } = ctx;

      await createEthAuction(ctx, 1n, eth("1"));
      await createUsdcAuction(ctx, 2n, usdcUnits(1000));

      expect(await market.auctionCount()).to.equal(2n);
      expect((await market.getAuction(0n)).tokenId).to.equal(1n);
      expect((await market.getAuction(1n)).tokenId).to.equal(2n);
      expect((await market.getAuction(0n)).startPrice).to.equal(eth("1"));
      expect((await market.getAuction(1n)).startPrice).to.equal(usdcUnits(1000));
    });

    it("同一 NFT 不能重复上架（已托管到市场）", async function () {
      const ctx = await load();
      await createEthAuction(ctx, 1n, eth("1"));

      await expect(createEthAuction(ctx, 1n, eth("2"))).to.be.revertedWithCustomError(
        ctx.market,
        "NotTokenOwner",
      );
    });

    it("拍卖期间卖家无法转走 NFT", async function () {
      const ctx = await load();
      await createEthAuction(ctx, 1n, eth("1"));

      await expect(
        ctx.nft
          .connect(ctx.seller)
          .transferFrom(ctx.seller.address, ctx.stranger.address, 1n),
      ).to.revert(ethers);
    });

    it("起拍价为 0 或时长非法时回滚", async function () {
      const ctx = await load();
      const { market, nft, seller } = ctx;
      const nftAddr = await nft.getAddress();

      await expect(
        market.connect(seller).createAuction(nftAddr, 1n, ZERO, 0n, HOUR),
      ).to.be.revertedWithCustomError(market, "BadPrice");

      await expect(
        market
          .connect(seller)
          .createAuction(nftAddr, 1n, ZERO, eth("1"), MIN_DURATION - 1),
      ).to.be.revertedWithCustomError(market, "BadDuration");

      await expect(
        market
          .connect(seller)
          .createAuction(nftAddr, 1n, ZERO, eth("1"), MAX_DURATION + 1),
      ).to.be.revertedWithCustomError(market, "BadDuration");
    });

    it("非 NFT owner 不能创建拍卖", async function () {
      const ctx = await load();
      const { market, nft, stranger } = ctx;
      await expect(
        market
          .connect(stranger)
          .createAuction(await nft.getAddress(), 1n, ZERO, eth("1"), HOUR),
      ).to.be.revertedWithCustomError(market, "NotTokenOwner");
    });

    it("未授权给市场时回滚", async function () {
      const ctx = await load();
      const { market, nft, bidder1 } = ctx;
      await nft.mint(bidder1.address, "ipfs://token/3");

      await expect(
        market
          .connect(bidder1)
          .createAuction(await nft.getAddress(), 3n, ZERO, eth("1"), HOUR),
      ).to.be.revertedWithCustomError(market, "MarketNotApproved");
    });

    it("没有价格源的 ERC20 不能创建拍卖", async function () {
      const ctx = await load();
      const { market, nft, seller } = ctx;
      const token = await ethers.deployContract("MockERC20", ["NoFeed", "NF", 18]);
      await token.waitForDeployment();

      await expect(
        market
          .connect(seller)
          .createAuction(
            await nft.getAddress(),
            1n,
            await token.getAddress(),
            eth("1"),
            HOUR,
          ),
      ).to.be.revertedWithCustomError(market, "UnsupportedToken");
    });

    it("撤销价格源后不能再创建该 ERC20 拍卖", async function () {
      const ctx = await load();
      const { market, nft, seller, usdcAddr } = ctx;
      await market.connect(ctx.owner).setTokenFeed(usdcAddr, ZERO);

      await expect(
        market
          .connect(seller)
          .createAuction(await nft.getAddress(), 1n, usdcAddr, eth("1"), HOUR),
      ).to.be.revertedWithCustomError(market, "UnsupportedToken");
    });
  });

  // ============================================================
  // bid / 退款
  // ============================================================
  describe("bid 与退款", function () {
    it("ETH 出价：记录最高价，事件里带 USD 估值", async function () {
      const ctx = await load();
      const { market, bidder1 } = ctx;
      await createEthAuction(ctx, 1n, eth("1"));

      const amount = eth("1");
      await expect(market.connect(bidder1).bid(0n, amount, { value: amount }))
        .to.emit(market, "BidPlaced")
        .withArgs(0n, bidder1.address, amount, eth("2000"));

      const a = await market.getAuction(0n);
      expect(a.highestBid).to.equal(amount);
      expect(a.highestBidder).to.equal(bidder1.address);
      expect(await ethers.provider.getBalance(await market.getAddress())).to.equal(
        amount,
      );
    });

    it("ERC20 出价：代币进入市场，事件里带 USD 估值", async function () {
      const ctx = await load();
      const { market, bidder1, usdc } = ctx;
      await createUsdcAuction(ctx, 1n, usdcUnits(1000));

      const amount = usdcUnits(1000);
      await expect(market.connect(bidder1).bid(0n, amount))
        .to.emit(market, "BidPlaced")
        .withArgs(0n, bidder1.address, amount, eth("1000"));

      const a = await market.getAuction(0n);
      expect(a.highestBid).to.equal(amount);
      expect(a.highestBidder).to.equal(bidder1.address);
      expect(await usdc.balanceOf(await market.getAddress())).to.equal(amount);
    });

    it("低于起拍价回滚", async function () {
      const ctx = await load();
      const { market, bidder1 } = ctx;
      await createEthAuction(ctx, 1n, eth("1"));

      await expect(
        market.connect(bidder1).bid(0n, eth("0.9"), { value: eth("0.9") }),
      )
        .to.be.revertedWithCustomError(market, "BidTooLow")
        .withArgs(eth("0.9"), eth("1"));
    });

    it("加价必须至少 5%", async function () {
      const ctx = await load();
      const { market, bidder1, bidder2 } = ctx;
      await createEthAuction(ctx, 1n, eth("1"));
      await market.connect(bidder1).bid(0n, eth("1"), { value: eth("1") });

      const minNext = eth("1.05");
      await expect(
        market.connect(bidder2).bid(0n, minNext - 1n, { value: minNext - 1n }),
      )
        .to.be.revertedWithCustomError(market, "BidTooLow")
        .withArgs(minNext - 1n, minNext);

      await expect(
        market.connect(bidder2).bid(0n, minNext, { value: minNext }),
      ).to.emit(market, "BidPlaced");
    });

    it("卖家不能出价", async function () {
      const ctx = await load();
      const { market, seller } = ctx;
      await createEthAuction(ctx, 1n, eth("1"));

      await expect(
        market.connect(seller).bid(0n, eth("1"), { value: eth("1") }),
      ).to.be.revertedWithCustomError(market, "SellerCannotBid");
    });

    it("ETH 出价金额必须等于 msg.value", async function () {
      const ctx = await load();
      const { market, bidder1 } = ctx;
      await createEthAuction(ctx, 1n, eth("1"));

      await expect(
        market.connect(bidder1).bid(0n, eth("1"), { value: eth("0.9") }),
      ).to.be.revertedWithCustomError(market, "EthAmountMismatch");
    });

    it("ERC20 拍卖不能附带 ETH", async function () {
      const ctx = await load();
      const { market, bidder1 } = ctx;
      await createUsdcAuction(ctx, 1n, usdcUnits(1000));

      await expect(
        market.connect(bidder1).bid(0n, usdcUnits(1000), { value: 1n }),
      ).to.be.revertedWithCustomError(market, "EthAmountMismatch");
    });

    it("被超过的出价可以取回（ETH，pull 模式）", async function () {
      const ctx = await load();
      const { market, bidder1, bidder2 } = ctx;
      await createEthAuction(ctx, 1n, eth("1"));

      await market.connect(bidder1).bid(0n, eth("1"), { value: eth("1") });
      await market.connect(bidder2).bid(0n, eth("1.05"), { value: eth("1.05") });

      expect(await market.pendingReturns(0n, bidder1.address)).to.equal(eth("1"));

      await expect(market.connect(bidder1).WithdrawRefund(0n)).to.changeEtherBalance(
        ethers,
        bidder1.address,
        eth("1"),
      );
      expect(await market.pendingReturns(0n, bidder1.address)).to.equal(0n);
    });

    it("退款不能重复领取", async function () {
      const ctx = await load();
      const { market, bidder1, bidder2 } = ctx;
      await createEthAuction(ctx, 1n, eth("1"));
      await market.connect(bidder1).bid(0n, eth("1"), { value: eth("1") });
      await market.connect(bidder2).bid(0n, eth("1.05"), { value: eth("1.05") });

      await market.connect(bidder1).WithdrawRefund(0n);
      await expect(
        market.connect(bidder1).WithdrawRefund(0n),
      ).to.be.revertedWithCustomError(market, "NothingToRefund");
    });

    it("被超过的出价可以取回（ERC20）", async function () {
      const ctx = await load();
      const { market, bidder1, bidder2, usdc } = ctx;
      await createUsdcAuction(ctx, 1n, usdcUnits(1000));

      await market.connect(bidder1).bid(0n, usdcUnits(1000));
      await market.connect(bidder2).bid(0n, usdcUnits(1050));

      await expect(market.connect(bidder1).WithdrawRefund(0n)).to.changeTokenBalance(
        ethers,
        usdc,
        bidder1.address,
        usdcUnits(1000),
      );
    });

    it("拍卖结束后不能再出价", async function () {
      const ctx = await load();
      const { market, bidder1 } = ctx;
      await createEthAuction(ctx, 1n, eth("1"));

      const a = await market.getAuction(0n);
      await networkHelpers.time.increaseTo(Number(a.endTime));

      await expect(
        market.connect(bidder1).bid(0n, eth("1"), { value: eth("1") }),
      ).to.be.revertedWithCustomError(market, "AuctionEndedAlready");
    });

    it("不存在的拍卖不能出价", async function () {
      const ctx = await load();
      const { market, bidder1 } = ctx;
      await expect(
        market.connect(bidder1).bid(99n, eth("1"), { value: eth("1") }),
      ).to.be.revertedWithCustomError(market, "AuctionNotActive");
    });
  });

  // ============================================================
  // endAuction
  // ============================================================
  describe("endAuction", function () {
    it("未到结束时间不能结算", async function () {
      const ctx = await load();
      const { market } = ctx;
      await createEthAuction(ctx, 1n, eth("1"));

      await expect(market.endAuction(0n)).to.be.revertedWithCustomError(
        market,
        "AuctionNotEndedYet",
      );
    });

    it("无人出价：NFT 退回卖家", async function () {
      const ctx = await load();
      const { market, nft, seller } = ctx;
      await createEthAuction(ctx, 1n, eth("1"));

      const a = await market.getAuction(0n);
      await networkHelpers.time.increaseTo(Number(a.endTime) + 1);

      await expect(market.connect(ctx.stranger).endAuction(0n))
        .to.emit(market, "AuctionSettled")
        .withArgs(0n, ZERO, 0n, 0n);

      expect(await nft.ownerOf(1n)).to.equal(seller.address);
      expect((await market.getAuction(0n)).active).to.equal(false);
      expect(await market.isActive(0n)).to.equal(false);
    });

    it("ETH 结算：NFT 给最高出价者，卖家收款，平台收手续费", async function () {
      const ctx = await load();
      const { market, nft, seller, bidder1, feeRecipient } = ctx;
      await createEthAuction(ctx, 1n, eth("1"));

      const amount = eth("2");
      await market.connect(bidder1).bid(0n, amount, { value: amount });

      const a = await market.getAuction(0n);
      await networkHelpers.time.increaseTo(Number(a.endTime) + 1);

      const fee = (amount * FEE_BPS) / 10000n;
      const proceeds = amount - fee;

      await expect(market.connect(ctx.stranger).endAuction(0n)).to.changeEtherBalances(
        ethers,
        [seller.address, feeRecipient.address],
        [proceeds, fee],
      );

      expect(await nft.ownerOf(1n)).to.equal(bidder1.address);
      expect((await market.getAuction(0n)).active).to.equal(false);
      expect(await ethers.provider.getBalance(await market.getAddress())).to.equal(0n);
    });

    it("ERC20 结算：卖家与平台按比例收款", async function () {
      const ctx = await load();
      const { market, nft, seller, bidder1, feeRecipient, usdc } = ctx;
      await createUsdcAuction(ctx, 1n, usdcUnits(1000));

      const amount = usdcUnits(2000);
      await market.connect(bidder1).bid(0n, amount);

      const a = await market.getAuction(0n);
      await networkHelpers.time.increaseTo(Number(a.endTime) + 1);

      const fee = (amount * FEE_BPS) / 10000n;
      const proceeds = amount - fee;

      await expect(
        market.connect(ctx.stranger).endAuction(0n),
      ).to.changeTokenBalances(
        ethers,
        usdc,
        [seller.address, feeRecipient.address],
        [proceeds, fee],
      );

      expect(await nft.ownerOf(1n)).to.equal(bidder1.address);
      expect(await usdc.balanceOf(await market.getAddress())).to.equal(0n);
    });

    it("任何人都可以结算已到期的拍卖", async function () {
      const ctx = await load();
      const { market, stranger } = ctx;
      await createEthAuction(ctx, 1n, eth("1"));

      const a = await market.getAuction(0n);
      await networkHelpers.time.increaseTo(Number(a.endTime) + 1);

      await expect(market.connect(stranger).endAuction(0n)).to.emit(
        market,
        "AuctionSettled",
      );
    });

    it("不能重复结算", async function () {
      const ctx = await load();
      const { market } = ctx;
      await createEthAuction(ctx, 1n, eth("1"));

      const a = await market.getAuction(0n);
      await networkHelpers.time.increaseTo(Number(a.endTime) + 1);
      await market.endAuction(0n);

      await expect(market.endAuction(0n)).to.be.revertedWithCustomError(
        market,
        "AuctionNotActive",
      );
    });

    it("结算后被超过的出价者仍能取回资金", async function () {
      const ctx = await load();
      const { market, bidder1, bidder2 } = ctx;
      await createEthAuction(ctx, 1n, eth("1"));
      await market.connect(bidder1).bid(0n, eth("1"), { value: eth("1") });
      await market.connect(bidder2).bid(0n, eth("1.05"), { value: eth("1.05") });

      const a = await market.getAuction(0n);
      await networkHelpers.time.increaseTo(Number(a.endTime) + 1);
      await market.endAuction(0n);

      await expect(market.connect(bidder1).WithdrawRefund(0n)).to.changeEtherBalance(
        ethers,
        bidder1.address,
        eth("1"),
      );
    });
  });

  // ============================================================
  // cancelAuction
  // ============================================================
  describe("cancelAuction", function () {
    it("卖家在无人出价时可以取消，NFT 退回", async function () {
      const ctx = await load();
      const { market, nft, seller } = ctx;
      await createEthAuction(ctx, 1n, eth("1"));

      await expect(market.connect(seller).cancelAuction(0n))
        .to.emit(market, "AuctionCanceled")
        .withArgs(0n);

      expect(await nft.ownerOf(1n)).to.equal(seller.address);
      expect((await market.getAuction(0n)).active).to.equal(false);
    });

    it("非卖家不能取消", async function () {
      const ctx = await load();
      const { market, stranger } = ctx;
      await createEthAuction(ctx, 1n, eth("1"));

      await expect(
        market.connect(stranger).cancelAuction(0n),
      ).to.be.revertedWithCustomError(market, "NotTokenOwner");
    });

    it("已有出价时不能取消", async function () {
      const ctx = await load();
      const { market, seller, bidder1 } = ctx;
      await createEthAuction(ctx, 1n, eth("1"));
      await market.connect(bidder1).bid(0n, eth("1"), { value: eth("1") });

      await expect(market.connect(seller).cancelAuction(0n)).to.revert(ethers);
    });

    it("取消后不能再出价或结算", async function () {
      const ctx = await load();
      const { market, seller, bidder1 } = ctx;
      await createEthAuction(ctx, 1n, eth("1"));
      await market.connect(seller).cancelAuction(0n);

      await expect(
        market.connect(bidder1).bid(0n, eth("1"), { value: eth("1") }),
      ).to.be.revertedWithCustomError(market, "AuctionNotActive");
      await expect(market.endAuction(0n)).to.be.revertedWithCustomError(
        market,
        "AuctionNotActive",
      );
    });
  });

  // ============================================================
  // Chainlink 价格
  // ============================================================
  describe("Chainlink 价格换算", function () {
    it("AggregatorV3Interface 使用真实的 latestRoundData 选择器", async function () {
      const { ethFeed } = await load();
      expect(ethFeed.interface.getFunction("latestRoundData").selector).to.equal(
        "0xfeaf968c",
      );
      expect(ethFeed.interface.hasFunction("lastestRoundData")).to.equal(false);
    });

    it("ETH 与 ERC20 的 USD 估值", async function () {
      const ctx = await load();
      const { market, usdcAddr } = ctx;

      expect(await market.usdValueOf(ZERO, eth("1"))).to.equal(eth("2000"));
      expect(await market.usdValueOf(usdcAddr, usdcUnits(1000))).to.equal(
        eth("1000"),
      );
    });

    it("未配置价格源的代币回滚", async function () {
      const ctx = await load();
      await expect(
        ctx.market.usdValueOf(ctx.stranger.address, 1n),
      ).to.be.revertedWithCustomError(ctx.market, "UnsupportedToken");
    });

    it("价格非正数时回滚", async function () {
      const ctx = await load();
      await ctx.ethFeed.updateAnswer(0n);
      await expect(
        ctx.market.usdValueOf(ZERO, eth("1")),
      ).to.be.revertedWithCustomError(ctx.market, "BadPrice");
    });

    it("价格过期时回滚", async function () {
      const ctx = await load();
      const now = BigInt(await networkHelpers.time.latest());
      await ctx.ethFeed.updateAnswerWithTime(ETH_USD_8, now - 48n * 3600n - 1n);
      await expect(
        ctx.market.usdValueOf(ZERO, eth("1")),
      ).to.be.revertedWithCustomError(ctx.market, "BadPrice");
    });

    it("1 小时前的价格仍然可用（适配测试网稳定币 feed 的 24h 心跳）", async function () {
      const ctx = await load();
      const now = BigInt(await networkHelpers.time.latest());
      await ctx.ethFeed.updateAnswerWithTime(ETH_USD_8, now - 3600n);
      expect(await ctx.market.usdValueOf(ZERO, eth("1"))).to.equal(eth("2000"));
    });

    it("价格更新后使用最新价格", async function () {
      const ctx = await load();
      await ctx.ethFeed.updateAnswer(3000n * 10n ** 8n);
      expect(await ctx.market.usdValueOf(ZERO, eth("1"))).to.equal(eth("3000"));
    });

    it("getAuctionUsdValue 出价前用起拍价，出价后用最高价", async function () {
      const ctx = await load();
      const { market, bidder1 } = ctx;
      await createEthAuction(ctx, 1n, eth("1"));

      expect(await market.getAuctionUsdValue(0n)).to.equal(eth("2000"));

      await market.connect(bidder1).bid(0n, eth("1.05"), { value: eth("1.05") });
      expect(await market.getAuctionUsdValue(0n)).to.equal(eth("2100"));
    });
  });

  // ============================================================
  // 管理函数
  // ============================================================
  describe("管理函数与权限", function () {
    it("四个 setter 都只能由 owner 调用", async function () {
      const ctx = await load();
      const { market, stranger, usdcAddr, ethFeed } = ctx;

      const ethFeedAddr = await ethFeed.getAddress();
      for (const call of [
        () => market.connect(stranger).setFeeRecipient(stranger.address),
        () => market.connect(stranger).setFeeBps(100n),
        () => market.connect(stranger).setEthUsdFeed(ethFeedAddr),
        () => market.connect(stranger).setTokenFeed(usdcAddr, ZERO),
      ]) {
        await expect(call()).to.be.revertedWithCustomError(
          market,
          "OwnableUnauthorizedAccount",
        );
      }
    });

    it("费率上限为 10%", async function () {
      const ctx = await load();
      const { market } = ctx;
      await expect(market.connect(ctx.owner).setFeeBps(1001n)).to.be.revertedWithCustomError(
        market,
        "FeeTooHigh",
      );
      await market.connect(ctx.owner).setFeeBps(1000n);
      expect(await market.feeBps()).to.equal(1000n);
    });

    it("零地址校验", async function () {
      const ctx = await load();
      const { market } = ctx;
      await expect(
        market.connect(ctx.owner).setFeeRecipient(ZERO),
      ).to.be.revertedWithCustomError(market, "ZeroAddress");
      await expect(
        market.connect(ctx.owner).setEthUsdFeed(ZERO),
      ).to.be.revertedWithCustomError(market, "ZeroAddress");
    });

    it("setTokenFeed 可以更新价格源", async function () {
      const ctx = await load();
      const { market, usdcAddr, usdcFeed } = ctx;
      expect(await market.tokenUsdFeed(usdcAddr)).to.equal(
        await usdcFeed.getAddress(),
      );

      const other = await ethers.deployContract("MockV3Aggregator", [8, USDC_USD_8]);
      await other.waitForDeployment();
      await market.connect(ctx.owner).setTokenFeed(usdcAddr, await other.getAddress());
      expect(await market.tokenUsdFeed(usdcAddr)).to.equal(await other.getAddress());
    });

    it("setFeeRecipient 生效", async function () {
      const ctx = await load();
      await ctx.market.connect(ctx.owner).setFeeRecipient(ctx.stranger.address);
      expect(await ctx.market.feeRecipient()).to.equal(ctx.stranger.address);
    });
  });

  // ============================================================
  // UUPS 升级 + V2 动态手续费
  // ============================================================
  describe("UUPS 升级与 V2 动态手续费", function () {
    async function upgradeToV2(ctx, highValueFeeBps, highValueThreshold) {
      const v2 = await ethers.deployContract("NFTAuctionMarketV2");
      await v2.waitForDeployment();
      const data = v2.interface.encodeFunctionData("initializeV2", [
        highValueFeeBps,
        highValueThreshold,
      ]);
      await ctx.market.connect(ctx.owner).upgradeToAndCall(await v2.getAddress(), data);
      const marketV2 = await ethers.getContractAt(
        "NFTAuctionMarketV2",
        await ctx.proxy.getAddress(),
      );
      return { v2, marketV2 };
    }

    it("非 owner 不能升级", async function () {
      const ctx = await load();
      const v2 = await ethers.deployContract("NFTAuctionMarketV2");
      await v2.waitForDeployment();
      const data = v2.interface.encodeFunctionData("initializeV2", [100n, 0n]);

      await expect(
        ctx.market
          .connect(ctx.stranger)
          .upgradeToAndCall(await v2.getAddress(), data),
      )
        .to.be.revertedWithCustomError(ctx.market, "OwnableUnauthorizedAccount")
        .withArgs(ctx.stranger.address);
    });

    it("升级到 V2：状态保留，版本和动态费率字段生效", async function () {
      const ctx = await load();
      await createEthAuction(ctx, 1n, eth("1"));

      const { marketV2 } = await upgradeToV2(ctx, 100n, usdcUnits(1000));

      expect(await marketV2.version()).to.equal("v2");
      expect(await marketV2.owner()).to.equal(ctx.owner.address);
      expect(await marketV2.feeBps()).to.equal(FEE_BPS);
      expect(await marketV2.feeRecipient()).to.equal(ctx.feeRecipient.address);
      expect(await marketV2.auctionCount()).to.equal(1n);
      expect((await marketV2.getAuction(0n)).seller).to.equal(ctx.seller.address);
      expect(await marketV2.highValueFeeBps()).to.equal(100n);
      expect(await marketV2.highValueThreshold()).to.equal(usdcUnits(1000));
    });

    it("initializeV2 只能调用一次", async function () {
      const ctx = await load();
      const { marketV2 } = await upgradeToV2(ctx, 100n, usdcUnits(1000));

      await expect(
        marketV2.connect(ctx.owner).initializeV2(100n, usdcUnits(2000)),
      ).to.be.revertedWithCustomError(marketV2, "InvalidInitialization");
    });

    it("高价值拍卖使用更低的 V2 费率", async function () {
      const ctx = await load();
      const { marketV2 } = await upgradeToV2(ctx, 100n, usdcUnits(1000));

      await createUsdcAuction(ctx, 1n, usdcUnits(2000));
      const amount = usdcUnits(2000);
      await marketV2.connect(ctx.bidder1).bid(0n, amount);

      const a = await marketV2.getAuction(0n);
      await networkHelpers.time.increaseTo(Number(a.endTime) + 1);

      const fee = (amount * 100n) / 10000n; // 0.1%
      const proceeds = amount - fee;

      await expect(
        marketV2.connect(ctx.stranger).endAuction(0n),
      ).to.changeTokenBalances(
        ethers,
        ctx.usdc,
        [ctx.seller.address, ctx.feeRecipient.address],
        [proceeds, fee],
      );
      expect(fee).to.equal(usdcUnits(20));
    });

    it("低于阈值仍使用基础费率", async function () {
      const ctx = await load();
      const { marketV2 } = await upgradeToV2(ctx, 100n, usdcUnits(1000));

      await ctx.nft.mint(ctx.seller.address, "ipfs://token/3");
      await createUsdcAuction(ctx, 3n, usdcUnits(500));
      const amount = usdcUnits(500);
      await marketV2.connect(ctx.bidder1).bid(0n, amount);

      const a = await marketV2.getAuction(0n);
      await networkHelpers.time.increaseTo(Number(a.endTime) + 1);

      const fee = (amount * FEE_BPS) / 10000n; // 5%
      const proceeds = amount - fee;

      await expect(
        marketV2.connect(ctx.stranger).endAuction(0n),
      ).to.changeTokenBalances(
        ethers,
        ctx.usdc,
        [ctx.seller.address, ctx.feeRecipient.address],
        [proceeds, fee],
      );
      expect(fee).to.equal(usdcUnits(25));
    });

    it("V2 下调 feeBps 不能低于 highValueFeeBps", async function () {
      const ctx = await load();
      const { marketV2 } = await upgradeToV2(ctx, 100n, usdcUnits(1000));

      await expect(
        marketV2.connect(ctx.owner).setFeeBps(99n),
      ).to.be.revertedWith("V2: fee below high-value tier");

      await marketV2.connect(ctx.owner).setFeeBps(100n);
      expect(await marketV2.feeBps()).to.equal(100n);
    });

    it("setFeeTiers 校验高价值费率不高于基础费率", async function () {
      const ctx = await load();
      const { marketV2 } = await upgradeToV2(ctx, 100n, usdcUnits(1000));

      await expect(
        marketV2.connect(ctx.owner).setFeeTiers(600n, usdcUnits(1000)),
      ).to.be.revertedWith("V2: high fee must be lower");

      await marketV2.connect(ctx.owner).setFeeTiers(200n, usdcUnits(500));
      expect(await marketV2.highValueFeeBps()).to.equal(200n);
      expect(await marketV2.highValueThreshold()).to.equal(usdcUnits(500));
    });
  });
});
