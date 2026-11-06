import { createEmbeddedClient, type EmbeddedCliIdentity } from 'sim/embed'
import { withWorkspaceInvocationScope } from '@/lib/core/application/workspace-invocation-scope'
import type { AgentCliExecutionContext } from '@/lib/mothership/agent-cli'
import { curateBlockDetail } from '@/lib/mothership/agent-cli/curation'
import { AUGMENTATION_ENGINES, runEngine } from '@/lib/mothership/agent-cli/engines'
import { executePreparedCliRequest, prepareCliSession } from '@/lib/mothership/agent-cli/execute'
import { curateKnowledgeDocuments } from '@/lib/mothership/agent-cli/knowledge-curation'
import { readOnlyCliTransport } from '@/lib/mothership/agent-cli/read-only'
import { createAgentCliTransport } from '@/lib/mothership/agent-cli/transport'
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
import { isFileResourceType } from '@/lib/mothership/resources/types'
import { WORKSPACE_FILES_DELEGATION_AUDIENCE } from '@/lib/workspace-files/application/authorization'

/** Resolves workspace policy before preparing the existing workspace CLI transport. */
export async function executeWorkspaceCliRequest(
  request: AgentCliRequest,
  context: AgentCliExecutionContext,
  workspaceId = request.workspaceId
): Promise<AgentCliRawResult> {
  const target = await resolveInvocationWorkspace(context, workspaceId)
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
  const { endpoint, sessionKey, files, resources } = prepareCliSession(context)
  const identity = {
    endpoint,
    apiKey,
    workspaceId: context.workspaceId,
    transport: createAgentCliTransport({
      endpoint,
      invocation: invocationIdentity,
      registry: context.resolvedSecretTraceRegistry,
      ...(files ? { files } : {}),
      resources,
      observeReads:
        request.invocation.kind === 'cli' ||
        (request.invocation.kind === 'augmentation' &&
          AUGMENTATION_ENGINES[request.invocation.name]?.openReadResources === true),
    }),
    ...(context.signal ? { signal: context.signal } : {}),
  } satisfies EmbeddedCliIdentity

  if (context.readOnly) identity.transport = readOnlyCliTransport(identity.transport)

  return executePreparedCliRequest(request, {
    identity,
    sessionKey,
    files,
    resources,
    augment: (invocation) =>
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
          resolvedSecretTraceRegistry: context.resolvedSecretTraceRegistry,
          signal: context.signal,
        },
        invocation.flags
      ),
    async curate(result) {
      if (request.curate === 'knowledge-documents') return curateKnowledgeDocuments(result)
      if (result.exitCode === 0 && request.curate === 'block') {
        return withCopilotSpan(TraceSpan.CopilotCliCurate, undefined, () =>
          curateBlockDetail(result, context)
        )
      }
      return result
    },
    projectResources: (changes) => {
      function scopeResource<R extends ResourceChange['resource']>(resource: R): R {
        return {
          ...resource,
          ...(request.fileOwner && isFileResourceType(resource.type)
            ? { owner: request.fileOwner }
            : {}),
          ...(context.chatOrganizationId ? { workspaceId: context.workspaceId } : {}),
        }
      }
      return changes.map((effect) => {
        switch (effect.op) {
          case 'upsert':
            return { ...effect, resource: scopeResource(effect.resource) }
          case 'remove':
            return { ...effect, resource: scopeResource(effect.resource) }
          case 'refresh':
            return { ...effect, resource: scopeResource(effect.resource) }
          case 'clear_view':
            return { ...effect, resource: scopeResource(effect.resource) }
        }
      })
    },
  })
}
