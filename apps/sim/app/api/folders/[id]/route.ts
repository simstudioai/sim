import { db } from '@sim/db'
import { folder as folderTable } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { assertFolderMutable, FolderLockedError } from '@sim/platform-authz/workflow'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { deleteFolderContract, updateFolderContract } from '@/lib/api/contracts'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { HttpError } from '@/lib/core/utils/http-error'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { folderResourceConfig } from '@/lib/folders/config'
import { deleteFolder, updateFolder } from '@/lib/folders/lifecycle'
import { toFolderApi } from '@/lib/folders/queries'
import { folderMutationStatus } from '@/lib/folders/status'
import { captureServerEvent } from '@/lib/posthog/server'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('FoldersIDAPI')

// PUT - Update a folder
export const PUT = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    try {
      const session = await getSession()
      if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const parsed = await parseRequest(updateFolderContract, request, context, {
        validationErrorResponse: (error) => {
          logger.error('Folder update validation failed:', { errors: error.issues })
          const errorMessages = error.issues
            .map((err) => `${err.path.join('.')}: ${err.message}`)
            .join(', ')
          return NextResponse.json(
            { error: `Validation failed: ${errorMessages}` },
            { status: 400 }
          )
        },
      })
      if (!parsed.success) return parsed.response

      const { id } = parsed.data.params
      const { resourceType } = parsed.data.query
      const { name, locked, parentId, sortOrder } = parsed.data.body

      const existingFolder = await db
        .select()
        .from(folderTable)
        .where(and(eq(folderTable.id, id), eq(folderTable.resourceType, resourceType)))
        .then((rows) => rows[0])

      if (!existingFolder) {
        return NextResponse.json({ error: 'Folder not found' }, { status: 404 })
      }

      // Check if user has write permissions for the workspace
      const workspacePermission = await getUserEntityPermissions(
        session.user.id,
        'workspace',
        existingFolder.workspaceId
      )

      if (!workspacePermission || workspacePermission === 'read') {
        return NextResponse.json(
          { error: 'Write access required to update folders' },
          { status: 403 }
        )
      }

      // Locking is workflow-only. Reject the field outright for the other types rather than
      // dropping it silently, and keep the admin gate and the lock checks behind the same
      // capability so a non-workflow folder can neither be 403'd by a field that has no
      // meaning for it nor persist a `locked` value nothing will ever read.
      const supportsLocking = Boolean(folderResourceConfig(resourceType).supportsLocking)

      if (locked !== undefined && !supportsLocking) {
        return NextResponse.json(
          { error: 'Folder locking is only supported for workflow folders' },
          { status: 400 }
        )
      }

      if (supportsLocking) {
        if (locked !== undefined && workspacePermission !== 'admin') {
          return NextResponse.json(
            { error: 'Admin access required to lock folders' },
            { status: 403 }
          )
        }

        const hasNonLockUpdate = Object.keys(parsed.data.body).some((key) => key !== 'locked')
        if (hasNonLockUpdate) {
          await assertFolderMutable(id)
        }
        if (parentId !== undefined) {
          await assertFolderMutable(parentId)
        }
      }

      const result = await updateFolder({
        resourceType,
        folderId: id,
        workspaceId: existingFolder.workspaceId,
        userId: session.user.id,
        name,
        locked,
        parentId,
        sortOrder,
      })

      if (!result.success || !result.folder) {
        const status = folderMutationStatus(result.errorCode)
        return NextResponse.json({ error: result.error }, { status })
      }

      logger.info('Updated folder:', { id, updates: parsed.data.body })

      return NextResponse.json({ folder: toFolderApi(result.folder) })
    } catch (error) {
      if (error instanceof FolderLockedError) {
        return NextResponse.json({ error: error.message }, { status: error.status })
      }

      logger.error('Error updating folder:', { error })
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)

// DELETE - Delete a folder and all its contents
export const DELETE = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    try {
      const session = await getSession()
      if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const parsed = await parseRequest(deleteFolderContract, request, context)
      if (!parsed.success) return parsed.response
      const { id } = parsed.data.params
      const { resourceType } = parsed.data.query

      const existingFolder = await db
        .select()
        .from(folderTable)
        .where(and(eq(folderTable.id, id), eq(folderTable.resourceType, resourceType)))
        .then((rows) => rows[0])

      if (!existingFolder) {
        return NextResponse.json({ error: 'Folder not found' }, { status: 404 })
      }

      const workspacePermission = await getUserEntityPermissions(
        session.user.id,
        'workspace',
        existingFolder.workspaceId
      )

      if (!workspacePermission || workspacePermission === 'read') {
        return NextResponse.json(
          { error: 'Write or Admin access required to delete folders' },
          { status: 403 }
        )
      }

      if (resourceType === 'workflow') {
        await assertFolderMutable(id)
      }

      const result = await deleteFolder({
        resourceType,
        folderId: id,
        workspaceId: existingFolder.workspaceId,
        userId: session.user.id,
        folderName: existingFolder.name,
      })

      if (!result.success) {
        return NextResponse.json(
          { error: result.error },
          { status: folderMutationStatus(result.errorCode) }
        )
      }

      captureServerEvent(
        session.user.id,
        'folder_deleted',
        { workspace_id: existingFolder.workspaceId, resource_type: resourceType },
        { groups: { workspace: existingFolder.workspaceId } }
      )

      return NextResponse.json({
        success: true,
        deletedItems: result.deletedItems,
      })
    } catch (error) {
      if (error instanceof FolderLockedError) {
        return NextResponse.json({ error: error.message }, { status: error.status })
      }

      // A typed domain error carries its own status — `deleteTable` can still raise a 423
      // `TableLockedError` if a lock is set between the subtree guard and the archive.
      // Rethrow so `withRouteHandler` maps it instead of flattening it to a 500.
      if (error instanceof HttpError) throw error

      logger.error('Error deleting folder:', { error })
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)
