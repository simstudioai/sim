import { createEmbeddedClient, type EmbeddedCliIdentity } from 'sim/embed'
import { withWorkspaceInvocationScope } from '@/lib/core/application/workspace-invocation-scope'
import { getInternalApiBaseUrl } from '@/lib/core/utils/urls'
import { curateBlockDetail } from '@/lib/mothership/agent-cli/curation'
import { AUGMENTATION_ENGINES, runEngine } from '@/lib/mothership/agent-cli/engines'
import { createFileReadTransport } from '@/lib/mothership/agent-cli/file-read-transport'
import { createFileUploadTransport } from '@/lib/mothership/agent-cli/file-upload-transport'
import { createResourceEffectTransport } from '@/lib/mothership/agent-cli/resource-effects'
import { runCli } from '@/lib/mothership/agent-cli/run-cli'
import { createScopedCliTransport } from '@/lib/mothership/agent-cli/scoped-transport'
import { executeAgentCliService } from '@/lib/mothership/agent-cli/services'
import { applySink } from '@/lib/mothership/agent-cli/sink'
import { createTracedCliTransport } from '@/lib/mothership/agent-cli/traced-transport'
import { createWorkbenchFileProvenance } from '@/lib/mothership/agent-cli/workbench-file-provenance'
import { resolveInvocationWorkspace } from '@/lib/mothership/application/workspace-target'
import {
  COPILOT_APPLICATION_DELEGATION_TTL_MS,
  createCopilotChatPrincipal,
  createTrustedOrganizationCopilotPrincipal,
} from '@/lib/mothership/auth/application-delegation'
import type { AgentCliRawResult, AgentCliRequest } from '@/lib/mothership/generated/agent-cli'
import type { ResourceChange } from '@/lib/mothership/generated/resources'
import { TraceSpan } from '@/lib/mothership/generated/trace-spans-v1'
import { withCopilotSpan } from '@/lib/mothership/request/otel'
import { chatSandboxSessionKey } from '@/lib/mothership/tools/sandbox-session-key'
import type { ServerToolContext } from '@/lib/mothership/tools/server/base-tool'
import { WORKSPACE_FILES_DELEGATION_AUDIENCE } from '@/lib/workspace-files/application/authorization'

export interface AgentCliExecutionContext extends Omit<ServerToolContext, 'abortSignal'> {
  signal?: AbortSignal
}

/**
 * Executes one typed request from the worker: mint the caller's delegated identity, run
 * the real CLI, named engine or service, and land the pre-parsed sink. All
 * lanes preserve the server-minted identity so "the agent is the user" holds without any
 * credential crossing to the worker. Success here means only "the invocation ran".
 */
export async function executeAgentCliRequest(
  request: AgentCliRequest,
  context: AgentCliExecutionContext
): Promise<AgentCliRawResult> {
  context.signal?.throwIfAborted()
  if (
    request.invocation.kind === 'service' ||
    (request.invocation.kind === 'stdout' && (context.chatOrganizationId || context.organizationId))
  )
    return executeAgentCliService(request, context)
  const target = await resolveInvocationWorkspace(context, request.workspaceId)
  return withWorkspaceInvocationScope(
    {
      workspaceId: target.workspaceId,
      organizationId: context.chatOrganizationId ?? context.organizationId,
    },
    () =>
      executeBoundAgentCliRequest(request, {
        ...context,
        ...target,
        chatOrganizationId: context.chatOrganizationId ?? context.organizationId,
      })
  )
}

