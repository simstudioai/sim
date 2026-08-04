import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { hasWorkspaceSandboxAccess } from '@/lib/billing/core/subscription'
import type { ExecutionContext, ToolCallResult } from '@/lib/copilot/request/types'
import { copilotToolCanAdmin } from '@/lib/copilot/tools/permissions'
import { enforceWorkspaceRateLimit } from '@/lib/core/rate-limiter/route-helpers'
import {
  isSandboxLanguage,
  SANDBOX_LANGUAGES,
  type SandboxLanguage,
} from '@/lib/execution/remote-sandbox/sandbox-spec'
import {
  createWorkspaceSandbox,
  currentSandboxStrategy,
  deleteWorkspaceSandbox,
  listWorkspaceSandboxes,
  MAX_PLAN_REQUIRED,
  SANDBOX_ADMIN_REQUIRED,
  SANDBOX_MUTATION_LIMIT,
  type SandboxWriteFailure,
  updateWorkspaceSandbox,
} from '@/lib/execution/remote-sandbox/workspace-sandboxes'

const logger = createLogger('CopilotToolExecutor')

type ManageSandboxOperation = 'add' | 'edit' | 'delete' | 'list'

const WRITE_OPERATIONS: readonly string[] = ['add', 'edit', 'delete']

const LANGUAGE_REQUIRED = `'language' must be ${SANDBOX_LANGUAGES.join(' or ')}`

interface ManageSandboxParams {
  operation?: string
  sandboxId?: string
  name?: string
  language?: string
  dependencies?: string[]
}

function failureMessage(failure: SandboxWriteFailure): string {
  switch (failure.code) {
    case 'invalid_name':
      return failure.message
    case 'name_conflict':
      return `A sandbox named "${failure.name}" already exists in this workspace`
    case 'invalid_dependencies': {
      const lines = failure.issues
        .map((issue) => `line ${issue.line} ("${issue.value}"): ${issue.reason}`)
        .join('; ')
      return `Invalid dependency list — ${lines}`
    }
    case 'not_found':
      return `Sandbox not found: ${failure.sandboxId}`
    case 'read_back_failed':
      return 'The sandbox was saved but could not be read back'
  }
}

function parseLanguage(value: unknown): SandboxLanguage | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.toLowerCase()
  return isSandboxLanguage(normalized) ? normalized : undefined
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

/**
 * Reproduces the REST routes' gate — workspace admin, plan entitlement, then the
 * shared mutation budget — so chat cannot create a sandbox the same user could
 * not create in Settings > Sandboxes.
 */
export async function executeManageSandbox(
  rawParams: Record<string, unknown>,
  context: ExecutionContext
): Promise<ToolCallResult> {
  const params = rawParams as ManageSandboxParams
  const operation = String(params.operation || '').toLowerCase() as ManageSandboxOperation
  // Server-set only: a model-supplied workspaceId would be authorized against
  // the context workspace. Matches manage_custom_tool.
  const workspaceId = context.workspaceId

  if (!operation) {
    return { success: false, error: "Missing required 'operation' argument" }
  }
  if (!workspaceId) {
    return { success: false, error: 'workspaceId is required' }
  }

  const isWrite = WRITE_OPERATIONS.includes(operation)

  try {
    if (isWrite) {
      if (!copilotToolCanAdmin(context.userPermission)) {
        return { success: false, error: SANDBOX_ADMIN_REQUIRED }
      }
      if (!(await hasWorkspaceSandboxAccess(workspaceId))) {
        return { success: false, error: MAX_PLAN_REQUIRED }
      }
      if (
        await enforceWorkspaceRateLimit('sandbox-mutations', workspaceId, SANDBOX_MUTATION_LIMIT)
      ) {
        return {
          success: false,
          error: 'Rate limit exceeded for sandbox changes in this workspace. Try again shortly.',
        }
      }
    }

    if (params.dependencies !== undefined && !isStringArray(params.dependencies)) {
      return { success: false, error: "'dependencies' must be an array of strings" }
    }

    if (operation === 'list') {
      const sandboxes = await listWorkspaceSandboxes(workspaceId)
      return {
        success: true,
        output: {
          success: true,
          operation,
          // errorDetail is a 4KB installer log tail per failed build; errorMessage
          // is the classified summary, and is all the model is told to read.
          sandboxes: sandboxes.map(({ errorDetail, ...sandbox }) => sandbox),
          count: sandboxes.length,
          strategy: currentSandboxStrategy(),
        },
      }
    }

    if (operation === 'add') {
      if (typeof params.name !== 'string' || !params.name.trim()) {
        return { success: false, error: "'name' is required for operation 'add'" }
      }
      const language = parseLanguage(params.language)
      if (!language) {
        return {
          success: false,
          error: `'language' is required for operation 'add' — ${LANGUAGE_REQUIRED}`,
        }
      }
      const result = await createWorkspaceSandbox({
        workspaceId,
        userId: context.userId,
        name: params.name,
        language,
        dependencies: params.dependencies ?? [],
      })
      if (!result.ok) return { success: false, error: failureMessage(result.failure) }

      return {
        success: true,
        output: {
          success: true,
          operation,
          sandboxId: result.sandbox.id,
          sandbox: result.sandbox,
          message: `Created sandbox "${result.sandbox.name}"`,
        },
      }
    }

    if (operation === 'edit') {
      if (!params.sandboxId) {
        return { success: false, error: "'sandboxId' is required for operation 'edit'" }
      }
      if (
        params.name === undefined &&
        params.language === undefined &&
        params.dependencies === undefined
      ) {
        return {
          success: false,
          error: "At least one of 'name', 'language', or 'dependencies' is required for 'edit'",
        }
      }
      const language = parseLanguage(params.language)
      if (params.language !== undefined && !language) {
        return { success: false, error: LANGUAGE_REQUIRED }
      }
      if (params.name !== undefined && typeof params.name !== 'string') {
        return { success: false, error: "'name' must be a string" }
      }
      const result = await updateWorkspaceSandbox({
        workspaceId,
        sandboxId: params.sandboxId,
        name: params.name,
        language,
        dependencies: params.dependencies,
      })
      if (!result.ok) return { success: false, error: failureMessage(result.failure) }

      return {
        success: true,
        output: {
          success: true,
          operation,
          sandboxId: result.sandbox.id,
          sandbox: result.sandbox,
          message: `Updated sandbox "${result.sandbox.name}"`,
        },
      }
    }

    if (operation === 'delete') {
      if (!params.sandboxId) {
        return { success: false, error: "'sandboxId' is required for operation 'delete'" }
      }

      const result = await deleteWorkspaceSandbox(workspaceId, params.sandboxId)
      if (!result.ok) return { success: false, error: failureMessage(result.failure) }

      return {
        success: true,
        output: {
          success: true,
          operation,
          sandboxId: params.sandboxId,
          message: `Deleted sandbox "${result.name}". Blocks still selecting it will fail until they are pointed at another sandbox.`,
        },
      }
    }

    return { success: false, error: `Unsupported operation for manage_sandbox: ${operation}` }
  } catch (error) {
    logger.error(
      context.messageId
        ? `manage_sandbox execution failed [messageId:${context.messageId}]`
        : 'manage_sandbox execution failed',
      {
        operation,
        workspaceId,
        userId: context.userId,
        error: toError(error).message,
      }
    )
    return {
      success: false,
      error: getErrorMessage(error, 'Failed to manage sandbox'),
    }
  }
}
