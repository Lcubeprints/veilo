// ============================================================================
// VEILO — veilo_market_v2.aleo  (Leo 3.5.0)
// Privacy-preserving prediction market on Aleo — Version 2
// ============================================================================
// Changes from v1:
//   [NEW] Oracle Accuracy Score: tracks votes_cast / votes_correct / streak
//         per-voter; issues accuracy-weighted bonus on successful claim.
//   [NEW] Skin-in-the-Game voting: vote_with_shares() lets share holders
//         attach their position weight to their vote. Weight capped at
//         MAX_SHARE_VOTE_WEIGHT to prevent whale dominance.
//   [MOD] finalize_votes: winner determined by bonds + share-weight combined.
//   [MOD] claim_voter_bond: updates OracleProfile and writes pending bonus.
//   [NEW] claim_oracle_bonus: separate transition to redeem accumulated bonus.
//
// All 17 v1 transitions are preserved with identical semantics.
// v2 markets are indexed via PROGRAM_ID_V2_ALEO env var in the backend.
// ============================================================================

import credits.aleo;

program veilo_market_v2.aleo {

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

    // Fee config (basis points: 100 = 1%)
    const PROTOCOL_FEE_BPS: u128 = 50u128;
    const CREATOR_FEE_BPS: u128 = 50u128;
    const LP_FEE_BPS: u128 = 100u128;
    const FEE_DENOMINATOR: u128 = 10000u128;

    const VOTER_REWARD_PERCENT: u128 = 20u128;

    const MIN_TRADE_AMOUNT: u128 = 1000u128;
    const MIN_LIQUIDITY: u128 = 10000u128;

    const MIN_VOTE_BOND: u128 = 1000000u128;
    const MIN_VOTERS: u8 = 3u8;
    const VOTE_WINDOW_BLOCKS: u64 = 2880u64;
    const DISPUTE_WINDOW_BLOCKS: u64 = 2880u64;
    const DISPUTE_BOND_MULTIPLIER: u128 = 3u128;

    const MAX_SHARE_VOTE_WEIGHT: u128 = 10000000u128;
    const ORACLE_BONUS_BASE: u128 = 500000u128;

    // ========================================================================
    // RECORDS
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

    // ========================================================================
    // STRUCTS
    // ========================================================================

    struct Market {
        id: field,
        creator: address,
        resolver: address,
        question_hash: field,
        category: u8,
        num_outcomes: u8,
        deadline: u64,
        resolution_deadline: u64,
        status: u8,
        created_at: u64,
        token_type: u8,
    }

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

    struct WeightTally {
        market_id: field,
        outcome_1_weight: u128,
        outcome_2_weight: u128,
        outcome_3_weight: u128,
        outcome_4_weight: u128,
        outcome_5_weight: u128,
        outcome_6_weight: u128,
        outcome_7_weight: u128,
        outcome_8_weight: u128,
    }

    struct OracleProfile {
        votes_cast: u64,
        votes_correct: u64,
        streak: u16,
        best_streak: u16,
        total_bonus_earned: u128,
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
    // MAPPINGS
    // ========================================================================

    mapping markets: field => Market;
    mapping amm_pools: field => AMMPool;
    mapping market_fees: field => MarketFees;
    mapping share_redeemed: field => bool;
    mapping program_credits: u8 => u128;
    mapping market_credits: field => u128;
    mapping protocol_treasury: u8 => u128;
    mapping lp_positions: field => bool;

    mapping vote_tallies: field => VoteTally;
    mapping voter_participated: field => bool;
    mapping bond_claimed: field => bool;
    mapping voter_rewards: address => u128;
    mapping dispute_bonds: field => u128;

    mapping vote_weight_tallies: field => WeightTally;
    mapping oracle_profiles: address => OracleProfile;
    mapping oracle_pending_bonus: address => u128;

    // ========================================================================
    // CONSTRUCTOR
    // ========================================================================

    @noupgrade
    constructor() {}

    // ########################################################################
    //                         MARKET OPERATIONS
    // ########################################################################

    // ========================================================================
    // 1. CREATE MARKET
    // ========================================================================

    fn create_market(
        public question_hash: field,
        public category: u8,
        public num_outcomes: u8,
        public deadline: u64,
        public resolution_deadline: u64,
        public resolver: address,
        private initial_liquidity: u128,
    ) -> (field, LPToken, Final) {
        assert(num_outcomes >= 2u8 && num_outcomes <= 8u8);
        assert(initial_liquidity >= MIN_LIQUIDITY);

        let caller: address = self.caller;

        let market_id: field = BHP256::hash_to_field(MarketSeed {
            creator: caller,
            question_hash: question_hash,
            deadline: deadline,
            nonce: resolution_deadline,
        });

        let lp_nonce: field = BHP256::hash_to_field(LPClaimKey {
            market_id: market_id,
            claimer: caller,
            lp_nonce: 0field,
        });

        let lp_token: LPToken = LPToken {
            owner: caller,
            market_id: market_id,
            lp_shares: initial_liquidity,
            lp_nonce: lp_nonce,
            token_type: TOKEN_ALEO,
        };

        let amount_u64: u64 = initial_liquidity as u64;
        let f1: Final = credits.aleo::transfer_public_as_signer(self.address, amount_u64);

        return (market_id, lp_token, final {
            create_market_finalize(
                f1, market_id, caller,
                question_hash, category, num_outcomes,
                deadline, resolution_deadline, resolver, initial_liquidity
            );
        });
    }

    // ========================================================================
    // 2. BUY SHARES
    // ========================================================================

    fn buy_shares(
        private market_id: field,
        private outcome: u8,
        private amount_in: u128,
        private expected_shares: u128,
        private min_shares_out: u128,
        private share_nonce: field,
        private credits_in: credits.aleo::credits,
    ) -> (OutcomeShare, credits.aleo::credits, Final) {
        assert(outcome >= 1u8 && outcome <= 8u8);
        assert(amount_in >= MIN_TRADE_AMOUNT);

        let caller: address = self.caller;

        let share: OutcomeShare = OutcomeShare {
            owner: caller,
            market_id: market_id,
            outcome: outcome,
            quantity: expected_shares,
            share_nonce: share_nonce,
            token_type: TOKEN_ALEO,
        };

        let amount_u64: u64 = amount_in as u64;
        let (change, f1): (credits.aleo::credits, Final) =
            credits.aleo::transfer_private_to_public(credits_in, self.address, amount_u64);

        return (share, change, final {
            buy_shares_finalize(
                f1, market_id, outcome, amount_in,
                expected_shares, min_shares_out, TOKEN_ALEO
            );
        });
    }

    // ========================================================================
    // 3. SELL SHARES
    // ========================================================================

    fn sell_shares(
        private shares: OutcomeShare,
        private tokens_desired: u128,
        private max_shares_used: u128,
    ) -> (OutcomeShare, credits.aleo::credits, Final) {
        assert(shares.owner == self.caller);
        assert(shares.token_type == TOKEN_ALEO);
        assert(tokens_desired >= MIN_TRADE_AMOUNT);
        assert(max_shares_used > 0u128);
        assert(max_shares_used <= shares.quantity);

        let caller: address = self.caller;
        let s_market_id: field = shares.market_id;
        let s_outcome: u8 = shares.outcome;
        let s_quantity: u128 = shares.quantity;
        let s_nonce: field = shares.share_nonce;

        let protocol_fee: u128 = (tokens_desired * PROTOCOL_FEE_BPS) / FEE_DENOMINATOR;
        let creator_fee: u128 = (tokens_desired * CREATOR_FEE_BPS) / FEE_DENOMINATOR;
        let lp_fee: u128 = (tokens_desired * LP_FEE_BPS) / FEE_DENOMINATOR;
        let net_tokens: u128 = tokens_desired - protocol_fee - creator_fee - lp_fee;

        let net_u64: u64 = net_tokens as u64;
        let (payout_record, f1): (credits.aleo::credits, Final) =
            credits.aleo::transfer_public_to_private(caller, net_u64);

        let remainder: OutcomeShare = OutcomeShare {
            owner: caller,
            market_id: s_market_id,
            outcome: s_outcome,
            quantity: s_quantity - max_shares_used,
            share_nonce: s_nonce,
            token_type: TOKEN_ALEO,
        };

        return (remainder, payout_record, final {
            sell_shares_finalize(
                f1, s_market_id, s_outcome,
                tokens_desired, max_shares_used, TOKEN_ALEO
            );
        });
    }

    // ========================================================================
    // 4. ADD LIQUIDITY
    // ========================================================================

    fn add_liquidity(
        private market_id: field,
        private amount: u128,
        private expected_lp_shares: u128,
        private lp_nonce: field,
        private credits_in: credits.aleo::credits,
    ) -> (LPToken, credits.aleo::credits, Final) {
        assert(amount >= MIN_LIQUIDITY);

        let caller: address = self.caller;

        let lp_token: LPToken = LPToken {
            owner: caller,
            market_id: market_id,
            lp_shares: expected_lp_shares,
            lp_nonce: lp_nonce,
            token_type: TOKEN_ALEO,
        };

        let amount_u64: u64 = amount as u64;
        let (change, f1): (credits.aleo::credits, Final) =
            credits.aleo::transfer_private_to_public(credits_in, self.address, amount_u64);

        return (lp_token, change, final {
            add_liquidity_finalize(f1, market_id, amount, expected_lp_shares, TOKEN_ALEO);
        });
    }

    // ========================================================================
    // 5. CLOSE MARKET
    // ========================================================================

    fn close_market(public market_id: field) -> Final {
        return final { close_market_finalize(market_id); };
    }

    // ========================================================================
    // 6. CANCEL MARKET
    // ========================================================================

    fn cancel_market(public market_id: field) -> Final {
        let caller: address = self.caller;
        return final { cancel_market_finalize(market_id, caller); };
    }

    // ########################################################################
    //                   RESOLUTION
    // ########################################################################

    // ========================================================================
    // 7. VOTE OUTCOME
    // ========================================================================

    fn vote_outcome(
        private market_id: field,
        private outcome: u8,
        private bond_nonce: field,
        private credits_in: credits.aleo::credits,
    ) -> (VoterBondReceipt, credits.aleo::credits, Final) {
        let caller: address = self.caller;

        let receipt: VoterBondReceipt = VoterBondReceipt {
            owner: caller,
            market_id: market_id,
            voted_outcome: outcome,
            bond_amount: MIN_VOTE_BOND,
            bond_nonce: bond_nonce,
        };

        let bond_u64: u64 = MIN_VOTE_BOND as u64;
        let (change, f1): (credits.aleo::credits, Final) =
            credits.aleo::transfer_private_to_public(credits_in, self.address, bond_u64);

        return (receipt, change, final {
            vote_outcome_finalize(f1, market_id, outcome, caller);
        });
    }

    // ========================================================================
    // 7b. VOTE WITH SHARES (v2 NEW)
    // ========================================================================

    fn vote_with_shares(
        private shares: OutcomeShare,
        private bond_nonce: field,
        private credits_in: credits.aleo::credits,
    ) -> (OutcomeShare, VoterBondReceipt, credits.aleo::credits, Final) {
        assert(shares.owner == self.caller);
        assert(shares.token_type == TOKEN_ALEO);
        assert(shares.quantity > 0u128);

        let caller: address = self.caller;
        let s_market_id: field = shares.market_id;
        let s_outcome: u8 = shares.outcome;
        let s_quantity: u128 = shares.quantity;
        let s_nonce: field = shares.share_nonce;

        let reissued_share: OutcomeShare = OutcomeShare {
            owner: caller,
            market_id: s_market_id,
            outcome: s_outcome,
            quantity: s_quantity,
            share_nonce: s_nonce,
            token_type: TOKEN_ALEO,
        };

        let receipt: VoterBondReceipt = VoterBondReceipt {
            owner: caller,
            market_id: s_market_id,
            voted_outcome: s_outcome,
            bond_amount: MIN_VOTE_BOND,
            bond_nonce: bond_nonce,
        };

        let bond_u64: u64 = MIN_VOTE_BOND as u64;
        let (change, f1): (credits.aleo::credits, Final) =
            credits.aleo::transfer_private_to_public(credits_in, self.address, bond_u64);

        let weight: u128 = s_quantity > MAX_SHARE_VOTE_WEIGHT
            ? MAX_SHARE_VOTE_WEIGHT
            : s_quantity;

        return (reissued_share, receipt, change, final {
            vote_with_shares_finalize(f1, s_market_id, s_outcome, weight, caller);
        });
    }

    // ========================================================================
    // 8. FINALIZE VOTES
    // ========================================================================

    fn finalize_votes(public market_id: field) -> Final {
        return final { finalize_votes_finalize(market_id); };
    }

    // ========================================================================
    // 9. CONFIRM RESOLUTION
    // ========================================================================

    fn confirm_resolution(public market_id: field) -> Final {
        return final { confirm_resolution_finalize(market_id); };
    }

    // ========================================================================
    // 10. DISPUTE RESOLUTION
    // ========================================================================

    fn dispute_resolution(
        private market_id: field,
        private proposed_outcome: u8,
        private dispute_nonce: field,
        private credits_in: credits.aleo::credits,
        private dispute_bond: u128,
    ) -> (DisputeBondReceipt, credits.aleo::credits, Final) {
        assert(dispute_bond >= MIN_VOTE_BOND);

        let caller: address = self.caller;

        let receipt: DisputeBondReceipt = DisputeBondReceipt {
            owner: caller,
            market_id: market_id,
            proposed_outcome: proposed_outcome,
            bond_amount: dispute_bond,
            dispute_nonce: dispute_nonce,
        };

        let bond_u64: u64 = dispute_bond as u64;
        let (change, f1): (credits.aleo::credits, Final) =
            credits.aleo::transfer_private_to_public(credits_in, self.address, bond_u64);

        return (receipt, change, final {
            dispute_resolution_finalize(f1, market_id, proposed_outcome, dispute_bond, caller);
        });
    }

    // ========================================================================
    // 11. CLAIM VOTER BOND
    // ========================================================================

    fn claim_voter_bond(
        private receipt: VoterBondReceipt,
    ) -> (credits.aleo::credits, Final) {
        assert(receipt.owner == self.caller);
        assert(receipt.bond_amount > 0u128);

        let caller: address = self.caller;
        let r_market_id: field = receipt.market_id;
        let r_bond_amount: u128 = receipt.bond_amount;
        let r_voted_outcome: u8 = receipt.voted_outcome;
        let r_bond_nonce: field = receipt.bond_nonce;

        let claim_key: field = BHP256::hash_to_field(BondClaimKey {
            market_id: r_market_id,
            claimer: caller,
            bond_nonce: r_bond_nonce,
        });

        let bond_u64: u64 = r_bond_amount as u64;
        let (payout, f1): (credits.aleo::credits, Final) =
            credits.aleo::transfer_public_to_private(caller, bond_u64);

        return (payout, final {
            claim_voter_bond_finalize(
                f1, claim_key, r_market_id,
                r_bond_amount, r_voted_outcome, caller
            );
        });
    }

    // ========================================================================
    // 12. CLAIM DISPUTE BOND
    // ========================================================================

    fn claim_dispute_bond(
        private receipt: DisputeBondReceipt,
    ) -> (credits.aleo::credits, Final) {
        assert(receipt.owner == self.caller);
        assert(receipt.bond_amount > 0u128);

        let caller: address = self.caller;
        let r_market_id: field = receipt.market_id;
        let r_bond_amount: u128 = receipt.bond_amount;
        let r_proposed_outcome: u8 = receipt.proposed_outcome;
        let r_dispute_nonce: field = receipt.dispute_nonce;

        let claim_key: field = BHP256::hash_to_field(BondClaimKey {
            market_id: r_market_id,
            claimer: caller,
            bond_nonce: r_dispute_nonce,
        });

        let bond_u64: u64 = r_bond_amount as u64;
        let (payout, f1): (credits.aleo::credits, Final) =
            credits.aleo::transfer_public_to_private(caller, bond_u64);

        return (payout, final {
            claim_dispute_bond_finalize(
                f1, claim_key, r_market_id,
                r_bond_amount, r_proposed_outcome
            );
        });
    }

    // ========================================================================
    // 12b. CLAIM ORACLE BONUS (v2 NEW)
    // ========================================================================

    fn claim_oracle_bonus(
        public expected_amount: u128,
    ) -> (credits.aleo::credits, Final) {
        assert(expected_amount > 0u128);

        let caller: address = self.caller;
        let amount_u64: u64 = expected_amount as u64;
        let (payout, f1): (credits.aleo::credits, Final) =
            credits.aleo::transfer_public_to_private(caller, amount_u64);

        return (payout, final {
            claim_oracle_bonus_finalize(f1, caller, expected_amount);
        });
    }

    // ########################################################################
    //                     REDEMPTION / REFUND
    // ########################################################################

    // ========================================================================
    // 13. REDEEM SHARES
    // ========================================================================

    fn redeem_shares(
        private shares: OutcomeShare,
    ) -> (credits.aleo::credits, Final) {
        assert(shares.owner == self.caller);
        assert(shares.token_type == TOKEN_ALEO);
        assert(shares.quantity > 0u128);

        let caller: address = self.caller;
        let s_market_id: field = shares.market_id;
        let s_outcome: u8 = shares.outcome;
        let s_quantity: u128 = shares.quantity;
        let s_nonce: field = shares.share_nonce;

        let claim_key: field = BHP256::hash_to_field(ShareClaimKey {
            market_id: s_market_id,
            claimer: caller,
            share_nonce: s_nonce,
        });

        let payout_u64: u64 = s_quantity as u64;
        let (payout_record, f1): (credits.aleo::credits, Final) =
            credits.aleo::transfer_public_to_private(caller, payout_u64);

        return (payout_record, final {
            redeem_shares_finalize(
                f1, claim_key, s_market_id,
                s_outcome, s_quantity, TOKEN_ALEO
            );
        });
    }

    // ========================================================================
    // 14. CLAIM REFUND
    // ========================================================================

    fn claim_refund(
        private shares: OutcomeShare,
    ) -> (credits.aleo::credits, Final) {
        assert(shares.owner == self.caller);
        assert(shares.token_type == TOKEN_ALEO);
        assert(shares.quantity > 0u128);

        let caller: address = self.caller;
        let s_market_id: field = shares.market_id;
        let s_quantity: u128 = shares.quantity;
        let s_nonce: field = shares.share_nonce;

        let claim_key: field = BHP256::hash_to_field(ShareClaimKey {
            market_id: s_market_id,
            claimer: caller,
            share_nonce: s_nonce,
        });

        let refund_u64: u64 = s_quantity as u64;
        let (refund_record, f1): (credits.aleo::credits, Final) =
            credits.aleo::transfer_public_to_private(caller, refund_u64);

        return (refund_record, final {
            claim_refund_finalize(f1, claim_key, s_market_id, s_quantity, TOKEN_ALEO);
        });
    }

    // ========================================================================
    // 15. CLAIM LP REFUND
    // ========================================================================

    fn claim_lp_refund(
        private lp_token: LPToken,
        private min_tokens_out: u128,
    ) -> (credits.aleo::credits, Final) {
        assert(lp_token.owner == self.caller);
        assert(lp_token.token_type == TOKEN_ALEO);
        assert(lp_token.lp_shares > 0u128);
        assert(min_tokens_out > 0u128);

        let caller: address = self.caller;
        let lp_market_id: field = lp_token.market_id;
        let lp_shares: u128 = lp_token.lp_shares;
        let lp_nonce_val: field = lp_token.lp_nonce;

        let claim_key: field = BHP256::hash_to_field(LPClaimKey {
            market_id: lp_market_id,
            claimer: caller,
            lp_nonce: lp_nonce_val,
        });

        let min_u64: u64 = min_tokens_out as u64;
        let (refund_record, f1): (credits.aleo::credits, Final) =
            credits.aleo::transfer_public_to_private(caller, min_u64);

        return (refund_record, final {
            claim_lp_refund_finalize(
                f1, claim_key, lp_market_id,
                lp_shares, min_tokens_out, TOKEN_ALEO
            );
        });
    }

    // ========================================================================
    // 16. WITHDRAW LP FROM RESOLVED MARKET
    // ========================================================================

    fn withdraw_lp_resolved(
        private lp_token: LPToken,
        private min_tokens_out: u128,
    ) -> (credits.aleo::credits, Final) {
        assert(lp_token.owner == self.caller);
        assert(lp_token.token_type == TOKEN_ALEO);
        assert(lp_token.lp_shares > 0u128);
        assert(min_tokens_out > 0u128);

        let caller: address = self.caller;
        let lp_market_id: field = lp_token.market_id;
        let lp_shares: u128 = lp_token.lp_shares;
        let lp_nonce_val: field = lp_token.lp_nonce;

        let claim_key: field = BHP256::hash_to_field(LPClaimKey {
            market_id: lp_market_id,
            claimer: caller,
            lp_nonce: lp_nonce_val,
        });

        let min_u64: u64 = min_tokens_out as u64;
        let (payout_record, f1): (credits.aleo::credits, Final) =
            credits.aleo::transfer_public_to_private(caller, min_u64);

        return (payout_record, final {
            withdraw_lp_resolved_finalize(
                f1, claim_key, lp_market_id,
                lp_shares, min_tokens_out, TOKEN_ALEO
            );
        });
    }

    // ========================================================================
    // 17. WITHDRAW CREATOR FEES
    // ========================================================================

    fn withdraw_creator_fees(
        public market_id: field,
        public expected_amount: u128,
    ) -> Final {
        assert(expected_amount > 0u128);
        let caller: address = self.caller;
        let amount_u64: u64 = expected_amount as u64;
        let f1: Final = credits.aleo::transfer_public(caller, amount_u64);
        return final { withdraw_creator_fees_finalize(f1, market_id, expected_amount, caller); };
    }

}

// ============================================================================
// FINALIZE FUNCTIONS (Leo 3.5.0: final fn outside program block)
// ============================================================================

final fn create_market_finalize(
    f1: Final,
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
    f1.run();

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
        status: 1u8,
        created_at: current_height,
        token_type: 1u8,
    };

    let n: u128 = num_outcomes as u128;
    let per_outcome: u128 = initial_liquidity / n;

    let r1: u128 = per_outcome;
    let r2: u128 = per_outcome;
    let r3: u128 = num_outcomes >= 3u8 ? per_outcome : 0u128;
    let r4: u128 = num_outcomes >= 4u8 ? per_outcome : 0u128;
    let r5: u128 = num_outcomes >= 5u8 ? per_outcome : 0u128;
    let r6: u128 = num_outcomes >= 6u8 ? per_outcome : 0u128;
    let r7: u128 = num_outcomes >= 7u8 ? per_outcome : 0u128;
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

    let current_held: u128 = program_credits.get_or_use(0u8, 0u128);
    program_credits.set(0u8, current_held + initial_liquidity);
    market_credits.set(market_id, initial_liquidity);
}

