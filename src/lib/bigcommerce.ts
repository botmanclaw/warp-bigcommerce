const BC_API = 'https://api.bigcommerce.com'

export async function getBCStoreInfo(storeHash: string, accessToken: string) {
  const res = await fetch(`${BC_API}/stores/${storeHash}/v2/store`, {
    headers: {
      'X-Auth-Token': accessToken,
      'Content-Type': 'application/json',
    },
  })
  if (!res.ok) return null
  return res.json()
}

// Exchange auth code for permanent access token
export async function exchangeCodeForToken(
  code: string,
  scope: string,
  context: string,
  redirectUri: string
): Promise<{ access_token: string; user: { email: string }; context: string } | null> {
  const res = await fetch('https://login.bigcommerce.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.BC_CLIENT_ID!,
      client_secret: process.env.BC_CLIENT_SECRET!,
      code,
      scope,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
      context,
    }),
  })
  if (!res.ok) return null
  return res.json()
}
