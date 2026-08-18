// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {MetrxCore} from "../src/MetrxCore.sol";

/// @notice Deploys MetrxCore to BOT Chain Mainnet and records the address for the app + docs.
/// @dev Run with:
///      forge script script/Deploy.s.sol:Deploy --rpc-url $BOT_RPC_URL --broadcast --legacy \
///        --private-key $DEPLOYER_PRIVATE_KEY
contract Deploy is Script {
    function run() external returns (MetrxCore core) {
        address aiVerifier = vm.envAddress("AI_VERIFIER_ADDRESS");
        require(aiVerifier != address(0), "AI_VERIFIER_ADDRESS unset");

        console.log("chain id       ", block.chainid);
        console.log("ai verifier    ", aiVerifier);

        vm.startBroadcast();
        core = new MetrxCore(aiVerifier);
        vm.stopBroadcast();

        console.log("MetrxCore      ", address(core));
        console.log("domainSeparator");
        console.logBytes32(core.domainSeparator());

        string memory json = string.concat(
            '{\n  "chainId": ',
            vm.toString(block.chainid),
            ',\n  "metrxCore": "',
            vm.toString(address(core)),
            '",\n  "aiVerifier": "',
            vm.toString(aiVerifier),
            '",\n  "domainSeparator": "',
            vm.toString(core.domainSeparator()),
            '",\n  "deployedAtBlock": ',
            vm.toString(block.number),
            "\n}\n"
        );
        vm.writeFile("../deployments/botchain-mainnet.json", json);
    }
}