final fn buy_shares_finalize(
    f1: Final,
    market_id: field,
    outcome: u8,
    amount_in: u128,
    expected_shares: u128,
    min_shares_out: u128,
    token_type: u8,
) {
    f1.run();

    let market: Market = markets.get(market_id);
    assert(market.status == 1u8);
    assert(market.token_type == token_type);
    assert(outcome >= 1u8 && outcome <= market.num_outcomes);

    let current_height: u64 = block.height as u64;
    assert(current_height <= market.deadline);

    let protocol_fee: u128 = (amount_in * 50u128) / 10000u128;
    let creator_fee: u128 = (amount_in * 50u128) / 10000u128;
    let amount_to_pool: u128 = amount_in - protocol_fee - creator_fee;

    let fees: MarketFees = market_fees.get(market_id);
    market_fees.set(market_id, MarketFees {
        market_id: market_id,
        protocol_fees: fees.protocol_fees + protocol_fee,
        creator_fees: fees.creator_fees + creator_fee,
    });
    let current_treasury: u128 = protocol_treasury.get_or_use(0u8, 0u128);
    protocol_treasury.set(0u8, current_treasury + protocol_fee);

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

    let r_i: u128 =
        outcome == 1u8 ? r1 :
        (outcome == 2u8 ? r2 :
        (outcome == 3u8 ? r3 :
        (outcome == 4u8 ? r4 :
        (outcome == 5u8 ? r5 :
        (outcome == 6u8 ? r6 :
        (outcome == 7u8 ? r7 : r8))))));

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

    let current_held: u128 = program_credits.get_or_use(0u8, 0u128);
    program_credits.set(0u8, current_held + amount_in);
    let market_held: u128 = market_credits.get_or_use(market_id, 0u128);
    market_credits.set(market_id, market_held + amount_in);
}

