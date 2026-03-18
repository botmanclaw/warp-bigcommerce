// BigCommerce install redirect — sends merchant to BC OAuth consent screen
import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const clientId = process.env.BC_CLIENT_ID!
  const redirectUri = encodeURIComponent(`${process.env.APP_URL}/api/auth`)
  const scopes = encodeURIComponent('store_v2_information_read_only')

  const oauthUrl =
    `https://login.bigcommerce.com/oauth2/authorize` +
    `?response_type=code` +
    `&client_id=${clientId}` +
    `&redirect_uri=${redirectUri}` +
    `&scope=${scopes}`

  return NextResponse.redirect(oauthUrl)
}
