# 作业2 + 作业3 上链操作手册

> 适用项目：`D:\web3学习\homework-solidity`  
> 适用对象：第一次上链的初学者  
> 最后更新：2026-10-23

---

## 当前项目状态（开始前先确认）

- 合约编译通过；
- `npx hardhat test` → **103 passing / 0 failing**；
- `npx hardhat test --coverage` → **96.51% 行 / 95.60% 语句**；
- 已提供以下部署模块：
  - `ignition/modules/BeggingContract.ts`（作业2）
  - `ignition/modules/NFTAuctionMarket.ts`（作业3 本地版，带 Mock）
  - `ignition/modules/NFTAuctionMarketSepolia.ts`（作业3 Sepolia 版）
  - `ignition/modules/UpgradeToV2.ts`（作业3 升级）
- `hardhat.config.ts` 已配置：
  - `localhost` 网络（持久化本地节点）
  - Etherscan 验证（读取 `ETHERSCAN_API_KEY`）
- 拍卖合约的 `MAX_PRICE_AGE` 已放宽到 **48 小时**（避免测试网稳定币 feed 心跳较长导致 USDC 出价失败）。

---

## 开始前的总检查清单

先不要急着部署，逐项打勾：

- [ ] 已安装 MetaMask
- [ ] 已创建 3 个账户：A（部署/owner）、B（卖家）、C（买家）
- [ ] 已添加 Sepolia 网络（链 ID `11155111`）
- [ ] A 账户有 ≥ 0.05 Sepolia ETH
- [ ] B、C 各有 ≥ 0.005 Sepolia ETH（用于 gas）
- [ ] C 账户有 20 Sepolia USDC（作业3 ERC20 演示）
- [ ] 已设置 `SEPOLIA_RPC_URL`、`SEPOLIA_PRIVATE_KEY`、`ETHERSCAN_API_KEY`
- [ ] `npx hardhat test` 本地 103 个测试全绿
- [ ] 已准备地址记录表（见附录 B）

---

## 目录

0. 先懂 6 个概念
1. 环境准备
2. 作业2：BeggingContract 上链
3. 作业3：NFT 拍卖市场上链
4. 常见报错对照表
5. 提交清单与演示顺序
6. 附录：快速命令、地址表、README 模板、相关文件

---

# 0. 先懂 6 个概念

## 0.1 测试网（Sepolia）

以太坊主网上的 ETH 是真钱；Sepolia 是测试网，规则一样，但 ETH 是假的、免费领的。

| 项目 | 值 |
|---|---|
| 链 ID | `11155111` |
| 浏览器 | `https://sepolia.etherscan.io` |
| 用途 | 部署、测试，不花真钱 |

**原理**：测试网和主网是两条独立的链，只是跑同样的 EVM。链 ID 用于防止交易跨链重放。

## 0.2 账户、私钥、地址

- **私钥**：一个 256 位随机数，谁拿到它，谁就能控制账户里的钱。
- **地址**：由私钥推导出来，可以公开。
- **助记词**：生成多个私钥的种子，权限比单个私钥更大。

**原理**：交易用私钥签名，节点用签名恢复出地址，从而确认交易确实是你发的。

**安全**：私钥/助记词只填进 MetaMask 或 Hardhat keystore，**永远不要**填进水龙头网页、聊天工具或 GitHub。

## 0.3 RPC

MetaMask 和 Hardhat 自己不存区块链数据，它们通过 RPC 节点读写链：

```
你的钱包 / Hardhat ──签名交易──▶ RPC 节点 ──广播──▶ Sepolia 网络
```

- 读数据（`balanceOf`、`getVotes`）走 `eth_call`，**不花 gas**。
- 写数据（`Donate`、`bid`）要发交易，**花 gas**，需要私钥签名。

## 0.4 Gas 和 Nonce

- **Gas**：每个操作都有计算成本，用 Sepolia ETH 支付。测试网上很便宜。
- **Nonce**：每个账户的交易计数器，从 0 开始，每发一笔 +1，交易必须按顺序上链。
  - 一笔交易卡住，后面的都会排队。
  - MetaMask 的“清除活动数据”只清本地显示，不改变链上 nonce。

**原理**：按 nonce 顺序执行，防止同一笔交易被重复执行（重放攻击）。

## 0.5 合约、ABI、验证

- **合约**：部署后有一个地址，里面存代码和状态。
- **ABI**：描述合约有哪些函数、参数类型、事件。MetaMask/Etherscan 靠它生成输入框。
- **验证（Verify）**：把源码和编译设置提交给 Etherscan，Etherscan 重新编译并对比字节码，一致才显示 **Read Contract / Write Contract**。

**原理**：链上只存字节码，不存源码。Etherscan 不知道函数名，除非你验证。验证后，函数选择器（4 字节）才能映射回 `bid(uint256,uint256)` 这样的名字。

