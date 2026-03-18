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

  // Redirect to the setup/config page inside BC control panel iframe
  return NextResponse.redirect(`${process.env.APP_URL}/setup?store_hash=${storeHash}`)
}
