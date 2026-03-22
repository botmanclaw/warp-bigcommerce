// BigCommerce Shipping Provider API — unified rate endpoint
// Auto-detects cart type: Big & Bulky → 3 service levels | FTL → Request Capacity | LTL → standard rate
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { getWarpQuote, normalizeWeightToLbs, normalizeDimInches } from '@/lib/warp'

export const maxDuration = 30

const BB_WEIGHT_LBS = 150   // lbs per item
const BB_LENGTH_IN  = 96    // inches
const FTL_WEIGHT_LBS = 10000
const FTL_PALLETS    = 12

const BB_SERVICE_LEVELS = [
  { code: 'WARP_BB_THRESHOLD',   label: 'Threshold Delivery',  desc: 'Delivery to first dry area',             markup: 1.0  },
  { code: 'WARP_BB_ROOM',        label: 'Room of Choice',       desc: 'Placed in room of your choice',          markup: 1.15 },
  { code: 'WARP_BB_WHITE_GLOVE', label: '2-Man White Glove',    desc: 'Assembly, placement & debris removal',   markup: 1.35 },
]

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
  base_options: { origin: BCAddress; destination: BCAddress; items: BCItem[]; store_id: string; customer?: { email?: string } }
  connection_options?: Record<string, unknown>
}

