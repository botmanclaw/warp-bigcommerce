// BigCommerce OAuth callback — LTL app
import { NextRequest, NextResponse } from 'next/server'
import { exchangeCodeForToken, registerBCWebhook } from '@/lib/bigcommerce'
import { supabase } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const scope = searchParams.get('scope')
  const context = searchParams.get('context')

  if (!code || !scope || !context) return NextResponse.json({ error: 'Missing OAuth params' }, { status: 400 })

  const appUrl = process.env.APP_URL || 'https://warp-bigcommerce.vercel.app'
  const tokenData = await exchangeCodeForToken(code, scope, context, `${appUrl}/api/auth`)
  if (!tokenData) return NextResponse.json({ error: 'OAuth token exchange failed' }, { status: 500 })

  const storeHash = context.replace('stores/', '')
  const { access_token, user } = tokenData

  await supabase.from('bc_merchants').upsert(
    { store_hash: storeHash, access_token, email: user?.email, installed_at: new Date().toISOString() },
    { onConflict: 'store_hash' }
  )

  await registerBCWebhook(storeHash, access_token, 'store/order/statusUpdated', `${appUrl}/api/webhook/order`)
  await registerWarpCarrier(storeHash, process.env.BC_STORE_API_TOKEN || access_token, 'Warp LTL Freight')

  const res = NextResponse.redirect(`${appUrl}/setup?store_hash=${storeHash}`)
  res.cookies.set('bc_store_hash', storeHash, { httpOnly: false, path: '/', maxAge: 60 * 60 * 24 * 30, sameSite: 'none', secure: true })
  return res
}

export async function registerWarpCarrier(storeHash: string, accessToken: string, methodName: string) {
  const base = `https://api.bigcommerce.com/stores/${storeHash}`
  const headers = { 'X-Auth-Token': accessToken, 'Content-Type': 'application/json', 'Accept': 'application/json' }

  await fetch(`${base}/v2/shipping/carrier/connection`, {
    method: 'POST', headers,
    body: JSON.stringify({ carrier_id: 'carrier_573', connection: {} }),
  }).catch(() => {})

  const zonesRes = await fetch(`${base}/v2/shipping/zones`, { headers }).catch(() => null)
  if (!zonesRes?.ok) return
  const zones = await zonesRes.json().catch(() => [])
  for (const zone of (zones || [])) {
    await fetch(`${base}/v2/shipping/zones/${zone.id}/methods`, {
      method: 'POST', headers,
      body: JSON.stringify({ name: methodName, type: 'carrier_573', settings: { carrier_id: 'carrier_573' }, enabled: true }),
    }).catch(() => {})
  }
}