final fn sell_shares_finalize(
    f1: Final,
    market_id: field,
    outcome: u8,
    tokens_desired: u128,
    max_shares_used: u128,
    token_type: u8,
) {
    f1.run();

    let market: Market = markets.get(market_id);
    assert(market.status == 1u8);
    assert(market.token_type == token_type);
    assert(outcome >= 1u8 && outcome <= market.num_outcomes);

    let current_height: u64 = block.height as u64;
    assert(current_height <= market.deadline);

    let protocol_fee: u128 = (tokens_desired * 50u128) / 10000u128;
    let creator_fee: u128 = (tokens_desired * 50u128) / 10000u128;
    let lp_fee: u128 = (tokens_desired * 100u128) / 10000u128;
    let net_tokens: u128 = tokens_desired - protocol_fee - creator_fee - lp_fee;
    let pool_tokens_out: u128 = tokens_desired - lp_fee;

    let fees: MarketFees = market_fees.get(market_id);
    market_fees.set(market_id, MarketFees {
        market_id: market_id,
        protocol_fees: fees.protocol_fees + protocol_fee,
        creator_fees: fees.creator_fees + creator_fee,
    });
    let current_treasury: u128 = protocol_treasury.get_or_use(0u8, 0u128);
    protocol_treasury.set(0u8, current_treasury + protocol_fee);

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

    let sub1: u128 = outcome != 1u8 ? p : 0u128;
    assert(r1 >= sub1);
    let den1: u128 = r1 - sub1;
    let step0: u128 = r_i;
    let step1: u128 = outcome != 1u8 ? (step0 * r1) / den1 : step0;

    let sub2: u128 = outcome != 2u8 ? p : 0u128;
    assert(r2 >= sub2);
    let den2: u128 = r2 - sub2;
    let step2: u128 = outcome != 2u8 ? (step1 * r2) / den2 : step1;

    let apply3: bool = outcome != 3u8 && n >= 3u8;
    let sub3: u128 = apply3 ? p : 0u128;
    assert(r3 >= sub3);
    let den3_raw: u128 = r3 - sub3;
    let safe_den3: u128 = den3_raw == 0u128 ? 1u128 : den3_raw;
    let step3: u128 = apply3 ? (step2 * r3) / safe_den3 : step2;

    let apply4: bool = outcome != 4u8 && n >= 4u8;
    let sub4: u128 = apply4 ? p : 0u128;
    assert(r4 >= sub4);
    let den4_raw: u128 = r4 - sub4;
    let safe_den4: u128 = den4_raw == 0u128 ? 1u128 : den4_raw;
    let step4: u128 = apply4 ? (step3 * r4) / safe_den4 : step3;

    let apply5: bool = outcome != 5u8 && n >= 5u8;
    let sub5: u128 = apply5 ? p : 0u128;
    assert(r5 >= sub5);
    let den5_raw: u128 = r5 - sub5;
    let safe_den5: u128 = den5_raw == 0u128 ? 1u128 : den5_raw;
    let step5: u128 = apply5 ? (step4 * r5) / safe_den5 : step4;

    let apply6: bool = outcome != 6u8 && n >= 6u8;
    let sub6: u128 = apply6 ? p : 0u128;
    assert(r6 >= sub6);
    let den6_raw: u128 = r6 - sub6;
    let safe_den6: u128 = den6_raw == 0u128 ? 1u128 : den6_raw;
    let step6: u128 = apply6 ? (step5 * r6) / safe_den6 : step5;

    let apply7: bool = outcome != 7u8 && n >= 7u8;
    let sub7: u128 = apply7 ? p : 0u128;
    assert(r7 >= sub7);
    let den7_raw: u128 = r7 - sub7;
    let safe_den7: u128 = den7_raw == 0u128 ? 1u128 : den7_raw;
    let step7: u128 = apply7 ? (step6 * r7) / safe_den7 : step6;

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

    let current_held: u128 = program_credits.get_or_use(0u8, 0u128);
    assert(current_held >= net_tokens);
    program_credits.set(0u8, current_held - net_tokens);
}

