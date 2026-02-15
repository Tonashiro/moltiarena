// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console} from "forge-std/Test.sol";
import {MoltiToken} from "../src/MoltiToken.sol";
import {MoltiArena} from "../src/MoltiArena.sol";

/**
 * @title MoltiArenaTest
 * @notice Comprehensive test suite for MoltiToken and MoltiArena contracts.
 */
contract MoltiArenaTest is Test {
    MoltiToken public token;
    MoltiArena public arena;

    // Actors
    address public deployer = address(this);
    address public alice = makeAddr("alice");
    address public bob = makeAddr("bob");
    address public operatorAddr = makeAddr("operator");
    address public agentWallet1 = makeAddr("agentWallet1");
    address public agentWallet2 = makeAddr("agentWallet2");

    // Constants matching the contracts
    uint256 constant CREATION_FEE = 100 ether;        // 100 MOLTI
    uint256 constant SCALE = 1e18;
    uint256 constant BUY_AMOUNT = 200 ether;           // MOLTI to spend on a BUY trade
    uint256 constant WALLET_CAPITAL = 1100 ether;      // MOLTI for agent wallet (100 epoch fee + 1000 trading)
    uint256 constant INITIAL_SUPPLY = 1_000_000_000 ether;

    // Sample values
    bytes32 constant PROFILE_HASH = keccak256("test-profile-json");
    address constant TOKEN_ADDRESS = address(0xCAFE);
    uint256 constant PRICE = 0.001 ether;              // 0.001 MOLTI per token unit
    uint256 constant SIZE_50_PCT = 0.5 ether;          // 50 %

    function setUp() public {
        // Deploy token — this test contract is the deployer and receives all supply
        token = new MoltiToken(deployer);

        // Deploy arena
        arena = new MoltiArena(address(token), CREATION_FEE);

        // Fund test users with MOLTI
        token.transfer(alice, 100_000 ether);
        token.transfer(bob, 100_000 ether);

        // Set operator
        arena.setOperator(operatorAddr);
    }

    // ===============================================================
    //  MoltiToken tests
    // ===============================================================

    function test_TokenDeployment() public view {
        assertEq(token.name(), "MoltiToken");
        assertEq(token.symbol(), "MOLTI");
        assertEq(token.decimals(), 18);
        assertEq(token.totalSupply(), INITIAL_SUPPLY);
    }

    function test_TokenInitialBalance() public view {
        // Deployer started with full supply, sent 200k to alice+bob
        uint256 deployerBal = INITIAL_SUPPLY - 200_000 ether;
        assertEq(token.balanceOf(deployer), deployerBal);
        assertEq(token.balanceOf(alice), 100_000 ether);
        assertEq(token.balanceOf(bob), 100_000 ether);
    }

    function test_TokenTransfer() public {
        vm.prank(alice);
        token.transfer(bob, 50 ether);
        assertEq(token.balanceOf(alice), 99_950 ether);
        assertEq(token.balanceOf(bob), 100_050 ether);
    }

    function test_TokenRevertZeroRecipient() public {
        vm.expectRevert();
        new MoltiToken(address(0));
    }

    // ===============================================================
    //  Agent creation tests
    // ===============================================================

    function test_CreateAgent() public {
        vm.startPrank(alice);
        token.approve(address(arena), CREATION_FEE);

        uint256 balBefore = token.balanceOf(alice);
        uint256 agentId = arena.createAgent(PROFILE_HASH, agentWallet1);
        uint256 balAfter = token.balanceOf(alice);

        assertEq(agentId, 1);
        assertEq(balBefore - balAfter, CREATION_FEE);
        assertEq(arena.collectedFees(), CREATION_FEE);

        MoltiArena.AgentInfo memory info = arena.getAgent(agentId);
        assertEq(info.owner, alice);
        assertEq(info.wallet, agentWallet1);
        assertEq(info.profileHash, PROFILE_HASH);
        assertTrue(info.exists);

        vm.stopPrank();
    }

    function test_CreateAgentEmitsEvent() public {
        vm.startPrank(alice);
        token.approve(address(arena), CREATION_FEE);

        vm.expectEmit(true, true, false, true);
        emit MoltiArena.AgentCreated(1, alice, agentWallet1, PROFILE_HASH);
        arena.createAgent(PROFILE_HASH, agentWallet1);

        vm.stopPrank();
    }

    function test_CreateAgentIncrementsId() public {
        vm.startPrank(alice);
        token.approve(address(arena), CREATION_FEE * 2);

        uint256 id1 = arena.createAgent(PROFILE_HASH, agentWallet1);
        uint256 id2 = arena.createAgent(keccak256("second"), agentWallet2);

        assertEq(id1, 1);
        assertEq(id2, 2);
        assertEq(arena.nextAgentId(), 3);

        vm.stopPrank();
    }

    function test_CreateAgentRevertsWithoutApproval() public {
        vm.prank(alice);
        vm.expectRevert(); // SafeERC20 will revert
        arena.createAgent(PROFILE_HASH, agentWallet1);
    }

    function test_CreateAgentRevertsZeroWallet() public {
        vm.startPrank(alice);
        token.approve(address(arena), CREATION_FEE);

        vm.expectRevert(MoltiArena.ZeroAddress.selector);
        arena.createAgent(PROFILE_HASH, address(0));

        vm.stopPrank();
    }

    // ===============================================================
    //  Arena creation tests
    // ===============================================================

    function test_CreateArena() public {
        uint256 arenaId = arena.createArena(TOKEN_ADDRESS, "Chog Arena");

        assertEq(arenaId, 1);
        MoltiArena.ArenaInfo memory info = arena.getArena(arenaId);
        assertEq(info.tokenAddress, TOKEN_ADDRESS);
        assertEq(info.name, "Chog Arena");
        assertTrue(info.active);
    }

    function test_CreateArenaEmitsEvent() public {
        vm.expectEmit(true, false, false, true);
        emit MoltiArena.ArenaCreated(1, TOKEN_ADDRESS, "Chog Arena");
        arena.createArena(TOKEN_ADDRESS, "Chog Arena");
    }

    function test_CreateArenaRevertsForNonOwner() public {
        vm.prank(alice);
        vm.expectRevert(); // Ownable: caller is not the owner
        arena.createArena(TOKEN_ADDRESS, "Chog Arena");
    }

    function test_CreateArenaRevertsZeroAddress() public {
        vm.expectRevert(MoltiArena.ZeroAddress.selector);
        arena.createArena(address(0), "Bad Arena");
    }

    function test_SetArenaActive() public {
        uint256 arenaId = arena.createArena(TOKEN_ADDRESS, "Test");
        assertTrue(arena.getArena(arenaId).active);

        arena.setArenaActive(arenaId, false);
        assertFalse(arena.getArena(arenaId).active);

        arena.setArenaActive(arenaId, true);
        assertTrue(arena.getArena(arenaId).active);
    }

    // ===============================================================
    //  Registration tests (no deposit)
    // ===============================================================

    function test_RegisterToArena() public {
        uint256 arenaId = arena.createArena(TOKEN_ADDRESS, "Chog");

        vm.startPrank(alice);
        token.approve(address(arena), CREATION_FEE);
        uint256 agentId = arena.createAgent(PROFILE_HASH, agentWallet1);

        uint256 balBefore = token.balanceOf(alice);
        arena.registerToArena(agentId, arenaId);
        uint256 balAfter = token.balanceOf(alice);

        // No MOLTI transferred on registration
        assertEq(balAfter, balBefore);
        assertTrue(arena.isRegistered(agentId, arenaId));

        MoltiArena.PortfolioState memory pf = arena.getPortfolio(agentId, arenaId);
        assertEq(pf.moltiLocked, 0);
        assertEq(pf.tokenUnits, 0);
        assertEq(pf.tradeCount, 0);
        assertTrue(pf.initialized);

        vm.stopPrank();
    }

    function test_RegisterEmitsEvent() public {
        uint256 arenaId = arena.createArena(TOKEN_ADDRESS, "Chog");

        vm.startPrank(alice);
        token.approve(address(arena), CREATION_FEE);
        uint256 agentId = arena.createAgent(PROFILE_HASH, agentWallet1);

        vm.expectEmit(true, true, false, true);
        emit MoltiArena.AgentRegistered(agentId, arenaId);
        arena.registerToArena(agentId, arenaId);

        vm.stopPrank();
    }

    function test_RegisterRevertsIfAlreadyRegistered() public {
        uint256 arenaId = arena.createArena(TOKEN_ADDRESS, "Chog");

        vm.startPrank(alice);
        token.approve(address(arena), CREATION_FEE);
        uint256 agentId = arena.createAgent(PROFILE_HASH, agentWallet1);
        arena.registerToArena(agentId, arenaId);

        vm.expectRevert(
            abi.encodeWithSelector(MoltiArena.AlreadyRegistered.selector, agentId, arenaId)
        );
        arena.registerToArena(agentId, arenaId);

        vm.stopPrank();
    }

    function test_RegisterRevertsNonOwner() public {
        uint256 arenaId = arena.createArena(TOKEN_ADDRESS, "Chog");

        // Alice creates agent
        vm.startPrank(alice);
        token.approve(address(arena), CREATION_FEE);
        uint256 agentId = arena.createAgent(PROFILE_HASH, agentWallet1);
        vm.stopPrank();

        // Bob tries to register Alice's agent
        vm.prank(bob);
        vm.expectRevert(
            abi.encodeWithSelector(MoltiArena.NotAgentOwner.selector, agentId)
        );
        arena.registerToArena(agentId, arenaId);
    }

    function test_RegisterRevertsInactiveArena() public {
        uint256 arenaId = arena.createArena(TOKEN_ADDRESS, "Chog");
        arena.setArenaActive(arenaId, false);

        vm.startPrank(alice);
        token.approve(address(arena), CREATION_FEE);
        uint256 agentId = arena.createAgent(PROFILE_HASH, agentWallet1);

        vm.expectRevert(
            abi.encodeWithSelector(MoltiArena.ArenaNotActive.selector, arenaId)
        );
        arena.registerToArena(agentId, arenaId);
        vm.stopPrank();
    }

    // ===============================================================
    //  Trade execution tests
    // ===============================================================

    /// @dev Helper: create agent + arena + register + fund wallet + create epoch + auto-renew.
    function _setupTradingAgent() internal returns (uint256 agentId, uint256 arenaId, uint256 epochId) {
        arenaId = arena.createArena(TOKEN_ADDRESS, "Chog");

        vm.startPrank(alice);
        token.approve(address(arena), CREATION_FEE);
        agentId = arena.createAgent(PROFILE_HASH, agentWallet1);
        arena.registerToArena(agentId, arenaId);
        vm.stopPrank();

        // Fund agent wallet for trading + epoch renewal
        token.transfer(agentWallet1, WALLET_CAPITAL);
        vm.prank(agentWallet1);
        token.approve(address(arena), type(uint256).max);

        // Create epoch and auto-renew
        uint256 startTime = block.timestamp;
        uint256 endTime = startTime + 24 hours;
        vm.prank(operatorAddr);
        epochId = arena.createEpoch(arenaId, startTime, endTime);
        vm.prank(operatorAddr);
        arena.autoRenewEpoch(agentId, arenaId, epochId);
    }

    function test_ExecuteBuy() public {
        (uint256 agentId, uint256 arenaId, uint256 epochId) = _setupTradingAgent();

        // Operator executes a BUY: 200 MOLTI at price 0.001 MOLTI
        vm.prank(operatorAddr);
        arena.executeTrade(agentId, arenaId, epochId, MoltiArena.Action.BUY, 0, BUY_AMOUNT, PRICE, 1);

        MoltiArena.PortfolioState memory pf = arena.getPortfolio(agentId, arenaId);

        // fee = 200 * 0.5% = 1 MOLTI, netSpend = 199 MOLTI
        uint256 fee = BUY_AMOUNT * 50 / 10000;
        uint256 netSpend = BUY_AMOUNT - fee;
        // tokensBought = 199 * 1e18 / 0.001e18 = 199_000
        uint256 expectedTokens = netSpend * SCALE / PRICE;

        assertEq(pf.moltiLocked, netSpend);
        assertEq(pf.tokenUnits, expectedTokens);
        assertEq(pf.avgEntryPrice, PRICE);
        assertEq(pf.tradeCount, 1);
        assertEq(pf.lastTradeTick, 1);
    }

    function test_ExecuteSell() public {
        (uint256 agentId, uint256 arenaId, uint256 epochId) = _setupTradingAgent();

        // First buy some tokens
        vm.prank(operatorAddr);
        arena.executeTrade(agentId, arenaId, epochId, MoltiArena.Action.BUY, 0, BUY_AMOUNT, PRICE, 1);

        MoltiArena.PortfolioState memory pfAfterBuy = arena.getPortfolio(agentId, arenaId);
        uint256 tokensHeld = pfAfterBuy.tokenUnits;
        uint256 lockedAfterBuy = pfAfterBuy.moltiLocked;

        // Now sell 50 % of position at the same price
        vm.prank(operatorAddr);
        arena.executeTrade(agentId, arenaId, epochId, MoltiArena.Action.SELL, SIZE_50_PCT, 0, PRICE, 2);

        MoltiArena.PortfolioState memory pfAfterSell = arena.getPortfolio(agentId, arenaId);

        // moltiBack = moltiLocked * 50% (returned at cost basis)
        uint256 moltiBack = lockedAfterBuy * SIZE_50_PCT / SCALE;
        uint256 tokensSold = tokensHeld * SIZE_50_PCT / SCALE;

        assertEq(pfAfterSell.moltiLocked, lockedAfterBuy - moltiBack);
        assertEq(pfAfterSell.tokenUnits, tokensHeld - tokensSold);
        assertEq(pfAfterSell.tradeCount, 2);
        assertEq(pfAfterSell.lastTradeTick, 2);
    }

    function test_ExecuteSellFullPositionResetsAvgPrice() public {
        (uint256 agentId, uint256 arenaId, uint256 epochId) = _setupTradingAgent();

        // Buy
        vm.prank(operatorAddr);
        arena.executeTrade(agentId, arenaId, epochId, MoltiArena.Action.BUY, 0, BUY_AMOUNT, PRICE, 1);

        // Sell 100 %
        vm.prank(operatorAddr);
        arena.executeTrade(agentId, arenaId, epochId, MoltiArena.Action.SELL, 1 ether, 0, PRICE, 2);

        MoltiArena.PortfolioState memory pf = arena.getPortfolio(agentId, arenaId);
        assertEq(pf.tokenUnits, 0);
        assertEq(pf.avgEntryPrice, 0); // Reset after full sell
        assertEq(pf.moltiLocked, 0);
    }

    function test_ExecuteTradeEmitsEvent() public {
        (uint256 agentId, uint256 arenaId, uint256 epochId) = _setupTradingAgent();

        uint256 fee = BUY_AMOUNT * 50 / 10000;
        uint256 netSpend = BUY_AMOUNT - fee;
        uint256 expectedTokens = netSpend * SCALE / PRICE;

        vm.prank(operatorAddr);
        vm.expectEmit(true, true, false, true);
        emit MoltiArena.TradePlaced(
            agentId, arenaId, MoltiArena.Action.BUY,
            BUY_AMOUNT, PRICE, netSpend, expectedTokens
        );
        arena.executeTrade(agentId, arenaId, epochId, MoltiArena.Action.BUY, 0, BUY_AMOUNT, PRICE, 1);
    }

    function test_ExecuteHoldReverts() public {
        (uint256 agentId, uint256 arenaId, uint256 epochId) = _setupTradingAgent();

        vm.prank(operatorAddr);
        vm.expectRevert(MoltiArena.HoldIsNoop.selector);
        arena.executeTrade(agentId, arenaId, epochId, MoltiArena.Action.HOLD, 0, 0, PRICE, 1);
    }

    function test_ExecuteTradeRevertsUnauthorized() public {
        (uint256 agentId, uint256 arenaId, uint256 epochId) = _setupTradingAgent();

        // Bob (not operator, not agent wallet) tries to trade
        vm.prank(bob);
        vm.expectRevert(
            abi.encodeWithSelector(MoltiArena.NotTradeAuthorized.selector, agentId)
        );
        arena.executeTrade(agentId, arenaId, epochId, MoltiArena.Action.BUY, 0, BUY_AMOUNT, PRICE, 1);
    }

    function test_ExecuteTradeFromAgentWallet() public {
        (uint256 agentId, uint256 arenaId, uint256 epochId) = _setupTradingAgent();

        // Agent wallet can also execute trades
        vm.prank(agentWallet1);
        arena.executeTrade(agentId, arenaId, epochId, MoltiArena.Action.BUY, 0, BUY_AMOUNT, PRICE, 1);

        MoltiArena.PortfolioState memory pf = arena.getPortfolio(agentId, arenaId);
        assertEq(pf.tradeCount, 1);
    }

    function test_ExecuteTradeRevertsNotRegistered() public {
        // Create agent but don't register to arena
        uint256 arenaId = arena.createArena(TOKEN_ADDRESS, "Chog");
        vm.startPrank(alice);
        token.approve(address(arena), CREATION_FEE);
        uint256 agentId = arena.createAgent(PROFILE_HASH, agentWallet1);
        vm.stopPrank();

        uint256 startTime = block.timestamp;
        uint256 endTime = startTime + 24 hours;
        vm.prank(operatorAddr);
        uint256 epochId = arena.createEpoch(arenaId, startTime, endTime);

        vm.prank(operatorAddr);
        vm.expectRevert(
            abi.encodeWithSelector(MoltiArena.NotRegistered.selector, agentId, arenaId)
        );
        arena.executeTrade(agentId, arenaId, epochId, MoltiArena.Action.BUY, 0, BUY_AMOUNT, PRICE, 1);
    }

    function test_ExecuteTradeRevertsZeroBuyAmount() public {
        (uint256 agentId, uint256 arenaId, uint256 epochId) = _setupTradingAgent();

        vm.prank(operatorAddr);
        vm.expectRevert(MoltiArena.ZeroBuyAmount.selector);
        arena.executeTrade(agentId, arenaId, epochId, MoltiArena.Action.BUY, 0, 0, PRICE, 1);
    }

    function test_ExecuteTradeRevertsZeroSizePct() public {
        (uint256 agentId, uint256 arenaId, uint256 epochId) = _setupTradingAgent();

        vm.prank(operatorAddr);
        vm.expectRevert(MoltiArena.ZeroSizePct.selector);
        arena.executeTrade(agentId, arenaId, epochId, MoltiArena.Action.SELL, 0, 0, PRICE, 1);
    }

    function test_ExecuteTradeRevertsSizePctTooLarge() public {
        (uint256 agentId, uint256 arenaId, uint256 epochId) = _setupTradingAgent();

        vm.prank(operatorAddr);
        vm.expectRevert(MoltiArena.SizePctTooLarge.selector);
        arena.executeTrade(agentId, arenaId, epochId, MoltiArena.Action.SELL, 1.1 ether, 0, PRICE, 1);
    }

    function test_ExecuteTradeRevertsZeroPrice() public {
        (uint256 agentId, uint256 arenaId, uint256 epochId) = _setupTradingAgent();

        vm.prank(operatorAddr);
        vm.expectRevert(MoltiArena.ZeroPrice.selector);
        arena.executeTrade(agentId, arenaId, epochId, MoltiArena.Action.BUY, 0, BUY_AMOUNT, 0, 1);
    }

    // ===============================================================
    //  Fee distribution tests (50% reward, 30% treasury, 20% burn)
    // ===============================================================

    function test_TradeFeeSplit() public {
        (uint256 agentId, uint256 arenaId, uint256 epochId) = _setupTradingAgent();

        // Record state before trade
        uint256 collectedBefore = arena.collectedFees();
        address burnAddr = arena.BURN_ADDRESS();
        uint256 burnBalBefore = token.balanceOf(burnAddr);

        // Execute a BUY trade
        vm.prank(operatorAddr);
        arena.executeTrade(agentId, arenaId, epochId, MoltiArena.Action.BUY, 0, BUY_AMOUNT, PRICE, 1);

        // fee = 200 * 0.5% = 1 MOLTI
        uint256 fee = BUY_AMOUNT * 50 / 10000;
        uint256 expectedPool = fee * 50 / 100;      // 0.5 MOLTI
        uint256 expectedTreasury = fee * 30 / 100;   // 0.3 MOLTI
        uint256 expectedBurn = fee - expectedPool - expectedTreasury; // 0.2 MOLTI

        (,, uint256 rewardPoolWei,,) = arena.epochs(arenaId, epochId);
        // Reward pool includes epoch renewal pool + trade pool
        uint256 renewalPool = 100 ether * 50 / 100;
        assertEq(rewardPoolWei, renewalPool + expectedPool);

        // Treasury gained trade treasury portion
        assertEq(arena.collectedFees(), collectedBefore + expectedTreasury);

        // Burn
        uint256 burnBalAfter = token.balanceOf(burnAddr);
        assertEq(burnBalAfter - burnBalBefore, expectedBurn);
    }

    function test_EpochRenewalFeeSplit() public {
        uint256 arenaId = arena.createArena(TOKEN_ADDRESS, "Chog");

        vm.startPrank(alice);
        token.approve(address(arena), CREATION_FEE);
        uint256 agentId = arena.createAgent(PROFILE_HASH, agentWallet1);
        arena.registerToArena(agentId, arenaId);
        vm.stopPrank();

        token.transfer(agentWallet1, WALLET_CAPITAL);
        vm.prank(agentWallet1);
        token.approve(address(arena), type(uint256).max);

        uint256 startTime = block.timestamp;
        uint256 endTime = startTime + 24 hours;
        vm.prank(operatorAddr);
        uint256 epochId = arena.createEpoch(arenaId, startTime, endTime);

        uint256 collectedBefore = arena.collectedFees();
        address burnAddr = arena.BURN_ADDRESS();
        uint256 burnBalBefore = token.balanceOf(burnAddr);

        // Auto-renew
        vm.prank(operatorAddr);
        arena.autoRenewEpoch(agentId, arenaId, epochId);

        uint256 renewalFee = 100 ether;
        uint256 expectedPool = renewalFee * 50 / 100;
        uint256 expectedTreasury = renewalFee * 30 / 100;
        uint256 expectedBurn = renewalFee - expectedPool - expectedTreasury;

        assertEq(arena.collectedFees() - collectedBefore, expectedTreasury);
        assertEq(token.balanceOf(burnAddr) - burnBalBefore, expectedBurn);
    }

    // ===============================================================
    //  Unregistration tests
    // ===============================================================

    function test_UnregisterFromArena() public {
        (uint256 agentId, uint256 arenaId,) = _setupTradingAgent();

        vm.startPrank(alice);

        uint256 balBefore = token.balanceOf(alice);
        arena.unregisterFromArena(agentId, arenaId);
        uint256 balAfter = token.balanceOf(alice);

        // No MOLTI returned (no trades — moltiLocked is 0)
        assertEq(balAfter, balBefore);
        assertFalse(arena.isRegistered(agentId, arenaId));

        // Portfolio should be deleted
        MoltiArena.PortfolioState memory pf = arena.getPortfolio(agentId, arenaId);
        assertFalse(pf.initialized);

        vm.stopPrank();
    }

    function test_UnregisterAfterTrading() public {
        (uint256 agentId, uint256 arenaId, uint256 epochId) = _setupTradingAgent();

        // BUY to build a position
        vm.prank(operatorAddr);
        arena.executeTrade(agentId, arenaId, epochId, MoltiArena.Action.BUY, 0, BUY_AMOUNT, PRICE, 1);

        MoltiArena.PortfolioState memory pf = arena.getPortfolio(agentId, arenaId);
        uint256 lockedMolti = pf.moltiLocked;
        assertTrue(lockedMolti > 0);

        // Unregister returns the locked MOLTI to the owner
        uint256 balBefore = token.balanceOf(alice);
        vm.prank(alice);
        arena.unregisterFromArena(agentId, arenaId);
        uint256 balAfter = token.balanceOf(alice);

        assertEq(balAfter - balBefore, lockedMolti);
        assertFalse(arena.isRegistered(agentId, arenaId));
    }

    function test_UnregisterEmitsEvent() public {
        (uint256 agentId, uint256 arenaId,) = _setupTradingAgent();

        vm.prank(alice);
        vm.expectEmit(true, true, false, true);
        emit MoltiArena.AgentUnregistered(agentId, arenaId);
        arena.unregisterFromArena(agentId, arenaId);
    }

    function test_UnregisterRevertsNotRegistered() public {
        uint256 arenaId = arena.createArena(TOKEN_ADDRESS, "Chog");
        vm.startPrank(alice);
        token.approve(address(arena), CREATION_FEE);
        uint256 agentId = arena.createAgent(PROFILE_HASH, agentWallet1);
        vm.stopPrank();

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(MoltiArena.NotRegistered.selector, agentId, arenaId)
        );
        arena.unregisterFromArena(agentId, arenaId);
    }

    function test_UnregisterRevertsNonOwner() public {
        (uint256 agentId, uint256 arenaId,) = _setupTradingAgent();

        vm.prank(bob);
        vm.expectRevert(
            abi.encodeWithSelector(MoltiArena.NotAgentOwner.selector, agentId)
        );
        arena.unregisterFromArena(agentId, arenaId);
    }

    // ===============================================================
    //  Operator tests
    // ===============================================================

    function test_SetOperator() public {
        address newOp = makeAddr("newOperator");

        vm.expectEmit(true, true, false, false);
        emit MoltiArena.OperatorUpdated(operatorAddr, newOp);
        arena.setOperator(newOp);

        assertEq(arena.operator(), newOp);
    }

    function test_SetOperatorRevertsNonOwner() public {
        vm.prank(alice);
        vm.expectRevert(); // Ownable
        arena.setOperator(alice);
    }

    // ===============================================================
    //  Fee management tests
    // ===============================================================

    function test_WithdrawFees() public {
        // Create an agent so creation fees accumulate
        vm.startPrank(alice);
        token.approve(address(arena), CREATION_FEE);
        arena.createAgent(PROFILE_HASH, agentWallet1);
        vm.stopPrank();

        assertEq(arena.collectedFees(), CREATION_FEE);

        uint256 ownerBalBefore = token.balanceOf(deployer);
        arena.withdrawFees();
        uint256 ownerBalAfter = token.balanceOf(deployer);

        assertEq(ownerBalAfter - ownerBalBefore, CREATION_FEE);
        assertEq(arena.collectedFees(), 0);
    }

    function test_WithdrawFeesIncludesTreasuryCut() public {
        // Full setup: create agent + register + renew + trade → all contribute to treasury
        (uint256 agentId, uint256 arenaId, uint256 epochId) = _setupTradingAgent();

        vm.prank(operatorAddr);
        arena.executeTrade(agentId, arenaId, epochId, MoltiArena.Action.BUY, 0, BUY_AMOUNT, PRICE, 1);

        // Treasury should include: creation fee + renewal treasury + trade treasury
        uint256 renewalTreasury = 100 ether * 30 / 100;
        uint256 tradeFee = BUY_AMOUNT * 50 / 10000;
        uint256 tradeTreasury = tradeFee * 30 / 100;
        uint256 expectedTotal = CREATION_FEE + renewalTreasury + tradeTreasury;

        assertEq(arena.collectedFees(), expectedTotal);

        uint256 ownerBalBefore = token.balanceOf(deployer);
        arena.withdrawFees();
        uint256 ownerBalAfter = token.balanceOf(deployer);

        assertEq(ownerBalAfter - ownerBalBefore, expectedTotal);
        assertEq(arena.collectedFees(), 0);
    }

    function test_WithdrawFeesRevertsEmpty() public {
        vm.expectRevert(MoltiArena.NoFeesToWithdraw.selector);
        arena.withdrawFees();
    }

    function test_WithdrawFeesRevertsNonOwner() public {
        vm.startPrank(alice);
        token.approve(address(arena), CREATION_FEE);
        arena.createAgent(PROFILE_HASH, agentWallet1);
        vm.stopPrank();

        vm.prank(alice);
        vm.expectRevert(); // Ownable
        arena.withdrawFees();
    }

    function test_SetAgentCreationFee() public {
        uint256 newFee = 50 ether;

        vm.expectEmit(false, false, false, true);
        emit MoltiArena.AgentCreationFeeUpdated(CREATION_FEE, newFee);
        arena.setAgentCreationFee(newFee);

        assertEq(arena.agentCreationFee(), newFee);

        // Create agent with new fee
        vm.startPrank(alice);
        token.approve(address(arena), newFee);
        uint256 balBefore = token.balanceOf(alice);
        arena.createAgent(PROFILE_HASH, agentWallet1);
        uint256 balAfter = token.balanceOf(alice);
        assertEq(balBefore - balAfter, newFee);
        vm.stopPrank();
    }

    // ===============================================================
    //  View function tests
    // ===============================================================

    function test_ComputeEquity() public {
        (uint256 agentId, uint256 arenaId, uint256 epochId) = _setupTradingAgent();

        // Before any trade: equity = 0 (no token position)
        assertEq(arena.computeEquity(agentId, arenaId, PRICE), 0);

        // After buying at PRICE
        vm.prank(operatorAddr);
        arena.executeTrade(agentId, arenaId, epochId, MoltiArena.Action.BUY, 0, BUY_AMOUNT, PRICE, 1);

        uint256 fee = BUY_AMOUNT * 50 / 10000;
        uint256 netSpend = BUY_AMOUNT - fee;

        // equity = tokenUnits * price / SCALE = netSpend (at same price)
        uint256 equity = arena.computeEquity(agentId, arenaId, PRICE);
        assertEq(equity, netSpend);

        // At double the price, equity should double
        uint256 equityDouble = arena.computeEquity(agentId, arenaId, PRICE * 2);
        assertEq(equityDouble, netSpend * 2);
    }

    function test_IsRegistered() public {
        uint256 arenaId = arena.createArena(TOKEN_ADDRESS, "Chog");

        vm.startPrank(alice);
        token.approve(address(arena), CREATION_FEE);
        uint256 agentId = arena.createAgent(PROFILE_HASH, agentWallet1);

        assertFalse(arena.isRegistered(agentId, arenaId));
        arena.registerToArena(agentId, arenaId);
        assertTrue(arena.isRegistered(agentId, arenaId));

        vm.stopPrank();
    }

    // ===============================================================
    //  Multi-agent scenario
    // ===============================================================

    function test_MultipleAgentsInArena() public {
        uint256 arenaId = arena.createArena(TOKEN_ADDRESS, "Chog");

        // Alice creates agent 1
        vm.startPrank(alice);
        token.approve(address(arena), CREATION_FEE);
        uint256 agent1 = arena.createAgent(PROFILE_HASH, agentWallet1);
        arena.registerToArena(agent1, arenaId);
        vm.stopPrank();

        // Bob creates agent 2
        vm.startPrank(bob);
        token.approve(address(arena), CREATION_FEE);
        uint256 agent2 = arena.createAgent(keccak256("bob-profile"), agentWallet2);
        arena.registerToArena(agent2, arenaId);
        vm.stopPrank();

        // Fund both wallets
        token.transfer(agentWallet1, WALLET_CAPITAL);
        token.transfer(agentWallet2, WALLET_CAPITAL);
        vm.prank(agentWallet1);
        token.approve(address(arena), type(uint256).max);
        vm.prank(agentWallet2);
        token.approve(address(arena), type(uint256).max);

        // Create epoch and renew both agents
        uint256 startTime = block.timestamp;
        uint256 endTime = startTime + 24 hours;
        vm.prank(operatorAddr);
        uint256 epochId = arena.createEpoch(arenaId, startTime, endTime);
        vm.prank(operatorAddr);
        arena.autoRenewEpoch(agent1, arenaId, epochId);
        vm.prank(operatorAddr);
        arena.autoRenewEpoch(agent2, arenaId, epochId);

        // Both agents trade independently (different BUY amounts)
        vm.startPrank(operatorAddr);
        arena.executeTrade(agent1, arenaId, epochId, MoltiArena.Action.BUY, 0, 200 ether, PRICE, 1);
        arena.executeTrade(agent2, arenaId, epochId, MoltiArena.Action.BUY, 0, 500 ether, PRICE, 1);
        vm.stopPrank();

        // Verify independent portfolios
        MoltiArena.PortfolioState memory pf1 = arena.getPortfolio(agent1, arenaId);
        MoltiArena.PortfolioState memory pf2 = arena.getPortfolio(agent2, arenaId);

        // After 0.5% fee
        uint256 fee1 = 200 ether * 50 / 10000;
        uint256 fee2 = 500 ether * 50 / 10000;
        assertEq(pf1.moltiLocked, 200 ether - fee1);
        assertEq(pf2.moltiLocked, 500 ether - fee2);

        // Both can have different token amounts
        assertTrue(pf1.tokenUnits > 0);
        assertTrue(pf2.tokenUnits > pf1.tokenUnits);
    }

    // ===============================================================
    //  Edge case: weighted average entry price
    // ===============================================================

    function test_AvgEntryPriceMultipleBuys() public {
        (uint256 agentId, uint256 arenaId, uint256 epochId) = _setupTradingAgent();

        // Buy at price 0.001
        vm.prank(operatorAddr);
        arena.executeTrade(agentId, arenaId, epochId, MoltiArena.Action.BUY, 0, BUY_AMOUNT, PRICE, 1);

        // Buy again at price 0.002
        uint256 newPrice = 0.002 ether;
        vm.prank(operatorAddr);
        arena.executeTrade(agentId, arenaId, epochId, MoltiArena.Action.BUY, 0, BUY_AMOUNT, newPrice, 2);

        MoltiArena.PortfolioState memory pf = arena.getPortfolio(agentId, arenaId);

        // Weighted avg should be between PRICE and newPrice
        assertTrue(pf.avgEntryPrice > PRICE);
        assertTrue(pf.avgEntryPrice < newPrice);
        assertEq(pf.tradeCount, 2);
    }
}