## 0.6 代理和升级（UUPS）

作业3要求“合约可升级”。结构是：

```
你的调用 ──▶ Proxy（存数据）──delegatecall──▶ Implementation（存代码）
```

- **Proxy（代理）**：用户永远只和它交互，数据（拍卖、余额）都存在它这里。
- **Implementation（实现）**：真正的逻辑代码。
- **delegatecall**：Proxy 把调用转发给实现，但代码在 **Proxy 的存储** 上执行。
- **升级**：把 Proxy 里记录的“实现地址”换成 V2 的地址，Proxy 地址和数据都不变。

**原理**：合约部署后代码不可改，所以把“代码”和“数据”分开。升级只换代码地址，不换数据地址。

**注意**：**永远对 Proxy 地址读写**。直接对 Implementation 写，改的是实现合约自己的存储，和你的拍卖数据无关。

## 0.7 单位换算速查

| 概念 | 单位 | 例子 |
|---|---|---|
| ETH | wei，1 ETH = `10^18` wei | 0.01 ETH = `10000000000000000` |
| USDC | 6 位小数，1 USDC = `10^6` | 10 USDC = `10000000` |
| 手续费 | bps，1% = 100 bps | 5% = `500`，公式 `金额 × 500 / 10000` |
| 时间 | 秒 | 5 分钟 = `300` |

**原理**：Solidity 没有小数，所有金额都用整数的最小单位表示。USDC 的 `decimals()` 是 6，所以 1 USDC 在链上是 1,000,000。

---

# 1. 环境准备

## 1.1 打开项目终端

在 Windows 上，打开 PowerShell 或 VS Code 终端，进入项目目录：

```powershell
cd "D:\web3学习\homework-solidity"
```

> 下面所有 `npx hardhat ...` 命令都在这个目录执行。  
> 注意：本文所有命令都写成**一行**，PowerShell 和 Git Bash 都能直接运行。

## 1.2 准备三个账户

作业3里**卖家不能给自己出价**，所以至少需要两个角色。建议三个：

| 账户 | 角色 | 用途 |
|---|---|---|
| **A** | 部署者 / owner / 手续费收款人 | 部署合约、铸造 NFT、收 5% 手续费 |
| **B** | 卖家 | 持有 NFT、授权市场、创建拍卖 |
| **C** | 买家 | 出价、结算后拿 NFT |

在 MetaMask 里：

1. 点右上角头像 → **添加账户**，连续创建 3 个。
2. 起名：`A-deployer`、`B-seller`、`C-bidder`。
3. **只导出 A 的私钥**：
   - 选中 A → 账户详情 → **显示私钥** → 输入 MetaMask 密码 → 复制。

**原理**：一个助记词可以派生很多账户，它们互相独立。Hardhat 只需要 A 的私钥就能部署；B、C 只在 MetaMask 里点按钮，不需要导出私钥。

## 1.3 MetaMask 添加 Sepolia

MetaMask 通常自带 Sepolia。如果没有：

MetaMask → 网络选择器 → **添加网络 / 自定义网络**：

| 字段 | 填什么 |
|---|---|
| 网络名称 | `Sepolia` |
| RPC URL | 你的 RPC（见 1.5） |
| 链 ID | `11155111` |
| 货币符号 | `SepoliaETH` |
| 区块浏览器 | `https://sepolia.etherscan.io` |

**每次确认交易前，先看 MetaMask 左上角是不是 Sepolia。**

## 1.4 领 Sepolia ETH

准备 **0.05–0.1 ETH** 就够两份作业。

推荐顺序：

1. **Google Cloud Web3 Faucet**（最容易，只要有 Google 账号，每次 0.05 ETH，24 小时一次）：  
   `https://cloud.google.com/application/web3/faucet/ethereum/sepolia`
2. **Alchemy Faucet**（每次 0.1 ETH，但要求主网有 0.001 ETH）：  
   `https://www.alchemy.com/faucets/ethereum-sepolia`
3. **Chainlink Faucet**：`https://faucets.chain.link/`
4. **Infura Faucet**：`https://www.infura.io/faucet/sepolia`

操作：粘贴 **A 的地址** → 发送 → 等 1–2 分钟 → MetaMask 看到余额。

**原理**：水龙头是项目方在测试网上发假币的网站。它只认地址，不认私钥——**永远不要在水龙头上输入私钥或助记词**。

**领完后分一点给 B 和 C：**

- A → B 转 `0.005 ETH`
- A → C 转 `0.005 ETH`

MetaMask → 选中 A → **发送** → 粘贴 B 的地址 → 金额 `0.005` → 确认。C 同理。

> B 需要 gas 来 `approve` 和 `createAuction`；C 需要 gas 来 `bid` 和后续操作。

## 1.5 领 Sepolia USDC（作业3 ERC20 演示用）

打开：`https://faucet.circle.com/`

