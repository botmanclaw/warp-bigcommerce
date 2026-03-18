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
    pickupZipcode: params.pickupZipcode,
    dropoffZipcode: params.dropoffZipcode,
    ...(params.pickupCity && { pickupCity: params.pickupCity }),
    ...(params.pickupState && { pickupState: params.pickupState }),
    ...(params.dropoffCity && { dropoffCity: params.dropoffCity }),
    ...(params.dropoffState && { dropoffState: params.dropoffState }),
    shipmentType: 'LTL',
    shipmentItems: [{
      quantity: params.quantity,
      commodityName: params.commodityName,
      totalWeight: Math.max(1, Math.round(params.totalWeight)),
      length: Math.max(1, Math.round(params.length)),
      width: Math.max(1, Math.round(params.width)),
      height: Math.max(1, Math.round(params.height)),
      stackable: params.stackable,
    }],
    ...(params.isResidentialPickup && { pickupInfo: { serviceOptions: ['residential-pickup'] } }),
    ...(params.isResidentialDelivery && { dropoffInfo: { serviceOptions: ['residential-delivery'] } }),
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 25000)

  try {
    const res = await fetch(`${WARP_BASE}/freights/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: apiKey },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (!res.ok) return null
    const data = await res.json()
    const charge = data?.totalCharge ?? data?.rate ?? data?.price
    if (!charge) return null
    return {
      totalCharge: Number(charge),
      currency: 'USD',
      transitDays: data?.transitDays ?? data?.transit_days ?? null,
      carrierName: 'Warp',
      quoteId: data?.id ?? data?.quoteId ?? undefined,
    }
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
      listItems: params.listItems,
    }),
  })

  const raw = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`Warp booking failed: ${res.status} ${JSON.stringify(raw)}`)

  return {
    trackingNumber: raw.shipmentNumber ?? raw.trackingNumber ?? raw.proNumber ?? undefined,
    shipmentId: raw.shipmentId ?? raw.id ?? undefined,
    raw,
  }
}

export { nextBusinessDay }
