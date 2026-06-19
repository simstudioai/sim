import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import {
  authenticatePublicFileContract,
  getPublicFileContract,
} from '@/lib/api/contracts/public-shares'
import { parseRequest } from '@/lib/api/server'
import { setDeploymentAuthCookie } from '@/lib/core/security/deployment'
import { validateDeploymentAuth } from '@/lib/core/security/deployment-auth'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { enforcePublicFileRateLimit } from '@/lib/public-shares/rate-limit'
import { resolveActiveShareByToken } from '@/lib/public-shares/share-manager'

export const dynamic = 'force-dynamic'

const logger = createLogger('PublicFileMetadataAPI')

/**
 * GET /api/files/public/[token]
 * Public, unauthenticated metadata for a shared file. Returns 404 for unknown,
 * inactive, or deleted shares — the existence of a file is never leaked. A
 * password-protected share returns 401 `auth_required_password` until a valid
 * `file_auth_{shareId}` cookie is present.
 */
export const GET = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ token: string }> }) => {
    const requestId = generateRequestId()

    try {
      const limited = await enforcePublicFileRateLimit(request, 'metadata')
      if (limited) return limited

      const parsed = await parseRequest(getPublicFileContract, request, context)
      if (!parsed.success) return parsed.response
      const { token } = parsed.data.params

      const resolved = await resolveActiveShareByToken(token)
      if (!resolved) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 })
      }

      const auth = await validateDeploymentAuth(
        requestId,
        resolved.share,
        request,
        undefined,
        'file'
      )
      if (!auth.authorized) {
        return NextResponse.json({ error: auth.error ?? 'auth_required_password' }, { status: 401 })
      }

      const { file, workspaceName, ownerName } = resolved
      return NextResponse.json({
        token,
        name: file.originalName,
        type: file.contentType,
        size: file.size,
        workspaceName,
        ownerName,
      })
    } catch (error) {
      logger.error('Error fetching public file metadata:', error)
      return NextResponse.json(
        { error: getErrorMessage(error, 'Failed to fetch file') },
        { status: 500 }
      )
    }
  }
)

/**
 * POST /api/files/public/[token]
 * Exchanges a share password for a `file_auth_{shareId}` cookie. IP rate-limited
 * via the shared deployment-auth gate; returns 401 (`Invalid password`) on
 * mismatch and 429 (with `Retry-After`) when throttled.
 */
export const POST = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ token: string }> }) => {
    const requestId = generateRequestId()

    try {
      const parsed = await parseRequest(authenticatePublicFileContract, request, context)
      if (!parsed.success) return parsed.response
      const { token } = parsed.data.params
      const { password } = parsed.data.body

      const resolved = await resolveActiveShareByToken(token)
      if (!resolved) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 })
      }

      // This endpoint authenticates password shares only. Refusing other modes
      // here prevents minting a `file_auth` cookie for a `public` share (which
      // `validateDeploymentAuth` would otherwise authorize), which could later
      // satisfy the gate if the share is switched to `email`/`sso`.
      if (resolved.share.authType !== 'password') {
        return NextResponse.json(
          { error: 'This file does not use password authentication' },
          { status: 400 }
        )
      }

      const auth = await validateDeploymentAuth(
        requestId,
        resolved.share,
        request,
        { password },
        'file'
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
        'file',
        resolved.share.id,
        resolved.share.authType,
        resolved.share.password
      )
      logger.info('Public file share password accepted', { token, shareId: resolved.share.id })
      return response
    } catch (error) {
      logger.error('Error authenticating public file share:', error)
      return NextResponse.json(
        { error: getErrorMessage(error, 'Failed to authenticate') },
        { status: 500 }
      )
    }
  }
)