1. 网络选 **Ethereum Sepolia**
2. 代币选 **USDC**
3. 粘贴 **C 的地址**
4. 点请求，等 1–2 分钟

每次 **20 USDC**，每 2 小时一次，足够演示 10 USDC 起拍 + 10.5 USDC 加价。

**原理**：USDC 是 ERC20 代币，由合约管理余额。C 拿到 USDC 后，还要先 `approve` 市场合约，市场才能把 C 的 USDC 转走。

## 1.6 配置 Hardhat（RPC / 私钥 / Etherscan Key）

依次执行：

```powershell
npx hardhat keystore set SEPOLIA_RPC_URL
```

- 提示输入值时，粘贴 RPC URL（例如 `https://ethereum-sepolia-rpc.publicnode.com`）
- 再按提示设置一个 keystore 密码（记牢）

```powershell
npx hardhat keystore set SEPOLIA_PRIVATE_KEY
```

- 粘贴 **A 的私钥**（`0x` 开头）

```powershell
npx hardhat keystore set ETHERSCAN_API_KEY
```

- 粘贴 Etherscan API Key（在 `https://etherscan.io/myapikey` 免费申请）

检查：

```powershell
npx hardhat keystore list
```

应该能看到这三个键名。

**原理**：keystore 会把值加密后存在用户目录，不在项目里。Hardhat 配置里的 `configVariable("SEPOLIA_PRIVATE_KEY")` 运行时会去读它。这样私钥不会出现在代码或 Git 里。

**注意**：这个项目没有装 dotenv，所以把私钥写进 `.env` 不会自动生效；要么用 keystore，要么在当前终端用 `$env:SEPOLIA_PRIVATE_KEY = "..."`。

## 1.7 上链前预检

```powershell
npx hardhat test
```

预期：

```
103 passing
```

再确认：

- A 在 Sepolia 上有 ≥ 0.05 ETH
- B、C 各有 ≥ 0.005 ETH
- C 有 20 USDC
- `npx hardhat keystore list` 能看到三个键

---

# 2. 作业2：BeggingContract 上链

## 2.1 部署

```powershell
npx hardhat ignition deploy ignition/modules/BeggingContract.ts --network sepolia --deployment-id begging-sepolia
```

**你会看到：**

1. 编译（`Compiled ...`）
2. 逐批发送交易（`Batch #1 ...`）
3. 最后打印：

```
[ BeggingContractModule ] successfully deployed 🚀

Deployed Addresses

BeggingContractModule#BeggingContract - 0x....
```

**把这个地址填进附录 B 的地址表。** 这就是作业要交的合约地址。

如果中途失败（比如水不够），重新执行同一条命令，Ignition 会从上次进度继续，不会重复部署已成功的合约。

**原理**：部署合约是一笔“没有收款地址”的交易，数据里是编译后的字节码。EVM 执行它，把返回的运行时字节码存到新地址。新地址由“部署者地址 + nonce”决定，所以同一账户同一 nonce 只会得到一个地址。

## 2.2 验证合约

```powershell
npx hardhat ignition verify begging-sepolia --network sepolia
```

预期：看到每个合约的验证结果，最后类似 `Successfully verified`。

如果失败：

- 检查 `ETHERSCAN_API_KEY` 是否设置；
- 刚部署完 Etherscan 可能要几十秒才索引到，等 1 分钟重试；
- 也可以单独验证：

```powershell
npx hardhat verify --network sepolia <BeggingContract地址> 7
```

最后的 `7` 是构造参数 `durationDays = 7`。

**原理**：Etherscan 用你提交的源码重新编译，把得到的字节码和链上字节码对比。完全一致才通过。验证不是必须的，但不验证就没有 Read/Write Contract 页面。

## 2.3 在 Etherscan 上测试

打开：

```
https://sepolia.etherscan.io/address/<BeggingContract地址>
```

确认有 **Read Contract** 和 **Write Contract** 两个标签。

### ① 捐赠（截图 1）

1. 点 **Write Contract**
2. 点 **Connect to Web3** → 选 MetaMask → 连接 **A 账户**
3. 找到函数 **`Donate`**（注意大写 D）
4. 展开：
   - **Value** 填 `0.01`（单位选 ETH）
   - 其他不用填
5. 点 **Write** → MetaMask 确认
6. 等交易成功

预期事件：Logs 里有 `Donation`，参数是 donor、amount、total、timestamp。

**截图**：交易详情页 + 事件。

**原理**：`Donate` 是 `payable` 函数，MetaMask 里的 Value 会变成合约的 `msg.value`。合约检查 `msg.value >= 0.001 ETH`，把金额记到 `donations[msg.sender]`。

### ② 查询（截图 2）

点 **Read Contract**：

