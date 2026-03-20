// BigCommerce Shipping Provider API — check_connection_options endpoint
// BC calls this when a merchant connects/configures the carrier
import { NextResponse } from 'next/server'

export async function POST() {
  // Centralized API key — no merchant credentials needed, always valid
  return NextResponse.json({
    valid: true,
    messages: [{ text: 'Warp Freight is active and ready', type: 'INFO' }],
  })
}
