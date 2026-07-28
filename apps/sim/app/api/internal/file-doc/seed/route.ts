import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { buildFileDocSeedContract } from '@/lib/api/contracts/file-doc'
import { parseRequest } from '@/lib/api/server'
import { buildFileDocSeed } from '@/lib/collab-doc/seed'
import { checkInternalApiKey, createUnauthorizedResponse } from '@/lib/copilot/request/http'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('FileDocSeedAPI')

/**
 * POST /api/internal/file-doc/seed — build a server-authoritative collaborative-document seed
 * (markdown → Yjs) for the realtime relay to apply on room creation. Internal only: gated on the
 * shared `x-api-key: INTERNAL_API_SECRET` secret, matching the header the realtime relay sends
 * (`apps/realtime/src/handlers/file-doc-seed.ts`) and the realtime server's own inbound validator.
 */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const auth = checkInternalApiKey(request)
  if (!auth.success) return createUnauthorizedResponse()

  const parsed = await parseRequest(buildFileDocSeedContract, request, {})
  if (!parsed.success) return parsed.response
  const { workspaceId, fileId } = parsed.data.body

  try {
    const seed = await buildFileDocSeed(workspaceId, fileId)
    return NextResponse.json({
      update: seed ? Buffer.from(seed.update).toString('base64') : null,
    })
  } catch (error) {
    logger.error('Failed to build file-doc seed', { workspaceId, fileId, error })
    return NextResponse.json(
      { error: getErrorMessage(error, 'Failed to build seed') },
      { status: 500 }
    )
  }
})