| 函数 | 输入 | 预期 |
|---|---|---|
| `getDonation` | A 的地址 | `10000000000000000`（0.01 ETH 的 wei） |
| `totalDonated` | 无 | 同上 |
| `donorCount` | 无 | `1` |
| `top3` | 无 | 第一个是 A，另外两个零地址 |
| `balance` | 无 | 合约余额 0.01 ETH |
| `timeLeft` | 无 | 大约 604800（7 天剩余秒数） |

**截图**：`getDonation` 的结果。

**原理**：`mapping(address => uint256) public donations` 会自动生成一个 `donations(address)` getter；`getDonation` 是手写的另一个入口，效果一样。`public` 变量在 ABI 里就是一个只读函数。

### ③ 提现（截图 3）

1. **Write Contract** → 仍然连接 **A**（只有 owner 能提现）
2. 找到 **`withdraw`**
3. 点 **Write** → 确认
4. 交易成功后：
   - Read → `balance()` → `0`
   - Read → `getDonation(A)` → 仍然是 `0.01 ETH`（历史记录保留）

**截图**：withdraw 交易详情 + `balance()` 为 0。

如果用 B 账户点 `withdraw`，会看到 `NotOwner()` 报错，这是正常的权限保护，也可以截图作为“权限测试”。

**原理**：`withdraw` 上有 `onlyOwner` 修饰器，执行前检查 `msg.sender == owner`。合约用 `call` 把全部余额转给 owner，并用 `nonReentrant` 防止重入。`donations` 是历史累计，提现不会清零；`address(this).balance` 才是合约里真实剩余。

## 2.4 可选：时间限制演示（加分）

再部署一个 `durationDays = 0` 的实例。

新建 `ignition/parameters/begging.closed.json`：

```json
{
  "BeggingContractModule": {
    "durationDays": 0
  }
}
```

执行：

```powershell
npx hardhat ignition deploy ignition/modules/BeggingContract.ts --network sepolia --deployment-id begging-closed --parameters ignition/parameters/begging.closed.json
```

部署成功后，任何 `Donate` 都会 revert `DonationClosed()`，截图即可。

**原理**：构造时 `deadline = block.timestamp + 0 days`。下一笔交易所在区块的时间一定大于部署区块的时间，`block.timestamp > deadline` 成立，所以 `beforeDeadline` 修饰器直接回滚。

## 2.5 作业2提交清单

- [ ] `contracts/homework02/BeggingContract.sol`
- [ ] Sepolia 合约地址
- [ ] 截图：Donate 成功、getDonation、withdraw 成功、balance 归零
- [ ] 可选截图：非 owner withdraw 回滚、过期 Donate 回滚
- [ ] 部署交易哈希

---

# 3. 作业3：NFT 拍卖市场上链

## 3.1 部署

```powershell
npx hardhat ignition deploy ignition/modules/NFTAuctionMarketSepolia.ts --network sepolia --deployment-id nft-auction-sepolia --parameters ignition/parameters/sepolia.json
```

预期输出 4 个地址：

```
MyNFT
NFTAuctionMarket          <- 实现合约（不要直接写它）
NFTAuctionMarketProxy     <- 交互用这个
Market                    <- 和 Proxy 是同一个地址
```

**全部填进附录 B 的地址表**，并标注“交互用 Proxy”。

**原理**：

- `MyNFT` 是 ERC721 合约，负责铸造和转移 NFT；
- `NFTAuctionMarket` 是实现合约，只存逻辑；
- `NFTAuctionMarketProxy` 是代理，存所有拍卖数据；
- `Market` 只是 Ignition 给“通过 Proxy 访问实现”起的一个别名，地址和 Proxy 相同。

部署模块会自动调用 `initialize` 设置 owner、手续费、ETH 价格源，并调用 `setTokenFeed` 配置 USDC 价格源。

部署记录在：

```
ignition/deployments/nft-auction-sepolia/deployed_addresses.json
```

## 3.2 验证

```powershell
npx hardhat ignition verify nft-auction-sepolia --network sepolia
```

预期：MyNFT、实现、Proxy 都被验证。

验证完打开 **Proxy 地址** 的 Etherscan 页面，应该出现 **Read as Proxy / Write as Proxy**。

如果没出现，点页面上的 **More Options → Is this a proxy?**，按提示确认。

**原理**：Etherscan 读 ERC1967 规定的存储槽（`0x3608...bbc`），发现里面是一个已验证的实现地址，就会把实现的 ABI 挂到代理页面上。

## 3.3 铸造 NFT（用 A 账户）

1. 打开 **MyNFT 地址** 的 Etherscan → **Write Contract**
2. **Connect to Web3** → 连接 **A**（MyNFT 的 owner）
3. 找到 **`mint`**
4. 填写：
   - `to`：**B 的地址**（卖家）
   - `uri`：`ipfs://demo/1`（任意字符串）
5. Write → MetaMask 确认

预期：

