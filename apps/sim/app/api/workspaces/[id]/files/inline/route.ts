import { createLogger } from '@sim/logger'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { getInlineWorkspaceFileContract } from '@/lib/api/contracts/workspace-files'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { resolveWorkspaceInlineImage } from '@/lib/uploads/server/inline-image'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'
import { serveInlineImage } from '@/app/api/files/serve-inline-image'
import { createErrorResponse, FileNotFoundError } from '@/app/api/files/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('WorkspaceInlineFileAPI')

/**
 * GET /api/workspaces/[id]/files/inline?key=<cloudKey>|fileId=<id>
 *
 * Serves an image embedded in a workspace markdown document, **scoped to the workspace in the path**.
 * The markdown editor rewrites its embedded `/api/files/serve/<key>` and `/api/files/view/<id>` srcs to
 * this route so a referenced file resolves only within the document's workspace — a cross-workspace
 * reference returns 404 and does not render, even for a viewer who belongs to the other workspace. Read
 * access to the workspace is required; disposition/content-type handling mirrors the serve route.
 */
export const GET = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    try {
      const parsed = await parseRequest(getInlineWorkspaceFileContract, request, context)
      if (!parsed.success) return parsed.response
      const { id: workspaceId } = parsed.data.params
      const ref = parsed.data.query

      const session = await getSession()
      if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      // Authorize before disclosing anything; deny with 404 so a non-member can't probe existence.
      const permission = await getUserEntityPermissions(session.user.id, 'workspace', workspaceId)
      if (!permission) {
        throw new FileNotFoundError('Not found')
      }

      const image = await resolveWorkspaceInlineImage(workspaceId, ref)
      if (!image) {
        throw new FileNotFoundError('Not found')
      }

      return await serveInlineImage(image, { sniff: false })
    } catch (error) {
      if (error instanceof FileNotFoundError) {
        return createErrorResponse(error)
      }
      logger.error('Error serving workspace inline image:', error)
      return createErrorResponse(error instanceof Error ? error : new Error('Failed to serve file'))
    }
  }
)
