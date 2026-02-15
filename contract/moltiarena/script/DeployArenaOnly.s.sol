// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {MoltiArena} from "../src/MoltiArena.sol";

/**
 * @title DeployArenaOnly
 * @notice Deploys only MoltiArena using an existing MoltiToken address from env.
 *
 * Usage:
 *   # 1. Set in .env (or export):
 *   #    PRIVATE_KEY=0x...
 *   #    MOLTI_TOKEN_ADDRESS=0xYourExistingTokenAddress
 *   # 2. Run:
 *
 *   # Testnet (uses foundry.toml default RPC)
 *   forge script script/DeployArenaOnly.s.sol:DeployArenaOnly --broadcast --verify
 *
 *   # Mainnet
 *   forge script script/DeployArenaOnly.s.sol:DeployArenaOnly --rpc-url <MAINNET_RPC> --broadcast --verify
 */
contract DeployArenaOnly is Script {
    /// @dev Agent creation fee: 100 MOLTI (18 decimals).
    uint256 constant CREATION_FEE = 100 ether;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address token = vm.envAddress("MOLTI_TOKEN_ADDRESS");

        console.log("Deployer address:", deployer);
        console.log("Deployer balance:", deployer.balance);
        console.log("MoltiToken address:", token);

        vm.startBroadcast(deployerKey);

        MoltiArena arena = new MoltiArena(token, CREATION_FEE);
        console.log("MoltiArena deployed at:", address(arena));

        vm.stopBroadcast();

        console.log("---");
        console.log("MoltiArena:", address(arena));
        console.log("MoltiToken:", token);
        console.log("Agent creation fee:", CREATION_FEE / 1e18, "MOLTI");
    }
}