- Logs 里有 `Minted` 事件，`tokenId = 1`
- Read `ownerOf(1)` → B 的地址
- Read `tokenURI(1)` → `ipfs://demo/1`
- Read `totalMinted()` → `1`

**截图**：mint 交易 + `Minted` 事件。

**原理**：`mint` 有 `onlyOwner`，只有 A 能调用。`_safeMint` 会检查接收方合约是否实现 `onERC721Received`，防止 NFT 被永久锁死。`_nextTokenId` 从 1 开始，所以第一个 NFT 的 `tokenId` 是 1。

## 3.4 创建拍卖（用 B 账户）

### 第一步：授权市场

1. 打开 **MyNFT 地址** → **Write Contract**
2. **Connect to Web3** → 切到 **B**
3. 找到 **`approve`**
4. 填写：
   - `to`：**Proxy 地址**
   - `tokenId`：`1`
5. Write → 确认

**原理**：ERC721 默认不允许别人转走你的 NFT。`approve(proxy, 1)` 表示“允许 Proxy 转走 tokenId=1 这一个 NFT”。市场在 `createAuction` 里会调用 `transferFrom(B, 市场, 1)`，把 NFT 托管进市场。

也可以调用 `setApprovalForAll(proxy, true)`，一次授权所有 NFT。

### 第二步：创建拍卖

1. 打开 **Proxy 地址** → **Write as Proxy**
2. 连接 **B**
3. 找到 **`createAuction`**
4. 选一种：

**ETH 拍卖：**

| 字段 | 值 |
|---|---|
| `nft` | MyNFT 地址 |
| `tokenId` | `1` |
| `payToken` | `0x0000000000000000000000000000000000000000` |
| `startPrice` | `10000000000000000`（0.01 ETH，wei） |
| `duration` | `300`（5 分钟） |

**USDC 拍卖：**

