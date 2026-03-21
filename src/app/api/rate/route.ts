// BigCommerce Shipping Provider API — LTL rate endpoint
// Returns a single Warp LTL freight rate for the cart
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { getWarpQuote, normalizeWeightToLbs, normalizeDimInches } from '@/lib/warp'

export const maxDuration = 30

interface BCItem {
  sku: string; variant_id: string; product_id: string; name: string
  length: { units: string; value: number }
  width:  { units: string; value: number }
  height: { units: string; value: number }
  weight: { units: string; value: number }
  quantity: number
}
interface BCAddress {
  street_1?: string; zip: string; city?: string
  state_iso2?: string; country_iso2?: string; address_type?: string
}
interface BCRateRequest {
  base_options: {
    origin: BCAddress; destination: BCAddress; items: BCItem[]
    store_id: string; customer?: { email?: string }
  }
  connection_options?: Record<string, unknown>
  zone_options?: Record<string, unknown>
}

export async function POST(req: NextRequest) {
  let body: BCRateRequest
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { base_options } = body
  const { origin, destination, items } = base_options
  const storeId = (base_options.store_id || '').replace(/^stores\//, '')

  const warpApiKey = process.env.WARP_API_KEY || ''
  if (!warpApiKey) return NextResponse.json({ quote_id: 'no_key', carrier_quotes: [], messages: [] })

  // Aggregate cart
  let totalWeightLbs = 0, maxLength = 0, maxWidth = 0, maxHeight = 0, totalQty = 0
  let commodityName = 'Freight'
  const itemSnapshots = []

  for (const item of items) {
    const qty = item.quantity ?? 1
    const wLbs = normalizeWeightToLbs(item.weight.value, item.weight.units)
    const lenIn = normalizeDimInches(item.length.value, item.length.units)
    const widIn = normalizeDimInches(item.width.value,  item.width.units)
    const hgtIn = normalizeDimInches(item.height.value, item.height.units)
    totalWeightLbs += wLbs * qty
    totalQty += qty
    if (lenIn > maxLength) maxLength = lenIn
    if (widIn > maxWidth)  maxWidth  = widIn
    if (hgtIn > maxHeight) maxHeight = hgtIn
    if (item.name) commodityName = item.name
    itemSnapshots.push({ sku: item.sku, name: item.name, quantity: qty, weight_lbs: wLbs })
  }

  if (maxLength < 1) maxLength = 48
  if (maxWidth  < 1) maxWidth  = 40
  if (maxHeight < 1) maxHeight = 48
  if (totalWeightLbs < 1) totalWeightLbs = 150
  if (totalQty < 1) totalQty = 1

  const isResidential = destination.address_type?.toUpperCase() === 'RESIDENTIAL'

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
      isResidentialDelivery: isResidential,
    })

    if (!rate) return NextResponse.json({ quote_id: 'no_rates', carrier_quotes: [], messages: [] })

    const rateId = `warp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`

    await supabase.from('bc_quotes').insert({
      rate_id: rateId,
      store_hash: storeId,
      warp_quote_id: rate.quoteId,
      amount: rate.totalCharge,
      transit_days: rate.transitDays,
      origin_zip: origin.zip,
      dest_zip: destination.zip,
      dest_city: destination.city,
      dest_state: destination.state_iso2,
      is_residential: isResidential,
      items_snapshot: itemSnapshots,
      total_weight_lbs: Math.round(totalWeightLbs),
      total_qty: totalQty,
      length_in: Math.round(maxLength),
      width_in: Math.round(maxWidth),
      height_in: Math.round(maxHeight),
      commodity_name: commodityName,
      customer_email: base_options.customer?.email,
      expires_at: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
    })

    return NextResponse.json({
      quote_id: rateId,
      messages: [],
      carrier_quotes: [{
        carrier_info: { code: 'carrier_573', display_name: 'Warp' },
        quotes: [{
          code: `WARP_LTL_${rateId}`,
          display_name: 'Warp LTL',
          rate_id: rateId,
          cost: { currency: 'USD', amount: rate.totalCharge },
          description: 'Freight shipping via Warp',
          transit_time: { units: 'BUSINESS_DAYS', duration: rate.transitDays ?? 5 },
        }],
      }],
    })
  } catch (err) {
    console.error('[warp-bc] rate error:', err)
    return NextResponse.json({ quote_id: 'error', carrier_quotes: [], messages: [] })
  }
}
