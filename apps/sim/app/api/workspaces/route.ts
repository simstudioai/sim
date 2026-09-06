import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { type WorkspaceMode, workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getPostgresErrorCode } from '@sim/utils/errors'
import { and, eq, isNull } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { listWorkspacesQuerySchema } from '@/lib/api/contracts'
import { createWorkspaceContract } from '@/lib/api/contracts/workspaces'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { getActiveOrganizationId } from '@/lib/auth/session-response'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { capabilityRefusalResponse } from '@/lib/permission-groups/capability-response'
import { captureServerEvent } from '@/lib/posthog/server'
import { createWorkspace } from '@/lib/workspaces/create'
import { listWorkspacesForViewer } from '@/lib/workspaces/list'
import {
  getWorkspaceCreationPolicy,
  WorkspaceCreationCapabilityWithheldError,
  WorkspaceCreationContextChangedError,
} from '@/lib/workspaces/policy'

const logger = createLogger('Workspaces')

// Get all workspaces for the current user
export const GET = withRouteHandler(async (request: Request) => {
  const session = await getSession()

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const scopeResult = listWorkspacesQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams.entries())
  )
  if (!scopeResult.success) {
    return NextResponse.json(
      { error: 'Invalid query parameters', details: scopeResult.error.issues },
      { status: 400 }
    )
  }
  const { scope } = scopeResult.data

  const activeOrganizationId = getActiveOrganizationId(session)
  const payload = await listWorkspacesForViewer({
    userId: session.user.id,
    activeOrganizationId,
    scope,
  })
  const { lastActiveWorkspaceId, pinnedWorkspaceIds, creationPolicy } = payload

  if (scope === 'active' && payload.workspaces.length === 0) {
    if (!creationPolicy.canCreate) {
      return NextResponse.json({
        workspaces: [],
        lastActiveWorkspaceId,
        pinnedWorkspaceIds,
        creationPolicy,
      })
    }

    let defaultWorkspace: Awaited<ReturnType<typeof createDefaultWorkspace>>
    try {
      defaultWorkspace = await createDefaultWorkspace(
        session.user.id,
        session.user.name,
        creationPolicy
      )
    } catch (error) {
      /**
       * The user joined an organization between the empty list read and the
       * default-workspace insert. Their workspaces (the join sweep's output)
       * exist now — re-list and return that instead of failing the load.
       */
      if (error instanceof WorkspaceCreationContextChangedError) {
        logger.info(
          'Default workspace creation raced an organization membership change; re-listing',
          {
            userId: session.user.id,
          }
        )
        const refreshedPayload = await listWorkspacesForViewer({
          userId: session.user.id,
          activeOrganizationId,
          scope,
        })
        return NextResponse.json(refreshedPayload)
      }
      throw error
    }

    await migrateExistingWorkflows(session.user.id, defaultWorkspace.id)

    const refreshedCreationPolicy = await getWorkspaceCreationPolicy({
      userId: session.user.id,
      activeOrganizationId,
    })

    return NextResponse.json({
      workspaces: [defaultWorkspace],
      lastActiveWorkspaceId,
      pinnedWorkspaceIds,
      creationPolicy: refreshedCreationPolicy,
    })
  }

  if (scope === 'active') {
    await ensureWorkflowsHaveWorkspace(session.user.id, payload.workspaces[0].id)
  }

  return NextResponse.json(payload)
})

// POST /api/workspaces - Create a new workspace
export const POST = withRouteHandler(async (req: NextRequest) => {
  const session = await getSession()

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = await parseRequest(createWorkspaceContract, req, {})
    if (!parsed.success) return parsed.response
    const { name, skipDefaultWorkflow } = parsed.data.body
    const activeOrganizationId = getActiveOrganizationId(session)
    const creationPolicy = await getWorkspaceCreationPolicy({
      userId: session.user.id,
      activeOrganizationId,
    })

    if (!creationPolicy.canCreate) {
      /**
       * The preflight refusal and the revocation-race refusal are the same
       * decision reached at two moments, so they must be the same body. Without
       * this branch the common path — the group already denied `workspace.create`
       * when the policy was read — answered a bare `{ error }`, while only the
       * race the `catch` below handles carried
       * `details.code: PERMISSION_GROUP_CAPABILITY_BLOCKED`. A client that keys
       * off the code then saw the capability refusal in the rarer case only.
       */
      if (creationPolicy.blockedReasonCode === 'permission-group-denied') {
        return capabilityRefusalResponse('workspace.create')
      }
      return NextResponse.json(
        { error: creationPolicy.reason || 'Workspace creation is not available.' },
        { status: creationPolicy.status }
      )
    }

    const newWorkspace = await createWorkspace({
      userId: session.user.id,
      name,
      skipDefaultWorkflow,
      organizationId: creationPolicy.organizationId,
      workspaceMode: creationPolicy.workspaceMode,
      billedAccountUserId: creationPolicy.billedAccountUserId,
      observedOrganizationId: creationPolicy.observedOrganizationId,
      governingPermissionGroupOrganizationId: creationPolicy.governingPermissionGroupOrganizationId,
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
        workspaceMode: newWorkspace.workspaceMode,
        organizationId: newWorkspace.organizationId,
      },
      request: req,
    })

    return NextResponse.json({ workspace: newWorkspace })
  } catch (error) {
    if (error instanceof WorkspaceCreationCapabilityWithheldError) {
      return capabilityRefusalResponse('workspace.create')
    }
    if (error instanceof WorkspaceCreationContextChangedError) {
      return NextResponse.json(
        {
          error:
            'Your organization membership changed while this workspace was being created. Please try again.',
        },
        { status: 409 }
      )
    }
    /**
     * A lock timeout is contention, not a fault: creation serializes on the
     * organization's mutation locks and now also on `permission_group:<org>`,
     * so a concurrent create or a permission-group admin write can exhaust the
     * `lock_timeout` and abort this transaction. Answer 503 like the
     * permission-group routes do, rather than letting it reach the generic 500
     * below — the caller should retry, and a 500 tells them the opposite.
     */
    if (getPostgresErrorCode(error) === '55P03') {
      return NextResponse.json(
        { error: 'This organization is being updated by another request. Please try again.' },
        { status: 503 }
      )
    }
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
    observedOrganizationId: string | null
    governingPermissionGroupOrganizationId: string | null
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
    observedOrganizationId: creationPolicy.observedOrganizationId,
    governingPermissionGroupOrganizationId: creationPolicy.governingPermissionGroupOrganizationId,
  })
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