| 字段 | 值 |
|---|---|
| `nft` | MyNFT 地址 |
| `tokenId` | `1` |
| `payToken` | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` |
| `startPrice` | `10000000`（10 USDC，6 位小数） |
| `duration` | `300` |

5. Write → 确认

预期：

- Logs 里有 `AuctionCreated`，`auctionId = 0`
- Read `auctionCount()` → `1`
- Read `getAuction(0)` → seller 是 B，`startPrice` 正确，`active = true`
- Read `isActive(0)` → `true`
- **Read `ownerOf(1)` → Proxy 地址**（NFT 已被托管，正常）

**截图**：createAuction 交易 + `AuctionCreated` 事件。

**原理（为什么 NFT 会到市场手里）**：

如果 NFT 一直留在卖家手里，卖家可以在拍卖期间转走 NFT，拍卖结束时无法交割，买家的钱就卡死了。所以 `createAuction` 会把 NFT **托管（escrow）** 到市场合约里。这样卖家既不能转走，也不能撤销授权。拍卖结束后，市场再把 NFT 转给赢家。

**注意**：`createAuction` **不是 payable**，Value 留 0。`payToken = 0x0` 表示原生 ETH；填 USDC 地址表示 ERC20。`duration` 必须在 60 秒到 30 天之间。

## 3.5 ETH 出价（用 C 账户）

1. 打开 **Proxy 地址** → **Write as Proxy**
2. 连接 **C**（不能是 B，卖家出价会 `SellerCannotBid`）
3. 找到 **`bid`**
4. 填写：
   - `auctionId`：`0`
   - `amount`：`10000000000000000`（0.01 ETH，**wei**）
   - **Value**：`0.01`（Etherscan 的 Value 单位是 **ETH**）
5. Write → 确认

预期：

- Logs 里有 `BidPlaced`
  - `amount = 0.01 ETH`
  - `usdValue = 20000000000000000000`（按 $2000 算的 20 USD，18 位小数）
- `getAuction(0)` 的 `highestBid` / `highestBidder` 更新
- 合约 ETH 余额 = 0.01 ETH

**第二次出价**必须至少高 5%：

- `amount` = `10500000000000000`（0.0105 ETH）
- Value = `0.0105`

**原理**：

- `amount` 是 `uint256`，单位 wei；Value 是交易附带的 ETH，单位 ETH。两者必须相等，否则 revert `EthAmountMismatch`。
- 第一次出价 `minBid = startPrice`；之后 `minBid = highestBid + highestBid × 5%`，防止 +1 wei 刷价。
- 合约把出价转成美元只是为了事件里给用户看（`usdValue`），拍卖内部比较仍用原始代币金额。
- 出价时先把上一任最高出价记到 `pendingReturns`，再更新最高价，最后才转账（CEI 顺序），并且 `bid` 有 `nonReentrant`。

## 3.6 USDC 出价（用 C 账户）

### 第一步：授权 USDC

1. 打开 **USDC 地址**（`0x1c7D...`）→ **Write Contract**
2. 连接 **C**
3. 找到 **`approve`**
4. 填写：
   - `spender`：**Proxy 地址**
   - `amount`：`10500000`（10.5 USDC，6 位小数）
5. Write → 确认

### 第二步：出价

1. 打开 **Proxy 地址** → **Write as Proxy**
2. 连接 **C**
3. `bid`：
   - `auctionId`：`0`
   - `amount`：`10500000`（10.5 USDC）
   - **Value 留 0**
4. Write → 确认

预期：

- `BidPlaced` 事件里 `amount = 10500000`，`usdValue = 10500000000000000000`（10.5 USD，18 位小数）
- 合约 USDC 余额增加 10.5

**原理**：

- ERC20 不是原生币，不能通过 `msg.value` 发送。市场用 `safeTransferFrom(C, 市场, amount)` 把 USDC 拉进来。
- `approve` 是 ERC20 的授权机制：C 允许市场最多花自己多少 USDC。没有授权，`safeTransferFrom` 会 revert `ERC20InsufficientAllowance`。
- 如果是 ERC20 拍卖，`bid` 的 Value 必须为 0，否则 `EthAmountMismatch`。

## 3.7 被超过后退款

1. 让另一个账户 D 出更高价（比如 0.011 ETH 或 11 USDC）
2. C 被超过后，Read `pendingReturns(0, C的地址)` → 显示 C 之前出的金额
3. C 打开 **Write as Proxy** → `WithdrawRefund`
   - `auctionId`：`0`
4. 确认后，C 的 ETH/USDC 退回

预期：退款成功；再次调用会 revert `NothingToRefund`。

**截图**：`pendingReturns` + 退款交易。

**原理（pull over push）**：合约不主动把退款推给被超过的人，而是记账，让用户自己来拉。主动转账时，如果对方是恶意合约，可能重入；如果对方拒收，整个出价交易会失败。记账+自取更安全。

## 3.8 结算（等 5 分钟后）

拍卖到期后，**任何账户**（A/B/C 都行）都可以：

1. 打开 **Proxy 地址** → **Write as Proxy**
2. 找到 **`endAuction`**
3. `auctionId`：`0`
4. Write → 确认

预期：

| 检查项 | 结果 |
|---|---|
| `ownerOf(1)` | 最高出价者 C |
| `getAuction(0).active` | `false` |
| 卖家 B 的余额 | 增加 `出价 × 95%` |
| feeRecipient（A）的余额 | 增加 `出价 × 5%` |
| 合约余额（该拍卖） | 归零 |

**算例（0.01 ETH）：**

- 手续费 = `0.01 × 500 / 10000` = `0.0005 ETH`
- 卖家得到 `0.0095 ETH`
- A 得到 `0.0005 ETH`

**算例（10 USDC）：**

- 手续费 = `10 × 500 / 10000` = `0.5 USDC`
- 卖家得到 `9.5 USDC`
- A 得到 `0.5 USDC`

**截图**：endAuction 交易 + `AuctionSettled` 事件 + NFT owner + 余额。

**原理**：`endAuction` 先检查 `block.timestamp >= endTime`，把 `active = false`，再把托管的 NFT 转给赢家，最后按 `proceeds = highestBid - fee` 给卖家、`fee` 给手续费收款人。如果无人出价，NFT 退回卖家。`endAuction` 任何人可调，卖家不能拖着不结算。

## 3.9 升级到 V2（UUPS）

新建 `ignition/parameters/upgrade.sepolia.json`：

```json
{
  "UpgradeMarketToV2Module": {
    "proxyAddress": "0x你的Proxy地址",
    "highValueFeeBps": 100,
    "highValueThreshold": 10000000
  }
}
```

- `highValueThreshold = 10000000` 表示 10 USDC（6 位小数）。10 USDC 以上的拍卖走 1% 费率；
- 如果演示 ETH，阈值要按 wei 填（例如 0.01 ETH = `10000000000000000`）。

执行：

```powershell
npx hardhat ignition deploy ignition/modules/UpgradeToV2.ts --network sepolia --deployment-id upgrade-sepolia --parameters ignition/parameters/upgrade.sepolia.json
```

预期：看到 `UpgradeToV2` 交易成功。

回到 **Proxy 地址** → **Read as Proxy**：

| 函数 | 预期 |
|---|---|
| `version()` | `"v2"` |
| `highValueFeeBps()` | `100` |
| `highValueThreshold()` | `10000000` |
| `feeBps()` | 仍然是 `500` |
| `owner()` | 仍然是 A |
| `auctionCount()` | 升级前的值不变 |

**截图**：升级交易 + `version()` 返回 `v2`。

**原理（UUPS 升级到底改了什么）**：

- Proxy 里有一个固定的存储槽（ERC1967 槽），存着“当前实现地址”。
- `upgradeToAndCall(newImpl, data)` 做两件事：把槽改成 `newImpl`，然后 `delegatecall` 调用 `newImpl` 的 `initializeV2`。
- Proxy 的地址、NFT、拍卖、余额数据都不变；只是以后所有调用都走 V2 的代码。
- `initializeV2` 用 `reinitializer(2)`，表示“这是第 2 次初始化”，只能成功一次。
- 只有 owner 能升级（`_authorizeUpgrade` 有 `onlyOwner`），所以升级模块必须用 A 的私钥部署。
- V2 只改了 `_calcFee`：金额 ≥ 阈值时用 `highValueFeeBps`，否则用 `feeBps`，实现“金额越大手续费越低”。

## 3.10 测试报告与覆盖率

```powershell
npx hardhat test
npx hardhat test --coverage
```

当前基线：

```
103 passing
Total line coverage: 96.51%
Total statement coverage: 95.60%
NFTAuctionMarket.sol: 96.91% / 96.18%
NFTAuctionMarketV2.sol: 100% / 100%
```

HTML 报告：`coverage/html/index.html`，可以直接打开截图。

**原理**：测试在本地内存链上跑，不花真实 gas、不碰 Sepolia。覆盖率统计 Solidity 源码里哪些行/语句被测试执行过。`--coverage` 会插桩编译，结果只看本地。

## 3.11 作业3提交清单

- [ ] 代码：`contracts/`、`test/`、`ignition/`
- [ ] 测试截图：`103 passing` + 覆盖率表/HTML
- [ ] 地址：MyNFT、实现、**Proxy**、BeggingContract
- [ ] 截图：mint、approve、createAuction、bid（ETH 和 USDC 各一张）、endAuction、升级 + `version()`
- [ ] 文档：更新 `README.md`（项目结构、功能、部署步骤、测试结果、地址）
- [ ] 部署交易哈希

---

# 4. 常见报错对照表

| 报错/现象 | 原因 | 解决 |
|---|---|---|
| `SEPOLIA_RPC_URL` / `SEPOLIA_PRIVATE_KEY` 未设置 | keystore 或环境变量没配 | 重新 `keystore set`，或当前终端 `$env:` |
| 部署时 `insufficient funds` | A 没 ETH | 领水，给 A 转 |
| 交易一直 pending | nonce 卡住 / gas 太低 | MetaMask 清除活动数据，或等；不要重复发 |
| Etherscan 没有 Write Contract | 合约没验证 | `npx hardhat ignition verify <id> --network sepolia` |
| `BadPrice()` | feed 超过 48 小时没更新 | 等下一次 feed 更新，或重试 |
| `ERC20InsufficientAllowance` | USDC 没 approve 或额度不够 | 先 `approve(Proxy, 足够金额)` |
| `MarketNotApproved()` | NFT 没 approve 给市场 | 先 `approve(Proxy, tokenId)` |
| `NotTokenOwner()` | 不是 NFT owner；或 NFT 已被托管 | 检查 `ownerOf`；重复上架会报这个 |
| `BidTooLow(given, minimum)` | 第一次低于起拍价，或加价不足 5% | 按提示的最小值出价 |
| `SellerCannotBid()` | 卖家给自己出价 | 换 C/D 账户 |
| `EthAmountMismatch()` | `amount` 和 Value 不相等；或 ERC20 拍卖带了 ETH | ETH 拍卖两者一致；ERC20 拍卖 Value=0 |
| `AuctionNotEndedYet()` | 还没到结束时间 | 等 `endTime` |
| `AuctionNotActive()` | ID 错 / 已结束 / 已取消 | 用 `auctionCount` 和事件确认 ID |
| `NothingToRefund()` | 没有可退金额，或已经退过 | 检查 `pendingReturns` |
| 升级 `OwnableUnauthorizedAccount` | 不是 owner 在升级 | 用 A 的 keystore 部署升级模块 |
| 升级后 `version()` 还是 v1 | 升级没成功 / 看的是实现合约 | 对 **Proxy** 读 `version()` |
| `ownerOf(1)` 变成 Proxy | NFT 被托管 | 正常，结算后会转给赢家 |
| 金额差了 10^6 / 10^18 | 单位用错 | USDC 6 位、ETH 18 位 |
| MetaMask 提示 wrong network | 钱包不在 Sepolia | 切换网络后再确认 |
| 验证失败 | API key 错 / 刚部署没索引 / 编译器设置不一致 | 等 1 分钟重试，检查 key |
| 水龙头领不到 | 额度用完 / 需要主网余额 | 换 Google Cloud / Alchemy / Chainlink / Circle |

---

# 5. 提交清单与演示顺序

## 5.1 推荐顺序

1. **本地**：`npx hardhat test` → 103 passing
2. **领水**：A 领 ETH，分给 B/C；C 领 20 USDC
3. **作业2**：部署 → 验证 → Donate → getDonation → withdraw → 截图
4. **作业3 部署**：部署 → 验证 → 记录 4 个地址
5. **作业3 ETH 拍卖**：mint → approve → createAuction（300 秒）→ bid → 等 5 分钟 → endAuction → 截图
6. **作业3 USDC 拍卖**（推荐）：mint 第二个 NFT → createAuction（10 USDC）→ approve USDC → bid → endAuction → 截图
7. **升级 V2**：写参数文件 → 部署升级 → 读 `version()` → 截图
8. **测试报告**：`npx hardhat test --coverage` → 截图/打开 HTML
9. **文档**：更新 README，填地址

预计时间：环境 30 分钟 + 作业2 30 分钟 + 作业3 1–1.5 小时（含 5 分钟等待）。

## 5.2 演示时容易忘的三件事

1. **写操作对 Proxy，不对 Implementation**；
2. **金额先换算**：ETH 18 位、USDC 6 位；
3. **确认前看 MetaMask 是不是 Sepolia，以及当前是哪个账户**。

---

# 6. 附录

## 附录 A：快速命令清单

```powershell
# 本地测试
npx hardhat test
npx hardhat test --coverage

