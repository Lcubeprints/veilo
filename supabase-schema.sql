-- ============================================================================
-- VEILO — Supabase Schema (v2-ready, fresh start)
-- ============================================================================

-- Markets (indexed from on-chain)
CREATE TABLE markets (
    id TEXT PRIMARY KEY,
    program_id TEXT,                          -- v2: which on-chain program created this market
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
CREATE INDEX idx_markets_program_id ON markets(program_id);

-- Market metadata (from IPFS)
-- question_hash is the primary key so metadata can be stored before market_id is known on-chain.
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
    outcome_weights JSONB,                    -- v2: share-vote weights per outcome (NULL on v1 markets)
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

-- ============================================================================
-- Seed indexer cursor at current block (skip old history)
-- ============================================================================

INSERT INTO indexer_cursor (id, last_block) VALUES ('singleton', 15386310);


