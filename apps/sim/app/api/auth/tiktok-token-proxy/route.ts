import { NextResponse } from 'next/server'

/**
 * Proxy for TikTok's token endpoint.
 * TikTok uses 'client_key' instead of 'client_id' and wraps responses in 'data'.
 * This lets Better Auth's genericOAuth handle token persistence normally.
 */
export async function POST(request: Request) {
  const body = await request.text()
  const params = new URLSearchParams(body)

  // TikTok expects 'client_key' instead of 'client_id'
  const clientId = params.get('client_id')
  if (clientId) {
    params.delete('client_id')
    params.set('client_key', clientId)
  }

  const response = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  })

  const json = await response.json()

  // TikTok wraps the token response in 'data' - unwrap it for Better Auth
  const tokenData = json.data || json
  return NextResponse.json(tokenData)
}
