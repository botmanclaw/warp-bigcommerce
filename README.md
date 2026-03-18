# Warp Freight for BigCommerce

Live LTL freight rates at checkout, powered by Warp's carrier network.

## What it does

When a shopper checks out on a BigCommerce store, this app provides real-time Warp LTL freight rates. Rates are calculated dynamically based on:

- Origin ZIP (from store shipping origin)
- Destination ZIP (shopper's address)
- Item dimensions + weight (from product catalog)
- Address type (residential surcharge auto-applied)

## Architecture

```
Shopper checks out
  → BigCommerce calls POST /api/rate
    → App aggregates item weights/dims
      → Calls Warp /freights/quote
        → Returns carrier_quotes to BigCommerce
          → Shopper sees "Warp LTL — $XXX.XX (3 business days)"
```

## API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/api/rate` | POST | Main rate endpoint (BC Shipping Provider API) |
| `/api/check_connection` | POST | Credential validation (BC Shipping Provider API) |
| `/api/auth` | GET | BC OAuth callback — exchanges code for access_token |
| `/api/install` | GET | Initiates BC OAuth flow |
| `/api/save-key` | POST | Saves merchant's Warp API key |
| `/setup` | GET | Merchant config iFrame (shown inside BC control panel) |

## BigCommerce Registration

1. Create a draft app at [devtools.bigcommerce.com](https://devtools.bigcommerce.com)
2. Get your App ID from the URL
3. Email `shippingproviderapi@bigcommerce.com` with:
   - App name: "Warp Freight"
   - App ID
   - Partner ID
   - Rate URL: `https://warp-bigcommerce.vercel.app/api/rate`
   - Check connection URL: `https://warp-bigcommerce.vercel.app/api/check_connection`
   - Type: **multi-carrier**
4. They issue a **Carrier ID** (e.g. `carrier_33`) — store this in env vars

## Setup

```bash
npm install
cp .env.example .env.local
# Fill in .env.local with your credentials
npm run dev
```

## Database

Run `supabase/migration_001_bc_merchants.sql` in your Supabase SQL editor.

## Deployment

Deploy to Vercel. Set all env vars from `.env.example` in Vercel project settings.

Register OAuth callback URL in BC Developer Portal:
- Auth callback: `https://warp-bigcommerce.vercel.app/api/auth`
- Load callback: `https://warp-bigcommerce.vercel.app/setup`
