import { createLogger } from '@sim/logger'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import {
  authenticatePublicFileContract,
  getPublicFileContract,
} from '@/lib/api/contracts/public-shares'
import { parseRequest } from '@/lib/api/server'
import { getClientIp } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  publicFileAuthDenied,
  publicFileErrorResponse,
  publicFileShareCredential,
} from '@/lib/public-shares/api'
import {
  authenticatePublicFileSharePassword,
  authorizePublicFileShare,
  readPublicFileShare,
} from '@/lib/public-shares/application'
import { enforcePublicFileRateLimit } from '@/lib/public-shares/rate-limit'
import { getWorkspaceFileSize } from '@/lib/uploads/shared/types'

export const dynamic = 'force-dynamic'
const logger = createLogger('PublicFileMetadataAPI')

/** Public bearer authentication and cookie exchange retain their protocol-specific response shape. */
export const GET = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ token: string }> }) => {
    try {
      const limited = await enforcePublicFileRateLimit(request, 'metadata')
      if (limited) return limited
      const parsed = await parseRequest(getPublicFileContract, request, context)
      if (!parsed.success) return parsed.response
      const { token } = parsed.data.params
      const auth = await authorizePublicFileShare({
        token,
        credential: await publicFileShareCredential(request.cookies.getAll(), getClientIp(request)),
      })
      if (!auth.authorized) return publicFileAuthDenied(auth)
      const { file, workspaceName, ownerName } = await readPublicFileShare({ grant: auth.grant })
      return NextResponse.json({
        token,
        name: file.originalName,
        type: file.contentType,
        size: getWorkspaceFileSize(file),
        workspaceName,
        ownerName,
      })
    } catch (error) {
      logger.error('Error fetching public file metadata:', error)
      return publicFileErrorResponse(error, 'Failed to fetch file')
    }
  }
)

/** Exchanges a current password policy for its resource-bound HttpOnly cookie. */
export const POST = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ token: string }> }) => {
    try {
      const parsed = await parseRequest(authenticatePublicFileContract, request, context)
      if (!parsed.success) return parsed.response
      const auth = await authenticatePublicFileSharePassword({
        token: parsed.data.params.token,
        password: parsed.data.body.password,
        clientIp: getClientIp(request),
      })
      if (!auth.authorized) return publicFileAuthDenied(auth)
      const response = NextResponse.json({ authType: auth.authType })
      response.cookies.set(auth.cookie)
      return response
    } catch (error) {
      logger.error('Error authenticating public file share:', error)
      return publicFileErrorResponse(error, 'Failed to authenticate')
    }
  }
)