# 配置
npx hardhat keystore set SEPOLIA_RPC_URL
npx hardhat keystore set SEPOLIA_PRIVATE_KEY
npx hardhat keystore set ETHERSCAN_API_KEY
npx hardhat keystore list

# 作业2
npx hardhat ignition deploy ignition/modules/BeggingContract.ts --network sepolia --deployment-id begging-sepolia
npx hardhat ignition verify begging-sepolia --network sepolia

# 作业3
npx hardhat ignition deploy ignition/modules/NFTAuctionMarketSepolia.ts --network sepolia --deployment-id nft-auction-sepolia --parameters ignition/parameters/sepolia.json
npx hardhat ignition verify nft-auction-sepolia --network sepolia

# 作业3 升级
npx hardhat ignition deploy ignition/modules/UpgradeToV2.ts --network sepolia --deployment-id upgrade-sepolia --parameters ignition/parameters/upgrade.sepolia.json
```

## 附录 B：地址记录表

部署时把地址填进来：

| 项目 | 地址 |
|---|---|
| BeggingContract | |
| MyNFT | |
| NFTAuctionMarket（实现） | |
| NFTAuctionMarketProxy（交互用） | |
| Sepolia USDC | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` |
| ETH/USD feed | `0x694AA1769357215DE4FAC081bf1f309aDC325306` |
| USDC/USD feed | `0xA2F78ab2355fe2f984D808B5CeE7FD0A93D5270E` |