export async function POST(req: NextRequest) {
  let body: BCRateRequest
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { base_options } = body
  const { origin, destination, items } = base_options
  const storeId = (base_options.store_id || '').replace(/^stores\//, '')
  console.log('[rate] storeId:', storeId, 'destZip:', destination?.zip, 'totalItems:', items?.length)

  const warpApiKey = process.env.WARP_API_KEY || ''
  if (!warpApiKey) return NextResponse.json({ quote_id: 'no_key', carrier_quotes: [], messages: [] })

  // Use merchant's configured origin ZIP from setup page (fallback to BC store origin)
  const { data: merchant } = await supabase.from('bc_merchants').select('origin_zip').eq('store_hash', storeId).single()
  const originZip = merchant?.origin_zip || origin.zip
  console.log('[rate] merchant originZip:', merchant?.origin_zip, 'fallback:', origin.zip, 'using:', originZip)

  // Aggregate cart
  let totalWeightLbs = 0, maxLength = 0, maxWidth = 0, maxHeight = 0, totalQty = 0, estimatedPallets = 0
  let commodityName = 'Freight'
  const itemSnapshots = []
  let hasBigBulkyItem = false

  for (const item of items) {
    const qty = item.quantity ?? 1
    const wLbs = normalizeWeightToLbs(item.weight.value, item.weight.units)
    const lenIn = normalizeDimInches(item.length.value, item.length.units)
    const widIn = normalizeDimInches(item.width.value,  item.width.units)
    const hgtIn = normalizeDimInches(item.height.value, item.height.units)
    totalWeightLbs += wLbs * qty
    totalQty += qty
    estimatedPallets += Math.ceil(qty * Math.max(1, lenIn / 48) * Math.max(1, widIn / 40))
    if (lenIn > maxLength) maxLength = lenIn
    if (widIn > maxWidth)  maxWidth  = widIn
    if (hgtIn > maxHeight) maxHeight = hgtIn
    if (item.name) commodityName = item.name
    if (wLbs >= BB_WEIGHT_LBS || lenIn >= BB_LENGTH_IN) hasBigBulkyItem = true
    itemSnapshots.push({ sku: item.sku, name: item.name, quantity: qty, weight_lbs: wLbs })
  }

  if (maxLength < 1) maxLength = 48
  if (maxWidth  < 1) maxWidth  = 40
  if (maxHeight < 1) maxHeight = 48
  if (totalQty < 1) totalQty = 1

  // Ensure minimum 100 lbs so Warp always returns a freight quote (LTL minimum)
  if (totalWeightLbs < 100) totalWeightLbs = 100
  console.log('[rate] totalWeightLbs (after floor):', totalWeightLbs)
  if (maxLength < 12) maxLength = 12
  if (maxWidth < 12) maxWidth = 12
  if (maxHeight < 12) maxHeight = 12

  const isFTL      = totalWeightLbs >= FTL_WEIGHT_LBS || estimatedPallets >= FTL_PALLETS
  const isBigBulky = hasBigBulkyItem && !isFTL
  const isResidential = destination.address_type?.toUpperCase() === 'RESIDENTIAL'

  // FTL: get real Warp FTL quote
  if (isFTL) {
    // Use pallet-based weight estimate if actual weight is too low for FTL (min 500 lbs/pallet)
    const ftlWeight = Math.max(totalWeightLbs, estimatedPallets * 500, 10000)
    const ftlQuoteParams = {
      pickupZipcode: originZip, dropoffZipcode: destination.zip,
      pickupCity: origin.city, pickupState: origin.state_iso2,
      dropoffCity: destination.city, dropoffState: destination.state_iso2,
      commodityName, totalWeight: ftlWeight, quantity: totalQty,
      length: Math.max(maxLength, 48), width: Math.max(maxWidth, 40), height: Math.max(maxHeight, 48),
      stackable: false, isResidentialDelivery: isResidential,
      shipmentType: 'FTL' as const,
    }
    const ftlRate = await getWarpQuote(warpApiKey, ftlQuoteParams)
    if (!ftlRate) return NextResponse.json({ quote_id: 'no_rates', carrier_quotes: [], messages: [] })

    const ts = Date.now()
    const rateId = `WARP_FTL_${ts}`
    const transitDays = ftlRate.transitDays ?? 3

    await supabase.from('bc_quotes').insert({
      rate_id: rateId, store_hash: storeId, warp_quote_id: ftlRate.quoteId,
      amount: ftlRate.totalCharge, transit_days: transitDays,
      origin_zip: originZip, dest_zip: destination.zip,
      dest_city: destination.city, dest_state: destination.state_iso2,
      is_residential: isResidential, items_snapshot: itemSnapshots,
      total_weight_lbs: Math.round(ftlWeight), total_qty: totalQty,
      length_in: Math.round(Math.max(maxLength, 48)), width_in: Math.round(Math.max(maxWidth, 40)), height_in: Math.round(Math.max(maxHeight, 48)),
      commodity_name: commodityName, customer_email: base_options.customer?.email,
      expires_at: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
    }).then(() => {})

    return NextResponse.json({
      quote_id: rateId, messages: [],
      carrier_quotes: [{
        carrier_info: { code: 'carrier_573', display_name: 'Warp Freight' },
        quotes: [{ code: rateId, display_name: 'Warp FTL', rate_id: rateId, cost: { currency: 'USD', amount: ftlRate.totalCharge }, transit_time: { units: 'BUSINESS_DAYS', duration: transitDays } }],
      }],
    })
  }

  const baseQuoteParams = {
    pickupZipcode: originZip, dropoffZipcode: destination.zip,
    pickupCity: origin.city, pickupState: origin.state_iso2,
    dropoffCity: destination.city, dropoffState: destination.state_iso2,
    commodityName, totalWeight: totalWeightLbs, quantity: totalQty,
    length: maxLength, width: maxWidth, height: maxHeight,
    stackable: false, isResidentialDelivery: isResidential,
  }

  try {
    // Big & Bulky: single quote, 3 price tiers via markup
    if (isBigBulky) {
      const bbRate = await getWarpQuote(warpApiKey, baseQuoteParams)
      if (!bbRate) return NextResponse.json({ quote_id: 'no_rates', carrier_quotes: [], messages: [] })

      const ts = `${Date.now()}_${Math.random().toString(36).slice(2, 5)}`
      const priceThreshold = bbRate.totalCharge
      const priceRoom = parseFloat((priceThreshold * 1.15).toFixed(2))
      const priceWG  = parseFloat((priceThreshold * 1.35).toFixed(2))
      const transitDays = bbRate.transitDays ?? 5

      // Save 3 rows (same warp_quote_id) so webhook can match by tier-coded rate_id
      await supabase.from('bc_quotes').insert([
        { rate_id: `WARP_BB_THRESHOLD_${ts}`, store_hash: storeId, warp_quote_id: bbRate.quoteId, amount: priceThreshold, transit_days: transitDays, origin_zip: originZip, dest_zip: destination.zip, dest_city: destination.city, dest_state: destination.state_iso2, is_residential: isResidential, items_snapshot: itemSnapshots, total_weight_lbs: Math.round(totalWeightLbs), total_qty: totalQty, length_in: Math.round(maxLength), width_in: Math.round(maxWidth), height_in: Math.round(maxHeight), commodity_name: commodityName, customer_email: base_options.customer?.email, expires_at: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString() },
        { rate_id: `WARP_BB_ROOM_${ts}`,      store_hash: storeId, warp_quote_id: bbRate.quoteId, amount: priceRoom,      transit_days: transitDays, origin_zip: originZip, dest_zip: destination.zip, dest_city: destination.city, dest_state: destination.state_iso2, is_residential: isResidential, items_snapshot: itemSnapshots, total_weight_lbs: Math.round(totalWeightLbs), total_qty: totalQty, length_in: Math.round(maxLength), width_in: Math.round(maxWidth), height_in: Math.round(maxHeight), commodity_name: commodityName, customer_email: base_options.customer?.email, expires_at: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString() },
        { rate_id: `WARP_BB_WG_${ts}`,        store_hash: storeId, warp_quote_id: bbRate.quoteId, amount: priceWG,        transit_days: transitDays, origin_zip: originZip, dest_zip: destination.zip, dest_city: destination.city, dest_state: destination.state_iso2, is_residential: isResidential, items_snapshot: itemSnapshots, total_weight_lbs: Math.round(totalWeightLbs), total_qty: totalQty, length_in: Math.round(maxLength), width_in: Math.round(maxWidth), height_in: Math.round(maxHeight), commodity_name: commodityName, customer_email: base_options.customer?.email, expires_at: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString() },
      ])

      return NextResponse.json({
        quote_id: `WARP_BB_${ts}`, messages: [],
        carrier_quotes: [{
          carrier_info: { code: 'carrier_573', display_name: 'Warp Big & Bulky' },
          quotes: [
            { code: `WARP_BB_THRESHOLD_${ts}`, display_name: 'Threshold Delivery', description: 'Delivery to first dry area',          rate_id: `WARP_BB_THRESHOLD_${ts}`, cost: { currency: 'USD', amount: priceThreshold }, transit_time: { units: 'BUSINESS_DAYS', duration: transitDays } },
            { code: `WARP_BB_ROOM_${ts}`,      display_name: 'Room of Choice',      description: 'Placed in room of your choice',      rate_id: `WARP_BB_ROOM_${ts}`,      cost: { currency: 'USD', amount: priceRoom },      transit_time: { units: 'BUSINESS_DAYS', duration: transitDays } },
            { code: `WARP_BB_WG_${ts}`,        display_name: '2-Man White Glove',   description: 'Assembly, placement & debris removal', rate_id: `WARP_BB_WG_${ts}`,      cost: { currency: 'USD', amount: priceWG },        transit_time: { units: 'BUSINESS_DAYS', duration: transitDays } },
          ],
        }],
      })
    }

    const rate = await getWarpQuote(warpApiKey, baseQuoteParams)

    if (!rate) return NextResponse.json({ quote_id: 'no_rates', carrier_quotes: [], messages: [] })

    const rateId = `warp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`

    await supabase.from('bc_quotes').insert({
      rate_id: rateId, store_hash: storeId, warp_quote_id: rate.quoteId,
      amount: rate.totalCharge, transit_days: rate.transitDays,
      origin_zip: originZip, dest_zip: destination.zip,
      dest_city: destination.city, dest_state: destination.state_iso2,
      is_residential: isResidential, items_snapshot: itemSnapshots,
      total_weight_lbs: Math.round(totalWeightLbs), total_qty: totalQty,
      length_in: Math.round(maxLength), width_in: Math.round(maxWidth), height_in: Math.round(maxHeight),
      commodity_name: commodityName, customer_email: base_options.customer?.email,
      expires_at: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
    })

    // Standard LTL
    return NextResponse.json({
      quote_id: rateId, messages: [],
      carrier_quotes: [{
        carrier_info: { code: 'carrier_573', display_name: 'Warp' },
        quotes: [{
          code: `WARP_LTL_${rateId}`, display_name: 'Warp LTL', rate_id: rateId,
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
