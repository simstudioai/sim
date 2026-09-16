import { createLogger } from '@sim/logger'
import { type PermissionType, permissionSatisfies } from '@sim/platform-authz/workspace'
import { toError } from '@sim/utils/errors'
import { withWorkspaceInvocationScope } from '@/lib/core/application/workspace-invocation-scope'
import { withResourceOutboundScope } from '@/lib/core/network/resource-scope.server'
import { resolveInvocationWorkspace } from '@/lib/mothership/application/workspace-target'
import {
  ASSISTANT_TOOLS,
  assertAssistantIntegrationCall,
} from '@/lib/mothership/assistant/tool-policy'
import { prepareCopilotEnvironmentContext } from '@/lib/mothership/environment-context'
import { projectToolErrorMessageForCopilot } from '@/lib/mothership/request/tools/resolved-secret-result'
import { recordSecretUsage } from '@/lib/secrets/usage/record'
import { executeTool as executeAppTool } from '@/tools'
import { getToolMetadata } from '@/tools/metadata'
import { getToolEntry, isClientExecuted, isKnownTool, isSimExecuted } from './router'
import type { ToolExecutionContext, ToolExecutionResult, ToolHandler } from './types'

const logger = createLogger('ToolExecutor')

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
  if (context.organizationId) {
    if (
      context.workspaceId ||
      context.workflowId ||
      !['agent', 'assistant'].includes(context.requestMode ?? '')
    )
      return { success: false, error: 'Invalid organization execution scope' }
    const organizationTools =
      context.requestMode === 'assistant'
        ? ['search_workspace', 'read_document', 'oauth_get_auth_link']
        : [
            'list_workspaces',
            'search_workspace',
            'read_document',
            'search_sources',
            ...(params.scope !== 'workspace' ? ['settings'] : []),
          ]
    if (organizationTools.includes(toolId)) {
      if (context.targetWorkspaceId)
        return {
          success: false,
          error: 'Organization and account operations do not take a workspace target',
        }
      return executeBoundTool(toolId, params, context)
    }
    if (context.requestMode === 'assistant') {
      if (context.targetWorkspaceId)
        return { success: false, error: 'Organization Assistant does not take a workspace target' }
      try {
        const metadata = getToolMetadata(toolId)
        assertAssistantIntegrationCall(metadata, params)
        if (metadata?.personalToken) throw new Error('This account type is unavailable in Search.')
      } catch (error) {
        return { success: false, error: toError(error).message }
      }
      return executeBoundTool(toolId, params, context)
    }
    if (toolId === 'sim_cli') return executeBoundTool(toolId, params, context)
    if (['run_code', 'run_function'].includes(toolId) && !context.targetWorkspaceId)
      return executeBoundTool(toolId, params, {
        ...context,
        secretActorUserId: null,
        secretMountPolicy: { secretScope: 'selected', mountedSecrets: [] },
      })
  }
  if (context.organizationId || context.targetWorkspaceId) {
    try {
      const target = await resolveInvocationWorkspace(context, context.targetWorkspaceId)
      const chatOrganizationId = context.organizationId
      const environment = await prepareCopilotEnvironmentContext(
        context.userId,
        target.workspaceId,
        { includeSecrets: context.requestMode !== 'assistant' }
      )
      try {
        const result = await withWorkspaceInvocationScope(
          { workspaceId: target.workspaceId, organizationId: chatOrganizationId },
          () =>
            executeBoundTool(toolId, params, {
              ...context,
              ...environment,
              workspaceId: target.workspaceId,
              organizationId: undefined,
              ...(chatOrganizationId
                ? {
                    chatOrganizationId,
                    secretActorUserId: context.userId,
                    secretMountPolicy: undefined,
                  }
                : {}),
              userPermission: target.permission ?? context.userPermission,
            })
        )
        return chatOrganizationId && result.resources?.length
          ? {
              ...result,
              resources: result.resources.map((resource) => ({
                ...resource,
                workspaceId: target.workspaceId,
              })),
            }
          : result
      } finally {
        await context.resolvedSecretTraceRegistry?.importProvenance(
          environment.resolvedSecretTraceRegistry.exportProvenance(),
          { trusted: true, origin: 'organization-workspace-tool' }
        )
      }
    } catch (error) {
      return { success: false, error: toError(error).message }
    }
  }
  return executeBoundTool(toolId, params, context)
}

async function executeBoundTool(
  toolId: string,
  params: Record<string, unknown>,
  context: ToolExecutionContext
): Promise<ToolExecutionResult> {
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

  return withResourceOutboundScope(context, async () => {
    const canUseRegisteredHandler =
      hasHandler(toolId) &&
      (!isKnownTool(toolId) || isSimExecuted(toolId) || usesHeadlessClientFallback)
    if (!canUseRegisteredHandler) {
      const appParams = buildAppToolParams(params, context)
      const options = {
        ...(context.resolvedSecretTraceRegistry
          ? { resolvedSecretTraceRegistry: context.resolvedSecretTraceRegistry }
          : {}),
        ...(context.abortSignal ? { signal: context.abortSignal } : {}),
        operationContext: {
          userId: context.userId,
          workflowId: context.workflowId,
          workspaceId: context.workspaceId,
          organizationId: context.organizationId,
          executionId: context.executionId,
          chatId: context.chatId,
          toolCallId: context.toolCallId,
          mcpBlockId: context.mcpBlockId,
          executorDelegationOrigin: context.executorDelegationOrigin ?? {
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
      return {
        success: false,
        error: 'Execution aborted: abort signal was set before tool started',
      }
    }

    const handler = handlerRegistry.get(toolId)
    if (!handler) {
      logger.warn('No handler registered for tool', { toolId })
      return { success: false, error: `No handler for tool: ${toolId}` }
    }

    try {
      const { activity: _activity, ...executionParams } = params
      return await handler(executionParams, context)
    } catch (error) {
      const message = toError(error).message
      logger.error('Tool execution failed', {
        toolId,
        error: projectToolErrorMessageForCopilot(message, context.resolvedSecretTraceRegistry),
        abortSignalAborted: context.abortSignal?.aborted ?? false,
      })
      return { success: false, error: message }
    }
  })
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
    organizationId: context.organizationId,
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
