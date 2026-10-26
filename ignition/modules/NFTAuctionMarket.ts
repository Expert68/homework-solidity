import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

/**
 * 本地部署：mock 预言机 + mock USDC + MyNFT + NFT 拍卖市场（UUPS 代理）。
 *
 * npx hardhat ignition deploy ignition/modules/NFTAuctionMarket.ts --network hardhatMainnet
 *
 * 可选参数：
 *   feeRecipient  平台手续费收款地址（默认部署账户）
 *   feeBps        平台费率，单位 1/10000（默认 500 = 5%）
 */
export default buildModule("NFTAuctionMarketModule", (m) => {
  const deployer = m.getAccount(0);
  const feeRecipient = m.getParameter("feeRecipient", deployer);
  const feeBps = m.getParameter("feeBps", 500n);

  const nft = m.contract("MyNFT");

  // 本地链没有真实 Chainlink feed，部署 mock：ETH = $2000，USDC = $1
  const ethUsdFeed = m.contract("MockV3Aggregator", [8, 2000n * 10n ** 8n], {
    id: "EthUsdFeed",
  });
  const usdcUsdFeed = m.contract("MockV3Aggregator", [8, 1n * 10n ** 8n], {
    id: "UsdcUsdFeed",
  });
  const usdc = m.contract("MockERC20", ["USD Coin", "USDC", 6], {
    id: "Usdc",
  });

  const implementation = m.contract("NFTAuctionMarket");

  const initializeData = m.encodeFunctionCall(implementation, "initialize", [
    deployer,
    feeRecipient,
    feeBps,
    ethUsdFeed,
  ]);

  const proxy = m.contract("NFTAuctionMarketProxy", [
    implementation,
    initializeData,
  ]);

  const market = m.contractAt("NFTAuctionMarket", proxy, { id: "Market" });

  // 给 USDC 配上价格源，之后就可以创建 ERC20 拍卖
  m.call(market, "setTokenFeed", [usdc, usdcUsdFeed], {
    id: "SetUsdcFeed",
  });

  return {
    nft,
    usdc,
    ethUsdFeed,
    usdcUsdFeed,
    implementation,
    proxy,
    market,
  };
});