final fn add_liquidity_finalize(
    f1: Final,
    market_id: field,
    amount: u128,
    expected_lp_shares: u128,
    token_type: u8,
) {
    f1.run();

    let market: Market = markets.get(market_id);
    assert(market.status == 1u8);
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

    let add_1: u128 = (amount * pool.reserve_1) / total_reserves;
    let add_2: u128 = (amount * pool.reserve_2) / total_reserves;
    let add_3: u128 = (amount * pool.reserve_3) / total_reserves;
    let add_4: u128 = (amount * pool.reserve_4) / total_reserves;
    let add_5: u128 = (amount * pool.reserve_5) / total_reserves;
    let add_6: u128 = (amount * pool.reserve_6) / total_reserves;
    let add_7: u128 = (amount * pool.reserve_7) / total_reserves;
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

    let current_held: u128 = program_credits.get_or_use(0u8, 0u128);
    program_credits.set(0u8, current_held + amount);
    let market_held: u128 = market_credits.get_or_use(market_id, 0u128);
    market_credits.set(market_id, market_held + amount);
}

final fn close_market_finalize(market_id: field) {
    let market: Market = markets.get(market_id);
    assert(market.status == 1u8);

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
        status: 2u8,
        created_at: market.created_at,
        token_type: market.token_type,
    });
}

