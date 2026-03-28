# Veilo — Privacy-Preserving Prediction Markets on Aleo

> Trade on future outcomes without revealing your positions. Built on Aleo's ZK-native execution environment.

Veilo is a fully on-chain prediction market protocol where every user position — shares held, liquidity provided, votes cast — is a **private ZK record**. Public mappings expose only aggregate state: prices, liquidity, and resolution tallies. No one can see what you hold or how you voted.

---

## Table of Contents

1. [What We Built](#1-what-we-built)
2. [Architecture](#2-architecture)
3. [V1 — Deployed Features](#3-v1--deployed-features)
4. [V2 — Designed & Built (Next Wave)](#4-v2--designed--built-next-wave)
5. [Why We Reverted to V1 for Submission](#5-why-we-reverted-to-v1-for-submission)
6. [Tech Stack](#6-tech-stack)
7. [Deployed Contracts](#7-deployed-contracts)
8. [Local Setup](#8-local-setup)
9. [Judge Testing Guide](#9-judge-testing-guide)

---

## 1. What We Built

Veilo lets anyone create a prediction market on any question with up to 8 possible outcomes. Users buy and sell outcome shares using an AMM (Fixed-Product Market Maker). When the market resolves, winning shareholders are paid out from the pool.

**What makes it different from other prediction markets:**

| Feature | Traditional (e.g. Polymarket) | Veilo |
|---|---|---|
| Position visibility | Public on-chain | Private ZK record — only you see it |
| Vote visibility | Public | Private until tallied |
| Who can resolve | Centralized oracle | Any 3 community members + dispute window |
| Sybil resistance (v2) | None | Oracle Accuracy Score tracks voter history |
| Whale voting (v2) | 1-wallet-1-vote | Skin-in-the-game: share weight + bond |

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    FRONTEND (React + TypeScript + Vite)          │
│   Market Browser → TradingPanel → Portfolio → ResolutionPanel   │
└───────────────┬──────────────────────────────┬──────────────────┘
                │ wallet.executeTransaction()  │ fetch() REST API
                ▼                              ▼
┌──────────────────────────┐   ┌──────────────────────────────────┐
│  LEO PROGRAMS (On-chain) │   │  BACKEND (Node.js + Hono)        │
│                          │   │                                  │
│  veilo_market_v1.aleo    │   │  Indexer — polls Aleo RPC every  │
│  veilo_market_usdcx_v1   │   │    5s, writes to Supabase        │
│  veilo_market_usad_v1    │   │  Simulate API — FPMM math        │
│                          │   │  Pool API — live on-chain state  │
└──────────────────────────┘   └──────────────────────────────────┘
                ▲
                │ RPC mapping queries (public state)
                │ Wallet record decrypt (private state)
                ▼
┌──────────────────────────────────────────────────────────────────┐
│                       ALEO TESTNET                               │
│  Public: markets, amm_pools, vote_tallies (aggregate only)       │
│  Private: OutcomeShare, LPToken, VoterBondReceipt (ZK records)   │
└──────────────────────────────────────────────────────────────────┘
```

**Key design choices:**

- **One Leo program per token** (ALEO / USDCX / USAD) — avoids cross-program call complexity, each program is fully self-contained
- **All positions are private records** — ownership enforced by ZK proofs at the VM level, not application logic
- **Pure AMM (FPMM)** — no order book, prices always available, supports up to 8 outcomes simultaneously
- **Backend is an indexer, not a server** — all state transitions happen on-chain; the backend only caches public mapping data for fast reads

---

## 3. V1 — Deployed Features

### Market Creation
- Any wallet can create a market with 2–8 outcomes
- Creator sets question text, outcome labels, category, token type, and deadline block
- Initial liquidity is deposited into the AMM pool on creation
- Metadata (question, description, source URL, outcome labels) stored on IPFS via Pinata; only the content hash is stored on-chain

### Trading — FPMM AMM
The AMM uses a Fixed-Product Market Maker. For a market with `n` outcomes and reserves `[r₁, r₂, ..., rₙ]`:

- **Price of outcome i** = `∏(rⱼ for j≠i)` / `Σₖ ∏(rⱼ for j≠k)`
- **Buy shares**: deposit tokens → receive `OutcomeShare` private record; reserve `rᵢ` decreases (price rises)
- **Sell shares**: burn `OutcomeShare` private record → receive tokens; reserve `rᵢ` increases (price falls)

Fee structure: **2% total** (0.5% protocol + 0.5% creator + 1% LP on sells)

All trades produce or consume **private records** — the market only sees aggregate reserve changes, not individual positions.

### Liquidity Provision
- Add liquidity → receive `LPToken` private record (proportional LP shares)
- Remove liquidity (active market) → burn LP record, receive proportional tokens back
- LP refund (cancelled market) → burn LP record, recover deposit
- LP withdrawal (resolved market) → burn LP record, receive proportional share of remaining pool

### Resolution Flow

```
close_market()          ← creator or anyone, after deadline
      │
vote_outcome()          ← any wallet, 1 ALEO bond (private record as input)
      │                    voting_deadline = current_block + 2880
      │                    minimum 3 voters required
finalize_votes()        ← anyone, after voting_deadline + MIN_VOTERS met
      │                    sets dispute_deadline = current_block + 2880
      │
 ┌────┴────┐
 │         │
confirm_resolution()    ← anyone, after dispute_deadline (no dispute)
      │
redeem_shares()         ← winning shareholders, receive payout (private)
claim_voter_bond()      ← all voters, recover 1 ALEO bond (private receipt)
```

**Dispute path**: During the dispute window any wallet can call `dispute_resolution()` with a 3 ALEO bond to flag the result. Disputed markets enter a separate `STATUS_DISPUTED` state (manual arbitration out of scope for this submission).

**Cancellation**: Creator can cancel an active market with zero trading volume. All shareholders can claim refunds via `claim_refund()`.

### Portfolio
- Aggregates all private records across all markets the wallet has interacted with
- Shows outcome share holdings, LP positions, claimable winnings
- Reads directly from the wallet's decrypted record store — never touches a centralised server

### Supported Tokens
| Token | Program |
|---|---|
| ALEO (native) | `veilo_market_v1.aleo` |
| USDCX (testnet stablecoin) | `veilo_market_usdcx_v1.aleo` |
| USAD (testnet stablecoin) | `veilo_market_usad_v1.aleo` |

---

## 4. V2 — Designed & Built (Next Wave)

The V2 contracts (`veilo_market_v2.aleo`, `veilo_market_usdcx_v2.aleo`, `veilo_market_usad_v2.aleo`) are **fully written and compiled**. All 17 V1 transitions are preserved with identical semantics. V2 adds:

### Oracle Accuracy Score
Every address that votes has an `OracleProfile` stored in a public mapping:

```
struct OracleProfile {
    votes_cast:    u64   // total votes ever submitted
    votes_correct: u64   // votes that matched the winning outcome
    streak:        u64   // consecutive correct votes
    total_bonus:   u128  // accumulated bonus (microcredits)
}
```

**How bonuses work:**
1. Voter calls `vote_outcome()` — bond is locked as before
2. After resolution, voter calls `claim_voter_bond()` — bond is returned **and** `OracleProfile` is updated. If the voter voted correctly, a bonus (proportional to their accuracy rate and streak) is written to `oracle_pending_bonus` mapping
3. Voter calls `claim_oracle_bonus()` — receives the pending bonus as a private credits record

This creates a long-term incentive for voters to be genuinely informed, not just bonding randomly.

### Skin-in-the-Game Voting (`vote_with_shares`)
Share holders can attach their existing position to their vote using `vote_with_shares()`. Their outcome share record is burned (they're sacrificing their position as the bond), and their vote is weighted by:

```
weight = min(share_quantity, MAX_SHARE_VOTE_WEIGHT)
```

`finalize_votes()` in V2 determines the winner by **combined weight** (standard bonds + share-weight votes), making the oracle more resistant to low-information voting. Whales cannot dominate: `MAX_SHARE_VOTE_WEIGHT` caps any single voter's influence.

### Why V2 Matters
Standard voting oracles are vulnerable to:
- **Random voting** — bonds are recovered regardless of correctness, so there's no long-run incentive to vote accurately
- **Whale dominance** — large bondholders can outvote informed participants

V2 fixes both: accuracy-weighted bonuses reward expertise over time, and share-weight voting aligns voters who have skin in the game.

---

## 5. Why We Reverted to V1 for Submission

V2 introduced a dependency chain issue on Aleo testnet during final integration:

- The `claim_oracle_bonus` transition calls `credits.aleo/transfer_public_to_private` inside a `finalize` block, which requires the bonus amount to be computed on-chain
- During testnet testing, the `oracle_pending_bonus` mapping reads inside `finalize` produced intermittent `MappingNotFound` errors on the first-ever write for a new address (before the key exists)
- The V2 `vote_with_shares` path also showed non-deterministic behavior when a share record's `quantity` field cast from `u128` to `u64` overflowed on large share positions — a type-safety issue in the weight calculation

Rather than submit a partially broken V2, we decided to **deploy the stable V1 contracts** for judging and keep V2 ready for the next wave once these issues are resolved. The V2 Leo source is committed and fully reviewed — the architecture is sound, the implementation just needs a targeted fix on those two transitions.

**V1 is fully functional end-to-end.** The entire judge testing flow below works on deployed V1 contracts.

---

## 6. Tech Stack

| Layer | Technology |
|---|---|
| Smart Contracts | Leo 3.5.0, Aleo testnet |
| Frontend | React 18, TypeScript, Vite 5, Tailwind CSS |
| Wallet | `@provablehq/aleo-wallet-adaptor-react` (Shield, Leo, Puzzle, Fox, Soter) |
| Charts | Recharts |
| State | Zustand |
| Backend | Node.js, Hono, TypeScript |
| Database | Supabase (Postgres) — off-chain index only |
| Metadata | IPFS via Pinata |
| RPC | `https://api.explorer.provable.com/v1/testnet` |

---

## 7. Deployed Contracts

All contracts are deployed on **Aleo testnet**.

| Program ID | Token | Version |
|---|---|---|
| `veilo_market_v1.aleo` | ALEO (native) | V1 |
| `veilo_market_usdcx_v1.aleo` | USDCX | V1 |
| `veilo_market_v2.aleo` | ALEO (native) | V2 |


Verify on explorer: `https://testnet.explorer.provable.com/program/veilo_market_v1.aleo`
Verify on explorer: `https://testnet.explorer.provable.com/program/veilo_market_usdcx_v1.aleo`
Verify on explorer: `https://testnet.explorer.provable.com/program/veilo_market_v2.aleo`
---

## 8. Local Setup

### Prerequisites
- Node.js 20+
- Leo CLI (`leo --version` should be 3.x)
- A Supabase project
- A Pinata account (IPFS for metadata)

### 1. Clone & install
```bash
git clone <repo>
cd veilo
npm run install:all   # installs frontend + backend deps
```

### 2. Configure environment
```bash
cp .env.example .env
```

Edit `.env` with your values:
```env
RPC_URL=https://api.explorer.provable.com/v1/testnet
PROGRAM_ID_ALEO=veilo_market_v1.aleo
PROGRAM_ID_USDCX=veilo_market_usdcx_v1.aleo
PROGRAM_ID_USAD=veilo_market_usad_v1.aleo
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key
PINATA_JWT=your-pinata-jwt
VITE_BACKEND_URL=http://localhost:3001
# ... (see .env.example for full list)
```

### 3. Set up Supabase schema
```bash
# Run the SQL in supabase-schema.sql against your Supabase project
# (Supabase dashboard → SQL Editor → paste and run)
```

### 4. Run dev servers
```bash
npm run dev          # starts both frontend (port 5173) and backend (port 3001)
# or separately:
npm run dev:frontend
npm run dev:backend
```

### 5. Build contracts (optional — already compiled)
```bash
npm run build:contract           # veilo_market_v1.aleo
npm run build:contract:usdcx     # veilo_market_usdcx_v1.aleo
npm run build:contract:usad      # veilo_market_usad_v1.aleo
```

---

## 9. Judge Testing Guide

All testing uses the **live deployment on Aleo testnet**. No local blockchain required.

**Recommended wallet**: [Shield Wallet](https://shieldwallet.io) (Chrome extension). It supports private record management and `Transfer Public to Private` natively.

**Testnet faucet**: Request ALEO at `https://faucet.provable.com` — paste your wallet address, receive testnet ALEO within a few minutes.

---

### Test A — Browse Without Wallet (No Setup Required)

1. Open the live app URL
2. Click **Markets** in the nav
3. Browse available markets — prices, liquidity, probability bars visible without connecting wallet
4. Click any market to see the detail page: probability chart, outcome breakdown, stats
5. **What to verify**: All data loads from chain via the indexer; prices reflect the current AMM state

---

### Test B — Connect Wallet & View Portfolio

1. Install Shield wallet, create an account
2. Request testnet ALEO from the faucet
3. Click **Connect** in the app header → select Shield
4. Navigate to **Portfolio** — initially empty (no positions yet)
5. **What to verify**: Wallet connects, address shows in header, portfolio loads

---

### Test C — Buy Shares (Privacy Demo)

> This demonstrates that positions are private ZK records.

**Prerequisite**: You need a **private credits record** to pay for shares. In Shield wallet: go to **Transfer → Public to Private**, transfer any amount (e.g. 5 ALEO). Wait ~30 seconds for the transaction to confirm.

1. Open any active market
2. In the Trading Panel: select **Buy Shares**
3. Choose an outcome, enter an amount (e.g. `1`)
4. The simulation preview shows: estimated shares, average price, fee (2%), price impact
5. Click **Buy Shares** → Shield wallet prompts for approval → approve
6. Wait for confirmation (~30–60 seconds on testnet)
7. Navigate to **Portfolio** → your position appears as a private record
8. **What to verify**:
   - The probability bar on the market updates — the outcome you bought moved up
   - Your position shows in Portfolio with share count
   - On the Aleo explorer, the transaction output shows an **encrypted record** (not readable by observers)

**Privacy proof**: Go to `https://testnet.explorer.provable.com`, find your transaction. The `OutcomeShare` record in the output is encrypted — no one can read your position.

---

### Test D — Sell Shares

1. In Portfolio, note the shares you hold for a given outcome
2. Open that market → Trading Panel → **Sell Shares**
3. Select the same outcome, enter a token amount to receive
4. The preview shows: shares needed, net tokens received after fees
5. Click **Sell Shares** → approve in wallet
6. **What to verify**: Position decreases in Portfolio; probability bar shifts back

---

### Test E — Add & Remove Liquidity

1. Open an active market → scroll to the **Liquidity** panel (below trading)
2. Enter an amount → click **Add Liquidity**
3. Approve in wallet → an `LPToken` private record is created
4. In Portfolio → **LP Positions** tab → your LP position shows with estimated share %
5. Return to market → click **Remove Liquidity** → select your LP record → confirm
6. **What to verify**: Tokens returned proportionally; LP position disappears from Portfolio

---

### Test F — Create a Market

1. Click **Create Market** in the nav
2. Fill in:
   - Question (e.g. "Which team wins the next match?")
   - Category
   - Outcomes (2–8): add labels for each
   - Token type: ALEO
   - Deadline: a future block number (current block + 100 for a quick test)
   - Initial liquidity: e.g. `5` ALEO
3. Click **Create** → approve two wallet prompts (IPFS metadata upload, then on-chain transaction)
4. Market appears in the Markets list within ~10 seconds (one indexer poll)
5. **What to verify**: Market card shows your question, correct outcome count, probability bars at equal distribution (50/50 or equal for N outcomes)

---

### Test G — Full Resolution Flow (End-to-End)

> This requires a market whose deadline has passed. Either use the market from Test F (wait for the deadline block) or ask us for a pre-created test market address.

**Setup**: You need 3 wallets, each with a private credits record (≥ 1 ALEO). Run `Transfer Public to Private` in each Shield wallet instance.

**Step 1 — Close the market**
- Open the market detail page with the creator wallet
- After the deadline block, a **Close Market** button appears in the right panel
- Click it → confirm → status changes to `Closed`, voting UI appears

**Step 2 — Vote from 3 wallets** (switch wallets between each)
- In the ResolutionPanel: select the correct outcome → click **Vote for [Outcome]**
- Each vote requires a private credits record (1 ALEO bond)
- Repeat from all 3 wallets
- **What to verify**: The vote tally bars update after each vote

**Step 3 — Finalize Votes**
- After the voting window passes (or if testing, note the `voting_deadline` block from the UI), a **Finalize Votes** button appears
- Any wallet can click it → status moves to `Dispute Window`

**Step 4 — Confirm Resolution**
- After the dispute window, **Confirm Resolution** button appears
- Click → status moves to `Resolved`

**Step 5 — Redeem Winning Shares**
- Connect each wallet that holds shares on the winning outcome
- ResolutionPanel shows **Redeem Winning Shares** in green
- Click → private credits record returned to your wallet with payout amount

**Step 6 — Claim Voter Bonds**
- Each wallet that voted can click **Claim Voter Bond**
- Recovers the 1 ALEO bond as a private record

**What to verify end-to-end:**
- Market status correctly transitions through each stage
- Only the winning outcome shareholders can redeem
- Voter bonds are returned to all voters regardless of outcome
- All payouts arrive as private records (encrypted on explorer)

---

### Test H — Market Cancellation

1. Create a fresh market (no trades yet)
2. Before the deadline: **Cancel Market** button appears in the right panel (creator only)
3. Click → market status moves to `Cancelled`
4. If any wallets had bought shares before cancellation: **Claim Refund** appears in ResolutionPanel
5. **What to verify**: Refund returns original share cost as private record

---

### Troubleshooting for Judges

| Issue | Fix |
|---|---|
| "No private credits record found" | Shield → Transfer → Public to Private → wait ~30s → Sync |
| "Input ID already exists in ledger" | Shield → Settings → Sync → wait for completion → Transfer Public to Private again |
| Transaction fails silently | Check Shield wallet notification; may need to increase fee or wait for network congestion to clear |
| Portfolio shows no positions | Shield → Settings → Sync Records → wait for full scan (~1–2 min on testnet) |
| Market not appearing after creation | Wait up to 10s for indexer poll; hard-refresh the page |
| Prices look stale after a trade | Page auto-refreshes every 8s from chain; live prices update immediately after your own trade |

---

### V2 Contracts — Source Review

The V2 contracts are not deployed but reviewers can inspect the Leo source:

- `contracts/prediction_market_v2/src/main.leo` — ALEO variant
- `contracts/prediction_market_usdcx_v2/src/main.leo` — USDCX variant
- `contracts/prediction_market_usad_v2/src/main.leo` — USAD variant

Search for `[NEW]` and `[MOD]` tags at the top of each file for a diff summary of changes from V1.

---

## License

MIT
