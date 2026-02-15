// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {MoltiToken} from "../src/MoltiToken.sol";
import {MoltiArena} from "../src/MoltiArena.sol";

/**
 * @title Deploy
 * @notice Deploys MoltiToken and MoltiArena to Monad.
 *
 * Usage:
 *   # 1. Copy .env.example to .env and fill in PRIVATE_KEY
 *   # 2. Run deployment:
 *
 *   # Testnet (uses foundry.toml default RPC)
 *   forge script script/Deploy.s.sol:Deploy --broadcast --verify
 *
 *   # Mainnet (override RPC)
 *   forge script script/Deploy.s.sol:Deploy --rpc-url <MAINNET_RPC> --broadcast --verify
 *
 *   # With explicit private key (not recommended)
 *   forge script script/Deploy.s.sol:Deploy --private-key <KEY> --broadcast
 */
contract Deploy is Script {
    /// @dev Agent creation fee: 100 MOLTI (18 decimals).
    uint256 constant CREATION_FEE = 100 ether;

    function run() external {
        // Load private key from environment
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        console.log("Deployer address:", deployer);
        console.log("Deployer balance:", deployer.balance);

        vm.startBroadcast(deployerKey);

        // 1. Deploy MoltiToken — entire supply goes to the deployer.
        MoltiToken token = new MoltiToken(deployer);
        console.log("MoltiToken deployed at:", address(token));

        // 2. Deploy MoltiArena — linked to the token, with 100 MOLTI creation fee.
        MoltiArena arena = new MoltiArena(address(token), CREATION_FEE);
        console.log("MoltiArena deployed at:", address(arena));

        vm.stopBroadcast();

        // Summary
        console.log("---");
        console.log("Deployer / Owner:", deployer);
        console.log("Agent creation fee:", CREATION_FEE / 1e18, "MOLTI");
        console.log("Token supply:", token.totalSupply() / 1e18, "MOLTI");
    }
}