final fn cancel_market_finalize(market_id: field, caller: address) {
    let market: Market = markets.get(market_id);
    let current_height: u64 = block.height as u64;

    let is_creator_cancel: bool = market.creator == caller && market.status == 1u8;
    let is_emergency: bool = current_height > market.resolution_deadline
        && market.status != 3u8
        && market.status != 4u8;

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
        status: 4u8,
        created_at: market.created_at,
        token_type: market.token_type,
    });
}

final fn vote_outcome_finalize(
    f1: Final,
    market_id: field,
    outcome: u8,
    voter: address,
) {
    f1.run();

    let market: Market = markets.get(market_id);
    assert(outcome >= 1u8 && outcome <= market.num_outcomes);

    let current_height: u64 = block.height as u64;

    let is_closed: bool = market.status == 2u8;
    let is_pending: bool = market.status == 5u8;
    let is_past_deadline: bool = market.status == 1u8 && current_height > market.deadline;
    assert(is_closed || is_pending || is_past_deadline);
    assert(current_height <= market.resolution_deadline);

    let voter_key: field = BHP256::hash_to_field(VoterKey { market_id: market_id, voter: voter });
    let already_voted: bool = voter_participated.get_or_use(voter_key, false);
    assert(!already_voted);
    voter_participated.set(voter_key, true);

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

    let voting_deadline: u64 = has_tally ? tally.voting_deadline : (current_height + 2880u64);
    assert(!has_tally || current_height <= voting_deadline);

    let new_o1: u128 = outcome == 1u8 ? tally.outcome_1_bonds + 1000000u128 : tally.outcome_1_bonds;
    let new_o2: u128 = outcome == 2u8 ? tally.outcome_2_bonds + 1000000u128 : tally.outcome_2_bonds;
    let new_o3: u128 = outcome == 3u8 ? tally.outcome_3_bonds + 1000000u128 : tally.outcome_3_bonds;
    let new_o4: u128 = outcome == 4u8 ? tally.outcome_4_bonds + 1000000u128 : tally.outcome_4_bonds;
    let new_o5: u128 = outcome == 5u8 ? tally.outcome_5_bonds + 1000000u128 : tally.outcome_5_bonds;
    let new_o6: u128 = outcome == 6u8 ? tally.outcome_6_bonds + 1000000u128 : tally.outcome_6_bonds;
    let new_o7: u128 = outcome == 7u8 ? tally.outcome_7_bonds + 1000000u128 : tally.outcome_7_bonds;
    let new_o8: u128 = outcome == 8u8 ? tally.outcome_8_bonds + 1000000u128 : tally.outcome_8_bonds;

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
        total_bonded: tally.total_bonded + 1000000u128,
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
        status: 5u8,
        created_at: market.created_at,
        token_type: market.token_type,
    });

    let current_held: u128 = program_credits.get_or_use(0u8, 0u128);
    program_credits.set(0u8, current_held + 1000000u128);
}

