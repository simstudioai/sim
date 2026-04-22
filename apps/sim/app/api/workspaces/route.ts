import { db } from '@sim/db'
import { permissions, settings, type WorkspaceMode, workflow, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { AuditAction, AuditResourceType, recordAudit } from '@/lib/audit/log'
import { getSession } from '@/lib/auth'
import { PlatformEvents } from '@/lib/core/telemetry'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { captureServerEvent } from '@/lib/posthog/server'
import { buildDefaultWorkflowArtifacts } from '@/lib/workflows/defaults'
import { saveWorkflowToNormalizedTables } from '@/lib/workflows/persistence/utils'
import { getRandomWorkspaceColor } from '@/lib/workspaces/colors'
import {
  CONTACT_OWNER_TO_UPGRADE_REASON,
  evaluateWorkspaceInvitePolicy,
  getWorkspaceCreationPolicy,
  getWorkspaceInvitePolicy,
  hasActiveTeamOrEnterpriseSubscription,
  UPGRADE_TO_INVITE_REASON,
  WORKSPACE_MODE,
} from '@/lib/workspaces/policy'
import type { WorkspaceScope } from '@/lib/workspaces/utils'

const logger = createLogger('Workspaces')

const createWorkspaceSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  skipDefaultWorkflow: z.boolean().optional().default(false),
})

// Get all workspaces for the current user
export const GET = withRouteHandler(async (request: Request) => {
  const session = await getSession()

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const activeOrganizationId =
    (session.session as { activeOrganizationId?: string } | null)?.activeOrganizationId ?? null
  const creationPolicy = await getWorkspaceCreationPolicy({
    userId: session.user.id,
    activeOrganizationId,
  })

  const scope = (new URL(request.url).searchParams.get('scope') ?? 'active') as WorkspaceScope
  if (!['active', 'archived', 'all'].includes(scope)) {
    return NextResponse.json({ error: 'Invalid scope' }, { status: 400 })
  }

  const settingsQuery = db
    .select({ lastActiveWorkspaceId: settings.lastActiveWorkspaceId })
    .from(settings)
    .where(eq(settings.userId, session.user.id))
    .limit(1)

  const [userWorkspaces, userSettings] = await Promise.all([
    db
      .select({
        workspace: workspace,
        permissionType: permissions.permissionType,
      })
      .from(permissions)
      .innerJoin(workspace, eq(permissions.entityId, workspace.id))
      .where(
        scope === 'all'
          ? and(eq(permissions.userId, session.user.id), eq(permissions.entityType, 'workspace'))
          : scope === 'archived'
            ? and(
                eq(permissions.userId, session.user.id),
                eq(permissions.entityType, 'workspace'),
                sql`${workspace.archivedAt} IS NOT NULL`
              )
            : and(
                eq(permissions.userId, session.user.id),
                eq(permissions.entityType, 'workspace'),
                isNull(workspace.archivedAt)
              )
      )
      .orderBy(desc(workspace.createdAt)),
    settingsQuery,
  ])

  const lastActiveWorkspaceId = userSettings[0]?.lastActiveWorkspaceId ?? null

  if (scope === 'active' && userWorkspaces.length === 0) {
    if (!creationPolicy.canCreate) {
      return NextResponse.json({ workspaces: [], lastActiveWorkspaceId, creationPolicy })
    }

    const defaultWorkspace = await createDefaultWorkspace(
      session.user.id,
      session.user.name,
      creationPolicy
    )

    await migrateExistingWorkflows(session.user.id, defaultWorkspace.id)

    const refreshedCreationPolicy = await getWorkspaceCreationPolicy({
      userId: session.user.id,
      activeOrganizationId,
    })

    return NextResponse.json({
      workspaces: [defaultWorkspace],
      lastActiveWorkspaceId,
      creationPolicy: refreshedCreationPolicy,
    })
  }

  if (scope === 'active') {
    await ensureWorkflowsHaveWorkspace(session.user.id, userWorkspaces[0].workspace.id)
  }

  const grandfatheredBilledUserIds = [
    ...new Set(
      userWorkspaces
        .filter(({ workspace: ws }) => ws.workspaceMode === WORKSPACE_MODE.GRANDFATHERED_SHARED)
        .map(({ workspace: ws }) => ws.billedAccountUserId)
    ),
  ]
  const teamOrEnterpriseByUser = new Map<string, boolean>()
  await Promise.all(
    grandfatheredBilledUserIds.map(async (userId) => {
      teamOrEnterpriseByUser.set(userId, await hasActiveTeamOrEnterpriseSubscription(userId))
    })
  )

  const workspacesWithPermissions = userWorkspaces.map(
    ({ workspace: workspaceDetails, permissionType }) => {
      const invitePolicy = evaluateWorkspaceInvitePolicy(workspaceDetails, {
        billedUserHasTeamOrEnterprise:
          teamOrEnterpriseByUser.get(workspaceDetails.billedAccountUserId) ?? false,
      })
      const callerIsBilledUser = workspaceDetails.billedAccountUserId === session.user.id

      const canActOnUpgrade = invitePolicy.upgradeRequired && callerIsBilledUser
      const inviteDisabledReason = invitePolicy.allowed
        ? null
        : callerIsBilledUser
          ? (invitePolicy.reason ?? UPGRADE_TO_INVITE_REASON)
          : CONTACT_OWNER_TO_UPGRADE_REASON

      return {
        ...workspaceDetails,
        role:
          workspaceDetails.ownerId === session.user.id
            ? 'owner'
            : permissionType === 'admin'
              ? 'admin'
              : 'member',
        permissions: permissionType,
        inviteMembersEnabled: invitePolicy.allowed,
        inviteDisabledReason,
        inviteUpgradeRequired: canActOnUpgrade,
      }
    }
  )

  return NextResponse.json({
    workspaces: workspacesWithPermissions,
    lastActiveWorkspaceId,
    creationPolicy,
  })
})

