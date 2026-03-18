-- Warp quote cache (created at checkout rate fetch, used for auto-booking on order paid)
CREATE TABLE IF NOT EXISTS bc_quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rate_id TEXT UNIQUE NOT NULL,          -- returned as rate_id in BC quote response
  store_hash TEXT NOT NULL,
  warp_quote_id TEXT,                    -- Warp's quote ID for booking
  amount NUMERIC(10,2),
  transit_days INT,
  origin_zip TEXT,
  origin_street TEXT,
  dest_zip TEXT,
  dest_city TEXT,
  dest_state TEXT,
  is_residential BOOLEAN DEFAULT false,
  items_snapshot JSONB,
  total_weight_lbs NUMERIC(10,2),
  total_qty INT,
  length_in NUMERIC(8,2),
  width_in NUMERIC(8,2),
  height_in NUMERIC(8,2),
  commodity_name TEXT,
  customer_email TEXT,
  expires_at TIMESTAMPTZ,
  booked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bc_quotes_store_dest ON bc_quotes(store_hash, dest_zip);
CREATE INDEX IF NOT EXISTS idx_bc_quotes_rate_id ON bc_quotes(rate_id);

-- Warp bookings created from BC orders
CREATE TABLE IF NOT EXISTS bc_bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_hash TEXT NOT NULL,
  bc_order_id BIGINT NOT NULL,
  bc_quote_rate_id TEXT,
  warp_quote_id TEXT,
  warp_tracking_number TEXT,
  warp_shipment_id TEXT,
  amount NUMERIC(10,2),
  pickup_date TEXT,
  status TEXT DEFAULT 'booked',          -- booked | failed | cancelled
  error TEXT,
  raw_response JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_bc_bookings_order ON bc_bookings(store_hash, bc_order_id);
CREATE INDEX IF NOT EXISTS idx_bc_bookings_store ON bc_bookings(store_hash);

ALTER TABLE bc_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE bc_bookings ENABLE ROW LEVEL SECURITY;
