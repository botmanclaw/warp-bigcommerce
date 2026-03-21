const WARP_BASE = process.env.WARP_API_BASE || 'https://gw.wearewarp.com/api/v1'

export interface WarpQuoteParams {
  pickupZipcode: string
  dropoffZipcode: string
  pickupCity?: string
  pickupState?: string
  dropoffCity?: string
  dropoffState?: string
  commodityName: string
  totalWeight: number // lbs
  quantity: number
  length: number // inches
  width: number
  height: number
  stackable: boolean
  isResidentialPickup?: boolean
  isResidentialDelivery?: boolean
}

export interface WarpRate {
  totalCharge: number
  currency: string
  transitDays: number | null
  carrierName: string
  quoteId?: string
}

export interface WarpBookingParams {
  quoteId: string
  pickupInfo: {
    locationName?: string
    contactName?: string
    contactPhone: string
    contactEmail?: string
    address: { street: string; city: string; state: string; zipcode: string }
    timeWindow: { from: string; to: string }
    serviceOptions?: string[]
    instructions?: string
    refNum?: string
  }
  deliveryInfo: {
    locationName?: string
    contactName?: string
    contactPhone: string
    contactEmail?: string
    address: { street: string; city: string; state: string; zipcode: string }
    timeWindow: { from: string; to: string }
    serviceOptions?: string[]
    instructions?: string
    refNum?: string
  }
  items: Array<{
    name: string
    packaging: string
    height: number
    length: number
    width: number
    sizeUnit: string
    quantity: number
    totalWeight: number
    weightUnit: string
    stackable: boolean
  }>
}

export function normalizeWeightToLbs(value: number, unit: string): number {
  switch (unit.toLowerCase()) {
    case 'oz': case 'ounces': return value / 16
    case 'g': case 'grams': return value / 453.592
    case 'kg': case 'kilograms': return value * 2.20462
    default: return value
  }
}

export function normalizeDimInches(value: number, unit: string): number {
  switch (unit.toLowerCase()) {
    case 'cm': return value / 2.54
    case 'mm': return value / 25.4
    case 'm': return value * 39.3701
    default: return value
  }
}

// Next business day as YYYY-MM-DD
function nextBusinessDay(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1)
  return d.toISOString().split('T')[0]
}

export async function getWarpQuote(
  apiKey: string,
  params: WarpQuoteParams
): Promise<WarpRate | null> {
  const pickupDate = nextBusinessDay()
  const item = {
    name: params.commodityName || 'Freight',
    packaging: 'PALLET',
    quantity: Math.max(1, params.quantity),
    totalWeight: Math.max(1, Math.round(params.totalWeight)),
    weightUnit: 'lbs',
    length: Math.max(1, Math.round(params.length)),
    width: Math.max(1, Math.round(params.width)),
    height: Math.max(1, Math.round(params.height)),
    sizeUnit: 'IN',
    stackable: params.stackable ?? false,
  }

  const headers = { 'Content-Type': 'application/json', apikey: apiKey }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 25000)

  try {
    const res = await fetch(`${WARP_BASE}/freights/quote`, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        pickupDate,
        pickupInfo: { zipcode: params.pickupZipcode },
        deliveryInfo: { zipcode: params.dropoffZipcode },
        listItems: [item],
        shipmentType: 'LTL',
      }),
    })

    if (!res.ok) return null
    const data = await res.json()
    const charge = data?.price?.amount ?? data?.totalCharge
    if (!charge) return null

    return {
      totalCharge: Number(charge),
      currency: data?.price?.currency_code ?? 'USD',
      transitDays: data?.transitDays ?? null,
      carrierName: 'Warp',
      quoteId: data?.quote_id ?? data?.id ?? undefined,
    }
  } catch (err) {
    console.error('[warp] getWarpQuote error:', err)
    return null
  } finally {
    clearTimeout(timeout)
  }
}

export async function bookWarpShipment(
  apiKey: string,
  params: WarpBookingParams
): Promise<{ trackingNumber?: string; shipmentId?: string; raw: Record<string, unknown> }> {
  const res = await fetch(`${WARP_BASE}/freights/booking`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: apiKey },
    body: JSON.stringify({
      quoteId: params.quoteId,
      pickupInfo: params.pickupInfo,
      deliveryInfo: params.deliveryInfo,
      listItems: params.items,
    }),
  })

  const raw = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`Warp booking failed: ${res.status} ${JSON.stringify(raw)}`)

  return {
    trackingNumber: (raw.trackingNumber ?? raw.proNumber ?? raw.shipmentNumber) as string | undefined,
    shipmentId: (raw.orderId ?? raw.shipmentId ?? raw.id) as string | undefined,
    raw: raw as Record<string, unknown>,
  }
}

export { nextBusinessDay }
