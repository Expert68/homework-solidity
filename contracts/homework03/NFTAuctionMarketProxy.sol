// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/// @notice OZ 的 ERC1967Proxy 只作为依赖存在，Hardhat 不会为它生成本地 artifact；
///         这里包一层可部署的代理，供 Ignition 和测试直接使用。
contract NFTAuctionMarketProxy is ERC1967Proxy {
    constructor(
        address implementation,
        bytes memory data
    ) ERC1967Proxy(implementation, data) payable {}
}
