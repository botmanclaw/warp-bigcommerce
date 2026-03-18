// BigCommerce Shipping Provider API — check_connection_options endpoint
// BC calls this when a merchant connects/configures the carrier to validate credentials
import { NextRequest, NextResponse } from 'next/server'
import { getWarpQuote } from '@/lib/warp'

export async function POST(req: NextRequest) {
  let body: { connection_options?: { warp_api_key?: string } }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ valid: false, messages: [{ text: 'Invalid request', type: 'ERROR' }] })
  }

  const apiKey = body?.connection_options?.warp_api_key?.trim()

  if (!apiKey) {
    return NextResponse.json({
      valid: false,
      messages: [{ text: 'Warp API key is required', type: 'ERROR' }],
    })
  }

  // Test the key with a simple quote request (Chicago → LA)
  try {
    const result = await getWarpQuote(apiKey, {
      pickupZipcode: '60603',
      dropoffZipcode: '90021',
      commodityName: 'Test Item',
      totalWeight: 200,
      quantity: 1,
      length: 48,
      width: 40,
      height: 48,
      stackable: false,
    })

    if (result) {
      return NextResponse.json({
        valid: true,
        messages: [{ text: 'Warp API key verified successfully', type: 'INFO' }],
      })
    } else {
      return NextResponse.json({
        valid: false,
        messages: [{ text: 'Warp API key is invalid or account not active', type: 'ERROR' }],
      })
    }
  } catch {
    return NextResponse.json({
      valid: false,
      messages: [{ text: 'Could not reach Warp API. Please try again.', type: 'ERROR' }],
    })
  }
}
