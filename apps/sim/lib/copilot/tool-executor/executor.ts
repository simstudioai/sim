import { createLogger } from '@sim/logger'
import { type PermissionType, permissionSatisfies } from '@sim/platform-authz/workspace'
import { toError } from '@sim/utils/errors'
import {
  ASSISTANT_TOOLS,
  assertAssistantIntegrationCall,
} from '@/lib/copilot/assistant/tool-policy'
import { projectToolErrorMessageForCopilot } from '@/lib/copilot/request/tools/resolved-secret-result'
import { DEFAULT_EXECUTION_TIMEOUT_MS } from '@/lib/execution/constants'
import { recordSecretUsage } from '@/lib/secrets/usage/record'
import { executeTool as executeAppTool } from '@/tools'
import { getToolMetadata } from '@/tools/metadata'
import { getToolEntry, isClientExecuted, isKnownTool, isSimExecuted } from './router'
import type { ToolExecutionContext, ToolExecutionResult, ToolHandler } from './types'

const logger = createLogger('ToolExecutor')
const FUNCTION_EXECUTE_TOOL_ID = 'run_function'
const DEFAULT_FUNCTION_EXECUTE_TIMEOUT_SECONDS = 10
const MILLISECONDS_PER_SECOND = 1000

const handlerRegistry = new Map<string, ToolHandler>()

export function registerHandler(toolId: string, handler: ToolHandler): void {
  handlerRegistry.set(toolId, handler)
}

export function registerHandlers(entries: Record<string, ToolHandler>): void {
  for (const [toolId, handler] of Object.entries(entries)) {
    handlerRegistry.set(toolId, handler)
  }
}

export function hasHandler(toolId: string): boolean {
  return handlerRegistry.has(toolId)
}

export function clearHandlers(): void {
  handlerRegistry.clear()
}

export async function executeTool(
  toolId: string,
  params: Record<string, unknown>,
  context: ToolExecutionContext
): Promise<ToolExecutionResult> {
  if (
    context.organizationId &&
    (context.workspaceId ||
      context.workflowId ||
      context.requestMode !== 'assistant' ||
      !['search_workspace', 'read_document'].includes(toolId))
  ) {
    return {
      success: false,
      error: 'Organization Assistant can search and read connected documents.',
    }
  }
  if (context.requestMode === 'assistant' && !ASSISTANT_TOOLS.has(toolId)) {
    try {
      assertAssistantIntegrationCall(getToolMetadata(toolId), params)
    } catch (error) {
      return { success: false, error: toError(error).message }
    }
  }
  // Client-routed tools (e.g. run_workflow) are normally executed in the browser and never
  // reach this point in interactive mode. In headless mode (Mothership block, no browser) there
  // is no client to delegate to, so fall back to the registered server-side handler when one
  // exists — otherwise the call would route to executeAppTool and throw "Tool not found".
  const usesHeadlessClientFallback = isClientExecuted(toolId) && hasHandler(toolId)

  /**
   * Client-routed tools carry no catalog `requiredPermission` because the browser runs them
   * through the workflow APIs, which authorize the caller's own session. The headless fallback
   * has no session to authorize against and runs under the request's principal instead, so it
   * has to supply a bar of its own.
   *
   * Without one, a run whose permission was deliberately capped still reaches `run_workflow`,
   * and `runWorkflowFromCopilot` executes with `enforceCredentialAccess` — resolving the
   * principal's workspace and personal secrets. That is the hole an unattributed inbox message
   * leaves open: `resolveInboxExecutionActor` refuses it a secret actor, but the run still
   * carries the workspace owner as principal.
   */
  const requiredPermission =
    getToolEntry(toolId)?.requiredPermission ?? (usesHeadlessClientFallback ? 'write' : undefined)
  if (
    !context.organizationId &&
    requiredPermission &&
    !permissionSatisfies(
      (context.userPermission ?? null) as PermissionType | null,
      requiredPermission
    )
  ) {
    return {
      success: false,
      error: `Permission denied: ${toolId} requires ${requiredPermission} access. You have '${context.userPermission ?? 'none'}' permission.`,
    }
  }

  const normalizedParams = normalizeToolParams(toolId, params, context)

  const canUseRegisteredHandler =
    isKnownTool(toolId) && (isSimExecuted(toolId) || usesHeadlessClientFallback)
  if (!canUseRegisteredHandler) {
    const appParams = buildAppToolParams(normalizedParams, context)
    const options = {
      ...(context.resolvedSecretTraceRegistry
        ? { resolvedSecretTraceRegistry: context.resolvedSecretTraceRegistry }
        : {}),
      ...(context.abortSignal ? { signal: context.abortSignal } : {}),
      operationContext: {
        userId: context.userId,
        workflowId: context.workflowId,
        workspaceId: context.workspaceId,
        executionId: context.executionId,
        chatId: context.chatId,
        toolCallId: context.toolCallId,
        executorDelegationOrigin: {
          subjectUserId: context.userId,
          workflowId: context.workflowId,
          ...(context.executionId ? { executionId: context.executionId } : {}),
        },
        copilotToolExecution: context.copilotToolExecution,
        copilotInteractionMode: context.copilotInteractionMode,
        requestMode: context.requestMode,
        billingAttribution: context.billingAttribution,
        resolvedSecretTraceRegistry: context.resolvedSecretTraceRegistry,
      },
    }
    try {
      return await (Object.keys(options).length > 0
        ? executeAppTool(toolId, appParams, options)
        : executeAppTool(toolId, appParams))
    } finally {
      recordAppToolSecretUsage(context)
    }
  }

  if (context.abortSignal?.aborted) {
    logger.warn('Tool execution skipped: abort signal already set', {
      toolId,
      abortReason: context.abortSignal.reason ?? 'unknown',
    })
    return { success: false, error: 'Execution aborted: abort signal was set before tool started' }
  }

  const handler = handlerRegistry.get(toolId)
  if (!handler) {
    logger.warn('No handler registered for tool', { toolId })
    return { success: false, error: `No handler for tool: ${toolId}` }
  }

  try {
    return await handler(normalizedParams, context)
  } catch (error) {
    const message = toError(error).message
    logger.error('Tool execution failed', {
      toolId,
      error: projectToolErrorMessageForCopilot(message, context.resolvedSecretTraceRegistry),
      abortSignalAborted: context.abortSignal?.aborted ?? false,
    })
    return { success: false, error: message }
  }
}