final fn vote_with_shares_finalize(
    f1: Final,
    market_id: field,
    outcome: u8,
    weight: u128,
    voter: address,
) {
    f1.run();

    let market: Market = markets.get(market_id);
    assert(outcome >= 1u8 && outcome <= market.num_outcomes);

    let current_height: u64 = block.height as u64;

    let is_closed: bool = market.status == 2u8;
    let is_pending: bool = market.status == 5u8;
    let is_past_deadline: bool = market.status == 1u8 && current_height > market.deadline;
    assert(is_closed || is_pending || is_past_deadline);
    assert(current_height <= market.resolution_deadline);

    let voter_key: field = BHP256::hash_to_field(VoterKey { market_id: market_id, voter: voter });
    let already_voted: bool = voter_participated.get_or_use(voter_key, false);
    assert(!already_voted);
    voter_participated.set(voter_key, true);

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

    let voting_deadline: u64 = has_tally ? tally.voting_deadline : (current_height + 2880u64);
    assert(!has_tally || current_height <= voting_deadline);

    let new_o1: u128 = outcome == 1u8 ? tally.outcome_1_bonds + 1000000u128 : tally.outcome_1_bonds;
    let new_o2: u128 = outcome == 2u8 ? tally.outcome_2_bonds + 1000000u128 : tally.outcome_2_bonds;
    let new_o3: u128 = outcome == 3u8 ? tally.outcome_3_bonds + 1000000u128 : tally.outcome_3_bonds;
    let new_o4: u128 = outcome == 4u8 ? tally.outcome_4_bonds + 1000000u128 : tally.outcome_4_bonds;
    let new_o5: u128 = outcome == 5u8 ? tally.outcome_5_bonds + 1000000u128 : tally.outcome_5_bonds;
    let new_o6: u128 = outcome == 6u8 ? tally.outcome_6_bonds + 1000000u128 : tally.outcome_6_bonds;
    let new_o7: u128 = outcome == 7u8 ? tally.outcome_7_bonds + 1000000u128 : tally.outcome_7_bonds;
    let new_o8: u128 = outcome == 8u8 ? tally.outcome_8_bonds + 1000000u128 : tally.outcome_8_bonds;

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
        total_bonded: tally.total_bonded + 1000000u128,
        voting_deadline: voting_deadline,
        dispute_deadline: 0u64,
        finalized: false,
        winning_outcome: 0u8,
    });

    let default_wt: WeightTally = WeightTally {
        market_id: market_id,
        outcome_1_weight: 0u128,
        outcome_2_weight: 0u128,
        outcome_3_weight: 0u128,
        outcome_4_weight: 0u128,
        outcome_5_weight: 0u128,
        outcome_6_weight: 0u128,
        outcome_7_weight: 0u128,
        outcome_8_weight: 0u128,
    };
    let wt: WeightTally = vote_weight_tallies.get_or_use(market_id, default_wt);

    let new_w1: u128 = outcome == 1u8 ? wt.outcome_1_weight + weight : wt.outcome_1_weight;
    let new_w2: u128 = outcome == 2u8 ? wt.outcome_2_weight + weight : wt.outcome_2_weight;
    let new_w3: u128 = outcome == 3u8 ? wt.outcome_3_weight + weight : wt.outcome_3_weight;
    let new_w4: u128 = outcome == 4u8 ? wt.outcome_4_weight + weight : wt.outcome_4_weight;
    let new_w5: u128 = outcome == 5u8 ? wt.outcome_5_weight + weight : wt.outcome_5_weight;
    let new_w6: u128 = outcome == 6u8 ? wt.outcome_6_weight + weight : wt.outcome_6_weight;
    let new_w7: u128 = outcome == 7u8 ? wt.outcome_7_weight + weight : wt.outcome_7_weight;
    let new_w8: u128 = outcome == 8u8 ? wt.outcome_8_weight + weight : wt.outcome_8_weight;

    vote_weight_tallies.set(market_id, WeightTally {
        market_id: market_id,
        outcome_1_weight: new_w1,
        outcome_2_weight: new_w2,
        outcome_3_weight: new_w3,
        outcome_4_weight: new_w4,
        outcome_5_weight: new_w5,
        outcome_6_weight: new_w6,
        outcome_7_weight: new_w7,
        outcome_8_weight: new_w8,
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
        status: 5u8,
        created_at: market.created_at,
        token_type: market.token_type,
    });

    let current_held: u128 = program_credits.get_or_use(0u8, 0u128);
    program_credits.set(0u8, current_held + 1000000u128);
}