// POST /api/workspaces - Create a new workspace
export const POST = withRouteHandler(async (req: Request) => {
  const session = await getSession()

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { name, color, skipDefaultWorkflow } = createWorkspaceSchema.parse(await req.json())
    const activeOrganizationId =
      (session.session as { activeOrganizationId?: string } | null)?.activeOrganizationId ?? null
    const creationPolicy = await getWorkspaceCreationPolicy({
      userId: session.user.id,
      activeOrganizationId,
    })

    if (!creationPolicy.canCreate) {
      return NextResponse.json(
        { error: creationPolicy.reason || 'Workspace creation is not available.' },
        { status: creationPolicy.status }
      )
    }

    const newWorkspace = await createWorkspace({
      userId: session.user.id,
      name,
      skipDefaultWorkflow,
      explicitColor: color,
      organizationId: creationPolicy.organizationId,
      workspaceMode: creationPolicy.workspaceMode,
      billedAccountUserId: creationPolicy.billedAccountUserId,
    })

    captureServerEvent(
      session.user.id,
      'workspace_created',
      {
        workspace_id: newWorkspace.id,
        name: newWorkspace.name,
        workspace_mode: newWorkspace.workspaceMode,
        organization_id: newWorkspace.organizationId,
      },
      {
        groups: { workspace: newWorkspace.id },
        setOnce: { first_workspace_created_at: new Date().toISOString() },
      }
    )

    recordAudit({
      workspaceId: newWorkspace.id,
      actorId: session.user.id,
      actorName: session.user.name,
      actorEmail: session.user.email,
      action: AuditAction.WORKSPACE_CREATED,
      resourceType: AuditResourceType.WORKSPACE,
      resourceId: newWorkspace.id,
      resourceName: newWorkspace.name,
      description: `Created workspace "${newWorkspace.name}"`,
      metadata: {
        name: newWorkspace.name,
        color: newWorkspace.color,
        workspaceMode: newWorkspace.workspaceMode,
        organizationId: newWorkspace.organizationId,
      },
      request: req,
    })

    return NextResponse.json({ workspace: newWorkspace })
  } catch (error) {
    logger.error('Error creating workspace:', error)
    return NextResponse.json({ error: 'Failed to create workspace' }, { status: 500 })
  }
})

async function createDefaultWorkspace(
  userId: string,
  userName: string | null | undefined,
  creationPolicy: {
    organizationId: string | null
    workspaceMode: WorkspaceMode
    billedAccountUserId: string
  }
) {
  const firstName = userName?.split(' ')[0] || null
  const workspaceName = firstName ? `${firstName}'s Workspace` : 'My Workspace'
  return createWorkspace({
    userId,
    name: workspaceName,
    organizationId: creationPolicy.organizationId,
    workspaceMode: creationPolicy.workspaceMode,
    billedAccountUserId: creationPolicy.billedAccountUserId,
  })
}

interface CreateWorkspaceParams {
  userId: string
  name: string
  skipDefaultWorkflow?: boolean
  explicitColor?: string
  organizationId: string | null
  workspaceMode: WorkspaceMode
  billedAccountUserId: string
}

