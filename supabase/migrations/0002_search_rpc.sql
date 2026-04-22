-- =============================================================================
-- 0002_search_rpc.sql — U5 hybrid search RPC
-- =============================================================================
-- Exposes a single stable function `public.search_hybrid(q_embedding, q_text, k)`
-- that combines vector cosine similarity (70%) with pg_trgm word_similarity
-- against the English translation (30%) and returns the top-k shabads joined
-- with their scripture fields.
--
-- Called from lib/search.ts via Supabase JS .rpc(). Runs as SECURITY INVOKER
-- under the anon key; SELECT policies on shabads and shabad_embeddings (from
-- 0001_init.sql) grant the read access needed. No row-level write is performed.
-- =============================================================================

-- Drop and recreate so reruns apply new logic cleanly. The function is not
-- referenced by any persisted view so dropping it is safe.
DROP FUNCTION IF EXISTS public.search_hybrid(halfvec, text, int);

CREATE OR REPLACE FUNCTION public.search_hybrid(
    q_embedding halfvec(1024),
    q_text      text,
    k           int DEFAULT 10
)
RETURNS TABLE (
    shabad_id          text,
    gurmukhi_display   text,
    transliteration    text,
    translation_bms    text,
    translation_source text,
    ang                int,
    author             text,
    raag               text,
    score              double precision,
    dense_score        double precision,
    lexical_score      double precision
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
    -- cosine_distance is in [0, 2]; similarity = 1 - distance in [-1, 1],
    -- but for our normalized embeddings we clamp to [0, 1] by max(0, ...).
    SELECT
        s.shabad_id,
        s.gurmukhi_display,
        s.transliteration,
        s.translation_bms,
        s.translation_source,
        s.ang,
        s.author,
        s.raag,
        (0.7 * GREATEST(0.0, 1.0 - (e.embedding_english <=> q_embedding))
         + 0.3 * COALESCE(word_similarity(q_text, s.translation_bms), 0.0))
            ::double precision                                AS score,
        GREATEST(0.0, 1.0 - (e.embedding_english <=> q_embedding))::double precision AS dense_score,
        COALESCE(word_similarity(q_text, s.translation_bms), 0.0)::double precision  AS lexical_score
    FROM public.shabad_embeddings AS e
    JOIN public.shabads            AS s ON s.shabad_id = e.shabad_id
    ORDER BY
        (0.7 * GREATEST(0.0, 1.0 - (e.embedding_english <=> q_embedding))
         + 0.3 * COALESCE(word_similarity(q_text, s.translation_bms), 0.0)) DESC
    LIMIT GREATEST(1, LEAST(k, 50));
$$;

-- Expose to anon + authenticated. The function body runs as the caller so
-- RLS still applies; the SELECT policies on the underlying tables
-- (shabads_read_all, shabad_embeddings_read_all) grant the read path.
GRANT EXECUTE ON FUNCTION public.search_hybrid(halfvec, text, int)
    TO anon, authenticated, service_role;