final fn finalize_votes_finalize(market_id: field) {
    let market: Market = markets.get(market_id);
    assert(market.status == 5u8);

    let tally: VoteTally = vote_tallies.get(market_id);
    assert(!tally.finalized);

    let current_height: u64 = block.height as u64;
    assert(current_height > tally.voting_deadline);
    assert(tally.total_voters >= 3u8);

    let default_wt: WeightTally = WeightTally {
        market_id: market_id,
        outcome_1_weight: 0u128,
        outcome_2_weight: 0u128,
        outcome_3_weight: 0u128,
        outcome_4_weight: 0u128,
        outcome_5_weight: 0u128,
        outcome_6_weight: 0u128,
        outcome_7_weight: 0u128,
        outcome_8_weight: 0u128,
    };
    let wt: WeightTally = vote_weight_tallies.get_or_use(market_id, default_wt);

    let c1: u128 = tally.outcome_1_bonds + wt.outcome_1_weight;
    let c2: u128 = tally.outcome_2_bonds + wt.outcome_2_weight;
    let c3: u128 = tally.outcome_3_bonds + wt.outcome_3_weight;
    let c4: u128 = tally.outcome_4_bonds + wt.outcome_4_weight;
    let c5: u128 = tally.outcome_5_bonds + wt.outcome_5_weight;
    let c6: u128 = tally.outcome_6_bonds + wt.outcome_6_weight;
    let c7: u128 = tally.outcome_7_bonds + wt.outcome_7_weight;
    let c8: u128 = tally.outcome_8_bonds + wt.outcome_8_weight;

    let max1: u128 = c1;
    let w1: u8 = 1u8;
    let is_o2: bool = c2 > max1;
    let max2: u128 = is_o2 ? c2 : max1;
    let w2: u8 = is_o2 ? 2u8 : w1;
    let is_o3: bool = c3 > max2;
    let max3: u128 = is_o3 ? c3 : max2;
    let w3: u8 = is_o3 ? 3u8 : w2;
    let is_o4: bool = c4 > max3;
    let max4: u128 = is_o4 ? c4 : max3;
    let w4: u8 = is_o4 ? 4u8 : w3;
    let is_o5: bool = c5 > max4;
    let max5: u128 = is_o5 ? c5 : max4;
    let w5: u8 = is_o5 ? 5u8 : w4;
    let is_o6: bool = c6 > max5;
    let max6: u128 = is_o6 ? c6 : max5;
    let w6: u8 = is_o6 ? 6u8 : w5;
    let is_o7: bool = c7 > max6;
    let max7: u128 = is_o7 ? c7 : max6;
    let w7: u8 = is_o7 ? 7u8 : w6;
    let is_o8: bool = c8 > max7;
    let winning_outcome: u8 = is_o8 ? 8u8 : w7;

    let dispute_deadline: u64 = current_height + 2880u64;

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
        status: 6u8,
        created_at: market.created_at,
        token_type: market.token_type,
    });
}

final fn confirm_resolution_finalize(market_id: field) {
    let market: Market = markets.get(market_id);
    assert(market.status == 6u8);

    let tally: VoteTally = vote_tallies.get(market_id);
    assert(tally.winning_outcome >= 1u8);

    let current_height: u64 = block.height as u64;
    assert(current_height > tally.dispute_deadline);

    let has_dispute: bool = dispute_bonds.contains(market_id);
    assert(!has_dispute);

    let fees: MarketFees = market_fees.get(market_id);
    let total_reward: u128 = (fees.protocol_fees * 20u128) / 100u128;
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
        status: 3u8,
        created_at: market.created_at,
        token_type: market.token_type,
    });
}

final fn dispute_resolution_finalize(
    f1: Final,
    market_id: field,
    proposed_outcome: u8,
    dispute_bond: u128,
    disputer: address,
) {
    f1.run();

    let market: Market = markets.get(market_id);
    assert(market.status == 6u8);

    let tally: VoteTally = vote_tallies.get(market_id);
    assert(tally.winning_outcome >= 1u8);

    let current_height: u64 = block.height as u64;
    assert(current_height <= tally.dispute_deadline);

    assert(proposed_outcome != tally.winning_outcome);
    assert(proposed_outcome >= 1u8 && proposed_outcome <= market.num_outcomes);

    let min_dispute: u128 = tally.total_bonded * 3u128;
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
        status: 3u8,
        created_at: market.created_at,
        token_type: market.token_type,
    });

    let current_held: u128 = program_credits.get_or_use(0u8, 0u128);
    program_credits.set(0u8, current_held + dispute_bond);
}

