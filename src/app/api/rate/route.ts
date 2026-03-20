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
  zip: string
  city?: string
  state_iso2?: string
  country_iso2?: string
  address_type?: string
}

interface BCRateRequest {
  base_options: {
    origin: BCAddress
    destination: BCAddress
    items: BCItem[]
    store_id: string
    customer?: { email?: string }
  }
  connection_options?: { warp_api_key?: string }
  zone_options?: Record<string, unknown>
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
  const storeId = (base_options.store_id || '').replace(/^stores\//, '')

  // Always use centralized Warp API key — merchants don't have their own keys
  const warpApiKey = process.env.WARP_API_KEY || ''

  if (!warpApiKey) {
    return NextResponse.json({
      quote_id: 'no_key',
      carrier_quotes: [],
      messages: [{ text: 'Warp not configured', type: 'ERROR' }],
    })
  }

  // Fetch merchant contact info for booking
  const { data: merchant } = await supabase.from('bc_merchants').select('company_name,contact_name,contact_phone').eq('store_hash', storeId).single()

  // Aggregate items
  let totalWeightLbs = 0, maxLength = 0, maxWidth = 0, maxHeight = 0, totalQty = 0
  let commodityName = 'Freight'
  const itemSnapshots = []

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
    itemSnapshots.push({ sku: item.sku, name: item.name, quantity: item.quantity, weight_lbs: weightLbs })
  }

  if (maxLength < 1) maxLength = 48
  if (maxWidth < 1) maxWidth = 40
  if (maxHeight < 1) maxHeight = 48
  if (totalWeightLbs < 1) totalWeightLbs = 150
  if (totalQty < 1) totalQty = 1

  const isResidentialDelivery = destination.address_type?.toUpperCase() === 'RESIDENTIAL'

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

    // Save quote to Supabase so we can book later when order comes in
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
      is_residential: isResidentialDelivery,
      items_snapshot: itemSnapshots,
      total_weight_lbs: Math.round(totalWeightLbs),
      total_qty: totalQty,
      length_in: Math.round(maxLength),
      width_in: Math.round(maxWidth),
      height_in: Math.round(maxHeight),
      commodity_name: commodityName,
      customer_email: base_options.customer?.email,
      expires_at: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(), // 4hr TTL
    })

    return NextResponse.json({
      quote_id: rateId,
      carrier_quotes: [{
        carrier_info: { code: 'carrier_573', display_name: 'Warp' },
        quotes: [{
          code: 'WARP_LTL',
          display_name: 'Warp LTL',
          rate_id: rateId, // BC passes this back in order data
          cost: { currency: 'USD', amount: rate.totalCharge },
          description: 'Freight shipping via Warp',
          ...(rate.transitDays && {
            transit_time: { units: 'BUSINESS_DAYS', duration: rate.transitDays },
          }),
        }],
      }],
      messages: [],
    })
  } catch (err) {
    console.error('[warp-bc] rate error:', err)
    return NextResponse.json({
      quote_id: 'error',
      carrier_quotes: [],
      messages: [{ text: 'Warp rate service temporarily unavailable', type: 'WARNING' }],
    })
  }
}