function normalizeToolParams(
  toolId: string,
  params: Record<string, unknown>,
  context: ToolExecutionContext
): Record<string, unknown> {
  if (toolId !== FUNCTION_EXECUTE_TOOL_ID || !context.copilotToolExecution) {
    return params
  }

  const rawTimeoutSeconds =
    params.timeout === undefined || params.timeout === null
      ? DEFAULT_FUNCTION_EXECUTE_TIMEOUT_SECONDS
      : Number(params.timeout)
  const timeoutSeconds =
    Number.isFinite(rawTimeoutSeconds) && rawTimeoutSeconds > 0
      ? rawTimeoutSeconds
      : DEFAULT_FUNCTION_EXECUTE_TIMEOUT_SECONDS

  return {
    ...params,
    timeout: Math.min(
      Math.ceil(timeoutSeconds * MILLISECONDS_PER_SECOND),
      DEFAULT_EXECUTION_TIMEOUT_MS
    ),
  }
}

/**
 * Records the secrets an integration tool call resolved.
 *
 * `resolveToolEnvReferences` in `@/tools` substitutes `{{SECRET}}` into a tool's
 * `user-only` params — an API key reaching Slack or Stripe is as real a use as one read in
 * sandboxed code, and without this the trail reports "never used" for it. Every tool call
 * gets its own registry (`forkForInputPaths([])` returns one with no active entries), so this
 * counts only what THIS call resolved rather than everything earlier in the turn.
 *
 * Only the `executeAppTool` branch reaches here. `function_execute` takes the registered-handler
 * branch and records its own mounted secrets, so the two never count the same resolution twice.
 */
function recordAppToolSecretUsage(context: ToolExecutionContext): void {
  const registry = context.resolvedSecretTraceRegistry
  if (!registry || !context.workspaceId) return
  recordSecretUsage(registry.getResolvedSecretUsage(), {
    workspaceId: context.workspaceId,
    source: 'copilot',
    actorUserId: context.userId,
    trigger: 'copilot',
  })
}

function buildAppToolParams(
  params: Record<string, unknown>,
  context: ToolExecutionContext
): Record<string, unknown> {
  const result = { ...params }

  if (result.credentialId && !result.credential && !result.oauthCredential) {
    result.credential = result.credentialId
  }

  result._context = {
    ...(typeof result._context === 'object' && result._context !== null
      ? (result._context as object)
      : {}),
    userId: context.userId,
    workflowId: context.workflowId,
    workspaceId: context.workspaceId,
    chatId: context.chatId,
    executionId: context.executionId,
    runId: context.runId,
    copilotToolExecution: context.copilotToolExecution,
    requestMode: context.requestMode,
    currentAgentId: context.currentAgentId,
    enforceCredentialAccess: true,
    ...(context.requestMode === 'assistant' ? { envReferenceMode: 'off' } : {}),
    ...(context.billingAttribution ? { billingAttribution: context.billingAttribution } : {}),
  }

  return result
}
