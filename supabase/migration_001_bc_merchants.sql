-- BigCommerce merchant registry
-- Run this in your Supabase SQL editor

CREATE TABLE IF NOT EXISTS bc_merchants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_hash TEXT UNIQUE NOT NULL,
  access_token TEXT NOT NULL,
  email TEXT,
  warp_api_key TEXT,
  installed_at TIMESTAMPTZ DEFAULT NOW(),
  configured_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bc_merchants_store_hash ON bc_merchants(store_hash);

-- RLS: only service role can access (all reads/writes via API routes with service key)
ALTER TABLE bc_merchants ENABLE ROW LEVEL SECURITY;
