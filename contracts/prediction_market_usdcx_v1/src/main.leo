// ============================================================================
// VEILO — prediction_market_v1.aleo
// Privacy-preserving prediction market on Aleo
// ============================================================================
// FPMM (Fixed Product Market Maker) with complete-set minting/burning.
// Supports 2–8 outcomes per market (vs veiled-markets 4-outcome max).
// Multi-voter quorum resolution + dispute bond system.
// ALEO-only variant; USDCX and USAD handled by separate programs.
// ============================================================================

import credits.aleo;
import test_usdcx_stablecoin.aleo;

program veilo_market_usdcx_v1.aleo {

    // ========================================================================
    // CONSTANTS
    // ========================================================================

    const STATUS_ACTIVE: u8 = 1u8;
    const STATUS_CLOSED: u8 = 2u8;
    const STATUS_RESOLVED: u8 = 3u8;
    const STATUS_CANCELLED: u8 = 4u8;
    const STATUS_PENDING_RESOLUTION: u8 = 5u8;
    const STATUS_PENDING_FINALIZATION: u8 = 6u8;
    const STATUS_DISPUTED: u8 = 7u8;

    const TOKEN_ALEO: u8 = 1u8;
    const TOKEN_USDCX: u8 = 2u8;
    const TOKEN_USAD: u8 = 3u8;

    // Category constants
    const CAT_POLITICS: u8 = 1u8;
    const CAT_SPORTS: u8 = 2u8;
    const CAT_CRYPTO: u8 = 3u8;
    const CAT_ENTERTAINMENT: u8 = 4u8;
    const CAT_OTHER: u8 = 5u8;

    // Fee config (basis points: 100 = 1%)
    const PROTOCOL_FEE_BPS: u128 = 50u128;
    const CREATOR_FEE_BPS: u128 = 50u128;
    const LP_FEE_BPS: u128 = 100u128;
    const FEE_DENOMINATOR: u128 = 10000u128;

    // Voter reward: 20% of protocol fees split among winning voters
    const VOTER_REWARD_PERCENT: u128 = 20u128;

    const MIN_TRADE_AMOUNT: u128 = 1000u128;
    const MIN_LIQUIDITY: u128 = 10000u128;

    // Multi-voter quorum + dispute
    const MIN_VOTE_BOND: u128 = 1000000u128;       // 1 ALEO
    const MIN_VOTERS: u8 = 3u8;
    const VOTE_WINDOW_BLOCKS: u64 = 2880u64;        // ~12 hours
    const DISPUTE_WINDOW_BLOCKS: u64 = 2880u64;
    const DISPUTE_BOND_MULTIPLIER: u128 = 3u128;

    // ========================================================================
    // RECORDS (Private state)
    // ========================================================================

    record OutcomeShare {
        owner: address,
        market_id: field,
        outcome: u8,
        quantity: u128,
        share_nonce: field,
        token_type: u8,
    }

    record LPToken {
        owner: address,
        market_id: field,
        lp_shares: u128,
        lp_nonce: field,
        token_type: u8,
    }

    record VoterBondReceipt {
        owner: address,
        market_id: field,
        voted_outcome: u8,
        bond_amount: u128,
        bond_nonce: field,
    }

    record DisputeBondReceipt {
        owner: address,
        market_id: field,
        proposed_outcome: u8,
        bond_amount: u128,
        dispute_nonce: field,
    }

    record RefundClaim {
        owner: address,
        market_id: field,
        amount: u128,
        claim_nonce: field,
        token_type: u8,
    }

    // ========================================================================
    // STRUCTS (Public composite types)
    // ========================================================================

    struct Market {
        id: field,
        creator: address,
        resolver: address,
        question_hash: field,
        category: u8,
        num_outcomes: u8,      // 2–8
        deadline: u64,
        resolution_deadline: u64,
        status: u8,
        created_at: u64,
        token_type: u8,
    }

    // 8-outcome AMM pool (reserve_5..reserve_8 are 0 for markets with fewer outcomes)
    struct AMMPool {
        market_id: field,
        reserve_1: u128,
        reserve_2: u128,
        reserve_3: u128,
        reserve_4: u128,
        reserve_5: u128,
        reserve_6: u128,
        reserve_7: u128,
        reserve_8: u128,
        total_liquidity: u128,
        total_lp_shares: u128,
        total_volume: u128,
    }

    // 8-outcome vote tally (bonds_5..bonds_8 are 0 for markets with fewer outcomes)
    struct VoteTally {
        market_id: field,
        outcome_1_bonds: u128,
        outcome_2_bonds: u128,
        outcome_3_bonds: u128,
        outcome_4_bonds: u128,
        outcome_5_bonds: u128,
        outcome_6_bonds: u128,
        outcome_7_bonds: u128,
        outcome_8_bonds: u128,
        total_voters: u8,
        total_bonded: u128,
        voting_deadline: u64,
        dispute_deadline: u64,
        finalized: bool,
        winning_outcome: u8,
    }

    struct MarketFees {
        market_id: field,
        protocol_fees: u128,
        creator_fees: u128,
    }

    struct MarketSeed {
        creator: address,
        question_hash: field,
        deadline: u64,
        nonce: u64,
    }

    struct ShareClaimKey {
        market_id: field,
        claimer: address,
        share_nonce: field,
    }

    struct LPClaimKey {
        market_id: field,
        claimer: address,
        lp_nonce: field,
    }

    struct BondClaimKey {
        market_id: field,
        claimer: address,
        bond_nonce: field,
    }

    struct VoterKey {
        market_id: field,
        voter: address,
    }

    // ========================================================================
    // MAPPINGS (Public on-chain state)
    // ========================================================================

    mapping markets: field => Market;
    mapping amm_pools: field => AMMPool;
    mapping market_fees: field => MarketFees;
    mapping share_redeemed: field => bool;
    mapping program_credits: u8 => u128;       // 0u8 = ALEO total held
    mapping market_credits: field => u128;     // per-market credits held
    mapping protocol_treasury: u8 => u128;
    mapping lp_positions: field => bool;

    // Resolution
    mapping vote_tallies: field => VoteTally;
    mapping voter_participated: field => bool;
    mapping bond_claimed: field => bool;
    mapping voter_rewards: address => u128;
    mapping dispute_bonds: field => u128;

    // ========================================================================
    // CONSTRUCTOR
    // ========================================================================

    @noupgrade
    async constructor() {}

    // ########################################################################
    //                         MARKET OPERATIONS
    // ########################################################################

    // ========================================================================
    // 1. CREATE MARKET
    // ========================================================================

    async transition create_market(
        public question_hash: field,
        public category: u8,
        public num_outcomes: u8,
        public deadline: u64,
        public resolution_deadline: u64,
        public resolver: address,
        private initial_liquidity: u128,
    ) -> (field, LPToken, Future) {
        assert(num_outcomes >= 2u8 && num_outcomes <= 8u8);
        assert(initial_liquidity >= MIN_LIQUIDITY);

        let market_id: field = BHP256::hash_to_field(MarketSeed {
            creator: self.caller,
            question_hash: question_hash,
            deadline: deadline,
            nonce: resolution_deadline,
        });

        let lp_nonce: field = BHP256::hash_to_field(LPClaimKey {
            market_id: market_id,
            claimer: self.caller,
            lp_nonce: 0field,
        });

        let lp_token: LPToken = LPToken {
            owner: self.caller,
            market_id: market_id,
            lp_shares: initial_liquidity,
            lp_nonce: lp_nonce,
            token_type: TOKEN_USDCX,
        };

        let transfer_future: Future = test_usdcx_stablecoin.aleo/transfer_public_as_signer(
            self.address,
            initial_liquidity
        );

        return (market_id, lp_token, create_market_finalize(
            transfer_future, market_id, self.caller,
            question_hash, category, num_outcomes,
            deadline, resolution_deadline, resolver, initial_liquidity
        ));
    }

    async function create_market_finalize(
        transfer_future: Future,
        market_id: field,
        creator: address,
        question_hash: field,
        category: u8,
        num_outcomes: u8,
        deadline: u64,
        resolution_deadline: u64,
        resolver: address,
        initial_liquidity: u128,
    ) {
        transfer_future.await();

        let market_exists: bool = markets.contains(market_id);
        assert(!market_exists);

        let current_height: u64 = block.height as u64;
        assert(deadline > current_height);
        assert(resolution_deadline > deadline);

        let new_market: Market = Market {
            id: market_id,
            creator: creator,
            resolver: resolver,
            question_hash: question_hash,
            category: category,
            num_outcomes: num_outcomes,
            deadline: deadline,
            resolution_deadline: resolution_deadline,
            status: STATUS_ACTIVE,
            created_at: current_height,
            token_type: TOKEN_USDCX,
        };

        // Distribute initial liquidity equally across active outcomes
        let n: u128 = num_outcomes as u128;
        let per_outcome: u128 = initial_liquidity / n;

        let r1: u128 = per_outcome;
        let r2: u128 = per_outcome;
        let r3: u128 = num_outcomes >= 3u8 ? per_outcome : 0u128;
        let r4: u128 = num_outcomes >= 4u8 ? per_outcome : 0u128;
        let r5: u128 = num_outcomes >= 5u8 ? per_outcome : 0u128;
        let r6: u128 = num_outcomes >= 6u8 ? per_outcome : 0u128;
        let r7: u128 = num_outcomes >= 7u8 ? per_outcome : 0u128;
        // r8 absorbs rounding remainder
        let distributed: u128 = per_outcome * (n - 1u128);
        let r8: u128 = num_outcomes >= 8u8 ? (initial_liquidity - distributed) : 0u128;

        let initial_pool: AMMPool = AMMPool {
            market_id: market_id,
            reserve_1: r1,
            reserve_2: r2,
            reserve_3: r3,
            reserve_4: r4,
            reserve_5: r5,
            reserve_6: r6,
            reserve_7: r7,
            reserve_8: r8,
            total_liquidity: initial_liquidity,
            total_lp_shares: initial_liquidity,
            total_volume: 0u128,
        };

        markets.set(market_id, new_market);
        amm_pools.set(market_id, initial_pool);
        market_fees.set(market_id, MarketFees {
            market_id: market_id,
            protocol_fees: 0u128,
            creator_fees: 0u128,
        });

        let current_held: u128 = program_credits.get_or_use(1u8, 0u128);
        program_credits.set(1u8, current_held + initial_liquidity);
        market_credits.set(market_id, initial_liquidity);
    }

    // ========================================================================
    // 2. BUY SHARES (ALEO) — FPMM complete-set minting, 8-outcome extension
    // ========================================================================
    // Formula: r_i_new = r_i * prod(r_k / (r_k + a)) for active k != i
    // shares_out = (r_i + a) - r_i_new

    async transition buy_shares(
        private market_id: field,
        private outcome: u8,
        private amount_in: u128,
        private expected_shares: u128,
        private min_shares_out: u128,
        private share_nonce: field,
    ) -> (OutcomeShare, Future) {
        assert(outcome >= 1u8 && outcome <= 8u8);
        assert(amount_in >= MIN_TRADE_AMOUNT);

        let share: OutcomeShare = OutcomeShare {
            owner: self.caller,
            market_id: market_id,
            outcome: outcome,
            quantity: expected_shares,
            share_nonce: share_nonce,
            token_type: TOKEN_USDCX,
        };

        let transfer_future: Future = test_usdcx_stablecoin.aleo/transfer_public_as_signer(
            self.address, amount_in
        );

        return (share, buy_shares_finalize(
            transfer_future, market_id, outcome, amount_in,
            expected_shares, min_shares_out, TOKEN_USDCX
        ));
    }

    async function buy_shares_finalize(
        transfer_future: Future,
        market_id: field,
        outcome: u8,
        amount_in: u128,
        expected_shares: u128,
        min_shares_out: u128,
        token_type: u8,
    ) {
        transfer_future.await();

        let market: Market = markets.get(market_id);
        assert(market.status == STATUS_ACTIVE);
        assert(market.token_type == token_type);
        assert(outcome >= 1u8 && outcome <= market.num_outcomes);

        let current_height: u64 = block.height as u64;
        assert(current_height <= market.deadline);

        // Fees
        let protocol_fee: u128 = (amount_in * PROTOCOL_FEE_BPS) / FEE_DENOMINATOR;
        let creator_fee: u128 = (amount_in * CREATOR_FEE_BPS) / FEE_DENOMINATOR;
        let amount_to_pool: u128 = amount_in - protocol_fee - creator_fee;

        let fees: MarketFees = market_fees.get(market_id);
        market_fees.set(market_id, MarketFees {
            market_id: market_id,
            protocol_fees: fees.protocol_fees + protocol_fee,
            creator_fees: fees.creator_fees + creator_fee,
        });
        let current_treasury: u128 = protocol_treasury.get_or_use(1u8, 0u128);
        protocol_treasury.set(1u8, current_treasury + protocol_fee);

        // FPMM step-division (8 outcomes)
        let pool: AMMPool = amm_pools.get(market_id);
        let n: u8 = market.num_outcomes;
        let r1: u128 = pool.reserve_1;
        let r2: u128 = pool.reserve_2;
        let r3: u128 = pool.reserve_3;
        let r4: u128 = pool.reserve_4;
        let r5: u128 = pool.reserve_5;
        let r6: u128 = pool.reserve_6;
        let r7: u128 = pool.reserve_7;
        let r8: u128 = pool.reserve_8;
        let a: u128 = amount_to_pool;

        // r_i = selected outcome's current reserve
        let r_i: u128 =
            outcome == 1u8 ? r1 :
            (outcome == 2u8 ? r2 :
            (outcome == 3u8 ? r3 :
            (outcome == 4u8 ? r4 :
            (outcome == 5u8 ? r5 :
            (outcome == 6u8 ? r6 :
            (outcome == 7u8 ? r7 : r8))))));

        // Step-division: multiply r_i by (r_k / (r_k + a)) for each non-target active outcome
        let step0: u128 = r_i;
        let step1: u128 = outcome != 1u8 ? (step0 * r1) / (r1 + a) : step0;
        let step2: u128 = outcome != 2u8 ? (step1 * r2) / (r2 + a) : step1;
        let step3: u128 = (outcome != 3u8 && n >= 3u8) ? (step2 * r3) / (r3 + a) : step2;
        let step4: u128 = (outcome != 4u8 && n >= 4u8) ? (step3 * r4) / (r4 + a) : step3;
        let step5: u128 = (outcome != 5u8 && n >= 5u8) ? (step4 * r5) / (r5 + a) : step4;
        let step6: u128 = (outcome != 6u8 && n >= 6u8) ? (step5 * r6) / (r6 + a) : step5;
        let step7: u128 = (outcome != 7u8 && n >= 7u8) ? (step6 * r7) / (r7 + a) : step6;
        let step8: u128 = (outcome != 8u8 && n >= 8u8) ? (step7 * r8) / (r8 + a) : step7;

        let r_i_new: u128 = step8;
        let shares_out: u128 = (r_i + a) - r_i_new;

        assert(shares_out >= min_shares_out);
        assert(shares_out >= expected_shares);
        assert(shares_out > 0u128);

        // Reserve update: non-target outcomes += a, target outcome = r_i_new
        let new_r1: u128 = outcome == 1u8 ? r_i_new : (r1 + a);
        let new_r2: u128 = outcome == 2u8 ? r_i_new : (r2 + a);
        let nr3: u128 = outcome == 3u8 ? r_i_new : (r3 + a);
        let new_r3: u128 = n >= 3u8 ? nr3 : 0u128;
        let nr4: u128 = outcome == 4u8 ? r_i_new : (r4 + a);
        let new_r4: u128 = n >= 4u8 ? nr4 : 0u128;
        let nr5: u128 = outcome == 5u8 ? r_i_new : (r5 + a);
        let new_r5: u128 = n >= 5u8 ? nr5 : 0u128;
        let nr6: u128 = outcome == 6u8 ? r_i_new : (r6 + a);
        let new_r6: u128 = n >= 6u8 ? nr6 : 0u128;
        let nr7: u128 = outcome == 7u8 ? r_i_new : (r7 + a);
        let new_r7: u128 = n >= 7u8 ? nr7 : 0u128;
        let nr8: u128 = outcome == 8u8 ? r_i_new : (r8 + a);
        let new_r8: u128 = n >= 8u8 ? nr8 : 0u128;

        amm_pools.set(market_id, AMMPool {
            market_id: market_id,
            reserve_1: new_r1,
            reserve_2: new_r2,
            reserve_3: new_r3,
            reserve_4: new_r4,
            reserve_5: new_r5,
            reserve_6: new_r6,
            reserve_7: new_r7,
            reserve_8: new_r8,
            total_liquidity: pool.total_liquidity + amount_to_pool,
            total_lp_shares: pool.total_lp_shares,
            total_volume: pool.total_volume + amount_in,
        });

        let current_held: u128 = program_credits.get_or_use(1u8, 0u128);
        program_credits.set(1u8, current_held + amount_in);
        let market_held: u128 = market_credits.get_or_use(market_id, 0u128);
        market_credits.set(market_id, market_held + amount_in);
    }

    // ========================================================================
    // 3. SELL SHARES (ALEO) — FPMM complete-set burning, 8-outcome extension
    // ========================================================================
    // Formula: r_i_new = r_i * prod(r_k / (r_k - p)) for active k != i
    // shares_needed = r_i_new - r_i + p

    async transition sell_shares(
        private shares: OutcomeShare,
        private tokens_desired: u128,
        private max_shares_used: u128,
    ) -> (OutcomeShare, Future) {
        assert(shares.owner == self.caller);
        assert(shares.token_type == TOKEN_USDCX);
        assert(tokens_desired >= MIN_TRADE_AMOUNT);
        assert(max_shares_used > 0u128);
        assert(max_shares_used <= shares.quantity);

        // Pre-compute fees (constants — no mapping reads needed in transition)
        let protocol_fee: u128 = (tokens_desired * PROTOCOL_FEE_BPS) / FEE_DENOMINATOR;
        let creator_fee: u128 = (tokens_desired * CREATOR_FEE_BPS) / FEE_DENOMINATOR;
        let lp_fee: u128 = (tokens_desired * LP_FEE_BPS) / FEE_DENOMINATOR;
        let net_tokens: u128 = tokens_desired - protocol_fee - creator_fee - lp_fee;

        let transfer_future: Future = test_usdcx_stablecoin.aleo/transfer_public(
            self.caller, net_tokens
        );

        let remainder: OutcomeShare = OutcomeShare {
            owner: self.caller,
            market_id: shares.market_id,
            outcome: shares.outcome,
            quantity: shares.quantity - max_shares_used,
            share_nonce: shares.share_nonce,
            token_type: TOKEN_USDCX,
        };

        return (remainder, sell_shares_finalize(
            transfer_future, shares.market_id, shares.outcome,
            tokens_desired, max_shares_used, TOKEN_USDCX
        ));
    }

    async function sell_shares_finalize(
        transfer_future: Future,
        market_id: field,
        outcome: u8,
        tokens_desired: u128,
        max_shares_used: u128,
        token_type: u8,
    ) {
        transfer_future.await();

        let market: Market = markets.get(market_id);
        assert(market.status == STATUS_ACTIVE);
        assert(market.token_type == token_type);
        assert(outcome >= 1u8 && outcome <= market.num_outcomes);

        let current_height: u64 = block.height as u64;
        assert(current_height <= market.deadline);

        let protocol_fee: u128 = (tokens_desired * PROTOCOL_FEE_BPS) / FEE_DENOMINATOR;
        let creator_fee: u128 = (tokens_desired * CREATOR_FEE_BPS) / FEE_DENOMINATOR;
        let lp_fee: u128 = (tokens_desired * LP_FEE_BPS) / FEE_DENOMINATOR;
        let net_tokens: u128 = tokens_desired - protocol_fee - creator_fee - lp_fee;
        let pool_tokens_out: u128 = tokens_desired - lp_fee;

        let fees: MarketFees = market_fees.get(market_id);
        market_fees.set(market_id, MarketFees {
            market_id: market_id,
            protocol_fees: fees.protocol_fees + protocol_fee,
            creator_fees: fees.creator_fees + creator_fee,
        });
        let current_treasury: u128 = protocol_treasury.get_or_use(1u8, 0u128);
        protocol_treasury.set(1u8, current_treasury + protocol_fee);

        // FPMM sell: r_i_new = r_i * prod(r_k / (r_k - p)) for active k != i
        let pool: AMMPool = amm_pools.get(market_id);
        let n: u8 = market.num_outcomes;
        let r1: u128 = pool.reserve_1;
        let r2: u128 = pool.reserve_2;
        let r3: u128 = pool.reserve_3;
        let r4: u128 = pool.reserve_4;
        let r5: u128 = pool.reserve_5;
        let r6: u128 = pool.reserve_6;
        let r7: u128 = pool.reserve_7;
        let r8: u128 = pool.reserve_8;
        let p: u128 = pool_tokens_out;

        let r_i: u128 =
            outcome == 1u8 ? r1 :
            (outcome == 2u8 ? r2 :
            (outcome == 3u8 ? r3 :
            (outcome == 4u8 ? r4 :
            (outcome == 5u8 ? r5 :
            (outcome == 6u8 ? r6 :
            (outcome == 7u8 ? r7 : r8))))));

        // Step 1
        let sub1: u128 = outcome != 1u8 ? p : 0u128;
        assert(r1 >= sub1);
        let den1: u128 = r1 - sub1;
        let step0: u128 = r_i;
        let step1: u128 = outcome != 1u8 ? (step0 * r1) / den1 : step0;

        // Step 2
        let sub2: u128 = outcome != 2u8 ? p : 0u128;
        assert(r2 >= sub2);
        let den2: u128 = r2 - sub2;
        let step2: u128 = outcome != 2u8 ? (step1 * r2) / den2 : step1;

        // Step 3
        let apply3: bool = outcome != 3u8 && n >= 3u8;
        let sub3: u128 = apply3 ? p : 0u128;
        assert(r3 >= sub3);
        let den3_raw: u128 = r3 - sub3;
        let safe_den3: u128 = den3_raw == 0u128 ? 1u128 : den3_raw;
        let step3: u128 = apply3 ? (step2 * r3) / safe_den3 : step2;

        // Step 4
        let apply4: bool = outcome != 4u8 && n >= 4u8;
        let sub4: u128 = apply4 ? p : 0u128;
        assert(r4 >= sub4);
        let den4_raw: u128 = r4 - sub4;
        let safe_den4: u128 = den4_raw == 0u128 ? 1u128 : den4_raw;
        let step4: u128 = apply4 ? (step3 * r4) / safe_den4 : step3;

        // Step 5
        let apply5: bool = outcome != 5u8 && n >= 5u8;
        let sub5: u128 = apply5 ? p : 0u128;
        assert(r5 >= sub5);
        let den5_raw: u128 = r5 - sub5;
        let safe_den5: u128 = den5_raw == 0u128 ? 1u128 : den5_raw;
        let step5: u128 = apply5 ? (step4 * r5) / safe_den5 : step4;

        // Step 6
        let apply6: bool = outcome != 6u8 && n >= 6u8;
        let sub6: u128 = apply6 ? p : 0u128;
        assert(r6 >= sub6);
        let den6_raw: u128 = r6 - sub6;
        let safe_den6: u128 = den6_raw == 0u128 ? 1u128 : den6_raw;
        let step6: u128 = apply6 ? (step5 * r6) / safe_den6 : step5;

        // Step 7
        let apply7: bool = outcome != 7u8 && n >= 7u8;
        let sub7: u128 = apply7 ? p : 0u128;
        assert(r7 >= sub7);
        let den7_raw: u128 = r7 - sub7;
        let safe_den7: u128 = den7_raw == 0u128 ? 1u128 : den7_raw;
        let step7: u128 = apply7 ? (step6 * r7) / safe_den7 : step6;

        // Step 8
        let apply8: bool = outcome != 8u8 && n >= 8u8;
        let sub8: u128 = apply8 ? p : 0u128;
        assert(r8 >= sub8);
        let den8_raw: u128 = r8 - sub8;
        let safe_den8: u128 = den8_raw == 0u128 ? 1u128 : den8_raw;
        let step8: u128 = apply8 ? (step7 * r8) / safe_den8 : step7;

        let r_i_new: u128 = step8;
        let shares_needed: u128 = r_i_new - r_i + p;
        assert(shares_needed <= max_shares_used);
        assert(shares_needed > 0u128);

        // Reserve update: non-target -= p, target = r_i_new
        let new_r1: u128 = outcome == 1u8 ? r_i_new : (r1 - sub1);
        let new_r2: u128 = outcome == 2u8 ? r_i_new : (r2 - sub2);
        let nr3: u128 = outcome == 3u8 ? r_i_new : (r3 - sub3);
        let new_r3: u128 = n >= 3u8 ? nr3 : 0u128;
        let nr4: u128 = outcome == 4u8 ? r_i_new : (r4 - sub4);
        let new_r4: u128 = n >= 4u8 ? nr4 : 0u128;
        let nr5: u128 = outcome == 5u8 ? r_i_new : (r5 - sub5);
        let new_r5: u128 = n >= 5u8 ? nr5 : 0u128;
        let nr6: u128 = outcome == 6u8 ? r_i_new : (r6 - sub6);
        let new_r6: u128 = n >= 6u8 ? nr6 : 0u128;
        let nr7: u128 = outcome == 7u8 ? r_i_new : (r7 - sub7);
        let new_r7: u128 = n >= 7u8 ? nr7 : 0u128;
        let nr8: u128 = outcome == 8u8 ? r_i_new : (r8 - sub8);
        let new_r8: u128 = n >= 8u8 ? nr8 : 0u128;

        amm_pools.set(market_id, AMMPool {
            market_id: market_id,
            reserve_1: new_r1,
            reserve_2: new_r2,
            reserve_3: new_r3,
            reserve_4: new_r4,
            reserve_5: new_r5,
            reserve_6: new_r6,
            reserve_7: new_r7,
            reserve_8: new_r8,
            total_liquidity: pool.total_liquidity - pool_tokens_out,
            total_lp_shares: pool.total_lp_shares,
            total_volume: pool.total_volume + tokens_desired,
        });

        let market_held: u128 = market_credits.get_or_use(market_id, 0u128);
        assert(market_held >= pool_tokens_out);
        market_credits.set(market_id, market_held - pool_tokens_out);

        let current_held: u128 = program_credits.get_or_use(1u8, 0u128);
        assert(current_held >= net_tokens);
        program_credits.set(1u8, current_held - net_tokens);
    }

    // ========================================================================
    // 4. ADD LIQUIDITY
    // ========================================================================

    async transition add_liquidity(
        private market_id: field,
        private amount: u128,
        private expected_lp_shares: u128,
        private lp_nonce: field,
    ) -> (LPToken, Future) {
        assert(amount >= MIN_LIQUIDITY);

        let lp_token: LPToken = LPToken {
            owner: self.caller,
            market_id: market_id,
            lp_shares: expected_lp_shares,
            lp_nonce: lp_nonce,
            token_type: TOKEN_USDCX,
        };

        let transfer_future: Future = test_usdcx_stablecoin.aleo/transfer_public_as_signer(
            self.address, amount
        );

        return (lp_token, add_liquidity_finalize(
            transfer_future, market_id, amount, expected_lp_shares, TOKEN_USDCX
        ));
    }

    async function add_liquidity_finalize(
        transfer_future: Future,
        market_id: field,
        amount: u128,
        expected_lp_shares: u128,
        token_type: u8,
    ) {
        transfer_future.await();

        let market: Market = markets.get(market_id);
        assert(market.status == STATUS_ACTIVE);
        assert(market.token_type == token_type);

        let current_height: u64 = block.height as u64;
        assert(current_height <= market.deadline);

        let pool: AMMPool = amm_pools.get(market_id);

        let total_reserves: u128 = pool.reserve_1 + pool.reserve_2 + pool.reserve_3 + pool.reserve_4
            + pool.reserve_5 + pool.reserve_6 + pool.reserve_7 + pool.reserve_8;
        assert(total_reserves > 0u128);

        let computed_shares: u128 = (amount * pool.total_lp_shares) / total_reserves;
        assert(computed_shares >= expected_lp_shares);
        assert(expected_lp_shares > 0u128);

        // Add proportionally to all active reserves
        let add_1: u128 = (amount * pool.reserve_1) / total_reserves;
        let add_2: u128 = (amount * pool.reserve_2) / total_reserves;
        let add_3: u128 = (amount * pool.reserve_3) / total_reserves;
        let add_4: u128 = (amount * pool.reserve_4) / total_reserves;
        let add_5: u128 = (amount * pool.reserve_5) / total_reserves;
        let add_6: u128 = (amount * pool.reserve_6) / total_reserves;
        let add_7: u128 = (amount * pool.reserve_7) / total_reserves;
        // add_8 absorbs rounding remainder
        let add_8: u128 = amount - add_1 - add_2 - add_3 - add_4 - add_5 - add_6 - add_7;

        amm_pools.set(market_id, AMMPool {
            market_id: market_id,
            reserve_1: pool.reserve_1 + add_1,
            reserve_2: pool.reserve_2 + add_2,
            reserve_3: pool.reserve_3 + add_3,
            reserve_4: pool.reserve_4 + add_4,
            reserve_5: pool.reserve_5 + add_5,
            reserve_6: pool.reserve_6 + add_6,
            reserve_7: pool.reserve_7 + add_7,
            reserve_8: pool.reserve_8 + add_8,
            total_liquidity: pool.total_liquidity + amount,
            total_lp_shares: pool.total_lp_shares + expected_lp_shares,
            total_volume: pool.total_volume,
        });

        let current_held: u128 = program_credits.get_or_use(1u8, 0u128);
        program_credits.set(1u8, current_held + amount);
        let market_held: u128 = market_credits.get_or_use(market_id, 0u128);
        market_credits.set(market_id, market_held + amount);
    }

    // ========================================================================
    // 5. CLOSE MARKET — callable by anyone after deadline
    // ========================================================================

    async transition close_market(public market_id: field) -> Future {
        return close_market_finalize(market_id);
    }

    async function close_market_finalize(market_id: field) {
        let market: Market = markets.get(market_id);
        assert(market.status == STATUS_ACTIVE);

        let current_height: u64 = block.height as u64;
        assert(current_height > market.deadline);

        markets.set(market_id, Market {
            id: market.id,
            creator: market.creator,
            resolver: market.resolver,
            question_hash: market.question_hash,
            category: market.category,
            num_outcomes: market.num_outcomes,
            deadline: market.deadline,
            resolution_deadline: market.resolution_deadline,
            status: STATUS_CLOSED,
            created_at: market.created_at,
            token_type: market.token_type,
        });
    }

    // ========================================================================
    // 6. CANCEL MARKET
    // ========================================================================
    // Path A: Creator cancel — active, zero volume
    // Path B: Emergency — anyone, past resolution_deadline, not resolved/cancelled

    async transition cancel_market(public market_id: field) -> Future {
        return cancel_market_finalize(market_id, self.caller);
    }

    async function cancel_market_finalize(market_id: field, caller: address) {
        let market: Market = markets.get(market_id);
        let current_height: u64 = block.height as u64;

        let is_creator_cancel: bool = market.creator == caller
            && market.status == STATUS_ACTIVE;

        let is_emergency: bool = current_height > market.resolution_deadline
            && market.status != STATUS_RESOLVED
            && market.status != STATUS_CANCELLED;

        assert(is_creator_cancel || is_emergency);

        let pool: AMMPool = amm_pools.get(market_id);
        assert(!is_creator_cancel || pool.total_volume == 0u128);

        vote_tallies.remove(market_id);

        markets.set(market_id, Market {
            id: market.id,
            creator: market.creator,
            resolver: market.resolver,
            question_hash: market.question_hash,
            category: market.category,
            num_outcomes: market.num_outcomes,
            deadline: market.deadline,
            resolution_deadline: market.resolution_deadline,
            status: STATUS_CANCELLED,
            created_at: market.created_at,
            token_type: market.token_type,
        });
    }

    // ########################################################################
    //                   RESOLUTION — MULTI-VOTER QUORUM + DISPUTE
    // ########################################################################

    // ========================================================================
    // 7. VOTE OUTCOME — Bond-weighted voting on resolution
    // ========================================================================

    async transition vote_outcome(
        private market_id: field,
        private outcome: u8,
        private bond_nonce: field,    ) -> (VoterBondReceipt, Future) {
        let receipt: VoterBondReceipt = VoterBondReceipt {
            owner: self.caller,
            market_id: market_id,
            voted_outcome: outcome,
            bond_amount: MIN_VOTE_BOND,
            bond_nonce: bond_nonce,
        };

        let transfer_future: Future = test_usdcx_stablecoin.aleo/transfer_public_as_signer(
            self.address, MIN_VOTE_BOND
        );

        return (receipt, vote_outcome_finalize(
            transfer_future, market_id, outcome, self.caller
        ));
    }

    async function vote_outcome_finalize(
        transfer_future: Future,
        market_id: field,
        outcome: u8,
        voter: address,
    ) {
        transfer_future.await();

        let market: Market = markets.get(market_id);
        assert(outcome >= 1u8 && outcome <= market.num_outcomes);

        let current_height: u64 = block.height as u64;

        let is_closed: bool = market.status == STATUS_CLOSED;
        let is_pending: bool = market.status == STATUS_PENDING_RESOLUTION;
        let is_past_deadline: bool = market.status == STATUS_ACTIVE && current_height > market.deadline;
        assert(is_closed || is_pending || is_past_deadline);
        assert(current_height <= market.resolution_deadline);

        // Prevent double voting
        let voter_key: field = BHP256::hash_to_field(VoterKey { market_id: market_id, voter: voter });
        let already_voted: bool = voter_participated.get_or_use(voter_key, false);
        assert(!already_voted);
        voter_participated.set(voter_key, true);

        // Get or initialize tally (use get_or_use to avoid panic on first vote)
        let default_tally: VoteTally = VoteTally {
            market_id: market_id,
            outcome_1_bonds: 0u128,
            outcome_2_bonds: 0u128,
            outcome_3_bonds: 0u128,
            outcome_4_bonds: 0u128,
            outcome_5_bonds: 0u128,
            outcome_6_bonds: 0u128,
            outcome_7_bonds: 0u128,
            outcome_8_bonds: 0u128,
            total_voters: 0u8,
            total_bonded: 0u128,
            voting_deadline: 0u64,
            dispute_deadline: 0u64,
            finalized: false,
            winning_outcome: 0u8,
        };
        let has_tally: bool = vote_tallies.contains(market_id);
        let tally: VoteTally = vote_tallies.get_or_use(market_id, default_tally);

        let voting_deadline: u64 = has_tally ? tally.voting_deadline : (current_height + VOTE_WINDOW_BLOCKS);
        assert(!has_tally || current_height <= voting_deadline);

        // Add bond to the voted outcome's tally
        let new_o1: u128 = outcome == 1u8 ? tally.outcome_1_bonds + MIN_VOTE_BOND : tally.outcome_1_bonds;
        let new_o2: u128 = outcome == 2u8 ? tally.outcome_2_bonds + MIN_VOTE_BOND : tally.outcome_2_bonds;
        let new_o3: u128 = outcome == 3u8 ? tally.outcome_3_bonds + MIN_VOTE_BOND : tally.outcome_3_bonds;
        let new_o4: u128 = outcome == 4u8 ? tally.outcome_4_bonds + MIN_VOTE_BOND : tally.outcome_4_bonds;
        let new_o5: u128 = outcome == 5u8 ? tally.outcome_5_bonds + MIN_VOTE_BOND : tally.outcome_5_bonds;
        let new_o6: u128 = outcome == 6u8 ? tally.outcome_6_bonds + MIN_VOTE_BOND : tally.outcome_6_bonds;
        let new_o7: u128 = outcome == 7u8 ? tally.outcome_7_bonds + MIN_VOTE_BOND : tally.outcome_7_bonds;
        let new_o8: u128 = outcome == 8u8 ? tally.outcome_8_bonds + MIN_VOTE_BOND : tally.outcome_8_bonds;

        vote_tallies.set(market_id, VoteTally {
            market_id: market_id,
            outcome_1_bonds: new_o1,
            outcome_2_bonds: new_o2,
            outcome_3_bonds: new_o3,
            outcome_4_bonds: new_o4,
            outcome_5_bonds: new_o5,
            outcome_6_bonds: new_o6,
            outcome_7_bonds: new_o7,
            outcome_8_bonds: new_o8,
            total_voters: tally.total_voters + 1u8,
            total_bonded: tally.total_bonded + MIN_VOTE_BOND,
            voting_deadline: voting_deadline,
            dispute_deadline: 0u64,
            finalized: false,
            winning_outcome: 0u8,
        });

        markets.set(market_id, Market {
            id: market.id,
            creator: market.creator,
            resolver: market.resolver,
            question_hash: market.question_hash,
            category: market.category,
            num_outcomes: market.num_outcomes,
            deadline: market.deadline,
            resolution_deadline: market.resolution_deadline,
            status: STATUS_PENDING_RESOLUTION,
            created_at: market.created_at,
            token_type: market.token_type,
        });

        let current_held: u128 = program_credits.get_or_use(1u8, 0u128);
        program_credits.set(1u8, current_held + MIN_VOTE_BOND);
    }

    // ========================================================================
    // 8. FINALIZE VOTES — Tally and open dispute window
    // ========================================================================

    async transition finalize_votes(public market_id: field) -> Future {
        return finalize_votes_finalize(market_id);
    }

    async function finalize_votes_finalize(market_id: field) {
        let market: Market = markets.get(market_id);
        assert(market.status == STATUS_PENDING_RESOLUTION);

        let tally: VoteTally = vote_tallies.get(market_id);
        assert(!tally.finalized);

        let current_height: u64 = block.height as u64;
        assert(current_height > tally.voting_deadline);
        assert(tally.total_voters >= MIN_VOTERS);

        // Determine winning outcome (highest total bonds) across up to 8 outcomes
        let max1: u128 = tally.outcome_1_bonds;
        let w1: u8 = 1u8;

        let is_o2: bool = tally.outcome_2_bonds > max1;
        let max2: u128 = is_o2 ? tally.outcome_2_bonds : max1;
        let w2: u8 = is_o2 ? 2u8 : w1;

        let is_o3: bool = tally.outcome_3_bonds > max2;
        let max3: u128 = is_o3 ? tally.outcome_3_bonds : max2;
        let w3: u8 = is_o3 ? 3u8 : w2;

        let is_o4: bool = tally.outcome_4_bonds > max3;
        let max4: u128 = is_o4 ? tally.outcome_4_bonds : max3;
        let w4: u8 = is_o4 ? 4u8 : w3;

        let is_o5: bool = tally.outcome_5_bonds > max4;
        let max5: u128 = is_o5 ? tally.outcome_5_bonds : max4;
        let w5: u8 = is_o5 ? 5u8 : w4;

        let is_o6: bool = tally.outcome_6_bonds > max5;
        let max6: u128 = is_o6 ? tally.outcome_6_bonds : max5;
        let w6: u8 = is_o6 ? 6u8 : w5;

        let is_o7: bool = tally.outcome_7_bonds > max6;
        let max7: u128 = is_o7 ? tally.outcome_7_bonds : max6;
        let w7: u8 = is_o7 ? 7u8 : w6;

        let is_o8: bool = tally.outcome_8_bonds > max7;
        let winning_outcome: u8 = is_o8 ? 8u8 : w7;

        let dispute_deadline: u64 = current_height + DISPUTE_WINDOW_BLOCKS;

        vote_tallies.set(market_id, VoteTally {
            market_id: market_id,
            outcome_1_bonds: tally.outcome_1_bonds,
            outcome_2_bonds: tally.outcome_2_bonds,
            outcome_3_bonds: tally.outcome_3_bonds,
            outcome_4_bonds: tally.outcome_4_bonds,
            outcome_5_bonds: tally.outcome_5_bonds,
            outcome_6_bonds: tally.outcome_6_bonds,
            outcome_7_bonds: tally.outcome_7_bonds,
            outcome_8_bonds: tally.outcome_8_bonds,
            total_voters: tally.total_voters,
            total_bonded: tally.total_bonded,
            voting_deadline: tally.voting_deadline,
            dispute_deadline: dispute_deadline,
            finalized: false,
            winning_outcome: winning_outcome,
        });

        markets.set(market_id, Market {
            id: market.id,
            creator: market.creator,
            resolver: market.resolver,
            question_hash: market.question_hash,
            category: market.category,
            num_outcomes: market.num_outcomes,
            deadline: market.deadline,
            resolution_deadline: market.resolution_deadline,
            status: STATUS_PENDING_FINALIZATION,
            created_at: market.created_at,
            token_type: market.token_type,
        });
    }

    // ========================================================================
    // 9. CONFIRM RESOLUTION — No dispute, finalize market
    // ========================================================================

    async transition confirm_resolution(public market_id: field) -> Future {
        return confirm_resolution_finalize(market_id);
    }

    async function confirm_resolution_finalize(market_id: field) {
        let market: Market = markets.get(market_id);
        assert(market.status == STATUS_PENDING_FINALIZATION);

        let tally: VoteTally = vote_tallies.get(market_id);
        assert(tally.winning_outcome >= 1u8);

        let current_height: u64 = block.height as u64;
        assert(current_height > tally.dispute_deadline);

        let has_dispute: bool = dispute_bonds.contains(market_id);
        assert(!has_dispute);

        let fees: MarketFees = market_fees.get(market_id);
        let total_reward: u128 = (fees.protocol_fees * VOTER_REWARD_PERCENT) / 100u128;
        let current_reward: u128 = voter_rewards.get_or_use(market.resolver, 0u128);
        voter_rewards.set(market.resolver, current_reward + total_reward);

        vote_tallies.set(market_id, VoteTally {
            market_id: market_id,
            outcome_1_bonds: tally.outcome_1_bonds,
            outcome_2_bonds: tally.outcome_2_bonds,
            outcome_3_bonds: tally.outcome_3_bonds,
            outcome_4_bonds: tally.outcome_4_bonds,
            outcome_5_bonds: tally.outcome_5_bonds,
            outcome_6_bonds: tally.outcome_6_bonds,
            outcome_7_bonds: tally.outcome_7_bonds,
            outcome_8_bonds: tally.outcome_8_bonds,
            total_voters: tally.total_voters,
            total_bonded: tally.total_bonded,
            voting_deadline: tally.voting_deadline,
            dispute_deadline: tally.dispute_deadline,
            finalized: true,
            winning_outcome: tally.winning_outcome,
        });

        markets.set(market_id, Market {
            id: market.id,
            creator: market.creator,
            resolver: market.resolver,
            question_hash: market.question_hash,
            category: market.category,
            num_outcomes: market.num_outcomes,
            deadline: market.deadline,
            resolution_deadline: market.resolution_deadline,
            status: STATUS_RESOLVED,
            created_at: market.created_at,
            token_type: market.token_type,
        });
    }

    // ========================================================================
    // 10. DISPUTE RESOLUTION — 3× bond challenge
    // ========================================================================

    async transition dispute_resolution(
        private market_id: field,
        private proposed_outcome: u8,
        private dispute_nonce: field,        private dispute_bond: u128,
    ) -> (DisputeBondReceipt, Future) {
        assert(dispute_bond >= MIN_VOTE_BOND);

        let receipt: DisputeBondReceipt = DisputeBondReceipt {
            owner: self.caller,
            market_id: market_id,
            proposed_outcome: proposed_outcome,
            bond_amount: dispute_bond,
            dispute_nonce: dispute_nonce,
        };

        let transfer_future: Future = test_usdcx_stablecoin.aleo/transfer_public_as_signer(
            self.address, dispute_bond
        );

        return (receipt, dispute_resolution_finalize(
            transfer_future, market_id, proposed_outcome, dispute_bond, self.caller
        ));
    }

    async function dispute_resolution_finalize(
        transfer_future: Future,
        market_id: field,
        proposed_outcome: u8,
        dispute_bond: u128,
        disputer: address,
    ) {
        transfer_future.await();

        let market: Market = markets.get(market_id);
        assert(market.status == STATUS_PENDING_FINALIZATION);

        let tally: VoteTally = vote_tallies.get(market_id);
        assert(tally.winning_outcome >= 1u8);

        let current_height: u64 = block.height as u64;
        assert(current_height <= tally.dispute_deadline);

        assert(proposed_outcome != tally.winning_outcome);
        assert(proposed_outcome >= 1u8 && proposed_outcome <= market.num_outcomes);

        let min_dispute: u128 = tally.total_bonded * DISPUTE_BOND_MULTIPLIER;
        assert(dispute_bond >= min_dispute);

        let has_dispute: bool = dispute_bonds.contains(market_id);
        assert(!has_dispute);
        dispute_bonds.set(market_id, dispute_bond);

        vote_tallies.set(market_id, VoteTally {
            market_id: market_id,
            outcome_1_bonds: tally.outcome_1_bonds,
            outcome_2_bonds: tally.outcome_2_bonds,
            outcome_3_bonds: tally.outcome_3_bonds,
            outcome_4_bonds: tally.outcome_4_bonds,
            outcome_5_bonds: tally.outcome_5_bonds,
            outcome_6_bonds: tally.outcome_6_bonds,
            outcome_7_bonds: tally.outcome_7_bonds,
            outcome_8_bonds: tally.outcome_8_bonds,
            total_voters: tally.total_voters,
            total_bonded: tally.total_bonded,
            voting_deadline: tally.voting_deadline,
            dispute_deadline: tally.dispute_deadline,
            finalized: true,
            winning_outcome: proposed_outcome,
        });

        markets.set(market_id, Market {
            id: market.id,
            creator: market.creator,
            resolver: disputer,
            question_hash: market.question_hash,
            category: market.category,
            num_outcomes: market.num_outcomes,
            deadline: market.deadline,
            resolution_deadline: market.resolution_deadline,
            status: STATUS_RESOLVED,
            created_at: market.created_at,
            token_type: market.token_type,
        });

        let current_held: u128 = program_credits.get_or_use(1u8, 0u128);
        program_credits.set(1u8, current_held + dispute_bond);
    }

    // ========================================================================
    // 11. CLAIM VOTER BOND — Winning voters recover bond
    // ========================================================================

    async transition claim_voter_bond(
        private receipt: VoterBondReceipt,
    ) -> Future {
        assert(receipt.owner == self.caller);
        assert(receipt.bond_amount > 0u128);

        let claim_key: field = BHP256::hash_to_field(BondClaimKey {
            market_id: receipt.market_id,
            claimer: self.caller,
            bond_nonce: receipt.bond_nonce,
        });

        let transfer_future: Future = test_usdcx_stablecoin.aleo/transfer_public(
            self.caller, receipt.bond_amount
        );

        return claim_voter_bond_finalize(
            transfer_future, claim_key, receipt.market_id,
            receipt.bond_amount, receipt.voted_outcome
        );
    }

    async function claim_voter_bond_finalize(
        transfer_future: Future,
        claim_key: field,
        market_id: field,
        bond_amount: u128,
        voted_outcome: u8,
    ) {
        transfer_future.await();

        let market: Market = markets.get(market_id);
        let is_resolved: bool = market.status == STATUS_RESOLVED;
        let is_cancelled: bool = market.status == STATUS_CANCELLED;
        assert(is_resolved || is_cancelled);

        let tally_exists: bool = vote_tallies.contains(market_id);
        let outcome_matches: bool = tally_exists ?
            vote_tallies.get(market_id).winning_outcome == voted_outcome : false;
        assert(is_cancelled || outcome_matches);

        let already_claimed: bool = bond_claimed.get_or_use(claim_key, false);
        assert(!already_claimed);
        bond_claimed.set(claim_key, true);

        let current_held: u128 = program_credits.get_or_use(1u8, 0u128);
        assert(current_held >= bond_amount);
        program_credits.set(1u8, current_held - bond_amount);
    }

    // ========================================================================
    // 12. CLAIM DISPUTE BOND
    // ========================================================================

    async transition claim_dispute_bond(
        private receipt: DisputeBondReceipt,
    ) -> Future {
        assert(receipt.owner == self.caller);
        assert(receipt.bond_amount > 0u128);

        let claim_key: field = BHP256::hash_to_field(BondClaimKey {
            market_id: receipt.market_id,
            claimer: self.caller,
            bond_nonce: receipt.dispute_nonce,
        });

        let transfer_future: Future = test_usdcx_stablecoin.aleo/transfer_public(
            self.caller, receipt.bond_amount
        );

        return claim_dispute_bond_finalize(
            transfer_future, claim_key, receipt.market_id,
            receipt.bond_amount, receipt.proposed_outcome
        );
    }

    async function claim_dispute_bond_finalize(
        transfer_future: Future,
        claim_key: field,
        market_id: field,
        bond_amount: u128,
        proposed_outcome: u8,
    ) {
        transfer_future.await();

        let market: Market = markets.get(market_id);
        let is_resolved: bool = market.status == STATUS_RESOLVED;
        let is_cancelled: bool = market.status == STATUS_CANCELLED;
        assert(is_resolved || is_cancelled);

        let tally_exists: bool = vote_tallies.contains(market_id);
        let outcome_matches: bool = tally_exists ?
            vote_tallies.get(market_id).winning_outcome == proposed_outcome : false;
        assert(is_cancelled || outcome_matches);

        let already_claimed: bool = bond_claimed.get_or_use(claim_key, false);
        assert(!already_claimed);
        bond_claimed.set(claim_key, true);

        let current_held: u128 = program_credits.get_or_use(1u8, 0u128);
        assert(current_held >= bond_amount);
        program_credits.set(1u8, current_held - bond_amount);
    }

    // ########################################################################
    //                     REDEMPTION / REFUND
    // ########################################################################

    // ========================================================================
    // 13. REDEEM SHARES — Winning shares pay out 1:1
    // ========================================================================

    async transition redeem_shares(
        private shares: OutcomeShare,
    ) -> Future {
        assert(shares.owner == self.caller);
        assert(shares.token_type == TOKEN_USDCX);
        assert(shares.quantity > 0u128);

        let claim_key: field = BHP256::hash_to_field(ShareClaimKey {
            market_id: shares.market_id,
            claimer: self.caller,
            share_nonce: shares.share_nonce,
        });

        let transfer_future: Future = test_usdcx_stablecoin.aleo/transfer_public(
            self.caller, shares.quantity
        );

        return redeem_shares_finalize(
            transfer_future, claim_key, shares.market_id,
            shares.outcome, shares.quantity, TOKEN_USDCX
        );
    }

    async function redeem_shares_finalize(
        transfer_future: Future,
        claim_key: field,
        market_id: field,
        outcome: u8,
        quantity: u128,
        token_type: u8,
    ) {
        transfer_future.await();

        let market: Market = markets.get(market_id);
        assert(market.status == STATUS_RESOLVED);
        assert(market.token_type == token_type);

        let resolution: VoteTally = vote_tallies.get(market_id);
        assert(resolution.finalized);
        assert(outcome == resolution.winning_outcome);

        let already_claimed: bool = share_redeemed.get_or_use(claim_key, false);
        assert(!already_claimed);
        share_redeemed.set(claim_key, true);

        let market_held: u128 = market_credits.get_or_use(market_id, 0u128);
        assert(market_held >= quantity);
        market_credits.set(market_id, market_held - quantity);

        let current_held: u128 = program_credits.get_or_use(1u8, 0u128);
        assert(current_held >= quantity);
        program_credits.set(1u8, current_held - quantity);
    }

    // ========================================================================
    // 14. CLAIM REFUND — Cancelled market share refund
    // ========================================================================

    async transition claim_refund(
        private shares: OutcomeShare,
    ) -> Future {
        assert(shares.owner == self.caller);
        assert(shares.token_type == TOKEN_USDCX);
        assert(shares.quantity > 0u128);

        let claim_key: field = BHP256::hash_to_field(ShareClaimKey {
            market_id: shares.market_id,
            claimer: self.caller,
            share_nonce: shares.share_nonce,
        });

        let transfer_future: Future = test_usdcx_stablecoin.aleo/transfer_public(
            self.caller, shares.quantity
        );

        return claim_refund_finalize(
            transfer_future, claim_key, shares.market_id, shares.quantity, TOKEN_USDCX
        );
    }

    async function claim_refund_finalize(
        transfer_future: Future,
        claim_key: field,
        market_id: field,
        amount: u128,
        token_type: u8,
    ) {
        transfer_future.await();

        let market: Market = markets.get(market_id);
        assert(market.status == STATUS_CANCELLED);
        assert(market.token_type == token_type);

        let already_claimed: bool = share_redeemed.get_or_use(claim_key, false);
        assert(!already_claimed);
        share_redeemed.set(claim_key, true);

        let market_held: u128 = market_credits.get_or_use(market_id, 0u128);
        assert(market_held >= amount);
        market_credits.set(market_id, market_held - amount);

        let current_held: u128 = program_credits.get_or_use(1u8, 0u128);
        assert(current_held >= amount);
        program_credits.set(1u8, current_held - amount);
    }

    // ========================================================================
    // 15. CLAIM LP REFUND — LP tokens on cancelled markets
    // ========================================================================

    async transition claim_lp_refund(
        private lp_token: LPToken,
        private min_tokens_out: u128,
    ) -> Future {
        assert(lp_token.owner == self.caller);
        assert(lp_token.token_type == TOKEN_USDCX);
        assert(lp_token.lp_shares > 0u128);
        assert(min_tokens_out > 0u128);

        let claim_key: field = BHP256::hash_to_field(LPClaimKey {
            market_id: lp_token.market_id,
            claimer: self.caller,
            lp_nonce: lp_token.lp_nonce,
        });

        let transfer_future: Future = test_usdcx_stablecoin.aleo/transfer_public(
            self.caller, min_tokens_out
        );

        return claim_lp_refund_finalize(
            transfer_future, claim_key, lp_token.market_id,
            lp_token.lp_shares, min_tokens_out, TOKEN_USDCX
        );
    }

    async function claim_lp_refund_finalize(
        transfer_future: Future,
        claim_key: field,
        market_id: field,
        lp_shares: u128,
        min_tokens_out: u128,
        token_type: u8,
    ) {
        transfer_future.await();

        let market: Market = markets.get(market_id);
        assert(market.status == STATUS_CANCELLED);
        assert(market.token_type == token_type);

        let already_claimed: bool = lp_positions.get_or_use(claim_key, false);
        assert(!already_claimed);
        lp_positions.set(claim_key, true);

        let pool: AMMPool = amm_pools.get(market_id);
        let total_reserves: u128 = pool.reserve_1 + pool.reserve_2 + pool.reserve_3 + pool.reserve_4
            + pool.reserve_5 + pool.reserve_6 + pool.reserve_7 + pool.reserve_8;
        assert(total_reserves > 0u128);
        let tokens_out: u128 = (lp_shares * total_reserves) / pool.total_lp_shares;
        assert(tokens_out >= min_tokens_out);
        assert(min_tokens_out > 0u128);

        let market_held: u128 = market_credits.get_or_use(market_id, 0u128);
        assert(market_held >= min_tokens_out);
        market_credits.set(market_id, market_held - min_tokens_out);

        let current_held: u128 = program_credits.get_or_use(1u8, 0u128);
        assert(current_held >= min_tokens_out);
        program_credits.set(1u8, current_held - min_tokens_out);
    }

    // ========================================================================
    // 16. WITHDRAW LP FROM RESOLVED MARKET
    // ========================================================================

    async transition withdraw_lp_resolved(
        private lp_token: LPToken,
        private min_tokens_out: u128,
    ) -> Future {
        assert(lp_token.owner == self.caller);
        assert(lp_token.token_type == TOKEN_USDCX);
        assert(lp_token.lp_shares > 0u128);
        assert(min_tokens_out > 0u128);

        let claim_key: field = BHP256::hash_to_field(LPClaimKey {
            market_id: lp_token.market_id,
            claimer: self.caller,
            lp_nonce: lp_token.lp_nonce,
        });

        let transfer_future: Future = test_usdcx_stablecoin.aleo/transfer_public(
            self.caller, min_tokens_out
        );

        return withdraw_lp_resolved_finalize(
            transfer_future, claim_key, lp_token.market_id,
            lp_token.lp_shares, min_tokens_out, TOKEN_USDCX
        );
    }

    async function withdraw_lp_resolved_finalize(
        transfer_future: Future,
        claim_key: field,
        market_id: field,
        lp_shares: u128,
        min_tokens_out: u128,
        token_type: u8,
    ) {
        transfer_future.await();

        let market: Market = markets.get(market_id);
        assert(market.status == STATUS_RESOLVED);
        assert(market.token_type == token_type);

        let resolution: VoteTally = vote_tallies.get(market_id);
        assert(resolution.finalized);

        let already_claimed: bool = lp_positions.get_or_use(claim_key, false);
        assert(!already_claimed);
        lp_positions.set(claim_key, true);

        let pool: AMMPool = amm_pools.get(market_id);
        let market_held: u128 = market_credits.get_or_use(market_id, 0u128);
        let tokens_out: u128 = (lp_shares * market_held) / pool.total_lp_shares;
        assert(tokens_out >= min_tokens_out);
        assert(tokens_out > 0u128);

        market_credits.set(market_id, market_held - tokens_out);

        let current_held: u128 = program_credits.get_or_use(1u8, 0u128);
        assert(current_held >= tokens_out);
        program_credits.set(1u8, current_held - tokens_out);

        amm_pools.set(market_id, AMMPool {
            market_id: market_id,
            reserve_1: pool.reserve_1,
            reserve_2: pool.reserve_2,
            reserve_3: pool.reserve_3,
            reserve_4: pool.reserve_4,
            reserve_5: pool.reserve_5,
            reserve_6: pool.reserve_6,
            reserve_7: pool.reserve_7,
            reserve_8: pool.reserve_8,
            total_liquidity: pool.total_liquidity,
            total_lp_shares: pool.total_lp_shares - lp_shares,
            total_volume: pool.total_volume,
        });
    }

    // ========================================================================
    // 17. WITHDRAW CREATOR FEES
    // ========================================================================

    async transition withdraw_creator_fees(
        public market_id: field,
        public expected_amount: u128,
    ) -> Future {
        assert(expected_amount > 0u128);
        let transfer_future: Future = test_usdcx_stablecoin.aleo/transfer_public(self.caller, expected_amount);
        return withdraw_creator_fees_finalize(transfer_future, market_id, expected_amount, self.caller);
    }

    async function withdraw_creator_fees_finalize(
        transfer_future: Future,
        market_id: field,
        expected_amount: u128,
        caller: address,
    ) {
        transfer_future.await();

        let market: Market = markets.get(market_id);
        assert(market.creator == caller);
        let is_resolved: bool = market.status == STATUS_RESOLVED;
        let is_cancelled: bool = market.status == STATUS_CANCELLED;
        assert(is_resolved || is_cancelled);

        let fees: MarketFees = market_fees.get(market_id);
        assert(fees.creator_fees >= expected_amount);

        market_fees.set(market_id, MarketFees {
            market_id: market_id,
            protocol_fees: fees.protocol_fees,
            creator_fees: fees.creator_fees - expected_amount,
        });

        let market_held: u128 = market_credits.get_or_use(market_id, 0u128);
        assert(market_held >= expected_amount);
        market_credits.set(market_id, market_held - expected_amount);

        let current_held: u128 = program_credits.get_or_use(1u8, 0u128);
        assert(current_held >= expected_amount);
        program_credits.set(1u8, current_held - expected_amount);
    }
}