## 附录 C：README 模板

作业3要求详细文档。把 `README.md` 换成下面几节：

1. **项目结构**：`contracts/homework01~03`、`test/`、`ignition/` 各自是什么
2. **功能说明**：NFT、拍卖、Chainlink 美元估值、UUPS 升级、V2 动态手续费
3. **部署步骤**：本手册 1.6、2.1、3.1、3.9 的命令
4. **测试**：`npx hardhat test` 结果 + 覆盖率
5. **已部署地址**：附录 B 的表
6. **设计说明**：NFT 托管、pull 退款、5% 加价、48 小时价格有效期、手续费 bps

## 附录 D：本手册对应的项目文件

| 文件 | 作用 |
|---|---|
| `contracts/homework02/BeggingContract.sol` | 作业2 合约 |
| `contracts/homework03/MyNFT.sol` | ERC721 NFT |
| `contracts/homework03/NFTAuctionMarket.sol` | 拍卖市场 V1 |
| `contracts/homework03/NFTAuctionMarketV2.sol` | V2 动态手续费 |
| `contracts/homework03/NFTAuctionMarketProxy.sol` | 可部署的 ERC1967 代理 |
| `contracts/homework03/interfaces/AggregatorV3Interface.sol` | Chainlink 接口 |
| `contracts/homework03/mocks/MockV3Aggregator.sol` | 本地 Mock feed |
| `contracts/homework03/mocks/MockERC20.sol` | 本地 Mock USDC |
| `ignition/modules/BeggingContract.ts` | 作业2 部署模块 |
| `ignition/modules/NFTAuctionMarket.ts` | 作业3 本地部署（Mock） |
| `ignition/modules/NFTAuctionMarketSepolia.ts` | 作业3 Sepolia 部署 |
| `ignition/modules/UpgradeToV2.ts` | 作业3 升级模块 |
| `ignition/parameters/sepolia.json` | Sepolia 真实地址参数 |
| `test/homework01.test.js` | 作业1 测试 |
| `test/homework02.test.js` | 作业2 测试 |
| `test/homework03.test.js` | 作业3 测试 |
| `hardhat.config.ts` | 网络与验证配置 |

---

**最后提醒**：所有写操作都在 Proxy 地址上做；所有金额先换算成最小单位（ETH 18 位、USDC 6 位）；每次确认前看 MetaMask 是不是 Sepolia、是不是正确的账户。做到这三点，基本不会出错。
