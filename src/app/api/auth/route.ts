// BigCommerce OAuth callback — exchanges code for access_token, stores merchant, registers webhooks
import { NextRequest, NextResponse } from 'next/server'
import { exchangeCodeForToken } from '@/lib/bigcommerce'
import { registerBCWebhook } from '@/lib/bigcommerce'
import { supabase } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const scope = searchParams.get('scope')
  const context = searchParams.get('context') // "stores/abc123"

  if (!code || !scope || !context) {
    return NextResponse.json({ error: 'Missing required OAuth params' }, { status: 400 })
  }

  const redirectUri = `${process.env.APP_URL}/api/auth`
  const tokenData = await exchangeCodeForToken(code, scope, context, redirectUri)

  if (!tokenData) {
    return NextResponse.json({ error: 'OAuth token exchange failed' }, { status: 500 })
  }

  const storeHash = context.replace('stores/', '')
  const { access_token, user } = tokenData

  // Upsert merchant record
  await supabase.from('bc_merchants').upsert(
    {
      store_hash: storeHash,
      access_token,
      email: user.email,
      installed_at: new Date().toISOString(),
    },
    { onConflict: 'store_hash' }
  )

  // Register order status webhook so we can auto-book when orders are paid
  const webhookUrl = `${process.env.APP_URL}/api/webhook/order`
  await registerBCWebhook(storeHash, access_token, 'store/order/statusUpdated', webhookUrl)

  // Register Warp as a shipping carrier on the store
  await registerWarpCarrier(storeHash, access_token)

  // Redirect to setup page — set cookie so iframe reloads can still find store_hash
  const redirectUrl = `${process.env.APP_URL}/setup?store_hash=${storeHash}`
  const response = NextResponse.redirect(redirectUrl)
  response.cookies.set('bc_store_hash', storeHash, { httpOnly: false, path: '/', maxAge: 60 * 60 * 24 * 30, sameSite: 'none', secure: true })
  return response
}

async function registerWarpCarrier(storeHash: string, accessToken: string) {
  const headers = { 'X-Auth-Token': accessToken, 'Content-Type': 'application/json' }
  const base = `https://api.bigcommerce.com/stores/${storeHash}`

  // 1. Connect carrier_573 to store
  await fetch(`${base}/v2/shipping/carrier/connection`, {
    method: 'POST', headers,
    body: JSON.stringify({ carrier_id: 'carrier_573', connection: {} }),
  }).catch(() => {})

  // 2. Get existing shipping zones
  const zonesRes = await fetch(`${base}/v2/shipping/zones`, { headers }).catch(() => null)
  if (!zonesRes?.ok) return
  const zones = await zonesRes.json().catch(() => [])
  if (!zones?.length) return

  // 3. Add Warp carrier method to all zones
  for (const zone of zones) {
    await fetch(`${base}/v2/shipping/zones/${zone.id}/methods`, {
      method: 'POST', headers,
      body: JSON.stringify({
        name: 'Warp LTL Freight',
        type: 'carrier_573',
        settings: { carrier_id: 'carrier_573' },
        enabled: true,
      }),
    }).catch(() => {})
  }
}
