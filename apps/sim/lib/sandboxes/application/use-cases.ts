import { AuditAction, AuditResourceType } from '@sim/audit'
import { requirePrincipalSubjectUserId } from '@sim/auth/principal'
import type { CursorKey, ListSortOrder } from '@/lib/api/list-query'
import { hasWorkspaceSandboxAccess } from '@/lib/billing/core/subscription'
import { defineAuthorizedWorkspaceUseCase, ForbiddenOperationError } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { SandboxCliToolId } from '@/lib/execution/remote-sandbox/cli-tools'
import { MAX_PLAN_REQUIRED } from '@/lib/execution/remote-sandbox/entitlement'
import type { SandboxLanguage } from '@/lib/execution/remote-sandbox/sandbox-spec'
import {
  createWorkspaceSandbox,
  currentSandboxStrategy,
  deleteWorkspaceSandbox,
  listWorkspaceSandboxesPage,
  readWorkspaceSandbox,
  type SandboxSortBy,
  updateWorkspaceSandbox,
} from '@/lib/execution/remote-sandbox/workspace-sandboxes'
import { sandboxDelegationPolicy } from '@/lib/sandboxes/application/authorization'
import { assertSandboxBuildBudget } from '@/lib/sandboxes/application/build-budget'
import { sandboxOperations } from '@/lib/sandboxes/application/operations'
import { loadActiveWorkspaceContext } from '@/lib/uploads/contexts/workspace'

/** Which surface wrote, recorded on the audit entry only. */
type SandboxWriteSource = 'api' | 'settings' | 'tool_input'

interface SandboxWorkspaceContext {
  workspaceId: string
  workspaceOrganizationId: string | null
  allowPersonalApiKeys: boolean
  billedAccountUserId: string
}

type SandboxRecord = NonNullable<Awaited<ReturnType<typeof readWorkspaceSandbox>>>

interface SandboxContext extends SandboxWorkspaceContext {
  sandbox: SandboxRecord
}

async function resolveWorkspaceContext(workspaceId: string): Promise<SandboxWorkspaceContext> {
  const context = await loadActiveWorkspaceContext(workspaceId)
  if (!context) throw new OrchestrationError('not_found', 'Workspace not found')
  return context
}

async function resolveSandboxContext(
  workspaceId: string,
  sandboxId: string
): Promise<SandboxContext> {
  const workspace = await resolveWorkspaceContext(workspaceId)
  const sandbox = await readWorkspaceSandbox(workspace.workspaceId, sandboxId)
  if (!sandbox) throw new OrchestrationError('not_found', 'Sandbox not found')
  return { ...workspace, sandbox }
}

/**
 * The plan gate every write shares, checked right after the role check as the
 * legacy routes did: its refusal is actionable and costs nothing.
 */
async function requireSandboxPlan(workspaceId: string): Promise<void> {
  if (!(await hasWorkspaceSandboxAccess(workspaceId))) {
    throw new ForbiddenOperationError('WORKSPACE_PLAN_CAPABILITY_REQUIRED', MAX_PLAN_REQUIRED)
  }
}

/**
 * The build budget, handed to the manager as its admission hook so it is spent
 * only once the spec has validated and the name is free — a refused line or a
 * collision builds nothing and must not drain what a real build needs.
 */
function spendBuildBudget(workspaceId: string) {
  return { admit: () => assertSandboxBuildBudget(workspaceId) }
}

const authorizationOptions = { delegation: sandboxDelegationPolicy }

export interface ListWorkspaceSandboxesInput {
  workspaceId: string
  search?: string
  sortBy?: SandboxSortBy
  sortOrder?: ListSortOrder
  /** Absent for the whole set in one read; the public API pages. */
  limit?: number
  cursorKeys?: CursorKey[]
}

export const listWorkspaceSandboxesUseCase = defineAuthorizedWorkspaceUseCase({
  operation: sandboxOperations.list,
  resolveContext: ({ input }: { input: ListWorkspaceSandboxesInput }) =>
    resolveWorkspaceContext(input.workspaceId),
  authorizationOptions,
  async execute({ input, context }) {
    const [page, entitled] = await Promise.all([
      listWorkspaceSandboxesPage({ ...input, workspaceId: context.workspaceId }),
      hasWorkspaceSandboxAccess(context.workspaceId),
    ])
    return {
      sandboxes: page.data,
      nextCursorKeys: page.nextCursorKeys,
      strategy: currentSandboxStrategy(),
      /** False below the Max tier: the list still renders, but every write is refused. */
      entitled,
      sortBy: input.sortBy ?? 'name',
      sortOrder: input.sortOrder ?? 'asc',
    }
  },
})

