import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

/**
 * 把已经部署的拍卖市场代理升级到 V2（动态手续费）。
 *
 * 先在 ignition/parameters/upgrade.json 里填上 proxyAddress，然后：
 * npx hardhat ignition deploy ignition/modules/UpgradeToV2.ts \
 *   --network sepolia --parameters ignition/parameters/upgrade.json
 *
 * 必填参数：
 *   proxyAddress          NFTAuctionMarketProxy 的地址
 *
 * 可选参数：
 *   highValueFeeBps       高价值拍卖费率（默认 100 = 1%，必须 <= 当前 feeBps）
 *   highValueThreshold    高价值阈值，按支付代币的最小单位（默认 1000e6）
 *
 * 注意：部署账户必须是代理的 owner，否则 upgradeToAndCall 会回滚。
 */
export default buildModule("UpgradeMarketToV2Module", (m) => {
  const proxyAddress = m.getParameter<string>("proxyAddress");
  const highValueFeeBps = m.getParameter("highValueFeeBps", 100n);
  const highValueThreshold = m.getParameter(
    "highValueThreshold",
    1000n * 10n ** 6n,
  );

  const marketV2 = m.contract("NFTAuctionMarketV2");

  const initializeV2Data = m.encodeFunctionCall(marketV2, "initializeV2", [
    highValueFeeBps,
    highValueThreshold,
  ]);

  const market = m.contractAt("NFTAuctionMarket", proxyAddress);

  m.call(market, "upgradeToAndCall", [marketV2, initializeV2Data], {
    id: "UpgradeToV2",
  });

  const upgraded = m.contractAt("NFTAuctionMarketV2", proxyAddress, {
    id: "UpgradedMarket",
  });

  return { marketV2, upgraded };
});