async function createWorkspace({
  userId,
  name,
  skipDefaultWorkflow = false,
  explicitColor,
  organizationId,
  workspaceMode,
  billedAccountUserId,
}: CreateWorkspaceParams) {
  const workspaceId = generateId()
  const workflowId = generateId()
  const now = new Date()
  const color = explicitColor || getRandomWorkspaceColor()

  try {
    await db.transaction(async (tx) => {
      await tx.insert(workspace).values({
        id: workspaceId,
        name,
        color,
        ownerId: userId,
        organizationId,
        workspaceMode,
        billedAccountUserId,
        allowPersonalApiKeys: true,
        createdAt: now,
        updatedAt: now,
      })

      const permissionRows = [
        {
          id: generateId(),
          entityType: 'workspace' as const,
          entityId: workspaceId,
          userId,
          permissionType: 'admin' as const,
          createdAt: now,
          updatedAt: now,
        },
      ]

      if (
        workspaceMode === WORKSPACE_MODE.ORGANIZATION &&
        billedAccountUserId &&
        billedAccountUserId !== userId
      ) {
        permissionRows.push({
          id: generateId(),
          entityType: 'workspace' as const,
          entityId: workspaceId,
          userId: billedAccountUserId,
          permissionType: 'admin' as const,
          createdAt: now,
          updatedAt: now,
        })
      }

      await tx.insert(permissions).values(permissionRows)

      if (!skipDefaultWorkflow) {
        await tx.insert(workflow).values({
          id: workflowId,
          userId,
          workspaceId,
          folderId: null,
          name: 'default-agent',
          description: 'Your first workflow - start building here!',
          color: '#3972F6',
          lastSynced: now,
          createdAt: now,
          updatedAt: now,
          isDeployed: false,
          runCount: 0,
          variables: {},
        })

        const { workflowState } = buildDefaultWorkflowArtifacts()
        await saveWorkflowToNormalizedTables(workflowId, workflowState, tx)
      }

      logger.info(
        skipDefaultWorkflow
          ? `Created ${workspaceMode} workspace ${workspaceId} for user ${userId}`
          : `Created ${workspaceMode} workspace ${workspaceId} with initial workflow ${workflowId} for user ${userId}`
      )
    })
  } catch (error) {
    logger.error(`Failed to create workspace ${workspaceId}:`, error)
    throw error
  }

  try {
    PlatformEvents.workspaceCreated({
      workspaceId,
      userId,
      name,
    })
  } catch {
    // Telemetry should not fail the operation
  }

  const invitePolicy = await getWorkspaceInvitePolicy({
    organizationId,
    workspaceMode,
    billedAccountUserId,
    ownerId: userId,
  })
  const callerIsBilledUser = billedAccountUserId === userId
  const canActOnUpgrade = invitePolicy.upgradeRequired && callerIsBilledUser
  const inviteDisabledReason = invitePolicy.allowed
    ? null
    : callerIsBilledUser
      ? (invitePolicy.reason ?? UPGRADE_TO_INVITE_REASON)
      : CONTACT_OWNER_TO_UPGRADE_REASON

  return {
    id: workspaceId,
    name,
    color,
    ownerId: userId,
    organizationId,
    workspaceMode,
    billedAccountUserId,
    allowPersonalApiKeys: true,
    createdAt: now,
    updatedAt: now,
    role: 'owner',
    permissions: 'admin',
    inviteMembersEnabled: invitePolicy.allowed,
    inviteDisabledReason,
    inviteUpgradeRequired: canActOnUpgrade,
  }
}

async function migrateExistingWorkflows(userId: string, workspaceId: string) {
  const orphanedWorkflows = await db
    .select({ id: workflow.id })
    .from(workflow)
    .where(and(eq(workflow.userId, userId), isNull(workflow.workspaceId)))

  if (orphanedWorkflows.length === 0) {
    return // No orphaned workflows to migrate
  }

  logger.info(
    `Migrating ${orphanedWorkflows.length} workflows to workspace ${workspaceId} for user ${userId}`
  )

  await db
    .update(workflow)
    .set({
      workspaceId: workspaceId,
      updatedAt: new Date(),
    })
    .where(and(eq(workflow.userId, userId), isNull(workflow.workspaceId)))
}

async function ensureWorkflowsHaveWorkspace(userId: string, defaultWorkspaceId: string) {
  const orphanedWorkflows = await db
    .select()
    .from(workflow)
    .where(and(eq(workflow.userId, userId), isNull(workflow.workspaceId)))

  if (orphanedWorkflows.length > 0) {
    await db
      .update(workflow)
      .set({
        workspaceId: defaultWorkspaceId,
        updatedAt: new Date(),
      })
      .where(and(eq(workflow.userId, userId), isNull(workflow.workspaceId)))

    logger.info(`Fixed ${orphanedWorkflows.length} orphaned workflows for user ${userId}`)
  }
}
