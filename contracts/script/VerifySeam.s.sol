// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {MetrxCore} from "../src/MetrxCore.sol";

/// @notice Read-only pre-broadcast check against the live chain.
/// @dev Run with: forge script script/VerifySeam.s.sol:VerifySeam --rpc-url $BOT_RPC_URL
contract VerifySeam is Script {
    function run() external view {
        address deployer = vm.envOr("DEPLOYER_ADDRESS", address(0));

        console.log("chain id       ", block.chainid);
        console.log("block number   ", block.number);
        console.log("block timestamp", block.timestamp);
        console.log("basefee (wei)  ", block.basefee);

        require(block.chainid == 677, "not BOT Chain Mainnet (677)");

        if (deployer != address(0)) {
            console.log("deployer       ", deployer);
            console.log("deployer wei   ", deployer.balance);
            require(deployer.balance > 0, "deployer has no BOT: fund before broadcast");
        }

        address existing = vm.envOr("METRX_CORE_ADDRESS", address(0));
        if (existing != address(0)) {
            console.log("metrx core     ", existing);
            console.log("code size      ", existing.code.length);
            if (existing.code.length > 0) {
                console.log("ai verifier    ", MetrxCore(existing).aiVerifier());
                console.log("total orders   ", MetrxCore(existing).totalOrders());
            }
        }
    }
}
