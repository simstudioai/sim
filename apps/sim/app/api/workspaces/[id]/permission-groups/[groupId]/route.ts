import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { permissionGroup, permissionGroupMember } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { updatePermissionGroupContract } from '@/lib/api/contracts/permission-groups'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { isWorkspaceOnEnterprisePlan } from '@/lib/billing'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  type PermissionGroupConfig,
  parsePermissionGroupConfig,
} from '@/lib/permission-groups/types'
import { checkWorkspaceAccess, hasWorkspaceAdminAccess } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('WorkspacePermissionGroup')

async function loadGroupInWorkspace(groupId: string, workspaceId: string) {
  const [group] = await db
    .select({
      id: permissionGroup.id,
      workspaceId: permissionGroup.workspaceId,
      name: permissionGroup.name,
      description: permissionGroup.description,
      config: permissionGroup.config,
      createdBy: permissionGroup.createdBy,
      createdAt: permissionGroup.createdAt,
      updatedAt: permissionGroup.updatedAt,
      autoAddNewMembers: permissionGroup.autoAddNewMembers,
    })
    .from(permissionGroup)
    .where(and(eq(permissionGroup.id, groupId), eq(permissionGroup.workspaceId, workspaceId)))
    .limit(1)

  return group ?? null
}

export const GET = withRouteHandler(
  async (_req: NextRequest, { params }: { params: Promise<{ id: string; groupId: string }> }) => {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: workspaceId, groupId: id } = await params

    const access = await checkWorkspaceAccess(workspaceId, session.user.id)
    if (!access.exists) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    }
    if (!access.hasAccess) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const entitled = await isWorkspaceOnEnterprisePlan(workspaceId)
    if (!entitled) {
      return NextResponse.json(
        { error: 'Access Control is an Enterprise feature' },
        { status: 403 }
      )
    }

    const group = await loadGroupInWorkspace(id, workspaceId)

    if (!group) {
      return NextResponse.json({ error: 'Permission group not found' }, { status: 404 })
    }

    return NextResponse.json({
      permissionGroup: {
        ...group,
        config: parsePermissionGroupConfig(group.config),
      },
    })
  }
)

export const PUT = withRouteHandler(
  async (req: NextRequest, context: { params: Promise<{ id: string; groupId: string }> }) => {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: workspaceId, groupId: id } = await context.params

    try {
      const isWorkspaceAdmin = await hasWorkspaceAdminAccess(session.user.id, workspaceId)
      if (!isWorkspaceAdmin) {
        return NextResponse.json({ error: 'Admin permissions required' }, { status: 403 })
      }

      const entitled = await isWorkspaceOnEnterprisePlan(workspaceId)
      if (!entitled) {
        return NextResponse.json(
          { error: 'Access Control is an Enterprise feature' },
          { status: 403 }
        )
      }

      const group = await loadGroupInWorkspace(id, workspaceId)
      if (!group) {
        return NextResponse.json({ error: 'Permission group not found' }, { status: 404 })
      }

      const parsed = await parseRequest(updatePermissionGroupContract, req, context, {
        validationErrorResponse: (error) =>
          NextResponse.json({ error: getValidationErrorMessage(error) }, { status: 400 }),
      })
      if (!parsed.success) return parsed.response
      const updates = parsed.data.body

      if (updates.name) {
        const existingGroup = await db
          .select({ id: permissionGroup.id })
          .from(permissionGroup)
          .where(
            and(
              eq(permissionGroup.workspaceId, workspaceId),
              eq(permissionGroup.name, updates.name)
            )
          )
          .limit(1)

        if (existingGroup.length > 0 && existingGroup[0].id !== id) {
          return NextResponse.json(
            { error: 'A permission group with this name already exists' },
            { status: 409 }
          )
        }
      }

      const currentConfig = parsePermissionGroupConfig(group.config)
      const newConfig: PermissionGroupConfig = updates.config
        ? { ...currentConfig, ...updates.config }
        : currentConfig

      const now = new Date()

      await db.transaction(async (tx) => {
        if (updates.autoAddNewMembers === true) {
          await tx
            .update(permissionGroup)
            .set({ autoAddNewMembers: false, updatedAt: now })
            .where(
              and(
                eq(permissionGroup.workspaceId, workspaceId),
                eq(permissionGroup.autoAddNewMembers, true)
              )
            )
        }

        await tx
          .update(permissionGroup)
          .set({
            ...(updates.name !== undefined && { name: updates.name }),
            ...(updates.description !== undefined && { description: updates.description }),
            ...(updates.autoAddNewMembers !== undefined && {
              autoAddNewMembers: updates.autoAddNewMembers,
            }),
            config: newConfig,
            updatedAt: now,
          })
          .where(eq(permissionGroup.id, id))
      })

      const [updated] = await db
        .select()
        .from(permissionGroup)
        .where(eq(permissionGroup.id, id))
        .limit(1)

      recordAudit({
        workspaceId,
        actorId: session.user.id,
        action: AuditAction.PERMISSION_GROUP_UPDATED,
        resourceType: AuditResourceType.PERMISSION_GROUP,
        resourceId: id,
        actorName: session.user.name ?? undefined,
        actorEmail: session.user.email ?? undefined,
        resourceName: updated.name,
        description: `Updated permission group "${updated.name}"`,
        metadata: {
          workspaceId,
          updatedFields: Object.keys(updates).filter(
            (k) => updates[k as keyof typeof updates] !== undefined
          ),
        },
        request: req,
      })

      return NextResponse.json({
        permissionGroup: {
          ...updated,
          config: parsePermissionGroupConfig(updated.config),
        },
      })
    } catch (error) {
      logger.error('Error updating permission group', error)
      return NextResponse.json({ error: 'Failed to update permission group' }, { status: 500 })
    }
  }
)

export const DELETE = withRouteHandler(
  async (req: NextRequest, { params }: { params: Promise<{ id: string; groupId: string }> }) => {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: workspaceId, groupId: id } = await params

    try {
      const isWorkspaceAdmin = await hasWorkspaceAdminAccess(session.user.id, workspaceId)
      if (!isWorkspaceAdmin) {
        return NextResponse.json({ error: 'Admin permissions required' }, { status: 403 })
      }

      const entitled = await isWorkspaceOnEnterprisePlan(workspaceId)
      if (!entitled) {
        return NextResponse.json(
          { error: 'Access Control is an Enterprise feature' },
          { status: 403 }
        )
      }

      const group = await loadGroupInWorkspace(id, workspaceId)
      if (!group) {
        return NextResponse.json({ error: 'Permission group not found' }, { status: 404 })
      }

      await db.transaction(async (tx) => {
        await tx
          .delete(permissionGroupMember)
          .where(eq(permissionGroupMember.permissionGroupId, id))
        await tx.delete(permissionGroup).where(eq(permissionGroup.id, id))
      })

      logger.info('Deleted permission group', {
        permissionGroupId: id,
        workspaceId,
        userId: session.user.id,
      })

      recordAudit({
        workspaceId,
        actorId: session.user.id,
        action: AuditAction.PERMISSION_GROUP_DELETED,
        resourceType: AuditResourceType.PERMISSION_GROUP,
        resourceId: id,
        actorName: session.user.name ?? undefined,
        actorEmail: session.user.email ?? undefined,
        resourceName: group.name,
        description: `Deleted permission group "${group.name}"`,
        metadata: { workspaceId },
        request: req,
      })

      return NextResponse.json({ success: true })
    } catch (error) {
      logger.error('Error deleting permission group', error)
      return NextResponse.json({ error: 'Failed to delete permission group' }, { status: 500 })
    }
  }
)
