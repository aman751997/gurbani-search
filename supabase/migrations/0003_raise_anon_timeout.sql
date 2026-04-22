-- =============================================================================
-- 0003_raise_anon_timeout.sql — raise the `anon` role's statement_timeout
-- =============================================================================
-- The default Supabase `anon` role has a 3s statement_timeout. Our search RPC
-- runs an HNSW cosine query on shabad_embeddings; when the HNSW index is cold
-- (Supabase free tier evicts the index from memory after idle periods) the
-- first query of the day can take ~5s because Postgres has to page the index
-- back from disk. Subsequent queries return in < 100ms.
--
-- Under the default 3s cap, that first query aborts with
--     57014: canceling statement due to statement timeout
-- and /api/search returns 503 to the user.
--
-- Raise the anon statement_timeout to 10s. This:
--   - does NOT change authenticated or service_role timeouts,
--   - does NOT change the GLOBAL database timeout (role-scoped only),
--   - leaves the overall request budget safe — Vercel Hobby's serverless
--     execution cap is 10s on Node routes and 25s on Edge routes.
--
-- Apply via the Supabase SQL Editor. This migration is intentionally NOT
-- applied by the app's migration runner — it alters a Postgres role,
-- which we want to perform by hand against the live project.
-- =============================================================================

ALTER ROLE anon SET statement_timeout = '10s';

-- Verification query (run manually after applying):
--   SELECT rolname, rolconfig FROM pg_roles WHERE rolname = 'anon';
-- Expected: rolconfig contains `statement_timeout=10s`.
