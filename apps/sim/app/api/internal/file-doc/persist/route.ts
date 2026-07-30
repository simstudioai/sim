import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { persistFileDocContract } from '@/lib/api/contracts/file-doc'
import { parseRequest } from '@/lib/api/server'
import { persistFileDoc } from '@/lib/collab-doc/persist'
import { checkInternalApiKey, createUnauthorizedResponse } from '@/lib/copilot/request/http'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('FileDocPersistAPI')

/**
 * POST /api/internal/file-doc/persist — project a live collaborative document back to durable markdown
 * (Yjs → markdown, through the exact editor engine) and write it to the file. Internal only: gated on
 * the shared `x-api-key: INTERNAL_API_SECRET` secret, matching the header the realtime relay sends.
 * The relay owns the live doc but not the conversion engine or blob/DB access, so it ships the current
 * doc state here — the server-authoritative durable path that replaces the editor's client autosave.
 */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const auth = checkInternalApiKey(request)
  if (!auth.success) return createUnauthorizedResponse()

  const parsed = await parseRequest(persistFileDocContract, request, {})
  if (!parsed.success) return parsed.response
  const { workspaceId, fileId, userId, docState, expectedVersion } = parsed.data.body

  try {
    const result = await persistFileDoc(
      workspaceId,
      fileId,
      userId,
      new Uint8Array(Buffer.from(docState, 'base64')),
      expectedVersion
    )
    return NextResponse.json(result)
  } catch (error) {
    logger.error('Failed to persist file-doc', { workspaceId, fileId, error })
    return NextResponse.json(
      { error: getErrorMessage(error, 'Failed to persist document') },
      { status: 500 }
    )
  }
})
