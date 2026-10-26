import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

/**
 * 作业二：讨饭合约 BeggingContract
 *
 * 本地：
 * npx hardhat ignition deploy ignition/modules/BeggingContract.ts --network hardhatMainnet
 *
 * Sepolia：
 * npx hardhat ignition deploy ignition/modules/BeggingContract.ts --network sepolia
 *
 * 可选参数：
 *   durationDays  捐赠开放天数（默认 7）
 */
export default buildModule("BeggingContractModule", (m) => {
  const durationDays = m.getParameter("durationDays", 7n);
  const begging = m.contract("BeggingContract", [durationDays]);
  return { begging };
});
