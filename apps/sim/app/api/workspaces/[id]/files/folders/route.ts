import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import {
  createWorkspaceFileFolderContract,
  listWorkspaceFileFoldersContract,
} from '@/lib/api/contracts/workspace-file-folders'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { captureServerEvent } from '@/lib/posthog/server'
import {
  createWorkspaceFileFolder,
  listWorkspaceFileFolders,
  WorkspaceFileFolderConflictError,
} from '@/lib/uploads/contexts/workspace'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('WorkspaceFileFoldersAPI')

async function getWorkspacePermission(userId: string, workspaceId: string) {
  return getUserEntityPermissions(userId, 'workspace', workspaceId)
}

export const GET = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(listWorkspaceFileFoldersContract, request, context)
    if (!parsed.success) return parsed.response
    const { id: workspaceId } = parsed.data.params
    const { scope } = parsed.data.query

    const permission = await getWorkspacePermission(session.user.id, workspaceId)
    if (!permission) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const folders = await listWorkspaceFileFolders(workspaceId, { scope })
    return NextResponse.json({ success: true, folders })
  }
)

export const POST = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(createWorkspaceFileFolderContract, request, context)
    if (!parsed.success) return parsed.response
    const { id: workspaceId } = parsed.data.params
    const { name, parentId } = parsed.data.body

    const permission = await getWorkspacePermission(session.user.id, workspaceId)
    if (permission !== 'admin' && permission !== 'write') {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    try {
      const folder = await createWorkspaceFileFolder({
        workspaceId,
        userId: session.user.id,
        name,
        parentId,
      })
      captureServerEvent(
        session.user.id,
        'folder_created',
        { workspace_id: workspaceId },
        { groups: { workspace: workspaceId } }
      )
      recordAudit({
        workspaceId,
        actorId: session.user.id,
        actorName: session.user.name,
        actorEmail: session.user.email,
        action: AuditAction.FOLDER_CREATED,
        resourceType: AuditResourceType.FOLDER,
        resourceId: folder.id,
        resourceName: folder.name,
        description: `Created folder "${folder.name}"`,
      })
      return NextResponse.json({ success: true, folder })
    } catch (error) {
      logger.error('Failed to create workspace file folder:', error)
      const message = error instanceof Error ? error.message : 'Failed to create folder'
      return NextResponse.json(
        { success: false, error: message },
        { status: error instanceof WorkspaceFileFolderConflictError ? 409 : 400 }
      )
    }
  }
)
