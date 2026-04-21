-- =============================================================================
-- 0001_init.sql — U4 schema for the gurbani-search project
-- =============================================================================
-- Three tables:
--   shabads           — canonical SGGS corpus (public read in later units via RLS)
--   shabad_embeddings — BGE-M3 1024-dim halfvec; HNSW index for cosine search
--   caption_cache     — server-side cache for live-query captions
--
-- There is intentionally NO `query_log` table. User queries may be deeply
-- personal religious content (grief, doubt, shame). Storing them indefinitely
-- in plaintext is inconsistent with the project's trust posture. Latency and
-- error metrics are captured via Vercel runtime logs. See plan §U4.
-- =============================================================================

-- Extensions. pgvector provides halfvec + HNSW; pg_trgm backs lexical retrieval.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- -----------------------------------------------------------------------------
-- shabads — one row per shabad
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.shabads (
    shabad_id        text PRIMARY KEY,
    gurmukhi         text NOT NULL,
    gurmukhi_display text NOT NULL,
    transliteration  text NOT NULL DEFAULT '',
    translation_bms  text NOT NULL,
    ang              int  NOT NULL CHECK (ang BETWEEN 1 AND 1430),
    author           text NOT NULL DEFAULT '',
    raag             text NOT NULL DEFAULT '',
    line_count       int  NOT NULL CHECK (line_count >= 1),
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
);

-- Fast filters + range queries used by shabad-detail page (U12) and adjacent
-- shabads (U14, v1.1).
CREATE INDEX IF NOT EXISTS shabads_ang_idx    ON public.shabads (ang);
CREATE INDEX IF NOT EXISTS shabads_author_idx ON public.shabads (author);
CREATE INDEX IF NOT EXISTS shabads_raag_idx   ON public.shabads (raag);

-- GIN trigram indexes power the pg_trgm BM25-ish lexical signal that U5's
-- hybrid search layers on top of vector cosine similarity. One index per
-- searchable text column.
CREATE INDEX IF NOT EXISTS shabads_gurmukhi_trgm_idx
    ON public.shabads USING GIN (gurmukhi gin_trgm_ops);
CREATE INDEX IF NOT EXISTS shabads_transliteration_trgm_idx
    ON public.shabads USING GIN (transliteration gin_trgm_ops);
CREATE INDEX IF NOT EXISTS shabads_translation_bms_trgm_idx
    ON public.shabads USING GIN (translation_bms gin_trgm_ops);

-- -----------------------------------------------------------------------------
-- shabad_embeddings — one row per shabad (1:1 with shabads)
-- -----------------------------------------------------------------------------
-- halfvec(1024) = 16-bit halfs, half the storage of vector(1024). Supabase
-- free tier has a tight DB size budget and halfvec recall is within 0.5%
-- of full-precision at this corpus size.
CREATE TABLE IF NOT EXISTS public.shabad_embeddings (
    shabad_id         text PRIMARY KEY
        REFERENCES public.shabads(shabad_id) ON DELETE CASCADE,
    embedding_english halfvec(1024) NOT NULL,
    created_at        timestamptz NOT NULL DEFAULT now()
);

-- HNSW index on the halfvec cosine-ops opclass. Parameters per plan: m=16,
-- ef_construction=64. Small corpus so build time is seconds.
-- The index is created AFTER bulk load in seed_supabase.py to keep the
-- initial INSERTs fast; the CREATE INDEX IF NOT EXISTS here is defensive
-- for a fresh database where no seed has run yet.
CREATE INDEX IF NOT EXISTS shabad_embeddings_english_hnsw_idx
    ON public.shabad_embeddings
    USING hnsw (embedding_english halfvec_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- -----------------------------------------------------------------------------
-- caption_cache — live-query AI caption cache
-- -----------------------------------------------------------------------------
-- Keyed by SHA-256 of the normalized query string (lowercase + NFC + whitespace
-- collapse + strip trailing punct — spec lives in lib/caption.ts, U6) plus the
-- shabad_id. A single `explanation=''` row denotes the "no-explanation" marker
-- so a known-bad (query, shabad) pair is not regenerated repeatedly.
CREATE TABLE IF NOT EXISTS public.caption_cache (
    query_hash  text NOT NULL,
    shabad_id   text NOT NULL
        REFERENCES public.shabads(shabad_id) ON DELETE CASCADE,
    explanation text NOT NULL DEFAULT '',
    confidence  text NOT NULL DEFAULT 'low'
        CHECK (confidence IN ('high', 'medium', 'low')),
    created_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (query_hash, shabad_id)
);

-- Lookup by query_hash alone is the common path from U11's SSE endpoint.
CREATE INDEX IF NOT EXISTS caption_cache_query_hash_idx
    ON public.caption_cache (query_hash);

-- -----------------------------------------------------------------------------
-- Row-level security
-- -----------------------------------------------------------------------------
-- RLS is enforced with explicit policies rather than relying on the default
-- "allow nothing" fallback — this documents intent and survives a future
-- Supabase default change. All write paths are server-only via the service
-- key, which bypasses RLS.
ALTER TABLE public.shabads           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shabad_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.caption_cache     ENABLE ROW LEVEL SECURITY;

-- anon + authenticated can READ the corpus. No write policy → writes denied.
DROP POLICY IF EXISTS shabads_read_all ON public.shabads;
CREATE POLICY shabads_read_all ON public.shabads
    FOR SELECT
    USING (true);

-- Embeddings are used via an RPC (stable_predictable_search, created in U5).
-- Reads are allowed for completeness; practical queries go through the RPC.
DROP POLICY IF EXISTS shabad_embeddings_read_all ON public.shabad_embeddings;
CREATE POLICY shabad_embeddings_read_all ON public.shabad_embeddings
    FOR SELECT
    USING (true);

-- caption_cache is server-only. No SELECT/INSERT/UPDATE policies for anon or
-- authenticated. Server-side code uses the service key which bypasses RLS.
-- (No policy block intentionally.)

-- -----------------------------------------------------------------------------
-- Maintenance helpers — kept minimal
-- -----------------------------------------------------------------------------
-- Keep updated_at fresh on shabads rows (used to detect corpus refreshes).
CREATE OR REPLACE FUNCTION public.tg_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS shabads_set_updated_at ON public.shabads;
CREATE TRIGGER shabads_set_updated_at
    BEFORE UPDATE ON public.shabads
    FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
