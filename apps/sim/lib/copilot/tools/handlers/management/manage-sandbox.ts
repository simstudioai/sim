import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { hasWorkspaceSandboxAccess } from '@/lib/billing/core/subscription'
import type { ExecutionContext, ToolCallResult } from '@/lib/copilot/request/types'
import { ensureWorkspaceAccess } from '@/lib/copilot/tools/handlers/access'
import { enforceWorkspaceRateLimit } from '@/lib/core/rate-limiter/route-helpers'
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

type SandboxLanguage = 'javascript' | 'python'

const SANDBOX_LANGUAGES: readonly string[] = ['javascript', 'python']

interface ManageSandboxParams {
  operation?: string
  sandboxId?: string
  name?: string
  language?: string
  dependencies?: string[]
}

/** Renders a refused write as the sentence the model reads back to the user. */
function failureMessage(failure: SandboxWriteFailure): string {
  switch (failure.code) {
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

/**
 * Validates the model-supplied language. The parameter is a string on the wire,
 * so an unrecognized value must be rejected here rather than cast into the
 * enum and written to a column that only accepts two values.
 */
function parseLanguage(value: string | undefined): SandboxLanguage | undefined {
  if (value === undefined) return undefined
  const normalized = value.toLowerCase()
  return SANDBOX_LANGUAGES.includes(normalized) ? (normalized as SandboxLanguage) : undefined
}

/**
 * Sandbox CRUD for the mothership.
 *
 * Mirrors the REST routes' gate exactly — workspace admin, then plan
 * entitlement, then the shared per-workspace mutation budget — so a sandbox
 * cannot be created through chat that the same user could not create in
 * Settings > Sandboxes. `list` is readable by any member, matching the GET
 * route, because a downgraded workspace must still see what it already built.
 */
export async function executeManageSandbox(
  rawParams: Record<string, unknown>,
  context: ExecutionContext
): Promise<ToolCallResult> {
  const params = rawParams as ManageSandboxParams
  const operation = String(params.operation || '').toLowerCase() as ManageSandboxOperation
  /**
   * Server-set context only. A model-supplied `workspaceId` would be authorized
   * against the context workspace, letting a caller name another workspace and
   * have it checked against their own. Matches manage_custom_tool.
   */
  const workspaceId = context.workspaceId

  if (!operation) {
    return { success: false, error: "Missing required 'operation' argument" }
  }
  if (!workspaceId) {
    return { success: false, error: 'workspaceId is required' }
  }

  const isWrite = WRITE_OPERATIONS.includes(operation)

  try {
    // Authorization runs before any argument is interpreted, and admin is
    // required for writes — sandbox builds spend workspace compute.
    try {
      await ensureWorkspaceAccess(workspaceId, context.userId, isWrite ? 'admin' : 'read')
    } catch {
      return {
        success: false,
        error: isWrite ? SANDBOX_ADMIN_REQUIRED : 'You do not have access to this workspace',
      }
    }

    if (isWrite) {
      if (!(await hasWorkspaceSandboxAccess(workspaceId))) {
        return { success: false, error: MAX_PLAN_REQUIRED }
      }
      // The same bucket the REST routes spend, so chat cannot be used to double
      // the workspace's build allowance.
      if (
        await enforceWorkspaceRateLimit('sandbox-mutations', workspaceId, SANDBOX_MUTATION_LIMIT)
      ) {
        return {
          success: false,
          error: 'Rate limit exceeded for sandbox changes in this workspace. Try again shortly.',
        }
      }
    }

    if (operation === 'list') {
      const sandboxes = await listWorkspaceSandboxes(workspaceId)
      return {
        success: true,
        output: {
          success: true,
          operation,
          sandboxes,
          count: sandboxes.length,
          strategy: currentSandboxStrategy(),
        },
      }
    }

    if (operation === 'add') {
      const name = params.name?.trim()
      if (!name) {
        return { success: false, error: "'name' is required for operation 'add'" }
      }
      const language = parseLanguage(params.language)
      if (!language) {
        return {
          success: false,
          error: "'language' is required for operation 'add' and must be 'javascript' or 'python'",
        }
      }

      const result = await createWorkspaceSandbox({
        workspaceId,
        userId: context.userId,
        name,
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
          message: `Created sandbox "${name}"`,
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
        return { success: false, error: "'language' must be 'javascript' or 'python'" }
      }

      const result = await updateWorkspaceSandbox({
        workspaceId,
        sandboxId: params.sandboxId,
        name: params.name?.trim(),
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