async function executeBoundAgentCliRequest(
  request: AgentCliRequest,
  context: AgentCliExecutionContext & { workspaceId: string }
): Promise<AgentCliRawResult> {
  /** The embedded client's required credential is opaque and never valid on the public API. */
  const apiKey = 'mothership-in-process'
  const invocationIdentity = {
    userId: context.userId,
    workspaceId: context.workspaceId,
    chatId: context.chatId,
  }
  const endpoint = getInternalApiBaseUrl()
  const sessionKey = context.chatId ? chatSandboxSessionKey(context.chatId) : null
  const files = sessionKey ? createWorkbenchFileProvenance({ ...context, sessionKey }) : undefined
  const reads = createFileReadTransport({
    endpoint,
    transport: createTracedCliTransport(
      endpoint,
      createScopedCliTransport(endpoint, invocationIdentity)
    ),
    userId: context.userId,
    invocation: invocationIdentity,
    registry: context.resolvedSecretTraceRegistry,
    ...(context.chatId !== undefined ? { chatId: context.chatId } : {}),
    ...(files ? { trackDownload: files.trackDownload } : {}),
  })
  const resources: ResourceChange[] = []
  const identity: EmbeddedCliIdentity = {
    endpoint,
    apiKey,
    workspaceId: context.workspaceId,
    transport: createResourceEffectTransport(
      endpoint,
      files
        ? createFileUploadTransport({
            endpoint,
            workspaceId: context.workspaceId,
            userId: context.userId,
            invocation: invocationIdentity,
            fallback: reads,
            uploadProvenance: files.uploadProvenance,
          })
        : reads,
      resources,
      request.invocation.kind === 'cli' ||
        (request.invocation.kind === 'augmentation' &&
          AUGMENTATION_ENGINES[request.invocation.name]?.openReadResources === true)
    ),
    ...(context.signal ? { signal: context.signal } : {}),
  }

  const { invocation, sink } = request
  let result: AgentCliRawResult
  context.signal?.throwIfAborted()
  if (invocation.kind === 'stdout') {
    // Text the worker already holds (sliced, or worker-answered): only the sink applies.
    result = { exitCode: 0, stdout: invocation.stdout, stderr: '' }
  } else if (invocation.kind === 'augmentation') {
    result = await withCopilotSpan(TraceSpan.CopilotCliInvoke, undefined, async () =>
      runEngine(
        invocation.name,
        invocation.positionals,
        {
          client: createEmbeddedClient(identity),
          workspaceId: context.workspaceId,
          userId: context.userId,
          principal: createCopilotChatPrincipal(
            invocationIdentity,
            WORKSPACE_FILES_DELEGATION_AUDIENCE
          ),
          invocation: invocationIdentity,
          ...(context.chatOrganizationId && context.chatId
            ? {
                chatOrganizationId: context.chatOrganizationId,
                chatPrincipal: createTrustedOrganizationCopilotPrincipal(
                  {
                    userId: context.userId,
                    organizationId: context.chatOrganizationId,
                    chatId: context.chatId,
                    delegationId: `scratch:${context.chatId}`,
                  },
                  {
                    audience: WORKSPACE_FILES_DELEGATION_AUDIENCE,
                    ttlMs: COPILOT_APPLICATION_DELEGATION_TTL_MS,
                  }
                ),
              }
            : {}),
          ...(context.chatId !== undefined ? { chatId: context.chatId } : {}),
          signal: context.signal,
        },
        invocation.flags
      )
    )
  } else if (invocation.kind === 'cli') {
    const { argv } = invocation
    result = await withCopilotSpan(TraceSpan.CopilotCliInvoke, undefined, () =>
      runCli(argv, identity, sessionKey, files)
    )
    if (result.exitCode === 0 && request.curate === 'block') {
      result = await withCopilotSpan(TraceSpan.CopilotCliCurate, undefined, () =>
        curateBlockDetail(result, context)
      )
    }
  } else throw new Error('Service invocation must use the service bridge')
  if (resources.length)
    result = { ...result, resources: [...resources, ...(result.resources ?? [])] }
  if (context.chatOrganizationId && result.resources?.length)
    result = {
      ...result,
      resources: result.resources.map((effect) => {
        switch (effect.op) {
          case 'upsert':
            return { ...effect, resource: { ...effect.resource, workspaceId: context.workspaceId } }
          case 'remove':
            return { ...effect, resource: { ...effect.resource, workspaceId: context.workspaceId } }
          case 'refresh':
            return { ...effect, resource: { ...effect.resource, workspaceId: context.workspaceId } }
          case 'clear_view':
            return { ...effect, resource: { ...effect.resource, workspaceId: context.workspaceId } }
        }
      }),
    }
  return sink
    ? withCopilotSpan(TraceSpan.CopilotCliSink, undefined, () =>
        applySink(sink, sessionKey, result, context.signal, files?.observeOutput)
      )
    : result
}
