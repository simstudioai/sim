import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { createSandboxBodySchema, updateSandboxBodySchema } from '@/lib/api/contracts/sandboxes'
import { messageForCopilotApplicationError } from '@/lib/copilot/application/error'
import { executeCopilotSandboxUseCase } from '@/lib/copilot/application/execute-sandbox-use-case'
import type { ExecutionContext, ToolCallResult } from '@/lib/copilot/request/types'
import { asOrchestrationError } from '@/lib/core/orchestration/types'
import { SANDBOX_CLI_TOOLS } from '@/lib/execution/remote-sandbox/cli-tools'
import {
  SandboxDependencyError,
  SandboxSystemPackageError,
} from '@/lib/execution/remote-sandbox/workspace-sandboxes'
import { SandboxBuildBudgetExceededError } from '@/lib/sandboxes/application/build-budget'
import {
  createWorkspaceSandboxUseCase,
  deleteWorkspaceSandboxUseCase,
  listWorkspaceSandboxesUseCase,
  updateWorkspaceSandboxUseCase,
} from '@/lib/sandboxes/application/use-cases'

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

/**
 * Maps expected application failures to something the model can act on. A
 * spent build budget must not be retried; a refused line names the row; every
 * other classified refusal (plan, role, conflict, not found) carries its own
 * message; anything else is the generic retry-with-list guidance, with the
 * cause kept in server logs.
 */
function sandboxErrorMessage(error: unknown, operation: ManageSandboxOperation): string {
  if (error instanceof SandboxBuildBudgetExceededError) {
    return `Rate limit exceeded for sandbox ${operation} in this workspace — do not retry now; continue with other work or tell the user the limit was hit.`
  }
  const classified = asOrchestrationError(error)
  if (
    classified instanceof SandboxDependencyError ||
    classified instanceof SandboxSystemPackageError
  ) {
    return validationMessage(classified)
  }
  return messageForCopilotApplicationError(
    error,
    `The ${operation} operation failed inside Sim. The write may or may not have landed — run operation "list" to check current state before retrying.`
  )
}

/** Executes the Mothership agent's Sim-sandbox management tool. */
export async function executeManageSandbox(
  rawParams: Record<string, unknown>,
  context: ExecutionContext
): Promise<ToolCallResult> {
  const params = rawParams as ManageSandboxParams
  const operation = String(params.operation || '').toLowerCase() as ManageSandboxOperation
  /**
   * Server-set context only. The use case authorizes against the workspace the
   * delegated principal carries, so a model-supplied workspace could never win
   * here — but it must not be read at all, or a mismatch would surface as a
   * confusing refusal rather than never arising.
   */
  const workspaceId = context.workspaceId

  if (!workspaceId) return { success: false, error: 'workspaceId is required' }
  if (!['add', 'edit', 'delete', 'list'].includes(operation)) {
    return { success: false, error: "operation must be 'add', 'edit', 'delete', or 'list'" }
  }

  try {
    if (operation === 'list') {
      const { sandboxes, strategy, entitled } = await executeCopilotSandboxUseCase(
        context,
        listWorkspaceSandboxesUseCase,
        { workspaceId, sortBy: 'name', sortOrder: 'asc' }
      )
      return {
        success: true,
        output: {
          success: true,
          operation,
          strategy,
          /** False below the Max tier: add, edit, and delete will be refused. */
          entitled,
          sandboxes,
          count: sandboxes.length,
          availableCliTools: Object.values(SANDBOX_CLI_TOOLS),
        },
      }
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

      const { sandbox } = await executeCopilotSandboxUseCase(
        context,
        createWorkspaceSandboxUseCase,
        { workspaceId, ...parsed.data, source: 'tool_input' }
      )
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

      const { sandbox } = await executeCopilotSandboxUseCase(
        context,
        updateWorkspaceSandboxUseCase,
        { workspaceId, sandboxId: params.sandboxId, ...parsed.data, source: 'tool_input' }
      )
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

    await executeCopilotSandboxUseCase(context, deleteWorkspaceSandboxUseCase, {
      workspaceId,
      sandboxId: params.sandboxId,
      source: 'tool_input',
    })
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
    return { success: false, error: sandboxErrorMessage(error, operation) }
  }
}
