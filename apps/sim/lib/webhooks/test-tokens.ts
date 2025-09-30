import { jwtVerify, SignJWT } from 'jose'
import { env } from '@/lib/env'

type TestTokenPayload = {
  typ: 'webhook_test'
  wid: string
}

const getSecretKey = () => new TextEncoder().encode(env.INTERNAL_API_SECRET)

export async function signTestWebhookToken(webhookId: string, ttlSeconds: number): Promise<string> {
  const secret = getSecretKey()
  const payload: TestTokenPayload = { typ: 'webhook_test', wid: webhookId }

  const token = await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .setIssuer('sim-webhooks')
    .setAudience('sim-test')
    .sign(secret)

  return token
}

export async function verifyTestWebhookToken(
  token: string,
  expectedWebhookId: string
): Promise<boolean> {
  try {
    const secret = getSecretKey()
    const { payload } = await jwtVerify(token, secret, {
      issuer: 'sim-webhooks',
      audience: 'sim-test',
    })

    if (
      payload &&
      (payload as any).typ === 'webhook_test' &&
      (payload as any).wid === expectedWebhookId
    ) {
      return true
    }
    return false
  } catch (_e) {
    return false
  }
}
