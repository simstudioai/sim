import { withWorkspaceInvocationScope } from '@/lib/core/application/workspace-invocation-scope'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { AgentCliExecutionContext } from '@/lib/mothership/agent-cli'
import { readCliInputFile } from '@/lib/mothership/agent-cli/run-cli'
import { applySink } from '@/lib/mothership/agent-cli/sink'
import { createWorkbenchFileProvenance } from '@/lib/mothership/agent-cli/workbench-file-provenance'
import { resolveInvocationWorkspace } from '@/lib/mothership/application/workspace-target'
import {
  COPILOT_APPLICATION_DELEGATION_TTL_MS,
  createTrustedOrganizationCopilotPrincipal,
  requireTrustedCopilotExecutionContext,
  requireTrustedOrganizationCopilotContext,
} from '@/lib/mothership/auth/application-delegation'
import { authorizeOrganizationChatDelegation } from '@/lib/mothership/chat/organization-chats'
import type { AgentCliRawResult, AgentCliRequest } from '@/lib/mothership/generated/agent-cli'
import { chatSandboxSessionKey } from '@/lib/mothership/tools/sandbox-session-key'
import { routeExecution } from '@/lib/mothership/tools/server/router'

/** Services select existing domain handlers; only workspace settings selects a workspace. */
export async function executeAgentCliService(
  request: AgentCliRequest,
  context: AgentCliExecutionContext
): Promise<AgentCliRawResult> {
  context.signal?.throwIfAborted()
  if (context.requestMode !== 'agent')
    throw new OrchestrationError('forbidden', 'CLI services require agent mode')
  const organizationId = context.chatOrganizationId ?? context.organizationId
  let target = {
    ...context,
    organizationId,
    workspaceId: organizationId ? undefined : context.workspaceId,
  }
  if (organizationId) requireTrustedOrganizationCopilotContext(target)
  else requireTrustedCopilotExecutionContext(target)
  const invocation = request.invocation
  if (invocation.kind !== 'service' && invocation.kind !== 'stdout')
    throw new OrchestrationError('validation', 'Invalid service invocation')
  const scope =
    invocation.kind === 'service' && invocation.name === 'settings'
      ? invocation.input.scope
      : 'organization'
  if (
    invocation.kind === 'service' &&
    invocation.name !== 'list_workspaces' &&
    Object.hasOwn(invocation.input, 'workspaceId')
  )
    throw new OrchestrationError(
      'validation',
      'Use the invocation workspace target, not service input.workspaceId'
    )
  if (scope === 'workspace') {
    const resolved = await resolveInvocationWorkspace(context, request.workspaceId)
    target = {
      ...context,
      ...resolved,
      organizationId: undefined,
      chatOrganizationId: organizationId,
    }
    requireTrustedCopilotExecutionContext(target)
  } else {
    if (request.workspaceId)
      throw new OrchestrationError(
        'validation',
        'Account and organization services do not take a workspace target'
      )
    if (organizationId) {
      const trusted = requireTrustedOrganizationCopilotContext(target)
      await authorizeOrganizationChatDelegation.execute({
        principal: createTrustedOrganizationCopilotPrincipal(
          { ...trusted, delegationId: trusted.toolCallId },
          { audience: 'sim:workspaces', ttlMs: COPILOT_APPLICATION_DELEGATION_TTL_MS }
        ),
      })
    } else {
      if (scope !== 'account')
        throw new OrchestrationError(
          'forbidden',
          'This service requires an organization conversation'
        )
      requireTrustedCopilotExecutionContext(target)
      await resolveInvocationWorkspace(context)
    }
  }
  context.signal?.throwIfAborted()
  const execute = async (): Promise<AgentCliRawResult> => {
    const sessionKey = target.chatId ? chatSandboxSessionKey(target.chatId) : null
    const input = invocation.kind === 'service' ? { ...invocation.input } : {}
    if (invocation.kind === 'service' && invocation.inputFiles) {
      const allowedField =
        invocation.name === 'settings'
          ? input.action === 'execute'
            ? 'input'
            : input.action === 'update'
              ? 'changes'
              : undefined
          : undefined
      for (const [field, path] of Object.entries(invocation.inputFiles)) {
        if (field !== allowedField || Object.hasOwn(input, field))
          throw new OrchestrationError(
            'validation',
            'JSON input files must name a supported, omitted JSON flag'
          )
        if (!sessionKey)
          throw new OrchestrationError('validation', 'JSON input files require a chat workbench')
        let bytes: Buffer
        try {
          bytes = await readCliInputFile(sessionKey, path, context.signal)
        } catch {
          context.signal?.throwIfAborted()
          throw new OrchestrationError(
            'validation',
            `Could not read JSON input file "${path}" from this chat workbench; write it first or pass JSON inline`
          )
        }
        try {
          input[field] = JSON.parse(bytes.toString('utf8'))
        } catch {
          throw new OrchestrationError('validation', `JSON input file "${path}" is not valid JSON`)
        }
      }
    }

    const output =
      invocation.kind === 'stdout'
        ? undefined
        : await routeExecution(invocation.name, input, {
            ...target,
            abortSignal: context.signal,
            userStopSignal: context.signal,
          })
    const failure =
      output !== null &&
      typeof output === 'object' &&
      'success' in output &&
      output.success === false
    const message =
      failure &&
      ('error' in output && typeof output.error === 'string'
        ? output.error
        : 'message' in output && typeof output.message === 'string'
          ? output.message
          : 'Service operation failed')
    const result: AgentCliRawResult = {
      exitCode: failure ? 1 : 0,
      stdout: invocation.kind === 'stdout' ? invocation.stdout : JSON.stringify(output ?? null),
      stderr: message || '',
    }
    const files = sessionKey
      ? createWorkbenchFileProvenance({ ...target, organizationId, sessionKey })
      : undefined
    return request.sink
      ? applySink(request.sink, sessionKey, result, context.signal, files?.observeOutput)
      : result
  }
  return target.workspaceId
    ? withWorkspaceInvocationScope({ workspaceId: target.workspaceId, organizationId }, execute)
    : execute()
}
