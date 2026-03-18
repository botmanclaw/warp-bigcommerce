// BigCommerce Shipping Provider API — rate endpoint
// BC calls this when a shopper checks out and needs shipping options
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { getWarpQuote, normalizeWeightToLbs, normalizeDimInches } from '@/lib/warp'

export const maxDuration = 30

interface BCItem {
  sku: string
  variant_id: string
  product_id: string
  name: string
  length: { units: string; value: number }
  width: { units: string; value: number }
  height: { units: string; value: number }
  weight: { units: string; value: number }
  quantity: number
}

interface BCAddress {
  street_1?: string
  street_2?: string
  zip: string
  city?: string
  state_iso2?: string
  country_iso2?: string
  address_type?: string // RESIDENTIAL | COMMERCIAL
}

interface BCRateRequest {
  base_options: {
    origin: BCAddress
    destination: BCAddress
    items: BCItem[]
    store_id: string
    customer?: { email?: string }
  }
  connection_options?: {
    warp_api_key?: string
  }
  zone_options?: Record<string, unknown>
}

function buildCarrierQuotes(rate: number, transitDays: number | null) {
  const quotes = [
    {
      code: 'WARP_LTL',
      display_name: 'Warp LTL',
      cost: { currency: 'USD', amount: rate },
      description: 'Freight shipping via Warp',
      ...(transitDays && {
        transit_time: { units: 'BUSINESS_DAYS', duration: transitDays },
      }),
    },
  ]
  return quotes
}

export async function POST(req: NextRequest) {
  let body: BCRateRequest
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { base_options, connection_options } = body
  const { origin, destination, items } = base_options
  const storeId = base_options.store_id

  // Get Warp API key — prefer connection_options (per-merchant), fallback to env
  let warpApiKey = connection_options?.warp_api_key || ''

  if (!warpApiKey && storeId) {
    const { data } = await supabase
      .from('bc_merchants')
      .select('warp_api_key')
      .eq('store_hash', storeId)
      .single()
    warpApiKey = data?.warp_api_key || ''
  }

  if (!warpApiKey) {
    warpApiKey = process.env.WARP_API_KEY || ''
  }

  if (!warpApiKey) {
    return NextResponse.json({ quote_id: 'no_key', carrier_quotes: [], messages: [{ text: 'Warp API key not configured', type: 'ERROR' }] })
  }

  // Aggregate items — total weight, pick largest dims (freight class logic)
  let totalWeightLbs = 0
  let maxLength = 0, maxWidth = 0, maxHeight = 0
  let totalQty = 0
  let commodityName = 'Freight'

  for (const item of items) {
    const weightLbs = normalizeWeightToLbs(item.weight.value, item.weight.units)
    totalWeightLbs += weightLbs * item.quantity
    totalQty += item.quantity

    const lenIn = normalizeDimInches(item.length.value, item.length.units)
    const widIn = normalizeDimInches(item.width.value, item.width.units)
    const hgtIn = normalizeDimInches(item.height.value, item.height.units)

    if (lenIn > maxLength) maxLength = lenIn
    if (widIn > maxWidth) maxWidth = widIn
    if (hgtIn > maxHeight) maxHeight = hgtIn

    if (item.name) commodityName = item.name
  }

  // Enforce minimum dimensions (pallet defaults)
  if (maxLength < 1) maxLength = 48
  if (maxWidth < 1) maxWidth = 40
  if (maxHeight < 1) maxHeight = 48
  if (totalWeightLbs < 1) totalWeightLbs = 150
  if (totalQty < 1) totalQty = 1

  const isResidentialDelivery =
    destination.address_type?.toUpperCase() === 'RESIDENTIAL'

  try {
    const rate = await getWarpQuote(warpApiKey, {
      pickupZipcode: origin.zip,
      dropoffZipcode: destination.zip,
      pickupCity: origin.city,
      pickupState: origin.state_iso2,
      dropoffCity: destination.city,
      dropoffState: destination.state_iso2,
      commodityName,
      totalWeight: totalWeightLbs,
      quantity: totalQty,
      length: maxLength,
      width: maxWidth,
      height: maxHeight,
      stackable: false,
      isResidentialDelivery,
    })

    if (!rate) {
      return NextResponse.json({
        quote_id: 'no_rates',
        carrier_quotes: [],
        messages: [{ text: 'No Warp rates available for this route', type: 'INFO' }],
      })
    }

    return NextResponse.json({
      quote_id: rate.quoteId || `warp_${Date.now()}`,
      carrier_quotes: [
        {
          carrier_info: { code: 'warp', display_name: 'Warp' },
          quotes: buildCarrierQuotes(rate.totalCharge, rate.transitDays),
        },
      ],
      messages: [],
    })
  } catch (err) {
    console.error('[warp-bigcommerce] rate error:', err)
    return NextResponse.json({
      quote_id: 'error',
      carrier_quotes: [],
      messages: [{ text: 'Warp rate service temporarily unavailable', type: 'WARNING' }],
    })
  }
}
