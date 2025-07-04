import { jwtVerify, SignJWT } from 'jose'
import { env } from '@/lib/env'

// Create a secret key for JWT signing
const getJwtSecret = () => {
  const secret = new TextEncoder().encode(env.INTERNAL_API_SECRET)
  return secret
}

/**
 * Generate an internal JWT token for server-side API calls
 * Token expires in 5 minutes to keep it short-lived
 */
export async function generateInternalToken(): Promise<string> {
  const secret = getJwtSecret()

  const token = await new SignJWT({ type: 'internal' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('5m')
    .setIssuer('sim-internal')
    .setAudience('sim-api')
    .sign(secret)

  return token
}

/**
 * Verify an internal JWT token
 * Returns true if valid, false otherwise
 */
export async function verifyInternalToken(token: string): Promise<boolean> {
  try {
    const secret = getJwtSecret()

    const { payload } = await jwtVerify(token, secret, {
      issuer: 'sim-internal',
      audience: 'sim-api',
    })

    // Check that it's an internal token
    return payload.type === 'internal'
  } catch (error) {
    // Token verification failed
    return false
  }
}
