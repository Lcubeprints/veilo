# Veilo — Technical Reference

> Privacy-preserving prediction market on Aleo (testnet).
> Single monolithic Leo program per token variant, FPMM AMM, bond-weighted oracle, ZK private records.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Market Lifecycle & Status Machine](#2-market-lifecycle--status-machine)
3. [AMM — How Prices & Share Odds Are Calculated](#3-amm--how-prices--share-odds-are-calculated)
4. [Oracle — How Markets Resolve](#4-oracle--how-markets-resolve)
5. [Private Records & Public Mappings](#5-private-records--public-mappings)
6. [Fee Structure](#6-fee-structure)
7. [Constants & Limits](#7-constants--limits)
8. [What Is Implemented](#8-what-is-implemented)
9. [What Is Remaining](#9-what-is-remaining)

---

## 1. Architecture Overview

```
┌────────────────────────────────────────────────────────────────┐
│                     FRONTEND (React + TypeScript)              │
│  Wallet Connect → Market Browser → TradingPanel → Portfolio    │
│  ResolutionPanel → LiquidityPanel → CreateMarket               │
└──────────────┬──────────────────────────────┬──────────────────┘
               │ wallet.executeTransaction()  │ fetch() REST API
               ▼                              ▼
┌──────────────────────────┐   ┌──────────────────────────────────┐
│   LEO PROGRAMS (On-chain)│   │  BACKEND (Node.js + Supabase)    │
│                          │   │                                  │
│  veilo_market_v1.aleo    │   │  Indexer — polls Aleo RPC every  │
│  veilo_market_usdcx_v1   │   │    5s, writes to Postgres        │
│  veilo_market_usad_v1    │   │  Simulate API — buy/sell math    │
│                          │   │  Pool API — on-chain state       │
│  (same code, diff token) │   │  Supabase — off-chain metadata   │
└──────────────────────────┘   └──────────────────────────────────┘
               ▲
               │ Aleo RPC queries (mappings, records)
               ▼
┌──────────────────────────────────────────────────────────────┐
│                 ALEO TESTNET NODE                            │
│  Stores: public mappings (markets, amm_pools, vote_tallies)  │
│  Encrypts: private records (OutcomeShare, LPToken, receipts) │
└──────────────────────────────────────────────────────────────┘
```

**Key design decisions:**
- One Leo program per token type (ALEO / USDCX / USAD) — no cross-program calls, simpler state
- All user positions are **private records** — only the owner can see them, enforced by ZK proofs
- Public mappings expose only aggregate state: prices, liquidity, resolution tallies
- No order book — pure AMM (FPMM) so prices are always available

---

## 2. Market Lifecycle & Status Machine

### Status Constants

| Value | Name | Frontend Label |
|-------|------|----------------|
| `1` | `STATUS_ACTIVE` | Active |
| `2` | `STATUS_CLOSED` | Closed |
| `3` | `STATUS_RESOLVED` | Resolved |
| `4` | `STATUS_CANCELLED` | Cancelled |
| `5` | `STATUS_PENDING_RESOLUTION` | Voting |
| `6` | `STATUS_PENDING_FINALIZATION` | Dispute Window |
| `7` | `STATUS_DISPUTED` | Disputed |

### Full State Diagram

```
                    create_market()
                          │
                          ▼
                    ┌─────────┐
                    │ ACTIVE  │◄─── trading: buy/sell/add_liquidity
                    └────┬────┘
                         │ deadline reached (close_market by anyone)
                         ▼
                    ┌────────┐
                    │ CLOSED │
                    └────┬───┘
                         │ first vote_outcome() call
                         ▼
              ┌──────────────────────┐
              │ PENDING_RESOLUTION   │◄─── anyone can vote (bond 1 ALEO)
              └────────────┬─────────┘
                           │ voting_deadline passed
                           │ + MIN_VOTERS (3) reached
                           │ finalize_votes() by anyone
                           ▼
              ┌──────────────────────┐
              │ PENDING_FINALIZATION │◄─── dispute window open
              └────────────┬─────────┘
          ┌────────────────┼────────────────┐
          │                │                │
          │ dispute_       │ dispute_       │ confirm_
          │ resolution()   │ deadline       │ resolution()
          │ (3× bond)      │ expires        │ (no dispute)
          ▼                ▼                ▼
    ┌──────────┐    ┌──────────────────────────┐
    │RESOLVED  │    │         RESOLVED         │
    │(outcome  │    │  (original outcome wins) │
    │ changed) │    └──────────────────────────┘
    └──────────┘

  At any point (if no volume, or past resolution_deadline):
  cancel_market() → CANCELLED
```

### Transition Functions

| Function | Caller | From Status | To Status | Notes |
|----------|--------|-------------|-----------|-------|
| `create_market` | Anyone | — | ACTIVE | Requires initial_liquidity ≥ 10,000 µALEO |
| `buy_shares` | Anyone | ACTIVE | ACTIVE | Private transition |
| `sell_shares` | Anyone | ACTIVE | ACTIVE | Private transition |
| `add_liquidity` | Anyone | ACTIVE | ACTIVE | Private transition |
| `close_market` | Anyone | ACTIVE | CLOSED | Only after `block.height > deadline` |
| `vote_outcome` | Anyone | CLOSED/PENDING_RESOLUTION | PENDING_RESOLUTION | Bond ≥ 1 ALEO |
| `finalize_votes` | Anyone | PENDING_RESOLUTION | PENDING_FINALIZATION | After voting_deadline + 3 voters |
| `confirm_resolution` | Anyone | PENDING_FINALIZATION | RESOLVED | After dispute_deadline, no dispute |
| `dispute_resolution` | Anyone | PENDING_FINALIZATION | RESOLVED | During dispute window, bond ≥ 3× total |
| `cancel_market` | Creator / Anyone | ACTIVE/CLOSED/PENDING | CANCELLED | Creator: no volume; Anyone: past resolution_deadline |
| `redeem_shares` | Share owner | RESOLVED | — | Burns OutcomeShare record, 1:1 payout for winners |
| `claim_refund` | Share owner | CANCELLED | — | Burns share record, refunds original cost |
| `claim_voter_bond` | Bond holder | RESOLVED | — | Burns VoterBondReceipt, returns 1 ALEO |
| `claim_lp_refund` | LP holder | CANCELLED | — | Burns LPToken, proportional liquidity return |
| `withdraw_lp_resolved` | LP holder | RESOLVED | — | Burns LPToken, proportional liquidity + fees return |
| `claim_dispute_bond` | Dispute holder | RESOLVED | — | Burns DisputeBondReceipt |
| `withdraw_creator_fees` | Market creator | RESOLVED/CLOSED | — | Withdraws accumulated creator_fees |

---

## 3. AMM — How Prices & Share Odds Are Calculated

Veilo uses **FPMM (Fixed Product Market Maker)** — a generalization of the x\*y=k formula to N outcomes.

### Core Invariant

The invariant is maintained across all active reserves:

```
∏(reserve_i for i = 1..N) = k  (constant product)
```

When you buy shares of outcome `i`, only `reserve_i` decreases. All other reserves increase proportionally to maintain the product. This makes outcome prices a function of the relative reserve sizes.

### Price Formula

The implied probability (price) of outcome `i`:

```
price_i = prod(r_j  for j ≠ i)
          ─────────────────────────────────────────────
          Σ_k [ prod(r_j  for j ≠ k) ]
```

**Special case (2 outcomes):**
```
price_1 = reserve_2 / (reserve_1 + reserve_2)
price_2 = reserve_1 / (reserve_1 + reserve_2)
```

Intuition: if `reserve_1 = 100` and `reserve_2 = 400`, then:
- `price_1 = 400/500 = 80%` (more likely)
- `price_2 = 100/500 = 20%` (less likely)

When reserves are equal, all outcomes have equal probability `1/N`.

### Buy Shares

**Input:** `amount_in` tokens, targeting `outcome` (1–8)

**Step 1 — Fee deduction:**
```
protocol_fee = (amount_in × 50) / 10000        // 0.5%
creator_fee  = (amount_in × 50) / 10000        // 0.5%
a = amount_in − protocol_fee − creator_fee     // effective amount to pool
```

**Step 2 — Step-division (mirrors on-chain Leo):**
```
stepResult = reserve_i

for each k ≠ i:
    stepResult = stepResult × reserve_k / (reserve_k + a)

r_i_new   = stepResult
shares_out = (reserve_i + a) − r_i_new
```

**Step 3 — Reserve update:**
```
reserve_i' = r_i_new            (decreases)
reserve_k' = reserve_k + a      for k ≠ i  (all others increase)
total_liquidity += a
total_volume    += amount_in
```

**Example (2-outcome, equal reserves of 1,000,000):**
- Buy 100,000 µALEO on outcome 1
- fees: 2,000; `a` = 98,000
- `r1_new = 1,000,000 × 1,000,000 / (1,000,000 + 98,000) = 910,747`
- `shares_out = (1,000,000 + 98,000) − 910,747 = 187,253 shares`
- New price of outcome 1: `~1,098,000 / 2,098,000 ≈ 52.3%`

### Sell Shares

**Input:** `tokens_desired` target payout, `outcome` (the share type to burn)

**Step 1 — Fee deduction (including LP fee on sells):**
```
lp_fee      = (tokens_desired × 100) / 10000   // 1.0% stays in pool
p           = tokens_desired − lp_fee           // pool tokens to remove
protocol_fee = (tokens_desired × 50)  / 10000
creator_fee  = (tokens_desired × 50)  / 10000
net_to_user = tokens_desired − protocol_fee − creator_fee − lp_fee
```

**Step 2 — Step-division (reverse):**
```
stepResult = reserve_i

for each k ≠ i:
    stepResult = stepResult × reserve_k / (reserve_k − p)

shares_needed = (stepResult − reserve_i) + p
```

**Step 3 — Reserve update:**
```
reserve_i' = stepResult              (increases)
reserve_k' = reserve_k − p           for k ≠ i  (all others decrease)
total_liquidity -= p                 (lp_fee amount stays)
```

### Add Liquidity

**Input:** `amount` tokens to deposit

**LP shares received:**
```
lp_shares_out = (amount × total_lp_shares) / total_reserves
```
where `total_reserves = Σ reserve_i`

**Reserve distribution (proportional):**
```
add_k = (amount × reserve_k) / total_reserves   for each k
```
Rounding remainder added to `reserve_8`.

Initial liquidity (on `create_market`):
```
per_outcome_reserve = initial_liquidity / num_outcomes
total_lp_shares     = initial_liquidity
```

### Price Impact

```
price_impact = |price_after − price_before|
```

Both prices use the FPMM price formula computed from reserves before and after the trade.

### LP Withdrawal (RESOLVED market)

Proportional claim on remaining pool:
```
tokens_out = (lp_shares / total_lp_shares) × total_liquidity
```
Subject to `min_tokens_out` slippage guard.

---

## 4. Oracle — How Markets Resolve

Veilo uses a **permissionless bond-weighted quorum oracle** — no trusted third party. Anyone can vote, and economic incentives (bonds + dispute mechanism) keep resolution honest.

### Phase 1: Voting (`STATUS_PENDING_RESOLUTION`)

Triggered by the first call to `vote_outcome()` after `block.height > deadline`.

```
vote_outcome(market_id, outcome, bond_nonce, credits_record)
```

- Caller bonds exactly **1 ALEO** (`MIN_VOTE_BOND = 1,000,000 µALEO`)
- Bond is locked in contract mapping `market_credits[market_id]`
- Vote weight is always 1 bond unit (not capital-weighted)
- Double-voting prevented: `voter_participated[hash(market_id, voter)]` must be false
- Returns `VoterBondReceipt` private record to caller
- First vote sets `voting_deadline = block.height + VOTE_WINDOW_BLOCKS` (2880 blocks ≈ 12 hours)
- Accumulates bonds per outcome: `vote_tallies[market_id].outcome_X_bonds += bond_amount`

### Phase 2: Finalization (`STATUS_PENDING_FINALIZATION`)

Anyone calls `finalize_votes()` once the voting window closes:

```
finalize_votes(market_id)
```

Requirements:
- `block.height > tally.voting_deadline`
- `tally.total_voters >= MIN_VOTERS` (3 voters minimum)

**Winning outcome determination — max bond:**
```
winning_outcome = argmax(outcome_1_bonds, outcome_2_bonds, ..., outcome_8_bonds)
```

Then sets:
```
tally.dispute_deadline = block.height + DISPUTE_WINDOW_BLOCKS
market.status = STATUS_PENDING_FINALIZATION
tally.finalized = false   // not yet final
```

### Phase 3A: Confirm (No Dispute)

Anyone calls `confirm_resolution()` after the dispute window expires without a challenge:

```
confirm_resolution(market_id)
```

Requirements:
- `block.height > tally.dispute_deadline`
- `!dispute_bonds.contains(market_id)` (no dispute was filed)

Effects:
```
tally.finalized = true
market.status   = STATUS_RESOLVED

voter_reward = (protocol_fees[market_id] × VOTER_REWARD_PERCENT) / 100
voter_rewards[market.resolver] += voter_reward
```

The `resolver` address (set at market creation) receives the voter reward pool.

### Phase 3B: Dispute

Anyone can challenge the result during the dispute window by posting a bond:

```
dispute_resolution(market_id, proposed_outcome, dispute_nonce, credits_record, dispute_bond)
```

Requirements:
- `block.height <= tally.dispute_deadline`
- `market.status == STATUS_PENDING_FINALIZATION`
- `proposed_outcome ≠ tally.winning_outcome`
- `dispute_bond >= tally.total_bonded × DISPUTE_BOND_MULTIPLIER` (must bond **3× the total vote bonds**)
- No prior dispute: `!dispute_bonds.contains(market_id)`

Effects:
```
tally.winning_outcome = proposed_outcome   // outcome is overridden
market.resolver       = caller             // disputer becomes resolver
dispute_bonds[market_id] = dispute_bond
market.status         = STATUS_RESOLVED    // immediately resolved
```

Returns `DisputeBondReceipt` to the caller.

### Post-Resolution Claims

| Action | Who | Condition |
|--------|-----|-----------|
| `redeem_shares` | Winning share holders | `market.winning_outcome == share.outcome`, market RESOLVED |
| `claim_voter_bond` | Vote bond holders | Market RESOLVED, bond not yet claimed |
| `claim_dispute_bond` | Dispute bond holder | Market RESOLVED |
| `claim_refund` | Any share holder | Market CANCELLED |
| `claim_lp_refund` | LP token holders | Market CANCELLED |
| `withdraw_lp_resolved` | LP token holders | Market RESOLVED |
| `withdraw_creator_fees` | Market creator | Market RESOLVED or CLOSED |

**Redeem shares payout (1:1):**
```
payout = share.quantity × 1 µALEO_per_share
       = share.quantity  (shares are denominated in the market token)
```

Winning shares are worth 1 token unit each. Losing shares are worth 0.

### Cancellation

Markets can be cancelled by:
1. **Creator** — any time while ACTIVE and `total_volume == 0`
2. **Anyone** — if `block.height > market.resolution_deadline` and market is not yet RESOLVED/CANCELLED

On cancellation all positions become fully refundable at original cost.

---

## 5. Private Records & Public Mappings

### Private Records (ZK-encrypted, only owner can read)

#### `OutcomeShare`
```
owner:       address      -- record owner (can transfer)
market_id:   field        -- which market
outcome:     u8           -- which outcome (1–8)
quantity:    u128         -- number of shares (in µALEO units)
share_nonce: field        -- unique nonce, prevents replay
token_type:  u8           -- 1=ALEO, 2=USDCX, 3=USAD
```
Lifecycle: minted by `buy_shares` → burned by `sell_shares`, `redeem_shares`, `claim_refund`.

#### `LPToken`
```
owner:      address
market_id:  field
lp_shares:  u128         -- proportional claim on pool
lp_nonce:   field
token_type: u8
```
Lifecycle: minted by `create_market` and `add_liquidity` → burned by `claim_lp_refund` or `withdraw_lp_resolved`.

#### `VoterBondReceipt`
```
owner:         address
market_id:     field
voted_outcome: u8
bond_amount:   u128      -- always MIN_VOTE_BOND (1 ALEO)
bond_nonce:    field
```
Lifecycle: minted by `vote_outcome` → burned by `claim_voter_bond`.

#### `DisputeBondReceipt`
```
owner:            address
market_id:        field
proposed_outcome: u8
bond_amount:      u128   -- user-supplied (≥ 3× total voting bonds)
dispute_nonce:    field
```
Lifecycle: minted by `dispute_resolution` → burned by `claim_dispute_bond`.

### Public Mappings (Readable by anyone via Aleo RPC)

| Mapping | Key | Value | Purpose |
|---------|-----|-------|---------|
| `markets` | `field` (market_id) | `Market` struct | Market status, creator, deadline |
| `amm_pools` | `field` | `AMMPool` struct | 8 reserves, liquidity, volume |
| `market_fees` | `field` | `MarketFees` struct | Protocol + creator fee accrual |
| `vote_tallies` | `field` | `VoteTally` struct | Per-outcome bonds, windows, winner |
| `voter_participated` | `field` (hash of market_id + voter) | `bool` | Anti-double-vote |
| `dispute_bonds` | `field` | `u128` | Dispute bond amount per market |
| `bond_claimed` | `field` (hash of claim key) | `bool` | Idempotency for bond claims |
| `share_redeemed` | `field` (hash of claim key) | `bool` | Idempotency for share redemptions |
| `lp_positions` | `field` (hash of lp key) | `bool` | Idempotency for LP withdrawals |
| `market_credits` | `field` | `u128` | ALEO locked per market |
| `program_credits` | `u8` (always 0) | `u128` | Total ALEO in contract |
| `protocol_treasury` | `u8` (always 0) | `u128` | Accumulated protocol fees |
| `voter_rewards` | `address` | `u128` | Voter reward claimable per resolver |

---

## 6. Fee Structure

All fees are deducted in basis points (1 BPS = 0.01%).

| Fee | BPS | Rate | When | Goes to |
|-----|-----|------|------|---------|
| Protocol | 50 | 0.5% | Buy + Sell | `protocol_treasury` mapping |
| Creator | 50 | 0.5% | Buy + Sell | `market_fees[id].creator_fees` mapping |
| LP | 100 | 1.0% | Sell only | Stays in pool (increases reserves) |

**Buy total fee: 1.0%** (protocol + creator)
**Sell total fee: 2.0%** (protocol + creator + LP)

### Worked Example: Buy 10 ALEO worth of shares

```
amount_in      = 10,000,000 µALEO
protocol_fee   =    50,000 µALEO  (0.5%)
creator_fee    =    50,000 µALEO  (0.5%)
a (to pool)    = 9,900,000 µALEO  (99%)
```

### Worked Example: Sell for 10 ALEO

```
tokens_desired = 10,000,000 µALEO
protocol_fee   =    50,000 µALEO  (0.5%)
creator_fee    =    50,000 µALEO  (0.5%)
lp_fee         =   100,000 µALEO  (1.0%)
net to user    = 9,800,000 µALEO  (98%)
```

### Voter Reward from Protocol Fees

```
voter_reward = (protocol_fees[market_id] × 20) / 100
```

This reward is credited to `voter_rewards[market.resolver]` on `confirm_resolution`. The resolver address is the user who called the market-creating transaction (and can be updated to the disputer on dispute).

---

## 7. Constants & Limits

| Constant | Value | Meaning |
|----------|-------|---------|
| `MIN_LIQUIDITY` | 10,000 µALEO | Minimum initial liquidity to create a market |
| `MIN_TRADE_AMOUNT` | 1,000 µALEO | Minimum single trade |
| `MIN_VOTE_BOND` | 1,000,000 µALEO | 1 ALEO; required to cast a resolution vote |
| `MIN_VOTERS` | 3 | Quorum — need at least 3 unique voters to finalize |
| `VOTE_WINDOW_BLOCKS` | 2,880 | ~12 hours at ~15 s/block (mainnet); ~3 hours on testnet |
| `DISPUTE_WINDOW_BLOCKS` | 2,880 | Same as voting window |
| `DISPUTE_BOND_MULTIPLIER` | 3× | Disputer must bond 3× all voting bonds combined |
| `PROTOCOL_FEE_BPS` | 50 | 0.5% |
| `CREATOR_FEE_BPS` | 50 | 0.5% |
| `LP_FEE_BPS` | 100 | 1.0% (sell only) |
| `VOTER_REWARD_PERCENT` | 20 | 20% of protocol fees go to voter reward pool |
| `MAX_OUTCOMES` | 8 | Maximum outcomes per market |
| `MIN_OUTCOMES` | 2 | Binary minimum |

---

## 8. What Is Implemented

### Leo Smart Contract (`/contracts/prediction_market_v1/src/main.leo`)

All 17 transitions are implemented and deployed on Aleo testnet:

| Transition | Status |
|------------|--------|
| `create_market` | Deployed |
| `buy_shares` | Deployed |
| `sell_shares` | Deployed |
| `add_liquidity` | Deployed |
| `close_market` | Deployed |
| `cancel_market` | Deployed |
| `vote_outcome` | Deployed |
| `finalize_votes` | Deployed |
| `confirm_resolution` | Deployed |
| `dispute_resolution` | Deployed |
| `redeem_shares` | Deployed |
| `claim_refund` | Deployed |
| `claim_voter_bond` | Deployed |
| `claim_dispute_bond` | Deployed |
| `claim_lp_refund` | Deployed |
| `withdraw_lp_resolved` | Deployed |
| `withdraw_creator_fees` | Deployed |

Three token variants deployed: `veilo_market_v1.aleo` (ALEO), `veilo_market_usdcx_v1.aleo`, `veilo_market_usad_v1.aleo`.

### Backend (`/backend/src/`)

| Feature | File | Status |
|---------|------|--------|
| Chain indexer | `indexer.ts` | Done |
| `create_market` indexing | `indexer.ts` | Done |
| `buy_shares` indexing (private inputs, Future parsing) | `indexer.ts` | Done |
| `sell_shares` indexing | `indexer.ts` | Done |
| `add_liquidity` indexing | `indexer.ts` | Done |
| `close_market` / `cancel_market` status sync | `indexer.ts` | Done |
| `vote_outcome` / `finalize_votes` / `confirm_resolution` / `dispute_resolution` resolution sync | `indexer.ts` | Done |
| Trade simulation API (`POST /api/markets/:id/simulate`) | `routes/simulate.ts` | Done |
| Pool state API (`GET /api/markets/:id/pool`) | `routes/simulate.ts` | Done |
| LP simulation API (`POST /api/markets/:id/simulate-lp`) | `routes/simulate.ts` | Done |
| Markets list + filter by creator | `routes/markets.ts` | Done |
| Resolution data endpoint | `routes/markets.ts` | Done |
| Supabase schema: markets, metadata, resolutions, price_snapshots | `services/supabase.ts` | Done |
| Aleo RPC mapping queries | `services/aleo-rpc.ts` | Done |

### Frontend (`/frontend/src/`)

| Feature | File | Status |
|---------|------|--------|
| Wallet connect (Leo, Shield, Puzzle, Fox, Soter) | `App.tsx` | Done |
| Shield wallet transition ID resolution (`au1` → `at1`) | `hooks/useAleoTransaction.ts` | Done |
| Transaction confirmation polling (REST + wallet fallback) | `hooks/useAleoTransaction.ts` | Done |
| Toast notification system | `components/ui/Toast.tsx` | Done |
| Market browser with filters | `pages/Markets.tsx` | Done |
| Market detail page | `pages/MarketDetail.tsx` | Done |
| Probability chart (historical prices) | `components/charts/ProbabilityChart.tsx` | Done |
| Buy shares UI with simulation | `components/trading/TradingPanel.tsx` | Done |
| Sell shares UI with owned shares display | `components/trading/TradingPanel.tsx` | Done |
| Liquidity UI with LP simulation | `components/trading/LiquidityPanel.tsx` | Done |
| Resolution panel (vote / finalize / confirm / dispute) | `components/resolution/ResolutionPanel.tsx` | Done |
| Redeem shares (winners) | `components/resolution/ResolutionPanel.tsx` | Done |
| Claim voter bond | `components/resolution/ResolutionPanel.tsx` | Done |
| Claim refund (cancelled market) | `components/resolution/ResolutionPanel.tsx` | Done |
| Portfolio — My Positions (share records) | `pages/Portfolio.tsx` | Done |
| Portfolio — LP Positions | `pages/Portfolio.tsx` | Done |
| Portfolio — Dispute Bonds | `pages/Portfolio.tsx` | Done |
| Portfolio — Markets I Created | `pages/Portfolio.tsx` | Done |
| Withdraw creator fees | `pages/Portfolio.tsx` | Done |
| Withdraw LP (resolved) / Claim LP refund (cancelled) | `pages/Portfolio.tsx` | Done |
| Claim dispute bond | `pages/Portfolio.tsx` | Done |
| Create market form | `pages/CreateMarket.tsx` | Done |
| Close market (creator) | `pages/MarketDetail.tsx` | Done |
| Cancel market (creator) | `pages/MarketDetail.tsx` | Done |
| FPMM math library (mirrors Leo exactly) | `lib/amm.ts` | Done |
| Record parsing (Shield / Leo / Puzzle formats) | `lib/records.ts` | Done |
| Spent record detection (via Aleo RPC nonce check) | `lib/records.ts` | Done |
| Block height polling (for deadline display) | `App.tsx` | Done |
| Navbar — active state, correct routes | `components/layout/Navbar.tsx` | Done |

---

## 9. What Is Remaining

### High Priority

#### 1. Voter Reward Withdrawal
The contract accumulates `voter_rewards[resolver_address]` but there is no frontend UI to claim it, and no backend endpoint.
- Need: `GET /api/voter-rewards/:address` (query `voter_rewards` mapping)
- Need: Frontend button in Portfolio to call a `claim_voter_reward` transition
- **Contract note:** Check if `claim_voter_reward` transition exists in Leo or needs to be added

#### 2. Protocol Treasury Withdrawal
Protocol fees accumulate in `protocol_treasury` mapping but there is no admin UI to withdraw them.
- This may be intentionally admin-only; needs a dedicated admin page or script.

#### 3. Multi-outcome Dispute/Redeem in Portfolio
The Portfolio dispute bonds section shows a claim button, but the claim does not yet conditionally check whether the dispute was successful (i.e. whether disputer's `proposed_outcome == final winning_outcome`). Losing disputers should not be able to claim.

#### 4. USDCX / USAD Token Support in UI
Three programs are deployed but the frontend only drives ALEO markets end-to-end. USDCX and USAD markets require:
- Different `credits` transfer calls (token program vs native ALEO)
- Token balance display in Navbar
- Token-specific record fetching in Portfolio

### Medium Priority

#### 5. Finalize Votes / Confirm Resolution in MarketDetail
The `ResolutionPanel` has these buttons but they are only visible in the panel. There should be a clear top-level call-to-action on `MarketDetail` when:
- `status == PENDING_RESOLUTION` and voting_deadline has passed → show "Finalize Votes" prominently
- `status == PENDING_FINALIZATION` and dispute_deadline has passed → show "Confirm Resolution" prominently

#### 6. Market Search
`Markets.tsx` filters by status/category/token but has no text search. A `?q=` query param on the backend endpoint would enable keyword search on `question_text`.

#### 7. Market Creation — Outcome Image Upload
`CreateMarket.tsx` allows setting outcome labels but not per-outcome images. This is stored in `market_metadata` and could be extended.

#### 8. Price History Gaps
The indexer records a price snapshot on every `buy_shares`/`sell_shares` event. On low-activity markets the chart will show large gaps. A periodic snapshot (every N blocks) would improve chart quality.

### Low Priority / Future

#### 9. Parlay / Multi-Market Bets
`amm.ts` has `calcParlayMultiplier` and `calcParlayPayout` helpers but there is no UI or contract support for atomic multi-market parlays.

#### 10. Mobile Responsive Navbar
The navigation is `hidden md:flex` — on mobile only the logo and wallet button show. A hamburger menu for mobile is missing.

#### 11. Mainnet Deployment Configuration
All config points to Aleo testnet. A mainnet deployment requires:
- Updated `RPC_URL` and program IDs in `lib/config.ts`
- Longer block time constants (`VOTE_WINDOW_BLOCKS` should be increased for mainnet)
- Supabase production database

#### 12. Indexer Reliability
The indexer uses a simple polling loop with no retry backoff, dead-letter queue, or missed-block recovery. For production it should:
- Track last indexed block height
- Resume from last checkpoint on restart
- Alert on indexing lag

#### 13. Emergency Pause / Upgrade Path
The Leo program uses `@noupgrade` on the constructor. If a critical bug is found:
- No on-chain upgrade path exists
- Would require deploying a new program and migrating users
- Consider adding a `@upgradeable` annotation + governance for v2

---

## Key File Locations

| File | Purpose |
|------|---------|
| `veilo/contracts/prediction_market_v1/src/main.leo` | Leo smart contract (ALEO variant, 1600+ lines) |
| `veilo/contracts/prediction_market_usdcx_v1/src/main.leo` | Leo smart contract (USDCX variant) |
| `veilo/contracts/prediction_market_usad_v1/src/main.leo` | Leo smart contract (USAD variant) |
| `veilo/backend/src/indexer.ts` | Aleo chain indexer |
| `veilo/backend/src/routes/simulate.ts` | Trade simulation API |
| `veilo/backend/src/services/aleo-rpc.ts` | Aleo RPC query client |
| `veilo/backend/src/services/supabase.ts` | Database access layer |
| `veilo/frontend/src/lib/amm.ts` | FPMM math (mirrors Leo exactly) |
| `veilo/frontend/src/lib/records.ts` | Private record parsing + spent record detection |
| `veilo/frontend/src/lib/aleo-client.ts` | Transaction input builders |
| `veilo/frontend/src/hooks/useAleoTransaction.ts` | Wallet transaction hook with polling |
| `veilo/frontend/src/components/resolution/ResolutionPanel.tsx` | Oracle resolution UI |
| `veilo/frontend/src/components/trading/TradingPanel.tsx` | Buy/sell UI |
| `veilo/frontend/src/components/trading/LiquidityPanel.tsx` | Add liquidity UI |
| `veilo/frontend/src/pages/Portfolio.tsx` | Full portfolio management |
| `veilo/frontend/src/types/index.ts` | All TypeScript types and constants |
