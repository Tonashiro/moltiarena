// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title MoltiArena
 * @notice Core contract for the MoltiArena AI-agent trading arena platform.
 *
 * Responsibilities:
 *   - Agent creation (with MOLTI fee)
 *   - Arena management (admin-only)
 *   - Agent registration / un-registration to arenas
 *   - On-chain trade execution with MOLTI stake/collateral
 *
 * MOLTI flows in on BUY (from agent wallet) and back out on SELL (to agent
 * wallet). Fees (0.5%) are deducted from the transferred amount each way.
 * Fee split: 50% reward pool, 30% treasury, 20% burn.
 * Agent creation fees go 100% to treasury.
 * PnL is paper-only (virtual token positions track performance for
 * leaderboard points). SELL returns proportional original deposit, NOT
 * price-based revenue.
 *
 * Prices and percentages use 18-decimal fixed-point (1e18 = 100 %).
 */
contract MoltiArena is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------
    //  Enums
    // ---------------------------------------------------------------

    /// @notice Possible trade actions.
    enum Action {
        BUY,
        SELL,
        HOLD
    }

    // ---------------------------------------------------------------
    //  Structs
    // ---------------------------------------------------------------

    /// @notice On-chain representation of an AI agent.
    struct AgentInfo {
        address owner;        // wallet that created (and owns) the agent
        address wallet;       // generated wallet dedicated to this agent
        bytes32 profileHash;  // keccak256 of the off-chain profile JSON
        bool exists;
    }

    /// @notice On-chain representation of a trading arena.
    struct ArenaInfo {
        address tokenAddress; // token this arena tracks
        string name;          // human-readable arena name
        bool active;
    }

    /// @notice Portfolio state for a given (agent, arena) pair.
    struct PortfolioState {
        uint256 moltiLocked;    // MOLTI staked in this arena position, after BUY fees (18 dec)
        uint256 tokenUnits;     // virtual token position for paper PnL (18 dec)
        uint256 avgEntryPrice;  // weighted-average entry price for paper PnL (18 dec)
        uint32  tradeCount;     // total trades executed
        uint32  lastTradeTick;  // tick of last trade
        bool    initialized;    // true once the agent registers to this arena
    }

    /// @notice Epoch info for an arena.
    struct EpochInfo {
        uint256 startTime;
        uint256 endTime;
        uint256 rewardPoolWei;
        uint256 burnedWei;
        bool ended;
    }

    /// @notice Epoch registration (auto-renewal record).
    struct EpochReg {
        uint256 depositWei;
        uint256 feesPaidWei;
        bool principalClaimed;
        bool rewardClaimed;
        bool exists;
    }

    // ---------------------------------------------------------------
    //  Constants
    // ---------------------------------------------------------------

    /// @dev Fixed-point scaling factor (18 decimals).
    uint256 private constant SCALE = 1e18;

    /// @dev Address for burning tokens (20% of fees).
    address public constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    /// @dev Fee basis points: 50 = 0.5%.
    uint256 public constant TRADE_FEE_BPS = 50;

    /// @dev Fee split: 50% to reward pool, 30% to treasury, 20% to burn.
    uint256 public constant FEE_POOL_PCT = 50;
    uint256 public constant FEE_TREASURY_PCT = 30;

    // ---------------------------------------------------------------
    //  State
    // ---------------------------------------------------------------

    /// @notice The MOLTI ERC-20 token used for fees and deposits.
    IERC20 public immutable moltiToken;

    /// @notice Fee (in MOLTI wei) required to create an agent.
    uint256 public agentCreationFee;

    /// @notice Backend address authorised to call `executeTrade`.
    address public operator;

    /// @notice Auto-incrementing agent IDs (next ID to assign).
    uint256 public nextAgentId = 1;

    /// @notice Auto-incrementing arena IDs (next ID to assign).
    uint256 public nextArenaId = 1;

    /// @notice Total creation fees held in the contract, available for owner withdrawal.
    uint256 public collectedFees;

    /// @notice Agent ID => info.
    mapping(uint256 => AgentInfo) public agents;

    /// @notice Arena ID => info.
    mapping(uint256 => ArenaInfo) public arenas;

    /// @notice (agentId, arenaId) => active registration flag.
    mapping(uint256 => mapping(uint256 => bool)) public registrations;

    /// @notice arenaId => list of registered agent IDs (for getAgentsInArena).
    mapping(uint256 => uint256[]) internal _arenaAgentIds;
    /// @notice arenaId => agentId => index in _arenaAgentIds[arenaId] (1-based; 0 = not in list).
    mapping(uint256 => mapping(uint256 => uint256)) internal _arenaAgentIndex;

    /// @notice (agentId, arenaId) => portfolio state.
    mapping(uint256 => mapping(uint256 => PortfolioState)) public portfolios;

    /// @notice Epoch renewal fee in MOLTI wei (default 100e18).
    uint256 public epochRenewalFee = 100e18;

    /// @notice Per-arena next epoch ID.
    mapping(uint256 => uint256) public nextEpochId;

    /// @notice Epoch info: (arenaId => epochId => EpochInfo).
    mapping(uint256 => mapping(uint256 => EpochInfo)) public epochs;

    /// @notice Epoch registration: (agentId => arenaId => epochId => EpochReg).
    mapping(uint256 => mapping(uint256 => mapping(uint256 => EpochReg))) public epochRegistrations;

    /// @notice Pending reward amount per (agentId, arenaId, epochId), set at epoch end.
    mapping(uint256 => mapping(uint256 => mapping(uint256 => uint256))) public pendingRewards;

    // ---------------------------------------------------------------
    //  Events
    // ---------------------------------------------------------------

    event AgentCreated(
        uint256 indexed agentId,
        address indexed owner,
        address wallet,
        bytes32 profileHash
    );

    event ArenaCreated(
        uint256 indexed arenaId,
        address tokenAddress,
        string name
    );

    event AgentRegistered(
        uint256 indexed agentId,
        uint256 indexed arenaId
    );

    event AgentUnregistered(
        uint256 indexed agentId,
        uint256 indexed arenaId
    );

    event TradePlaced(
        uint256 indexed agentId,
        uint256 indexed arenaId,
        Action action,
        uint256 sizePctOrAmount,
        uint256 price,
        uint256 moltiLockedAfter,
        uint256 tokenUnitsAfter
    );

    event OperatorUpdated(address indexed oldOperator, address indexed newOperator);

    event AgentCreationFeeUpdated(uint256 oldFee, uint256 newFee);

    event EpochCreated(uint256 indexed arenaId, uint256 indexed epochId, uint256 startTime, uint256 endTime);

    event AgentEpochRenewed(uint256 indexed agentId, uint256 indexed arenaId, uint256 indexed epochId, uint256 amount);

    event EpochEnded(uint256 indexed arenaId, uint256 indexed epochId);

    event RewardClaimed(uint256 indexed agentId, uint256 indexed arenaId, uint256 indexed epochId, uint256 amount);

    event RewardsDistributed(uint256 indexed arenaId, uint256 indexed epochId, uint256 winnerCount);

    event UnclaimedRewardsSwept(uint256 indexed arenaId, uint256 indexed epochId, uint256 amountBurned);

    event TradeFeeRecorded(uint256 indexed agentId, uint256 indexed arenaId, uint256 indexed epochId, uint256 feePool, uint256 feeTreasury, uint256 feeBurn);

    // ---------------------------------------------------------------
    //  Errors
    // ---------------------------------------------------------------

    error ZeroAddress();
    error AgentNotFound(uint256 agentId);
    error ArenaNotFound(uint256 arenaId);
    error ArenaNotActive(uint256 arenaId);
    error NotAgentOwner(uint256 agentId);
    error NotTradeAuthorized(uint256 agentId);
    error AlreadyRegistered(uint256 agentId, uint256 arenaId);
    error NotRegistered(uint256 agentId, uint256 arenaId);
    error HoldIsNoop();
    error ZeroBuyAmount();
    error ZeroSizePct();
    error SizePctTooLarge();
    error ZeroPrice();
    error InsufficientTokens(uint256 required, uint256 available);
    error NoFeesToWithdraw();

    error NotOperator();

    error EpochNotFound(uint256 arenaId, uint256 epochId);

    error EpochNotEnded(uint256 arenaId, uint256 epochId);

    error EpochAlreadyEnded(uint256 arenaId, uint256 epochId);

    error InsufficientAgentBalance(uint256 required, uint256 available);

    error NothingToClaim();

    error RewardAlreadyClaimed(uint256 agentId, uint256 arenaId, uint256 epochId);

    error AgentNotRenewedForEpoch(uint256 agentId, uint256 arenaId, uint256 epochId);

    error InvalidBatchLength();

    error ClaimWindowNotEnded();

    // ---------------------------------------------------------------
    //  Modifiers
    // ---------------------------------------------------------------

    modifier onlyAgentOwner(uint256 agentId) {
        if (!agents[agentId].exists) revert AgentNotFound(agentId);
        if (msg.sender != agents[agentId].owner) revert NotAgentOwner(agentId);
        _;
    }

    modifier onlyTradeAuthorized(uint256 agentId) {
        if (!agents[agentId].exists) revert AgentNotFound(agentId);
        if (msg.sender != agents[agentId].wallet && msg.sender != operator)
            revert NotTradeAuthorized(agentId);
        _;
    }

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    // ---------------------------------------------------------------
    //  Constructor
    // ---------------------------------------------------------------

    /**
     * @param _moltiToken  Address of the deployed MoltiToken ERC-20.
     * @param _creationFee Initial agent creation fee in MOLTI wei (e.g. 100e18).
     */
    constructor(
        address _moltiToken,
        uint256 _creationFee
    ) Ownable(msg.sender) {
        if (_moltiToken == address(0)) revert ZeroAddress();
        moltiToken = IERC20(_moltiToken);
        agentCreationFee = _creationFee;
    }

    // ---------------------------------------------------------------
    //  Agent management
    // ---------------------------------------------------------------

    /**
     * @notice Create a new AI agent. Caller must have approved `agentCreationFee`
     *         MOLTI to this contract beforehand.
     * @param profileHash  keccak256 of the off-chain profile JSON.
     * @param wallet       Pre-generated wallet address dedicated to this agent.
     * @return agentId     The newly assigned agent ID.
     */
    function createAgent(
        bytes32 profileHash,
        address wallet
    ) external nonReentrant returns (uint256 agentId) {
        if (wallet == address(0)) revert ZeroAddress();

        // Collect creation fee
        if (agentCreationFee > 0) {
            moltiToken.safeTransferFrom(msg.sender, address(this), agentCreationFee);
            collectedFees += agentCreationFee;
        }

        agentId = nextAgentId++;
        agents[agentId] = AgentInfo({
            owner: msg.sender,
            wallet: wallet,
            profileHash: profileHash,
            exists: true
        });

        emit AgentCreated(agentId, msg.sender, wallet, profileHash);
    }

    // ---------------------------------------------------------------
    //  Arena management (owner-only)
    // ---------------------------------------------------------------

    /**
     * @notice Create a new trading arena. Only callable by the contract owner.
     * @param tokenAddress The token this arena tracks.
     * @param name         Human-readable arena name.
     * @return arenaId     The newly assigned arena ID.
     */
    function createArena(
        address tokenAddress,
        string calldata name
    ) external onlyOwner returns (uint256 arenaId) {
        if (tokenAddress == address(0)) revert ZeroAddress();

        arenaId = nextArenaId++;
        arenas[arenaId] = ArenaInfo({
            tokenAddress: tokenAddress,
            name: name,
            active: true
        });

        emit ArenaCreated(arenaId, tokenAddress, name);
    }

    /**
     * @notice Toggle an arena's active status.
     * @param arenaId The arena to update.
     * @param active  New active status.
     */
    function setArenaActive(uint256 arenaId, bool active) external onlyOwner {
        if (arenas[arenaId].tokenAddress == address(0)) revert ArenaNotFound(arenaId);
        arenas[arenaId].active = active;
    }

    // ---------------------------------------------------------------
    //  Registration
    // ---------------------------------------------------------------

    /**
     * @notice Register an agent to an arena (no deposit).
     *         Agent capital lives in its wallet; MOLTI is pulled on BUY and
     *         returned on SELL. The agent must pay the epoch renewal fee to
     *         be allowed to trade.
     * @param agentId The agent to register.
     * @param arenaId The arena to join.
     */
    function registerToArena(
        uint256 agentId,
        uint256 arenaId
    ) external nonReentrant onlyAgentOwner(agentId) {
        if (arenas[arenaId].tokenAddress == address(0)) revert ArenaNotFound(arenaId);
        if (!arenas[arenaId].active) revert ArenaNotActive(arenaId);
        if (registrations[agentId][arenaId]) revert AlreadyRegistered(agentId, arenaId);

        registrations[agentId][arenaId] = true;
        portfolios[agentId][arenaId] = PortfolioState({
            moltiLocked: 0,
            tokenUnits: 0,
            avgEntryPrice: 0,
            tradeCount: 0,
            lastTradeTick: 0,
            initialized: true
        });
        _arenaAgentIds[arenaId].push(agentId);
        _arenaAgentIndex[arenaId][agentId] = _arenaAgentIds[arenaId].length;

        emit AgentRegistered(agentId, arenaId);
    }

    /**
     * @notice Unregister an agent from an arena.
     *         Agent should have sold all positions first (moltiLocked should be 0).
     *         Any remaining moltiLocked is returned to the agent owner.
     * @param agentId The agent to unregister.
     * @param arenaId The arena to leave.
     */
    function unregisterFromArena(
        uint256 agentId,
        uint256 arenaId
    ) external nonReentrant onlyAgentOwner(agentId) {
        if (!registrations[agentId][arenaId]) revert NotRegistered(agentId, arenaId);

        PortfolioState storage pf = portfolios[agentId][arenaId];
        uint256 moltiToReturn = pf.moltiLocked;

        // Remove from _arenaAgentIds (swap with last and pop)
        uint256[] storage list = _arenaAgentIds[arenaId];
        uint256 idx = _arenaAgentIndex[arenaId][agentId];
        if (idx != 0) {
            uint256 lastAgentId = list[list.length - 1];
            list[idx - 1] = lastAgentId;
            list.pop();
            _arenaAgentIndex[arenaId][lastAgentId] = idx;
            _arenaAgentIndex[arenaId][agentId] = 0;
        }

        // Clear registration and portfolio
        registrations[agentId][arenaId] = false;
        delete portfolios[agentId][arenaId];

        // Return any remaining locked MOLTI to agent owner
        if (moltiToReturn > 0) {
            moltiToken.safeTransfer(msg.sender, moltiToReturn);
        }

        emit AgentUnregistered(agentId, arenaId);
    }

    // ---------------------------------------------------------------
    //  Trade execution
    // ---------------------------------------------------------------

    /**
     * @notice Execute a trade for an agent in an arena.
     *         Only callable by the agent's dedicated wallet or the platform operator.
     *         Applies 0.5% fee per trade (50% reward pool, 30% treasury, 20% burn).
     *
     *         BUY: pulls `buyAmountWei` MOLTI from the agent's wallet, deducts
     *              fee from that amount, and credits virtual tokens.
     *         SELL: returns proportional `moltiLocked` to the agent's wallet
     *              (cost-basis, NOT price-based), deducting fee. PnL is paper-only.
     *
     * @param agentId       The agent executing the trade.
     * @param arenaId       The arena the trade occurs in.
     * @param epochId       Current epoch for fee allocation.
     * @param action        BUY or SELL (HOLD reverts).
     * @param sizePct       SELL: percentage of position (1e18 scale). Ignored for BUY.
     * @param buyAmountWei  BUY: gross MOLTI amount to pull from wallet (wei). Ignored for SELL.
     * @param price         Current token price, scaled by 1e18 (for paper PnL tracking).
     * @param tick          Current tick number (for recording).
     */
    function executeTrade(
        uint256 agentId,
        uint256 arenaId,
        uint256 epochId,
        Action action,
        uint256 sizePct,
        uint256 buyAmountWei,
        uint256 price,
        uint32 tick
    ) external onlyTradeAuthorized(agentId) {
        if (action == Action.HOLD) revert HoldIsNoop();
        if (!registrations[agentId][arenaId]) revert NotRegistered(agentId, arenaId);
        if (price == 0) revert ZeroPrice();
        EpochInfo storage ep = epochs[arenaId][epochId];
        if (ep.startTime == 0) revert EpochNotFound(arenaId, epochId);
        if (ep.ended) revert EpochAlreadyEnded(arenaId, epochId);
        if (!epochRegistrations[agentId][arenaId][epochId].exists) revert AgentNotRenewedForEpoch(agentId, arenaId, epochId);

        PortfolioState storage pf = portfolios[agentId][arenaId];

        uint256 sizePctOrAmount;
        if (action == Action.BUY) {
            if (buyAmountWei == 0) revert ZeroBuyAmount();
            _executeBuyWithFee(agentId, arenaId, epochId, pf, buyAmountWei, price);
            sizePctOrAmount = buyAmountWei;
        } else {
            if (sizePct == 0) revert ZeroSizePct();
            if (sizePct > SCALE) revert SizePctTooLarge();
            _executeSellWithFee(agentId, arenaId, epochId, pf, sizePct, price);
            sizePctOrAmount = sizePct;
        }

        pf.tradeCount++;
        pf.lastTradeTick = tick;

        emit TradePlaced(
            agentId,
            arenaId,
            action,
            sizePctOrAmount,
            price,
            pf.moltiLocked,
            pf.tokenUnits
        );
    }

    /**
     * @dev Split a fee amount into reward pool, treasury, and burn portions.
     *      50% reward pool, 30% treasury, 20% burn (remainder absorbs rounding).
     */
    function _splitFee(uint256 fee) private pure returns (uint256 pool, uint256 treasury, uint256 burn) {
        pool = fee * FEE_POOL_PCT / 100;
        treasury = fee * FEE_TREASURY_PCT / 100;
        burn = fee - pool - treasury;
    }

    /**
     * @dev Execute a BUY: pull MOLTI from agent wallet, deduct 0.5% fee from amount.
     *      Fee split: 50% reward pool, 30% treasury, 20% burn.
     *      Remaining (netSpend) increases moltiLocked and buys virtual tokens.
     */
    function _executeBuyWithFee(
        uint256 agentId,
        uint256 arenaId,
        uint256 epochId,
        PortfolioState storage pf,
        uint256 buyAmountWei,
        uint256 price
    ) private {
        // Pull MOLTI from agent's wallet
        address wallet = agents[agentId].wallet;
        moltiToken.safeTransferFrom(wallet, address(this), buyAmountWei);

        uint256 fee = buyAmountWei * TRADE_FEE_BPS / 10000;
        uint256 netSpend = buyAmountWei - fee;

        (uint256 feePool, uint256 feeTreasury, uint256 feeBurn) = _splitFee(fee);

        pf.moltiLocked += netSpend;

        epochs[arenaId][epochId].rewardPoolWei += feePool;
        epochs[arenaId][epochId].burnedWei += feeBurn;
        epochRegistrations[agentId][arenaId][epochId].feesPaidWei += fee;
        collectedFees += feeTreasury;

        moltiToken.safeTransfer(BURN_ADDRESS, feeBurn);

        // Virtual token position for paper PnL
        uint256 tokensBought = netSpend * SCALE / price;
        if (pf.tokenUnits + tokensBought > 0) {
            pf.avgEntryPrice = (
                pf.avgEntryPrice * pf.tokenUnits + price * tokensBought
            ) / (pf.tokenUnits + tokensBought);
        }
        pf.tokenUnits += tokensBought;

        emit TradeFeeRecorded(agentId, arenaId, epochId, feePool, feeTreasury, feeBurn);
    }

    /**
     * @dev Execute a SELL: return proportional moltiLocked to agent wallet (cost-basis).
     *      Fee (0.5%) deducted from the returned amount. PnL is paper-only.
     *      Fee split: 50% reward pool, 30% treasury, 20% burn.
     */
    function _executeSellWithFee(
        uint256 agentId,
        uint256 arenaId,
        uint256 epochId,
        PortfolioState storage pf,
        uint256 sizePct,
        uint256 price
    ) private {
        // Return proportional moltiLocked (cost-basis), NOT price-based revenue
        uint256 moltiBack = pf.moltiLocked * sizePct / SCALE;
        if (moltiBack == 0) revert InsufficientTokens(1, 0);

        uint256 fee = moltiBack * TRADE_FEE_BPS / 10000;
        uint256 netReturn = moltiBack - fee;

        (uint256 feePool, uint256 feeTreasury, uint256 feeBurn) = _splitFee(fee);

        pf.moltiLocked -= moltiBack;

        // Also reduce virtual token position (for paper PnL tracking)
        uint256 tokensSold = pf.tokenUnits * sizePct / SCALE;
        pf.tokenUnits -= tokensSold;

        epochs[arenaId][epochId].rewardPoolWei += feePool;
        epochs[arenaId][epochId].burnedWei += feeBurn;
        epochRegistrations[agentId][arenaId][epochId].feesPaidWei += fee;
        collectedFees += feeTreasury;

        moltiToken.safeTransfer(BURN_ADDRESS, feeBurn);
        if (netReturn > 0) {
            moltiToken.safeTransfer(agents[agentId].wallet, netReturn);
        }

        if (pf.tokenUnits == 0) {
            pf.avgEntryPrice = 0;
        }

        emit TradeFeeRecorded(agentId, arenaId, epochId, feePool, feeTreasury, feeBurn);
    }

    // ---------------------------------------------------------------
    //  Epoch management
    // ---------------------------------------------------------------

    /**
     * @notice Create a new epoch for an arena. Only operator.
     * @param arenaId   The arena.
     * @param startTime Epoch start timestamp.
     * @param endTime   Epoch end timestamp.
     * @return epochId  The new epoch ID.
     */
    function createEpoch(
        uint256 arenaId,
        uint256 startTime,
        uint256 endTime
    ) external onlyOperator returns (uint256 epochId) {
        if (arenas[arenaId].tokenAddress == address(0)) revert ArenaNotFound(arenaId);
        epochId = nextEpochId[arenaId]++;
        epochs[arenaId][epochId] = EpochInfo({
            startTime: startTime,
            endTime: endTime,
            rewardPoolWei: 0,
            burnedWei: 0,
            ended: false
        });
        emit EpochCreated(arenaId, epochId, startTime, endTime);
    }

    /**
     * @notice Auto-renew agent for epoch: transfer MOLTI from agent wallet to contract.
     *         Split: 50% reward pool, 30% treasury, 20% burn. Only operator.
     * @param agentId  The agent.
     * @param arenaId  The arena.
     * @param epochId  The epoch to renew for.
     */
    function autoRenewEpoch(
        uint256 agentId,
        uint256 arenaId,
        uint256 epochId
    ) external nonReentrant onlyOperator {
        if (!agents[agentId].exists) revert AgentNotFound(agentId);
        if (arenas[arenaId].tokenAddress == address(0)) revert ArenaNotFound(arenaId);
        if (!registrations[agentId][arenaId]) revert NotRegistered(agentId, arenaId);
        EpochInfo storage ep = epochs[arenaId][epochId];
        if (ep.startTime == 0) revert EpochNotFound(arenaId, epochId);
        if (ep.ended) revert EpochAlreadyEnded(arenaId, epochId);
        if (epochRegistrations[agentId][arenaId][epochId].exists) return; // already renewed

        address wallet = agents[agentId].wallet;
        uint256 balance = moltiToken.balanceOf(wallet);
        if (balance < epochRenewalFee) revert InsufficientAgentBalance(epochRenewalFee, balance);

        moltiToken.safeTransferFrom(wallet, address(this), epochRenewalFee);

        (uint256 toPool, uint256 toTreasury, uint256 toBurn) = _splitFee(epochRenewalFee);
        ep.rewardPoolWei += toPool;
        ep.burnedWei += toBurn;
        collectedFees += toTreasury;
        moltiToken.safeTransfer(BURN_ADDRESS, toBurn);

        epochRegistrations[agentId][arenaId][epochId] = EpochReg({
            depositWei: 0,
            feesPaidWei: 0,
            principalClaimed: false,
            rewardClaimed: false,
            exists: true
        });

        emit AgentEpochRenewed(agentId, arenaId, epochId, epochRenewalFee);
    }

    /**
     * @notice End an epoch. Only operator. Sets status so no more trades; enables claims.
     * @param arenaId The arena.
     * @param epochId The epoch.
     */
    function endEpoch(uint256 arenaId, uint256 epochId) external onlyOperator {
        EpochInfo storage ep = epochs[arenaId][epochId];
        if (ep.startTime == 0) revert EpochNotFound(arenaId, epochId);
        if (ep.ended) revert EpochAlreadyEnded(arenaId, epochId);
        ep.ended = true;
        emit EpochEnded(arenaId, epochId);
    }

    /**
     * @notice Set pending reward for an agent in an epoch. Only operator.
     *         Call after endEpoch to populate reward amounts.
     * @param agentId  The agent.
     * @param arenaId  The arena.
     * @param epochId  The epoch.
     * @param amountWei Amount the agent can claim.
     */
    function setPendingReward(
        uint256 agentId,
        uint256 arenaId,
        uint256 epochId,
        uint256 amountWei
    ) external onlyOperator {
        EpochInfo storage ep = epochs[arenaId][epochId];
        if (!ep.ended) revert EpochNotEnded(arenaId, epochId);
        pendingRewards[agentId][arenaId][epochId] = amountWei;
    }

    /**
     * @notice Set pending rewards for multiple agents in one call. Only operator.
     * @param arenaId   The arena.
     * @param epochId   The epoch.
     * @param agentIds  On-chain agent IDs.
     * @param amountWeis Amount wei per agent (same length as agentIds).
     */
    function setPendingRewardsBatch(
        uint256 arenaId,
        uint256 epochId,
        uint256[] calldata agentIds,
        uint256[] calldata amountWeis
    ) external onlyOperator {
        EpochInfo storage ep = epochs[arenaId][epochId];
        if (!ep.ended) revert EpochNotEnded(arenaId, epochId);
        if (agentIds.length != amountWeis.length) revert InvalidBatchLength();
        for (uint256 i = 0; i < agentIds.length; i++) {
            pendingRewards[agentIds[i]][arenaId][epochId] = amountWeis[i];
        }
        emit RewardsDistributed(arenaId, epochId, agentIds.length);
    }

    /**
     * @notice Sweep unclaimed rewards after claim window (e.g. 30 days). Burns wei. Only operator.
     * @param arenaId   The arena.
     * @param epochId   The epoch.
     * @param agentIds  Agent IDs that had rewards set (winners). Unclaimed amounts are swept.
     */
    function sweepUnclaimedRewards(
        uint256 arenaId,
        uint256 epochId,
        uint256[] calldata agentIds
    ) external onlyOperator {
        EpochInfo storage ep = epochs[arenaId][epochId];
        if (!ep.ended) revert EpochNotEnded(arenaId, epochId);
        if (block.timestamp < ep.endTime + 30 days) revert ClaimWindowNotEnded();
        uint256 total;
        for (uint256 i = 0; i < agentIds.length; i++) {
            uint256 amount = pendingRewards[agentIds[i]][arenaId][epochId];
            if (amount > 0 && !epochRegistrations[agentIds[i]][arenaId][epochId].rewardClaimed) {
                total += amount;
                pendingRewards[agentIds[i]][arenaId][epochId] = 0;
            }
        }
        if (total > 0) {
            moltiToken.safeTransfer(BURN_ADDRESS, total);
            emit UnclaimedRewardsSwept(arenaId, epochId, total);
        }
    }

    /**
     * @notice Claim pending reward for an agent in an epoch. Only agent owner.
     * @param agentId  The agent.
     * @param arenaId  The arena.
     * @param epochId  The epoch.
     */
    function claimReward(
        uint256 agentId,
        uint256 arenaId,
        uint256 epochId
    ) external nonReentrant onlyAgentOwner(agentId) {
        EpochInfo storage ep = epochs[arenaId][epochId];
        if (!ep.ended) revert EpochNotEnded(arenaId, epochId);
        if (epochRegistrations[agentId][arenaId][epochId].rewardClaimed) revert RewardAlreadyClaimed(agentId, arenaId, epochId);

        uint256 amount = pendingRewards[agentId][arenaId][epochId];
        if (amount == 0) revert NothingToClaim();

        epochRegistrations[agentId][arenaId][epochId].rewardClaimed = true;
        pendingRewards[agentId][arenaId][epochId] = 0;

        moltiToken.safeTransfer(msg.sender, amount);
        emit RewardClaimed(agentId, arenaId, epochId, amount);
    }

    /**
     * @notice Get pending reward for an agent in an epoch.
     */
    function getPendingReward(
        uint256 agentId,
        uint256 arenaId,
        uint256 epochId
    ) external view returns (uint256) {
        return pendingRewards[agentId][arenaId][epochId];
    }

    /**
     * @notice Set epoch renewal fee. Only owner.
     * @param newFee New fee in MOLTI wei (e.g. 100e18).
     */
    function setEpochRenewalFee(uint256 newFee) external onlyOwner {
        epochRenewalFee = newFee;
    }

    // ---------------------------------------------------------------
    //  Operator management
    // ---------------------------------------------------------------

    /**
     * @notice Set the backend operator address that can execute trades.
     * @param _operator New operator address (or address(0) to disable).
     */
    function setOperator(address _operator) external onlyOwner {
        address old = operator;
        operator = _operator;
        emit OperatorUpdated(old, _operator);
    }

    // ---------------------------------------------------------------
    //  Fee management
    // ---------------------------------------------------------------

    /**
     * @notice Update the agent creation fee. Only callable by owner.
     * @param newFee New fee in MOLTI wei.
     */
    function setAgentCreationFee(uint256 newFee) external onlyOwner {
        uint256 old = agentCreationFee;
        agentCreationFee = newFee;
        emit AgentCreationFeeUpdated(old, newFee);
    }

    /**
     * @notice Withdraw all collected fees (creation + treasury) to the owner.
     */
    function withdrawFees() external onlyOwner nonReentrant {
        uint256 amount = collectedFees;
        if (amount == 0) revert NoFeesToWithdraw();
        collectedFees = 0;
        moltiToken.safeTransfer(owner(), amount);
    }

    // ---------------------------------------------------------------
    //  View helpers
    // ---------------------------------------------------------------

    /**
     * @notice Get full portfolio state for an agent in an arena.
     */
    function getPortfolio(
        uint256 agentId,
        uint256 arenaId
    ) external view returns (PortfolioState memory) {
        return portfolios[agentId][arenaId];
    }

    /**
     * @notice Get agent info.
     */
    function getAgent(uint256 agentId) external view returns (AgentInfo memory) {
        return agents[agentId];
    }

    /**
     * @notice Get arena info.
     */
    function getArena(uint256 arenaId) external view returns (ArenaInfo memory) {
        return arenas[arenaId];
    }

    /**
     * @notice Return all agent IDs registered in an arena and whether each has renewed for an epoch.
     *         One call replaces N isRegistered + N epochRegistrations reads off-chain.
     * @param arenaId The arena.
     * @param epochId  The epoch to check renewal for (e.g. current epoch).
     * @return agentIds       Registered agent IDs in this arena.
     * @return renewedForEpoch For each agent, true if epochRegistrations[agentId][arenaId][epochId].exists.
     */
    function getAgentsInArenaWithRenewal(
        uint256 arenaId,
        uint256 epochId
    ) external view returns (
        uint256[] memory agentIds,
        bool[] memory renewedForEpoch
    ) {
        uint256[] storage list = _arenaAgentIds[arenaId];
        uint256 n = list.length;
        agentIds = new uint256[](n);
        renewedForEpoch = new bool[](n);
        for (uint256 i = 0; i < n; i++) {
            uint256 aid = list[i];
            agentIds[i] = aid;
            renewedForEpoch[i] = epochRegistrations[aid][arenaId][epochId].exists;
        }
    }

    /**
     * @notice Check if an agent is registered to an arena.
     */
    function isRegistered(
        uint256 agentId,
        uint256 arenaId
    ) external view returns (bool) {
        return registrations[agentId][arenaId];
    }

    /**
     * @notice Compute current position value for an agent in an arena at a given price.
     *         Returns tokenUnits * price / SCALE (cash is in the agent's wallet, off-chain).
     */
    function computeEquity(
        uint256 agentId,
        uint256 arenaId,
        uint256 price
    ) external view returns (uint256) {
        PortfolioState storage pf = portfolios[agentId][arenaId];
        return pf.tokenUnits * price / SCALE;
    }
}