export interface GetWorkspaceSandboxInput {
  workspaceId: string
  sandboxId: string
}

export const getWorkspaceSandboxUseCase = defineAuthorizedWorkspaceUseCase({
  operation: sandboxOperations.read,
  resolveContext: ({ input }: { input: GetWorkspaceSandboxInput }) =>
    resolveSandboxContext(input.workspaceId, input.sandboxId),
  authorizationOptions,
  async execute({ context }) {
    return { sandbox: context.sandbox }
  },
})

export interface CreateWorkspaceSandboxInput {
  workspaceId: string
  name: string
  language: SandboxLanguage
  dependencies: string[]
  cliTools?: SandboxCliToolId[]
  systemPackages?: string[]
  source?: SandboxWriteSource
}

export const createWorkspaceSandboxUseCase = defineAuthorizedWorkspaceUseCase({
  operation: sandboxOperations.create,
  resolveContext: ({ input }: { input: CreateWorkspaceSandboxInput }) =>
    resolveWorkspaceContext(input.workspaceId),
  authorizationOptions,
  async execute({ principal, input, context }) {
    await requireSandboxPlan(context.workspaceId)
    const sandbox = await createWorkspaceSandbox(
      context.workspaceId,
      requirePrincipalSubjectUserId(principal),
      {
        name: input.name,
        language: input.language,
        dependencies: input.dependencies,
        cliTools: input.cliTools ?? [],
        systemPackages: input.systemPackages ?? [],
      },
      spendBuildBudget(context.workspaceId)
    )
    return { sandbox }
  },
  projectAudit: ({ input, result }) => ({
    action: AuditAction.SANDBOX_CREATED,
    resourceType: AuditResourceType.SANDBOX,
    resourceId: result.sandbox.id,
    resourceName: result.sandbox.name,
    description: `Created sandbox "${result.sandbox.name}"`,
    metadata: { source: input.source, language: result.sandbox.language },
  }),
})

export interface UpdateWorkspaceSandboxInput {
  workspaceId: string
  sandboxId: string
  name?: string
  language?: SandboxLanguage
  dependencies?: string[]
  cliTools?: SandboxCliToolId[]
  systemPackages?: string[]
  source?: SandboxWriteSource
}

export const updateWorkspaceSandboxUseCase = defineAuthorizedWorkspaceUseCase({
  operation: sandboxOperations.update,
  resolveContext: ({ input }: { input: UpdateWorkspaceSandboxInput }) =>
    resolveSandboxContext(input.workspaceId, input.sandboxId),
  authorizationOptions,
  async execute({ input, context }) {
    await requireSandboxPlan(context.workspaceId)
    const sandbox = await updateWorkspaceSandbox(
      context.workspaceId,
      context.sandbox.id,
      {
        name: input.name,
        language: input.language,
        dependencies: input.dependencies,
        cliTools: input.cliTools,
        systemPackages: input.systemPackages,
      },
      spendBuildBudget(context.workspaceId)
    )
    return { sandbox }
  },
  projectAudit: ({ input, result }) => ({
    action: AuditAction.SANDBOX_UPDATED,
    resourceType: AuditResourceType.SANDBOX,
    resourceId: result.sandbox.id,
    resourceName: result.sandbox.name,
    description: `Updated sandbox "${result.sandbox.name}"`,
    metadata: { source: input.source, language: result.sandbox.language },
  }),
})

export interface DeleteWorkspaceSandboxInput {
  workspaceId: string
  sandboxId: string
  source?: SandboxWriteSource
}

export const deleteWorkspaceSandboxUseCase = defineAuthorizedWorkspaceUseCase({
  operation: sandboxOperations.delete,
  resolveContext: ({ input }: { input: DeleteWorkspaceSandboxInput }) =>
    resolveSandboxContext(input.workspaceId, input.sandboxId),
  authorizationOptions,
  async execute({ context }) {
    await requireSandboxPlan(context.workspaceId)
    await assertSandboxBuildBudget(context.workspaceId)
    await deleteWorkspaceSandbox(context.workspaceId, context.sandbox.id)
    return { sandbox: context.sandbox }
  },
  projectAudit: ({ input, result }) => ({
    action: AuditAction.SANDBOX_DELETED,
    resourceType: AuditResourceType.SANDBOX,
    resourceId: result.sandbox.id,
    resourceName: result.sandbox.name,
    description: `Deleted sandbox "${result.sandbox.name}"`,
    metadata: { source: input.source, language: result.sandbox.language },
  }),
})
