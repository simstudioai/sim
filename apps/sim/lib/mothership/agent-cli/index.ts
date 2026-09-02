import { createEmbeddedClient, type EmbeddedCliIdentity } from 'sim/embed'
import { getInternalApiBaseUrl } from '@/lib/core/utils/urls'
import { curateBlockDetail } from '@/lib/mothership/agent-cli/curation'
import { runEngine } from '@/lib/mothership/agent-cli/engines'
import { applyPipeline } from '@/lib/mothership/agent-cli/pipeline'
import { runCli } from '@/lib/mothership/agent-cli/run-cli'
import { applySink } from '@/lib/mothership/agent-cli/sink'
import { agentCliFail } from '@/lib/mothership/agent-cli/types'
import { mintDelegationToken } from '@/lib/mothership/chat/delegation'
import type { AgentCliRawResult, AgentCliRequest } from '@/lib/mothership/generated/agent-cli'
import { chatSandboxSessionKey } from '@/lib/mothership/tools/sandbox-session'

export interface AgentCliExecutionContext {
  workspaceId: string
  userId: string
  chatId?: string | undefined
}

/**
 * Executes one typed request from the worker: mint the caller's delegated identity, run
 * the real CLI or the named engine, apply the pre-parsed pipeline, land the sink. Both
 * lanes share one server-minted identity so "the agent is the user" holds without any
 * credential crossing to the worker. Success here means only "the invocation ran".
 */
export async function executeAgentCliRequest(
  request: AgentCliRequest,
  context: AgentCliExecutionContext
): Promise<AgentCliRawResult> {
  const apiKey = await mintDelegationToken({
    workspaceId: context.workspaceId,
    userId: context.userId,
  })
  if (!apiKey) return agentCliFail('Could not establish workspace credentials for this command.')
  const identity: EmbeddedCliIdentity = {
    endpoint: getInternalApiBaseUrl(),
    apiKey,
    workspaceId: context.workspaceId,
  }
  const sessionKey = context.chatId ? chatSandboxSessionKey(context.chatId) : null

  let result: AgentCliRawResult
  if (request.invocation.kind === 'augmentation') {
    result = await runEngine(
      request.invocation.name,
      request.invocation.positionals,
      {
        client: createEmbeddedClient(identity),
        workspaceId: context.workspaceId,
        userId: context.userId,
      },
      request.invocation.flags
    )
  } else {
    result = await runCli(request.invocation.argv, identity, sessionKey)
    if (result.exitCode === 0 && request.curate === 'block') {
      result = await curateBlockDetail(result, context)
    }
  }
  if (result.exitCode === 0 && request.pipeline.length > 0) {
    result = await applyPipeline(result, request.pipeline)
  }
  return request.sink ? applySink(request.sink, sessionKey, result) : result
}
