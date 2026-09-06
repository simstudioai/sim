import type { Principal } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { createEmbeddedClient, type EmbeddedCliIdentity } from 'sim/embed'
import { authenticateV2ApiKey } from '@/lib/api/server/routes/v2-api-key-auth'
import { getInternalApiBaseUrl } from '@/lib/core/utils/urls'
import { curateBlockDetail } from '@/lib/mothership/agent-cli/curation'
import { runEngine } from '@/lib/mothership/agent-cli/engines'
import { createFileReadTransport } from '@/lib/mothership/agent-cli/file-read-transport'
import { createFileUploadTransport } from '@/lib/mothership/agent-cli/file-upload-transport'
import { runCli } from '@/lib/mothership/agent-cli/run-cli'
import { applySink } from '@/lib/mothership/agent-cli/sink'
import { agentCliFail } from '@/lib/mothership/agent-cli/types'
import { createWorkbenchFileProvenance } from '@/lib/mothership/agent-cli/workbench-file-provenance'
import { mintDelegationToken } from '@/lib/mothership/chat/delegation'
import type { AgentCliRawResult, AgentCliRequest } from '@/lib/mothership/generated/agent-cli'
import { chatSandboxSessionKey } from '@/lib/mothership/tools/sandbox-session-key'
import type { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

export interface AgentCliExecutionContext {
  workspaceId: string
  userId: string
  chatId?: string | undefined
  signal?: AbortSignal | undefined
  resolvedSecretTraceRegistry?: ResolvedSecretTraceRegistry
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
  context.signal?.throwIfAborted()
  const apiKey = await mintDelegationToken({
    workspaceId: context.workspaceId,
    userId: context.userId,
  })
  if (!apiKey) return agentCliFail('Could not establish workspace credentials for this command.')
  const endpoint = getInternalApiBaseUrl()
  const sessionKey = context.chatId ? chatSandboxSessionKey(context.chatId) : null
  const files = sessionKey ? createWorkbenchFileProvenance({ ...context, sessionKey }) : undefined
  const reads = createFileReadTransport({
    endpoint,
    userId: context.userId,
    registry: context.resolvedSecretTraceRegistry,
    ...(context.chatId !== undefined ? { chatId: context.chatId } : {}),
    ...(files ? { trackDownload: files.trackDownload } : {}),
  })
  const identity: EmbeddedCliIdentity = {
    endpoint,
    apiKey,
    workspaceId: context.workspaceId,
    transport: files
      ? createFileUploadTransport({
          endpoint,
          workspaceId: context.workspaceId,
          userId: context.userId,
          fallback: reads,
          uploadProvenance: files.uploadProvenance,
        })
      : reads,
    ...(context.signal ? { signal: context.signal } : {}),
  }

  let result: AgentCliRawResult
  context.signal?.throwIfAborted()
  if (request.invocation.kind === 'stdout') {
    // Text the worker already holds (sliced, or worker-answered): only the sink applies.
    result = { exitCode: 0, stdout: request.invocation.stdout, stderr: '' }
  } else if (request.invocation.kind === 'augmentation') {
    result = await runEngine(
      request.invocation.name,
      request.invocation.positionals,
      {
        client: createEmbeddedClient(identity),
        workspaceId: context.workspaceId,
        userId: context.userId,
        principal: await principalForDelegation(apiKey),
        ...(context.chatId !== undefined ? { chatId: context.chatId } : {}),
        signal: context.signal,
      },
      request.invocation.flags
    )
  } else {
    result = await runCli(request.invocation.argv, identity, sessionKey, files)
    if (result.exitCode === 0 && request.curate === 'block') {
      result = await curateBlockDetail(result, context)
    }
  }
  return request.sink
    ? applySink(request.sink, sessionKey, result, context.signal, files?.observeOutput)
    : result
}

/**
 * The delegation key resolved exactly as the v2 surface resolves it. Null when the key
 * does not authenticate (expired mid-command): the engine then keeps the client path,
 * whose own requests fail the same honest way.
 */
const logger = createLogger('AgentCli')

async function principalForDelegation(apiKey: string): Promise<Principal | undefined> {
  try {
    return (await authenticateV2ApiKey(apiKey)).principal
  } catch (error) {
    logger.warn('Delegation key did not resolve to a principal for the engine', {
      error: getErrorMessage(error),
    })
    return undefined
  }
}
