import { jwtVerify, SignJWT } from 'jose'
import { type NextRequest, NextResponse } from 'next/server'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('CronAuth')

const getJwtSecret = () => {
  const secret = new TextEncoder().encode(env.INTERNAL_API_SECRET)
  return secret
}

/**
 * Generate an internal JWT token for server-side API calls
 * Token expires in 5 minutes to keep it short-lived
 * @param userId Optional user ID to embed in token payload
 */
export async function generateInternalToken(userId?: string): Promise<string> {
  const secret = getJwtSecret()

  const payload: { type: string; userId?: string } = { type: 'internal' }
  if (userId) {
    payload.userId = userId
  }

  const token = await new SignJWT(payload)
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
 * Returns verification result with userId if present in token
 */
export async function verifyInternalToken(
  token: string
): Promise<{ valid: boolean; userId?: string }> {
  try {
    const secret = getJwtSecret()

    const { payload } = await jwtVerify(token, secret, {
      issuer: 'sim-internal',
      audience: 'sim-api',
    })

    // Check that it's an internal token
    if (payload.type === 'internal') {
      return {
        valid: true,
        userId: typeof payload.userId === 'string' ? payload.userId : undefined,
      }
    }

    return { valid: false }
  } catch (error) {
    // Token verification failed
    return { valid: false }
  }
}

/**
 * Verify CRON authentication for scheduled API endpoints
 * Returns null if authorized, or a NextResponse with error if unauthorized
 */
export function verifyCronAuth(request: NextRequest, context?: string): NextResponse | null {
  const authHeader = request.headers.get('authorization')
  const expectedAuth = `Bearer ${env.CRON_SECRET}`
  if (authHeader !== expectedAuth) {
    const contextInfo = context ? ` for ${context}` : ''
    logger.warn(`Unauthorized CRON access attempt${contextInfo}`, {
      providedAuth: authHeader,
      ip: request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip') ?? 'unknown',
      userAgent: request.headers.get('user-agent') ?? 'unknown',
      context,
    })

    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return null
}
