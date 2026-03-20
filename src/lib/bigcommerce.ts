const BC_API = 'https://api.bigcommerce.com'
const BC_HEADERS = (token: string) => ({
  'X-Auth-Token': token,
  'Content-Type': 'application/json',
  'Accept': 'application/json',
})

export async function getBCStoreInfo(storeHash: string, accessToken: string) {
  const res = await fetch(`${BC_API}/stores/${storeHash}/v2/store`, { headers: BC_HEADERS(accessToken) })
  if (!res.ok) return null
  return res.json()
}

export async function getBCOrder(storeHash: string, accessToken: string, orderId: number) {
  const res = await fetch(`${BC_API}/stores/${storeHash}/v2/orders/${orderId}`, { headers: BC_HEADERS(accessToken) })
  if (!res.ok) return null
  return res.json()
}

export async function getBCOrderShippingAddresses(storeHash: string, accessToken: string, orderId: number) {
  const res = await fetch(`${BC_API}/stores/${storeHash}/v2/orders/${orderId}/shipping_addresses`, { headers: BC_HEADERS(accessToken) })
  if (!res.ok) return null
  return res.json()
}

export async function getBCOrderProducts(storeHash: string, accessToken: string, orderId: number) {
  const res = await fetch(`${BC_API}/stores/${storeHash}/v2/orders/${orderId}/products`, { headers: BC_HEADERS(accessToken) })
  if (!res.ok) return null
  return res.json()
}

// Register a webhook on a store
export async function registerBCWebhook(
  storeHash: string,
  accessToken: string,
  scope: string,
  destination: string
) {
  const res = await fetch(`${BC_API}/stores/${storeHash}/v3/hooks`, {
    method: 'POST',
    headers: { 'X-Auth-Token': accessToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope, destination, is_active: true }),
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
