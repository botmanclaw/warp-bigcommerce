// BigCommerce webhook — store/order/statusUpdated
// Fires when an order status changes. When paid/confirmed + uses Warp rate → auto-book Warp shipment.
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { getBCOrder, getBCOrderShippingAddresses, getBCOrderProducts } from '@/lib/bigcommerce'
import { bookWarpShipment, nextBusinessDay, normalizeWeightToLbs } from '@/lib/warp'

// BC order statuses that indicate payment confirmed / ready to ship
const PAID_STATUSES = [
  'Awaiting Fulfillment',   // status_id: 11
  'Awaiting Shipment',      // status_id: 9
  'Partially Shipped',      // status_id: 3
]

interface BCWebhookPayload {
  store_id: string
  producer: string
  scope: string
  data: {
    type: string
    id: number
    status?: { id: number; label: string }
    new_status_id?: number
  }
}

export async function POST(req: NextRequest) {
  let payload: BCWebhookPayload
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 })
  }

  // Only handle order status updates
  if (payload.scope !== 'store/order/statusUpdated') {
    return NextResponse.json({ ok: true, skipped: 'wrong scope' })
  }

  const orderId = payload.data?.id
  // BC webhook: store_id is numeric; store hash is in producer field ("stores/2fbcpsw0sb")
  const storeHash = payload.producer?.replace('stores/', '')

  if (!orderId || !storeHash) {
    return NextResponse.json({ ok: false, error: 'Missing order ID or store hash' }, { status: 400 })
  }

  // Get merchant credentials
  const { data: merchant } = await supabase
    .from('bc_merchants')
    .select('access_token')
    .eq('store_hash', storeHash)
    .single()

  if (!merchant?.access_token) {
    return NextResponse.json({ ok: false, error: 'Merchant not configured' })
  }

  // Fetch the order
  const order = await getBCOrder(storeHash, process.env.BC_STORE_API_TOKEN || merchant.access_token, orderId)
  if (!order) return NextResponse.json({ ok: false, error: 'Order not found' })

  // Only proceed on paid/ready statuses
  if (!PAID_STATUSES.includes(order.status)) {
    return NextResponse.json({ ok: true, skipped: `status: ${order.status}` })
  }

  // Fetch shipping address first — use its ZIP for quote matching (billing ZIP ≠ ship-to ZIP)
  const shippingAddressesEarly = await getBCOrderShippingAddresses(storeHash, process.env.BC_STORE_API_TOKEN || merchant.access_token, orderId)
  const shipToEarly = shippingAddressesEarly?.[0]
  const destZip = (shipToEarly?.zip || order.billing_address?.zip || '').replace(/\s/g, '').slice(0, 5)

  console.log('[webhook] storeHash:', storeHash, 'destZip:', destZip)

  // Look up the saved quote — match by store + shipping dest zip + unbooked + not expired
  const { data: savedQuote, error: quoteErr } = await supabase
    .from('bc_quotes')
    .select('*')
    .eq('store_hash', storeHash)
    .eq('dest_zip', destZip)
    .is('booked_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  console.log('[webhook] savedQuote:', savedQuote?.rate_id, 'quoteErr:', quoteErr?.message)
  if (!savedQuote?.warp_quote_id) {
    // No matching Warp quote found — not a Warp order or quote expired
    return NextResponse.json({ ok: true, skipped: 'No matching Warp quote found' })
  }

  // Check if already booked (idempotency)
  const { data: existing } = await supabase
    .from('bc_bookings')
    .select('id')
    .eq('bc_order_id', orderId)
    .eq('store_hash', storeHash)
    .single()

  if (existing) {
    return NextResponse.json({ ok: true, skipped: 'Already booked' })
  }

  // Fetch shipping address and products
  const [, products] = await Promise.all([
    Promise.resolve(shippingAddressesEarly),
    getBCOrderProducts(storeHash, process.env.BC_STORE_API_TOKEN || merchant.access_token, orderId),
  ])

  const shipTo = shipToEarly
  if (!shipTo) return NextResponse.json({ ok: false, error: 'No shipping address' })

  // Build items list from order products
  const listItems = (products || []).map((p: {
    name: string
    quantity: number
    weight?: number
    depth?: number
    width?: number
    height?: number
  }) => ({
    name: p.name || 'Item',
    packaging: 'PALLET',
    height: Math.max(1, Math.round(p.height || savedQuote.height_in || 48)),
    length: Math.max(1, Math.round(p.depth || savedQuote.length_in || 48)),
    width: Math.max(1, Math.round(p.width || savedQuote.width_in || 40)),
    sizeUnit: 'IN',
    quantity: p.quantity || 1,
    totalWeight: Math.max(1, Math.round(normalizeWeightToLbs(p.weight || 0, 'oz') || savedQuote.total_weight_lbs / (products?.length || 1))),
    weightUnit: 'lbs',
    stackable: false,
  }))

  if (listItems.length === 0) {
    listItems.push({
      name: savedQuote.commodity_name || 'Freight',
      packaging: 'PALLET',
      height: savedQuote.height_in || 48,
      length: savedQuote.length_in || 48,
      width: savedQuote.width_in || 40,
      sizeUnit: 'IN',
      quantity: savedQuote.total_qty || 1,
      totalWeight: savedQuote.total_weight_lbs || 150,
      weightUnit: 'lbs',
      stackable: false,
    })
  }

  // Store origin from merchant config or env fallback
  // Origin ZIP must match what was used at quote time (BC store's shipping origin)
  const originZip = savedQuote.origin_zip || ''
  const originStreet = order.billing_address?.street_1 || '1 Main St'
  const originCity = order.billing_address?.city || ''
  const originState = order.billing_address?.state_iso2 || order.billing_address?.state || ''

  const pickupDate = nextBusinessDay()
  // Delivery date = pickup + transit days (default 3 if unknown)
  const transitDays = savedQuote.transit_days ?? 3
  const deliveryDateObj = new Date(pickupDate)
  deliveryDateObj.setDate(deliveryDateObj.getDate() + transitDays)
  const deliveryDate = deliveryDateObj.toISOString().split('T')[0]

  const bookingParams = {
    quoteId: savedQuote.warp_quote_id,
    pickupInfo: {
      locationName: order.billing_address?.company || 'Shipper',
      contactName: `${order.billing_address?.first_name || ''} ${order.billing_address?.last_name || ''}`.trim() || 'Shipper',
      contactPhone: order.billing_address?.phone || '0000000000',
      contactEmail: order.customer_message ? undefined : order.billing_address?.email,
      address: {
        street: originStreet,
        city: originCity,
        state: originState,
        zipcode: originZip,
      },
      timeWindow: { from: `${pickupDate}T08:00:00`, to: `${pickupDate}T16:00:00` },
      ...(savedQuote.is_residential ? {} : {}),
    },
    deliveryInfo: {
      locationName: shipTo.company || `${shipTo.first_name} ${shipTo.last_name}`,
      contactName: `${shipTo.first_name} ${shipTo.last_name}`,
      contactPhone: shipTo.phone || '0000000000',
      contactEmail: order.billing_address?.email,
      address: {
        street: shipTo.street_1 || '',
        city: shipTo.city || '',
        state: shipTo.state_iso2 || shipTo.state || '',
        zipcode: (shipTo.zip || '').replace(/\s/g, '').slice(0, 5),
      },
      timeWindow: { from: `${deliveryDate}T08:00:00`, to: `${deliveryDate}T20:00:00` },
      ...(savedQuote.is_residential
        ? { serviceOptions: ['residential-delivery'] }
        : {}),
    },
    items: listItems,
  }

  try {
    const warpApiKey = process.env.WARP_API_KEY || ''
    const booking = await bookWarpShipment(warpApiKey, bookingParams)

    // Save booking record
    await supabase.from('bc_bookings').insert({
      store_hash: storeHash,
      bc_order_id: orderId,
      bc_quote_rate_id: savedQuote.rate_id,
      warp_quote_id: savedQuote.warp_quote_id,
      warp_tracking_number: booking.trackingNumber,
      warp_shipment_id: booking.shipmentId,
      raw_response: booking.raw,
      amount: savedQuote.amount,
      pickup_date: pickupDate,
      status: 'booked',
    })

    // Mark quote as booked
    await supabase
      .from('bc_quotes')
      .update({ booked_at: new Date().toISOString() })
      .eq('rate_id', savedQuote.rate_id)

    console.log(`[warp-bc] Booked order ${orderId} → Warp tracking ${booking.trackingNumber}`)

    return NextResponse.json({
      ok: true,
      tracking_number: booking.trackingNumber,
      shipment_id: booking.shipmentId,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[warp-bc] Booking failed for order ${orderId}:`, msg)

    // Log the failure
    await supabase.from('bc_bookings').insert({
      store_hash: storeHash,
      bc_order_id: orderId,
      warp_quote_id: savedQuote.warp_quote_id,
      status: 'failed',
      error: msg,
    })

    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
