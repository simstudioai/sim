import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { permissionGroup, permissionGroupMember } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getPostgresConstraintName, getPostgresErrorCode } from '@sim/utils/errors'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { updatePermissionGroupContract } from '@/lib/api/contracts/permission-groups'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  PERMISSION_GROUP_CONSTRAINTS,
  type PermissionGroupConfig,
  parsePermissionGroupConfig,
} from '@/lib/permission-groups/types'
import {
  authorizeOrgAccessControl,
  loadGroupInOrganization,
} from '@/app/api/organizations/[id]/permission-groups/utils'

const logger = createLogger('OrganizationPermissionGroup')

export const GET = withRouteHandler(
  async (_req: NextRequest, { params }: { params: Promise<{ id: string; groupId: string }> }) => {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: organizationId, groupId: id } = await params

    const denied = await authorizeOrgAccessControl(session.user.id, organizationId)
    if (denied) return denied

    const group = await loadGroupInOrganization(id, organizationId)
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

    const { id: organizationId, groupId: id } = await context.params

    try {
      const denied = await authorizeOrgAccessControl(session.user.id, organizationId)
      if (denied) return denied

      const group = await loadGroupInOrganization(id, organizationId)
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
              eq(permissionGroup.organizationId, organizationId),
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
        if (updates.isDefault === true) {
          await tx
            .update(permissionGroup)
            .set({ isDefault: false, updatedAt: now })
            .where(
              and(
                eq(permissionGroup.organizationId, organizationId),
                eq(permissionGroup.isDefault, true)
              )
            )
        }

        await tx
          .update(permissionGroup)
          .set({
            ...(updates.name !== undefined && { name: updates.name }),
            ...(updates.description !== undefined && { description: updates.description }),
            ...(updates.isDefault !== undefined && { isDefault: updates.isDefault }),
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
        actorId: session.user.id,
        action: AuditAction.PERMISSION_GROUP_UPDATED,
        resourceType: AuditResourceType.PERMISSION_GROUP,
        resourceId: id,
        actorName: session.user.name ?? undefined,
        actorEmail: session.user.email ?? undefined,
        resourceName: updated.name,
        description: `Updated permission group "${updated.name}"`,
        metadata: {
          organizationId,
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
      if (getPostgresErrorCode(error) === '23505') {
        const constraint = getPostgresConstraintName(error)
        if (constraint === PERMISSION_GROUP_CONSTRAINTS.organizationName) {
          return NextResponse.json(
            { error: 'A permission group with this name already exists' },
            { status: 409 }
          )
        }
        if (constraint === PERMISSION_GROUP_CONSTRAINTS.organizationDefault) {
          return NextResponse.json(
            {
              error:
                'Another group was concurrently set as the default. Please refresh and try again.',
            },
            { status: 409 }
          )
        }
      }
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

    const { id: organizationId, groupId: id } = await params

    try {
      const denied = await authorizeOrgAccessControl(session.user.id, organizationId)
      if (denied) return denied

      const group = await loadGroupInOrganization(id, organizationId)
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
        organizationId,
        userId: session.user.id,
      })

      recordAudit({
        actorId: session.user.id,
        action: AuditAction.PERMISSION_GROUP_DELETED,
        resourceType: AuditResourceType.PERMISSION_GROUP,
        resourceId: id,
        actorName: session.user.name ?? undefined,
        actorEmail: session.user.email ?? undefined,
        resourceName: group.name,
        description: `Deleted permission group "${group.name}"`,
        metadata: { organizationId },
        request: req,
      })

      return NextResponse.json({ success: true })
    } catch (error) {
      logger.error('Error deleting permission group', error)
      return NextResponse.json({ error: 'Failed to delete permission group' }, { status: 500 })
    }
  }
)
