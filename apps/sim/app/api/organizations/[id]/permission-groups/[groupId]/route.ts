import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { permissionGroup, permissionGroupMember, permissionGroupWorkspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getPostgresConstraintName, getPostgresErrorCode } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
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
  type AllMembersConflict,
  acquirePermissionGroupOrgLock,
  authorizeOrgAccessControl,
  findAllMembersWorkspaceConflict,
  findScopeConflicts,
  findWorkspacesNotInOrganization,
  formatAllMembersConflictError,
  formatScopeConflictError,
  getGroupWorkspaces,
  loadGroupInOrganization,
  type ScopeConflict,
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

    const workspaces = group.appliesToAllWorkspaces ? [] : await getGroupWorkspaces(id)

    return NextResponse.json({
      permissionGroup: {
        ...group,
        config: parsePermissionGroupConfig(group.config),
        workspaces,
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

    // Populated inside the transaction when a scope conflict is detected, so the
    // catch can format the 409 after the rollback.
    let scopeConflicts: ScopeConflict[] = []
    let allMembersConflict: AllMembersConflict | null = null

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

      // Demoting the org default with no new scope: it becomes a non-default
      // group with no workspaces (inert) until an admin re-scopes it. The client
      // sends only `isDefault: false`, so this never forwards a workspace list
      // (which a non-default group otherwise requires) against the per-group cap.
      const demotingDefaultToInert =
        group.isDefault &&
        updates.isDefault === false &&
        updates.appliesToAllWorkspaces === undefined &&
        updates.workspaceIds === undefined

      // Resolve the target workspace scope. Setting the group as default forces
      // all-workspaces; otherwise an explicit `appliesToAllWorkspaces` wins, and
      // supplying `workspaceIds` alone implies a specific scope.
      const scopeProvided =
        demotingDefaultToInert ||
        updates.appliesToAllWorkspaces !== undefined ||
        updates.workspaceIds !== undefined ||
        updates.isDefault === true

      const resolvedAppliesToAll = demotingDefaultToInert
        ? false
        : updates.isDefault === true
          ? true
          : updates.appliesToAllWorkspaces !== undefined
            ? updates.appliesToAllWorkspaces
            : updates.workspaceIds !== undefined
              ? false
              : group.appliesToAllWorkspaces

      const effectiveIsDefault =
        updates.isDefault !== undefined ? updates.isDefault : group.isDefault
      if (effectiveIsDefault && !resolvedAppliesToAll) {
        return NextResponse.json(
          { error: 'The default group must apply to all workspaces' },
          { status: 400 }
        )
      }
      if (!effectiveIsDefault && resolvedAppliesToAll) {
        return NextResponse.json(
          { error: 'Non-default groups must target specific workspaces' },
          { status: 400 }
        )
      }

      // Resolve and validate explicitly-provided workspaceIds before the
      // transaction. When the request omits them for a specific-scope group
      // ("keep current"), they're read under the lock instead (see below) so the
      // conflict check and the write share one consistent snapshot.
      let providedWorkspaceIds: string[] | null = null
      if (!resolvedAppliesToAll && updates.workspaceIds !== undefined) {
        // Zero workspaces is allowed on update: the group then governs nothing
        // (the resolver inner-joins on the link table, so an empty group never
        // matches any workspace). No "at least one" floor here.
        providedWorkspaceIds = Array.from(new Set(updates.workspaceIds))
        const invalid = await findWorkspacesNotInOrganization(providedWorkspaceIds, organizationId)
        if (invalid.length > 0) {
          return NextResponse.json(
            { error: 'One or more selected workspaces do not belong to this organization' },
            { status: 400 }
          )
        }
      }

      const now = new Date()

      await db.transaction(async (tx) => {
        // For a specific-scope group the target workspaces are the request's
        // explicit ids, or — when omitted ("keep current") — the group's current
        // workspaces read under the lock so the conflict check and write share
        // one snapshot.
        let resolvedWorkspaceIds: string[] = []

        // When the scope changes, serialize against other permission-group writes
        // for this org and re-check membership conflicts atomically with the
        // write, so a concurrent member add (or scope change) can't slip a user
        // into two groups that overlap on a workspace.
        if (scopeProvided) {
          await acquirePermissionGroupOrgLock(tx, organizationId)

          if (!resolvedAppliesToAll) {
            // May resolve to an empty list — a specific-scope group is allowed to
            // target zero workspaces (governs nothing). The write below deletes
            // the old links and inserts none.
            resolvedWorkspaceIds =
              providedWorkspaceIds ?? (await getGroupWorkspaces(id, tx)).map((ws) => ws.id)
          }

          const members = await tx
            .select({ userId: permissionGroupMember.userId })
            .from(permissionGroupMember)
            .where(eq(permissionGroupMember.permissionGroupId, id))
          const conflicts = await findScopeConflicts(
            {
              organizationId,
              excludeGroupId: id,
              workspaceIds: resolvedWorkspaceIds,
              candidateUserIds: members.map((m) => m.userId),
            },
            tx
          )
          if (conflicts.length > 0) {
            scopeConflicts = conflicts
            throw new Error('SCOPE_CONFLICT')
          }

          // With no explicit members the group governs all members of its
          // workspaces; reject when another all-members group already does.
          if (!resolvedAppliesToAll && members.length === 0) {
            const conflict = await findAllMembersWorkspaceConflict(
              { organizationId, excludeGroupId: id, workspaceIds: resolvedWorkspaceIds },
              tx
            )
            if (conflict) {
              allMembersConflict = conflict
              throw new Error('ALL_MEMBERS_CONFLICT')
            }
          }
        }

        if (updates.isDefault === true) {
          // Demote the prior default to a non-default group. It must also drop
          // the all-workspaces scope (only the default may be org-wide); it ends
          // up with no workspaces (inert) until an admin re-scopes it.
          await tx
            .update(permissionGroup)
            .set({ isDefault: false, appliesToAllWorkspaces: false, updatedAt: now })
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
            ...(scopeProvided && { appliesToAllWorkspaces: resolvedAppliesToAll }),
            config: newConfig,
            updatedAt: now,
          })
          .where(eq(permissionGroup.id, id))

        if (scopeProvided) {
          await tx
            .delete(permissionGroupWorkspace)
            .where(eq(permissionGroupWorkspace.permissionGroupId, id))
          if (!resolvedAppliesToAll && resolvedWorkspaceIds.length > 0) {
            await tx.insert(permissionGroupWorkspace).values(
              resolvedWorkspaceIds.map((workspaceId) => ({
                id: generateId(),
                permissionGroupId: id,
                workspaceId,
                organizationId,
                createdAt: now,
              }))
            )
          }
        }
      })

      const [updated] = await db
        .select()
        .from(permissionGroup)
        .where(eq(permissionGroup.id, id))
        .limit(1)

      const finalWorkspaceIds = updated.appliesToAllWorkspaces
        ? []
        : (await getGroupWorkspaces(id)).map((ws) => ws.id)

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
          workspaceIds: finalWorkspaceIds,
        },
      })
    } catch (error) {
      if (error instanceof Error && error.message === 'SCOPE_CONFLICT') {
        return NextResponse.json(
          { error: formatScopeConflictError(scopeConflicts) },
          { status: 409 }
        )
      }
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
      // Advisory lock wait exceeded (lock_timeout) — transient contention.
      if (getPostgresErrorCode(error) === '55P03') {
        return NextResponse.json(
          { error: 'This group is being updated by another request. Please try again.' },
          { status: 503 }
        )
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
        await acquirePermissionGroupOrgLock(tx, organizationId)
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
      // Advisory lock wait exceeded (lock_timeout) — transient contention.
      if (getPostgresErrorCode(error) === '55P03') {
        return NextResponse.json(
          { error: 'This group is being updated by another request. Please try again.' },
          { status: 503 }
        )
      }
      logger.error('Error deleting permission group', error)
      return NextResponse.json({ error: 'Failed to delete permission group' }, { status: 500 })
    }
  }
)
