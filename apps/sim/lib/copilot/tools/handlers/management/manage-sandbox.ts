import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { createSandboxBodySchema, updateSandboxBodySchema } from '@/lib/api/contracts/sandboxes'
import { hasWorkspaceSandboxAccess } from '@/lib/billing/core/subscription'
import type { ExecutionContext, ToolCallResult } from '@/lib/copilot/request/types'
import { enforceWorkspaceRateLimit } from '@/lib/core/rate-limiter/route-helpers'
import { SANDBOX_CLI_TOOLS } from '@/lib/execution/remote-sandbox/cli-tools'
import {
  createWorkspaceSandbox,
  currentSandboxStrategy,
  deleteWorkspaceSandbox,
  listWorkspaceSandboxes,
  MAX_PLAN_REQUIRED,
  SANDBOX_ADMIN_REQUIRED,
  SANDBOX_MUTATION_LIMIT,
  SandboxDependencyError,
  SandboxSystemPackageError,
  updateWorkspaceSandbox,
  WorkspaceSandboxNameConflictError,
  WorkspaceSandboxNotFoundError,
} from '@/lib/execution/remote-sandbox/workspace-sandboxes'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('CopilotManageSandbox')

type ManageSandboxOperation = 'add' | 'edit' | 'delete' | 'list'

interface ManageSandboxParams {
  operation?: string
  sandboxId?: string
  name?: string
  language?: string
  dependencies?: string[]
  cliTools?: string[]
  systemPackages?: string[]
}

function validationMessage(error: SandboxDependencyError | SandboxSystemPackageError): string {
  const field = error instanceof SandboxDependencyError ? 'dependencies' : 'systemPackages'
  const issues = error.issues
    .map((issue) => `${field} line ${issue.line} (${JSON.stringify(issue.value)}): ${issue.reason}`)
    .join('; ')
  return `${error.message}${issues ? ` — ${issues}` : ''}`
}

function sandboxErrorMessage(error: unknown): string {
  if (error instanceof SandboxDependencyError || error instanceof SandboxSystemPackageError) {
    return validationMessage(error)
  }
  if (
    error instanceof WorkspaceSandboxNameConflictError ||
    error instanceof WorkspaceSandboxNotFoundError
  ) {
    return error.message
  }
  return getErrorMessage(error)
}

/** Executes the Mothership agent's Sim-sandbox management tool. */
export async function executeManageSandbox(
  rawParams: Record<string, unknown>,
  context: ExecutionContext
): Promise<ToolCallResult> {
  const params = rawParams as ManageSandboxParams
  const operation = String(params.operation || '').toLowerCase() as ManageSandboxOperation
  const workspaceId = context.workspaceId

  if (!workspaceId) return { success: false, error: 'workspaceId is required' }
  if (!['add', 'edit', 'delete', 'list'].includes(operation)) {
    return { success: false, error: "operation must be 'add', 'edit', 'delete', or 'list'" }
  }

  try {
    // Re-read current authorization in Sim. Mothership's entitlement and the
    // permission captured at request start control model visibility only; a
    // delayed or resumed mutation must not survive a downgrade or role change.
    const permission = await getUserEntityPermissions(context.userId, 'workspace', workspaceId)
    if (permission !== 'admin') {
      return { success: false, error: SANDBOX_ADMIN_REQUIRED }
    }
    if (!(await hasWorkspaceSandboxAccess(workspaceId))) {
      return { success: false, error: MAX_PLAN_REQUIRED }
    }

    if (operation === 'list') {
      const sandboxes = await listWorkspaceSandboxes(workspaceId)
      return {
        success: true,
        output: {
          success: true,
          operation,
          strategy: currentSandboxStrategy(),
          sandboxes,
          count: sandboxes.length,
          availableCliTools: Object.values(SANDBOX_CLI_TOOLS),
        },
      }
    }

    const limited = await enforceWorkspaceRateLimit(
      'sandbox-mutations',
      workspaceId,
      SANDBOX_MUTATION_LIMIT
    )
    if (limited)
      return {
        success: false,
        error: `Rate limit exceeded for sandbox ${operation} in this workspace — do not retry now; continue with other work or tell the user the limit was hit.`,
      }

    if (operation === 'add') {
      const parsed = createSandboxBodySchema.safeParse({
        name: params.name,
        language: params.language,
        dependencies: params.dependencies ?? [],
        cliTools: params.cliTools ?? [],
        systemPackages: params.systemPackages ?? [],
      })
      if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message }

      const sandbox = await createWorkspaceSandbox(workspaceId, context.userId, parsed.data)
      return {
        success: true,
        output: {
          success: true,
          operation,
          sandboxId: sandbox.id,
          sandbox,
          message: `Created Sim sandbox "${sandbox.name}"`,
        },
      }
    }

    if (!params.sandboxId) {
      return { success: false, error: `'sandboxId' is required for operation '${operation}'` }
    }

    if (operation === 'edit') {
      const parsed = updateSandboxBodySchema.safeParse({
        ...(params.name !== undefined ? { name: params.name } : {}),
        ...(params.language !== undefined ? { language: params.language } : {}),
        ...(params.dependencies !== undefined ? { dependencies: params.dependencies } : {}),
        ...(params.cliTools !== undefined ? { cliTools: params.cliTools } : {}),
        ...(params.systemPackages !== undefined ? { systemPackages: params.systemPackages } : {}),
      })
      if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message }

      const sandbox = await updateWorkspaceSandbox(workspaceId, params.sandboxId, parsed.data)
      return {
        success: true,
        output: {
          success: true,
          operation,
          sandboxId: sandbox.id,
          sandbox,
          message: `Updated Sim sandbox "${sandbox.name}"`,
        },
      }
    }

    await deleteWorkspaceSandbox(workspaceId, params.sandboxId)
    return {
      success: true,
      output: {
        success: true,
        operation,
        sandboxId: params.sandboxId,
        message: `Deleted Sim sandbox ${params.sandboxId}`,
      },
    }
  } catch (error) {
    logger.error('Failed to manage Sim sandbox', {
      workspaceId,
      operation,
      error: toError(error),
    })
    return { success: false, error: sandboxErrorMessage(error) }
  }
}
