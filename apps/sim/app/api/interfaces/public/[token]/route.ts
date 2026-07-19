import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { authenticatePublicInterfaceContract } from '@/lib/api/contracts/public-shares'
import { parseRequest } from '@/lib/api/server'
import { setDeploymentAuthCookie } from '@/lib/core/security/deployment'
import { validateDeploymentAuth } from '@/lib/core/security/deployment-auth'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { resolveActiveInterfaceShareByToken } from '@/lib/public-shares/share-manager'

export const dynamic = 'force-dynamic'

const logger = createLogger('PublicInterfaceAuthAPI')

/**
 * POST /api/interfaces/public/[token]
 * Exchanges a share password for an `interface_auth_{shareId}` cookie. IP
 * rate-limited via the shared deployment-auth gate; returns 401 (`Invalid
 * password`) on mismatch and 429 (with `Retry-After`) when throttled.
 *
 * The token is the auth material, so it is parsed before the gate runs — there
 * is no session to authenticate first.
 */
export const POST = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ token: string }> }) => {
    const requestId = generateRequestId()

    try {
      const parsed = await parseRequest(authenticatePublicInterfaceContract, request, context)
      if (!parsed.success) return parsed.response
      const { token } = parsed.data.params
      const { password } = parsed.data.body

      const resolved = await resolveActiveInterfaceShareByToken(token)
      if (!resolved) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 })
      }

      // This endpoint authenticates password shares only. Refusing other modes
      // here prevents minting an `interface_auth` cookie for a `public` share
      // (which `validateDeploymentAuth` would otherwise authorize), which could
      // later satisfy the gate if the share is switched to `email`/`sso`.
      if (resolved.share.authType !== 'password') {
        return NextResponse.json(
          { error: 'This interface does not use password authentication' },
          { status: 400 }
        )
      }

      const auth = await validateDeploymentAuth(
        requestId,
        resolved.share,
        request,
        { password },
        'interface'
      )
      if (!auth.authorized) {
        const response = NextResponse.json(
          { error: auth.error ?? 'Invalid password' },
          { status: auth.status ?? 401 }
        )
        if (auth.status === 429 && auth.retryAfterMs !== undefined) {
          response.headers.set('Retry-After', String(Math.ceil(auth.retryAfterMs / 1000)))
        }
        return response
      }

      const response = NextResponse.json({ authType: resolved.share.authType })
      setDeploymentAuthCookie(
        response,
        'interface',
        resolved.share.id,
        resolved.share.authType,
        resolved.share.password
      )
      logger.info('Public interface share password accepted', { shareId: resolved.share.id })
      return response
    } catch (error) {
      logger.error('Error authenticating public interface share:', error)
      return NextResponse.json(
        { error: getErrorMessage(error, 'Failed to authenticate') },
        { status: 500 }
      )
    }
  }
)
