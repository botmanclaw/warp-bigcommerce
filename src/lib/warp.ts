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
    windowTime: { from: string; to: string }
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
    windowTime: { from: string; to: string }
    serviceOptions?: string[]
    instructions?: string
    refNum?: string
  }
  listItems: Array<{
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
  const body = {
    pickupDate: nextBusinessDay(),
    pickupInfo: { zipcode: params.pickupZipcode },
    deliveryInfo: { zipcode: params.dropoffZipcode },
    items: [{
      name: params.commodityName,
      packaging: 'PALLET',
      quantity: Math.max(1, params.quantity),
      totalWeight: Math.max(100, Math.round(params.totalWeight)),
      weightUnit: 'lbs',
      length: Math.max(1, Math.round(params.length)),
      width: Math.max(1, Math.round(params.width)),
      height: Math.max(1, Math.round(params.height)),
      sizeUnit: 'IN',
    }],
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 25000)

  try {
    const res = await fetch(`${WARP_BASE}/freights/freight-quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: apiKey },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (!res.ok) return null
    const data = await res.json()
    const options = data?.options
    if (!options?.length) return null
    // Only use Warp's own network — no partner carriers
    const best = options.find((o: {source: string}) => o.source === 'WARP')
    if (!best) return null
    const transitDays = best.transitTime ? Math.round(best.transitTime / 86400) : null
    return {
      totalCharge: Number(best.rate),
      currency: 'USD',
      transitDays,
      carrierName: best.carrierName ?? 'Warp',
      quoteId: best.id ?? undefined,
    }
  } finally {
    clearTimeout(timeout)
  }
}

export async function bookWarpShipment(
  apiKey: string,
  params: WarpBookingParams
): Promise<{ trackingNumber?: string; shipmentId?: string; raw: Record<string, unknown> }> {
  // Use /freights/book (not /freights/booking) — works with freight-quote option IDs
  // Field names: items (not listItems), timeWindow (not windowTime)
  const res = await fetch(`${WARP_BASE}/freights/book`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: apiKey },
    body: JSON.stringify({
      quoteId: params.quoteId,
      pickupInfo: {
        ...params.pickupInfo,
        timeWindow: params.pickupInfo.windowTime,
        windowTime: undefined,
      },
      deliveryInfo: {
        ...params.deliveryInfo,
        timeWindow: params.deliveryInfo.windowTime,
        windowTime: undefined,
      },
      items: params.listItems,
    }),
  })

  const raw = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`Warp booking failed: ${res.status} ${JSON.stringify(raw)}`)

  return {
    trackingNumber: (raw.trackingNumber ?? raw.proNumber) as string | undefined,
    shipmentId: (raw.shipmentIds as string[] | undefined)?.[0] ?? raw.orderId as string | undefined,
    raw: raw as Record<string, unknown>,
  }
}

export { nextBusinessDay }
