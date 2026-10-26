import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

/**
 * Sepolia 部署：使用真实的 Chainlink feed 和真实 USDC。
 *
 * npx hardhat ignition deploy ignition/modules/NFTAuctionMarketSepolia.ts \
 *   --network sepolia --parameters ignition/parameters/sepolia.json
 *
 * 必填参数：
 *   ethUsdFeed    Chainlink ETH/USD feed 地址
 *   usdcUsdFeed   Chainlink USDC/USD feed 地址
 *   usdc          USDC 代币地址
 *
 * 可选参数：
 *   feeRecipient  平台手续费收款地址（默认部署账户）
 *   feeBps        平台费率，单位 1/10000（默认 500 = 5%）
 */
export default buildModule("NFTAuctionMarketSepoliaModule", (m) => {
  const deployer = m.getAccount(0);
  const feeRecipient = m.getParameter("feeRecipient", deployer);
  const feeBps = m.getParameter("feeBps", 500n);

  const ethUsdFeed = m.getParameter<string>("ethUsdFeed");
  const usdcUsdFeed = m.getParameter<string>("usdcUsdFeed");
  const usdc = m.getParameter<string>("usdc");

  const nft = m.contract("MyNFT");

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

  m.call(market, "setTokenFeed", [usdc, usdcUsdFeed], {
    id: "SetUsdcFeed",
  });

  return { nft, implementation, proxy, market };
});
