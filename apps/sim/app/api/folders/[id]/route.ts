import { db } from '@sim/db'
import { folder } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { ResourceLockedError } from '@sim/platform-authz/resource-lock'
import { and, eq, isNull } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { updateFolderContract } from '@/lib/api/contracts'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { performDeleteFolder, performUpdateFolder } from '@/lib/folders/orchestration'
import { FOLDER_RESOURCE_POLICIES } from '@/lib/folders/policy'
import { captureServerEvent } from '@/lib/posthog/server'
import { statusForOrchestrationError } from '@/lib/workflows/orchestration/types'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('FoldersIDAPI')

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
      const { name, locked, parentId, sortOrder } = parsed.data.body

      const existingFolder = await db
        .select()
        .from(folder)
        .where(and(eq(folder.id, id), isNull(folder.deletedAt)))
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
          { error: 'Write access required to update folders' },
          { status: 403 }
        )
      }

      const policy = FOLDER_RESOURCE_POLICIES[existingFolder.resourceType]

      if (locked !== undefined && !policy.supportsLocking) {
        return NextResponse.json(
          { error: `Folders of type "${existingFolder.resourceType}" do not support locking` },
          { status: 400 }
        )
      }
      if (locked !== undefined && workspacePermission !== 'admin') {
        return NextResponse.json(
          { error: 'Admin access required to lock folders' },
          { status: 403 }
        )
      }

      // An admin combining `locked: false` with other field changes (e.g. a move) in
      // one request is unlocking the folder as part of this same atomic write -- the
      // mutable-check must not block that. Skip only when this request isn't also
      // unlocking.
      const hasNonLockUpdate = Object.keys(parsed.data.body).some((key) => key !== 'locked')
      if (hasNonLockUpdate && locked !== false) {
        await policy.assertMutable(id)
      }
      if (parentId !== undefined) {
        await policy.assertMutable(parentId)
      }

      const result = await performUpdateFolder({
        resourceType: existingFolder.resourceType,
        folderId: id,
        workspaceId: existingFolder.workspaceId,
        userId: session.user.id,
        name,
        locked,
        parentId,
        sortOrder,
      })

      if (!result.success || !result.folder) {
        return NextResponse.json(
          { error: result.error },
          { status: statusForOrchestrationError(result.errorCode) }
        )
      }

      logger.info('Updated folder:', { id, updates: parsed.data.body })

      return NextResponse.json({ folder: result.folder })
    } catch (error) {
      if (error instanceof ResourceLockedError) {
        return NextResponse.json({ error: error.message }, { status: error.status })
      }

      logger.error('Error updating folder:', { error })
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)

export const DELETE = withRouteHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    try {
      const session = await getSession()
      if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const { id } = await params

      const existingFolder = await db
        .select()
        .from(folder)
        .where(and(eq(folder.id, id), isNull(folder.deletedAt)))
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

      await FOLDER_RESOURCE_POLICIES[existingFolder.resourceType].assertMutable(id)

      const result = await performDeleteFolder({
        resourceType: existingFolder.resourceType,
        folderId: id,
        workspaceId: existingFolder.workspaceId,
        userId: session.user.id,
        folderName: existingFolder.name,
      })

      if (!result.success) {
        return NextResponse.json(
          { error: result.error },
          { status: statusForOrchestrationError(result.errorCode) }
        )
      }

      captureServerEvent(
        session.user.id,
        'folder_deleted',
        { workspace_id: existingFolder.workspaceId },
        { groups: { workspace: existingFolder.workspaceId } }
      )

      return NextResponse.json({
        success: true,
        deletedItems: result.deletedItems,
      })
    } catch (error) {
      if (error instanceof ResourceLockedError) {
        return NextResponse.json({ error: error.message }, { status: error.status })
      }

      logger.error('Error deleting folder:', { error })
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)
