
CREATE SCHEMA IF NOT EXISTS extensions;
DROP INDEX IF EXISTS public.idx_products_title_trgm;
ALTER EXTENSION pg_trgm SET SCHEMA extensions;
GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role;
CREATE INDEX idx_products_title_trgm ON public.products USING gin (title extensions.gin_trgm_ops);
