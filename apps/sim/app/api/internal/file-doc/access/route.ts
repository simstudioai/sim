import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { authorizeFileDocAccessContract } from '@/lib/api/contracts/file-doc'
import { parseRequest } from '@/lib/api/server'
import { authorizeFileDocAccess } from '@/lib/collab-doc/access'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { checkInternalApiKey, createUnauthorizedResponse } from '@/lib/mothership/request/http'

/**
 * POST /api/internal/file-doc/access — authorize a socket's user for a workspace file's
 * collaborative document room. Internal only: gated on the shared `x-api-key: INTERNAL_API_SECRET`
 * secret, matching the seed and persist endpoints the same relay calls.
 */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const auth = checkInternalApiKey(request)
  if (!auth.success) return createUnauthorizedResponse()

  const parsed = await parseRequest(authorizeFileDocAccessContract, request, {})
  if (!parsed.success) return parsed.response
  const { fileId, userId } = parsed.data.body

  const authorization = await authorizeFileDocAccess(userId, fileId)
  if (!authorization.allowed || !authorization.workspaceId || !authorization.workspacePermission) {
    return NextResponse.json({
      allowed: false,
      status: authorization.status === 404 ? 404 : 403,
    })
  }
  return NextResponse.json({
    allowed: true,
    workspaceId: authorization.workspaceId,
    workspacePermission: authorization.workspacePermission,
  })
})
