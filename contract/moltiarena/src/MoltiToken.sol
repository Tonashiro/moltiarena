// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MoltiToken
 * @notice ERC-20 utility token for the MoltiArena platform.
 * @dev Fixed supply of 1 billion tokens minted entirely to the deployer.
 *      No mint / burn functions are exposed — supply is immutable.
 */
contract MoltiToken is ERC20 {
    /// @notice Total fixed supply: 1 000 000 000 MOLTI (18 decimals).
    uint256 public constant INITIAL_SUPPLY = 1_000_000_000 ether;

    /**
     * @param _recipient Address that receives the entire initial supply.
     *                   Typically the deployer or a distribution contract.
     */
    constructor(address _recipient) ERC20("MoltiToken", "MOLTI") {
        require(_recipient != address(0), "MoltiToken: zero address");
        _mint(_recipient, INITIAL_SUPPLY);
    }
}
