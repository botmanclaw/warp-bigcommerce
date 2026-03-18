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
  serviceOptions?: string[]
}

export interface WarpRate {
  totalCharge: number
  currency: string
  transitDays: number | null
  carrierName: string
  quoteId?: string
}

function ounceToLbs(oz: number) {
  return oz / 16
}

function gramsToLbs(g: number) {
  return g / 453.592
}

function kgsToLbs(kg: number) {
  return kg * 2.20462
}

export function normalizeWeightToLbs(value: number, unit: string): number {
  switch (unit.toLowerCase()) {
    case 'oz':
    case 'ounces':
      return ounceToLbs(value)
    case 'g':
    case 'grams':
      return gramsToLbs(value)
    case 'kg':
    case 'kilograms':
      return kgsToLbs(value)
    case 'lbs':
    case 'lb':
    case 'pounds':
    default:
      return value
  }
}

export function normalizeDimInches(value: number, unit: string): number {
  switch (unit.toLowerCase()) {
    case 'cm':
      return value / 2.54
    case 'mm':
      return value / 25.4
    case 'm':
      return value * 39.3701
    case 'in':
    case 'inches':
    default:
      return value
  }
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
    shipmentItems: [
      {
        quantity: params.quantity,
        commodityName: params.commodityName,
        totalWeight: Math.round(params.totalWeight),
        length: Math.round(params.length),
        width: Math.round(params.width),
        height: Math.round(params.height),
        stackable: params.stackable,
      },
    ],
    ...(params.isResidentialPickup && {
      pickupInfo: { serviceOptions: ['residential-pickup'] },
    }),
    ...(params.isResidentialDelivery && {
      dropoffInfo: { serviceOptions: ['residential-delivery'] },
    }),
  }

  const res = await fetch(`${WARP_BASE}/freights/quote`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: apiKey,
    },
    body: JSON.stringify(body),
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
}
