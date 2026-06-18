import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { getPublicFileContract } from '@/lib/api/contracts/public-shares'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { resolveActiveShareByToken } from '@/lib/public-shares/share-manager'

export const dynamic = 'force-dynamic'

const logger = createLogger('PublicFileMetadataAPI')

/**
 * GET /api/files/public/[token]
 * Public, unauthenticated metadata for a shared file. Returns 404 for unknown,
 * inactive, or deleted shares — the existence of a file is never leaked.
 */
export const GET = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ token: string }> }) => {
    try {
      const parsed = await parseRequest(getPublicFileContract, request, context)
      if (!parsed.success) return parsed.response
      const { token } = parsed.data.params

      const resolved = await resolveActiveShareByToken(token)
      if (!resolved) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 })
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