final fn claim_voter_bond_finalize(
    f1: Final,
    claim_key: field,
    market_id: field,
    bond_amount: u128,
    voted_outcome: u8,
    voter: address,
) {
    f1.run();

    let market: Market = markets.get(market_id);
    let is_resolved: bool = market.status == 3u8;
    let is_cancelled: bool = market.status == 4u8;
    assert(is_resolved || is_cancelled);

    let tally_exists: bool = vote_tallies.contains(market_id);
    let outcome_matches: bool = tally_exists ?
        vote_tallies.get(market_id).winning_outcome == voted_outcome : false;
    assert(is_cancelled || outcome_matches);

    let already_claimed: bool = bond_claimed.get_or_use(claim_key, false);
    assert(!already_claimed);
    bond_claimed.set(claim_key, true);

    let current_held: u128 = program_credits.get_or_use(0u8, 0u128);
    assert(current_held >= bond_amount);
    program_credits.set(0u8, current_held - bond_amount);

    let was_correct: bool = is_resolved && outcome_matches;

    let default_profile: OracleProfile = OracleProfile {
        votes_cast: 0u64,
        votes_correct: 0u64,
        streak: 0u16,
        best_streak: 0u16,
        total_bonus_earned: 0u128,
    };
    let profile: OracleProfile = oracle_profiles.get_or_use(voter, default_profile);

    let new_votes_cast: u64 = is_resolved ? profile.votes_cast + 1u64 : profile.votes_cast;
    let new_votes_correct: u64 = was_correct ? profile.votes_correct + 1u64 : profile.votes_correct;
    let new_streak: u16 = was_correct ? profile.streak + 1u16 : 0u16;
    let new_best: u16 = new_streak > profile.best_streak ? new_streak : profile.best_streak;

    let safe_cast: u64 = new_votes_cast == 0u64 ? 1u64 : new_votes_cast;
    let raw_bonus: u128 = was_correct
        ? (500000u128 * (new_votes_correct as u128)) / (safe_cast as u128)
        : 0u128;

    let treasury: u128 = protocol_treasury.get_or_use(0u8, 0u128);
    let actual_bonus: u128 = (was_correct && treasury >= raw_bonus) ? raw_bonus : 0u128;

    let pending: u128 = oracle_pending_bonus.get_or_use(voter, 0u128);
    oracle_pending_bonus.set(voter, pending + actual_bonus);
    protocol_treasury.set(0u8, treasury - actual_bonus);

    oracle_profiles.set(voter, OracleProfile {
        votes_cast: new_votes_cast,
        votes_correct: new_votes_correct,
        streak: new_streak,
        best_streak: new_best,
        total_bonus_earned: profile.total_bonus_earned + actual_bonus,
    });
}

final fn claim_dispute_bond_finalize(
    f1: Final,
    claim_key: field,
    market_id: field,
    bond_amount: u128,
    proposed_outcome: u8,
) {
    f1.run();

    let market: Market = markets.get(market_id);
    let is_resolved: bool = market.status == 3u8;
    let is_cancelled: bool = market.status == 4u8;
    assert(is_resolved || is_cancelled);

    let tally_exists: bool = vote_tallies.contains(market_id);
    let outcome_matches: bool = tally_exists ?
        vote_tallies.get(market_id).winning_outcome == proposed_outcome : false;
    assert(is_cancelled || outcome_matches);

    let already_claimed: bool = bond_claimed.get_or_use(claim_key, false);
    assert(!already_claimed);
    bond_claimed.set(claim_key, true);

    let current_held: u128 = program_credits.get_or_use(0u8, 0u128);
    assert(current_held >= bond_amount);
    program_credits.set(0u8, current_held - bond_amount);
}

final fn claim_oracle_bonus_finalize(
    f1: Final,
    claimer: address,
    expected_amount: u128,
) {
    f1.run();

    let pending: u128 = oracle_pending_bonus.get_or_use(claimer, 0u128);
    assert(pending >= expected_amount);
    oracle_pending_bonus.set(claimer, pending - expected_amount);

    let current_held: u128 = program_credits.get_or_use(0u8, 0u128);
    assert(current_held >= expected_amount);
    program_credits.set(0u8, current_held - expected_amount);
}

final fn redeem_shares_finalize(
    f1: Final,
    claim_key: field,
    market_id: field,
    outcome: u8,
    quantity: u128,
    token_type: u8,
) {
    f1.run();

    let market: Market = markets.get(market_id);
    assert(market.status == 3u8);
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

    let current_held: u128 = program_credits.get_or_use(0u8, 0u128);
    assert(current_held >= quantity);
    program_credits.set(0u8, current_held - quantity);
}

final fn claim_refund_finalize(
    f1: Final,
    claim_key: field,
    market_id: field,
    amount: u128,
    token_type: u8,
) {
    f1.run();

    let market: Market = markets.get(market_id);
    assert(market.status == 4u8);
    assert(market.token_type == token_type);

    let already_claimed: bool = share_redeemed.get_or_use(claim_key, false);
    assert(!already_claimed);
    share_redeemed.set(claim_key, true);

    let market_held: u128 = market_credits.get_or_use(market_id, 0u128);
    assert(market_held >= amount);
    market_credits.set(market_id, market_held - amount);

    let current_held: u128 = program_credits.get_or_use(0u8, 0u128);
    assert(current_held >= amount);
    program_credits.set(0u8, current_held - amount);
}

final fn claim_lp_refund_finalize(
    f1: Final,
    claim_key: field,
    market_id: field,
    lp_shares: u128,
    min_tokens_out: u128,
    token_type: u8,
) {
    f1.run();

    let market: Market = markets.get(market_id);
    assert(market.status == 4u8);
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

    let current_held: u128 = program_credits.get_or_use(0u8, 0u128);
    assert(current_held >= min_tokens_out);
    program_credits.set(0u8, current_held - min_tokens_out);
}

final fn withdraw_lp_resolved_finalize(
    f1: Final,
    claim_key: field,
    market_id: field,
    lp_shares: u128,
    min_tokens_out: u128,
    token_type: u8,
) {
    f1.run();

    let market: Market = markets.get(market_id);
    assert(market.status == 3u8);
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

    let current_held: u128 = program_credits.get_or_use(0u8, 0u128);
    assert(current_held >= tokens_out);
    program_credits.set(0u8, current_held - tokens_out);

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

final fn withdraw_creator_fees_finalize(
    f1: Final,
    market_id: field,
    expected_amount: u128,
    caller: address,
) {
    f1.run();

    let market: Market = markets.get(market_id);
    assert(market.creator == caller);
    let is_resolved: bool = market.status == 3u8;
    let is_cancelled: bool = market.status == 4u8;
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

    let current_held: u128 = program_credits.get_or_use(0u8, 0u128);
    assert(current_held >= expected_amount);
    program_credits.set(0u8, current_held - expected_amount);
}
