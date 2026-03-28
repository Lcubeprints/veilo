# Veilo — Supabase SQL Migrations

Run these in **Supabase Dashboard → SQL Editor** in order.

---

## Migration 1 — Initial Schema (Run once on fresh project)

> 113 lines — creates all tables, indexes, RLS policies, and realtime config.

```sql
-- ============================================================================
-- VEILO — Supabase Schema
-- ============================================================================

-- Markets (indexed from on-chain)
CREATE TABLE markets (
    id TEXT PRIMARY KEY,
    creator TEXT NOT NULL,
    resolver TEXT,
    question_hash TEXT NOT NULL,
    category SMALLINT NOT NULL DEFAULT 1,
    num_outcomes SMALLINT NOT NULL CHECK (num_outcomes BETWEEN 2 AND 8),
    deadline BIGINT NOT NULL,
    resolution_deadline BIGINT NOT NULL,
    status SMALLINT NOT NULL DEFAULT 1,
    token_type SMALLINT NOT NULL DEFAULT 1,
    total_liquidity BIGINT DEFAULT 0,
    total_volume BIGINT DEFAULT 0,
    winning_outcome SMALLINT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Market metadata (from IPFS)
-- question_hash is the PK so metadata can be stored before market_id is known on-chain.
-- market_id is populated by the indexer once the create_market tx is confirmed.
CREATE TABLE market_metadata (
    question_hash TEXT PRIMARY KEY,
    market_id TEXT UNIQUE REFERENCES markets(id) ON DELETE CASCADE,
    question_text TEXT NOT NULL,
    description TEXT,
    outcome_labels JSONB NOT NULL,
    image_url TEXT,
    ipfs_cid TEXT,
    source_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Price snapshots (for charts)
CREATE TABLE price_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    market_id TEXT NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
    prices JSONB NOT NULL,
    reserves JSONB NOT NULL,
    total_liquidity TEXT,
    block_height BIGINT NOT NULL,
    recorded_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_price_snapshots ON price_snapshots(market_id, recorded_at);

-- Resolution state
CREATE TABLE resolutions (
    market_id TEXT PRIMARY KEY REFERENCES markets(id) ON DELETE CASCADE,
    proposed_outcome SMALLINT,
    outcome_bonds JSONB,
    total_voters INT DEFAULT 0,
    voting_deadline BIGINT,
    dispute_deadline BIGINT,
    disputed BOOLEAN DEFAULT FALSE,
    finalized BOOLEAN DEFAULT FALSE,
    finalized_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- User bets (encrypted client-side)
CREATE TABLE user_bets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_address_hash TEXT NOT NULL,
    market_id TEXT NOT NULL REFERENCES markets(id),
    encrypted_data TEXT NOT NULL,
    tx_id TEXT,
    bet_type TEXT DEFAULT 'single',
    status TEXT DEFAULT 'confirmed',
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_user_bets ON user_bets(user_address_hash);

-- Indexer cursor
CREATE TABLE indexer_cursor (
    id TEXT PRIMARY KEY DEFAULT 'singleton',
    last_block BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- RLS Policies
-- ============================================================================

ALTER TABLE markets ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_metadata ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE resolutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_bets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read markets" ON markets FOR SELECT USING (true);
CREATE POLICY "Service write markets" ON markets FOR ALL TO service_role USING (true);

CREATE POLICY "Public read metadata" ON market_metadata FOR SELECT USING (true);
CREATE POLICY "Service write metadata" ON market_metadata FOR ALL TO service_role USING (true);

CREATE POLICY "Public read prices" ON price_snapshots FOR SELECT USING (true);
CREATE POLICY "Service write prices" ON price_snapshots FOR ALL TO service_role USING (true);

CREATE POLICY "Public read resolutions" ON resolutions FOR SELECT USING (true);
CREATE POLICY "Service write resolutions" ON resolutions FOR ALL TO service_role USING (true);

CREATE POLICY "Service role bets" ON user_bets FOR ALL TO service_role USING (true);

-- ============================================================================
-- Realtime
-- ============================================================================

ALTER PUBLICATION supabase_realtime ADD TABLE markets;
ALTER PUBLICATION supabase_realtime ADD TABLE resolutions;
ALTER PUBLICATION supabase_realtime ADD TABLE price_snapshots;
```

---

## Migration 2 — Fix market_metadata schema (Run if you already ran Migration 1)

> 16 lines — drops the old `market_metadata` table (which used `market_id` as PK)
> and recreates it with `question_hash` as PK so metadata can be stored before
> the on-chain `market_id` is known.
>
> **Safe to run** — `market_metadata` rows are re-populated automatically by the
> indexer and the create market flow going forward.

```sql
-- Drop old table (cascades to any FK dependents)
DROP TABLE IF EXISTS market_metadata CASCADE;

-- Recreate with question_hash as primary key
CREATE TABLE market_metadata (
    question_hash TEXT PRIMARY KEY,
    market_id TEXT UNIQUE REFERENCES markets(id) ON DELETE CASCADE,
    question_text TEXT NOT NULL,
    description TEXT,
    outcome_labels JSONB NOT NULL,
    image_url TEXT,
    ipfs_cid TEXT,
    source_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE market_metadata ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read metadata" ON market_metadata FOR SELECT USING (true);
CREATE POLICY "Service write metadata" ON market_metadata FOR ALL TO service_role USING (true);
```

---

## Backfill — Link metadata to an existing market

> Run this if you already created a market on-chain before Migration 2.
> Replace the placeholder values with your actual data.

```sql
-- 1. Insert the metadata row (strip the "field" suffix from question_hash)
INSERT INTO market_metadata (question_hash, market_id, question_text, outcome_labels, ipfs_cid)
VALUES (
    '6707359502369661952091994494955693213625154595137132093699423655495102703081',
    '5508729568763946454431202067676963110735414664099531806433384906005672470229field',
    'YOUR QUESTION TEXT HERE',         -- replace with your actual question
    '["Yes", "No"]',                   -- replace with your actual outcome labels as JSON
    'YOUR_IPFS_CID_HERE'               -- replace with the CID from the upload response
)
ON CONFLICT (question_hash) DO UPDATE
    SET market_id = EXCLUDED.market_id;
```

---

## Migration 3 — v2 Contract Support (Run after deploying veilo_market_v2.aleo)

> 5 lines — adds two nullable columns; fully backwards-compatible with all existing v1 rows.

```sql
-- markets: track which on-chain program (v1 or v2, any token) created each market.
-- Required so the frontend routes vote_with_shares / claim_oracle_bonus to the correct program.
ALTER TABLE markets
  ADD COLUMN IF NOT EXISTS program_id TEXT;

CREATE INDEX IF NOT EXISTS idx_markets_program_id ON markets(program_id);

-- resolutions: store per-outcome share-vote weights from the v2 WeightTally mapping.
-- NULL on all v1 markets and v2 markets where no one called vote_with_shares.
-- Format: { "1": "5000000", "2": "2000000", ... } (same unit as outcome_bonds).
ALTER TABLE resolutions
  ADD COLUMN IF NOT EXISTS outcome_weights JSONB;
```

---

## Quick Reference

| Migration | When to run | Lines |
|-----------|-------------|-------|
| Migration 1 | Fresh Supabase project, no tables yet | 113 |
| Migration 2 | Already ran Migration 1, need to fix metadata schema | 16 |
| Migration 3 | After deploying v2 contracts | 5 |
| Backfill | Already have on-chain markets with no metadata linked | ~10 |


