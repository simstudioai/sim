import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import {
  permissionGroup,
  permissionGroupMember,
  permissionGroupWorkspace,
  user,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getPostgresConstraintName, getPostgresErrorCode } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, count, desc, eq, inArray } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { createPermissionGroupContract } from '@/lib/api/contracts/permission-groups'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  DEFAULT_PERMISSION_GROUP_CONFIG,
  PERMISSION_GROUP_CONSTRAINTS,
  type PermissionGroupConfig,
  parsePermissionGroupConfig,
} from '@/lib/permission-groups/types'
import {
  type AllMembersConflict,
  acquirePermissionGroupOrgLock,
  authorizeOrgAccessControl,
  findAllMembersWorkspaceConflict,
  findWorkspacesNotInOrganization,
  formatAllMembersConflictError,
  getWorkspacesForGroups,
} from '@/app/api/organizations/[id]/permission-groups/utils'

const logger = createLogger('OrganizationPermissionGroups')

export const GET = withRouteHandler(
  async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: organizationId } = await params

    const denied = await authorizeOrgAccessControl(session.user.id, organizationId)
    if (denied) return denied

    const groups = await db
      .select({
        id: permissionGroup.id,
        name: permissionGroup.name,
        description: permissionGroup.description,
        config: permissionGroup.config,
        createdBy: permissionGroup.createdBy,
        createdAt: permissionGroup.createdAt,
        updatedAt: permissionGroup.updatedAt,
        isDefault: permissionGroup.isDefault,
        creatorName: user.name,
        creatorEmail: user.email,
      })
      .from(permissionGroup)
      .leftJoin(user, eq(permissionGroup.createdBy, user.id))
      .where(eq(permissionGroup.organizationId, organizationId))
      .orderBy(desc(permissionGroup.createdAt))

    const groupIds = groups.map((group) => group.id)
    const memberCounts = groupIds.length
      ? await db
          .select({
            permissionGroupId: permissionGroupMember.permissionGroupId,
            count: count(),
          })
          .from(permissionGroupMember)
          .where(inArray(permissionGroupMember.permissionGroupId, groupIds))
          .groupBy(permissionGroupMember.permissionGroupId)
      : []
    const countByGroupId = new Map(memberCounts.map((row) => [row.permissionGroupId, row.count]))
    const workspacesByGroupId = await getWorkspacesForGroups(groupIds)

    const groupsWithCounts = groups.map((group) => ({
      ...group,
      config: parsePermissionGroupConfig(group.config),
      memberCount: countByGroupId.get(group.id) ?? 0,
      workspaces: workspacesByGroupId.get(group.id) ?? [],
    }))

    return NextResponse.json({ permissionGroups: groupsWithCounts })
  }
)

export const POST = withRouteHandler(
  async (req: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: organizationId } = await context.params

    // Populated inside the transaction when an all-members scope conflict is
    // detected, so the catch can format the 409 after the rollback.
    let allMembersConflict: AllMembersConflict | null = null

    try {
      const denied = await authorizeOrgAccessControl(session.user.id, organizationId)
      if (denied) return denied

      const parsed = await parseRequest(createPermissionGroupContract, req, context, {
        validationErrorResponse: (error) =>
          NextResponse.json({ error: getValidationErrorMessage(error) }, { status: 400 }),
      })
      if (!parsed.success) return parsed.response
      const { name, description, config, isDefault } = parsed.data.body

      // Only the organization default group is org-wide; every other group
      // targets specific workspaces. "Org-wide" is definitionally `isDefault`.
      const isDefaultGroup = isDefault === true
      const workspaceIds = isDefaultGroup
        ? []
        : Array.from(new Set(parsed.data.body.workspaceIds ?? []))

      if (!isDefaultGroup && workspaceIds.length === 0) {
        return NextResponse.json(
          { error: 'Select at least one workspace when the group targets specific workspaces' },
          { status: 400 }
        )
      }

      if (!isDefaultGroup) {
        const invalid = await findWorkspacesNotInOrganization(workspaceIds, organizationId)
        if (invalid.length > 0) {
          return NextResponse.json(
            { error: 'One or more selected workspaces do not belong to this organization' },
            { status: 400 }
          )
        }
      }

      const existingGroup = await db
        .select({ id: permissionGroup.id })
        .from(permissionGroup)
        .where(
          and(eq(permissionGroup.organizationId, organizationId), eq(permissionGroup.name, name))
        )
        .limit(1)

      if (existingGroup.length > 0) {
        return NextResponse.json(
          { error: 'A permission group with this name already exists' },
          { status: 409 }
        )
      }

      const groupConfig: PermissionGroupConfig = {
        ...DEFAULT_PERMISSION_GROUP_CONFIG,
        ...config,
      }

      const now = new Date()
      const newGroup = {
        id: generateId(),
        organizationId,
        name,
        description: description || null,
        config: groupConfig,
        createdBy: session.user.id,
        createdAt: now,
        updatedAt: now,
        isDefault: isDefault || false,
      }

      await db.transaction(async (tx) => {
        await acquirePermissionGroupOrgLock(tx, organizationId)

        // A new non-default group has no members, so it governs all members of
        // its workspaces; reject when another all-members group already does.
        if (!isDefaultGroup) {
          const conflict = await findAllMembersWorkspaceConflict(
            { organizationId, excludeGroupId: newGroup.id, workspaceIds },
            tx
          )
          if (conflict) {
            allMembersConflict = conflict
            throw new Error('ALL_MEMBERS_CONFLICT')
          }
        }

        if (isDefault) {
          // Demote the prior default to a non-default group (only the default may
          // be org-wide); it ends up with no workspaces (inert) until an admin
          // re-scopes it.
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
        await tx.insert(permissionGroup).values(newGroup)
        if (workspaceIds.length > 0) {
          await tx.insert(permissionGroupWorkspace).values(
            workspaceIds.map((workspaceId) => ({
              id: generateId(),
              permissionGroupId: newGroup.id,
              workspaceId,
              organizationId,
              createdAt: now,
            }))
          )
        }
      })

      logger.info('Created permission group', {
        permissionGroupId: newGroup.id,
        organizationId,
        userId: session.user.id,
        workspaceCount: workspaceIds.length,
      })

      recordAudit({
        actorId: session.user.id,
        action: AuditAction.PERMISSION_GROUP_CREATED,
        resourceType: AuditResourceType.PERMISSION_GROUP,
        resourceId: newGroup.id,
        actorName: session.user.name ?? undefined,
        actorEmail: session.user.email ?? undefined,
        resourceName: name,
        description: `Created permission group "${name}"`,
        metadata: {
          organizationId,
          isDefault: isDefault || false,
          workspaceCount: workspaceIds.length,
        },
        request: req,
      })

      return NextResponse.json({ permissionGroup: { ...newGroup, workspaceIds } }, { status: 201 })
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'ALL_MEMBERS_CONFLICT' &&
        allMembersConflict
      ) {
        return NextResponse.json(
          { error: formatAllMembersConflictError(allMembersConflict) },
          { status: 409 }
        )
      }
      if (getPostgresErrorCode(error) === '55P03') {
        return NextResponse.json(
          { error: 'This organization is being updated by another request. Please try again.' },
          { status: 503 }
        )
      }
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
      logger.error('Error creating permission group', error)
      return NextResponse.json({ error: 'Failed to create permission group' }, { status: 500 })
    }
  }
)
