import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import { runManagedAgentSession } from '@/lib/managed-agents/run-session'
import {
  isTruthyAck,
  normalizeFiles,
  normalizeMemoryAccess,
  normalizeSessionParameters,
  normalizeStringList,
} from '@/tools/managed_agent/normalizers'
import type {
  ManagedAgentRunSessionParams,
  ManagedAgentRunSessionResponse,
} from '@/tools/managed_agent/types'

export const executeManagedAgentRunSessionOperation: InternalToolOperationImplementation<
  ManagedAgentRunSessionParams
> = async (params, signal, context): Promise<ManagedAgentRunSessionResponse> => {
  const apiKey = params.accessToken
  if (!apiKey) {
    return {
      success: false,
      output: { content: '', sessionId: '' },
      error: 'No Claude Platform credential is selected, or it could not be resolved.',
    }
  }

  const agentId = params.agent?.trim()
  const environmentId = params.environment?.trim()
  if (!agentId || !environmentId) {
    return {
      success: false,
      output: { content: '', sessionId: '' },
      error: 'An agent and an environment are required.',
    }
  }

  const vaultIds = normalizeStringList(params.vaults)
  if (vaultIds.length > 0 && !isTruthyAck(params.vaultsAck)) {
    return {
      success: false,
      output: { content: '', sessionId: '' },
      error:
        'Vault authorization is required — check the "I am authorized to use these vaults" acknowledgement on the block, or remove the selected vault(s).',
    }
  }

  const files = normalizeFiles(params.files)
  const sessionParameters = normalizeSessionParameters(params.sessionParameters)
  const memoryStoreId = params.memoryStoreId?.trim() || undefined
  const memoryAccess = normalizeMemoryAccess(params.memoryAccess)
  const memoryInstructions = params.memoryInstructions?.trim() || undefined

  // Title the Anthropic session so it is traceable to its Sim workflow from
  // the Claude Platform console. Only the workflow id is available in the
  // client-safe execution context (names would require a DB lookup).
  const workflowId = context?.workflowId.trim()
  const title = workflowId ? `Sim workflow ${workflowId}` : undefined

  const environmentType =
    params.environmentType === 'self_hosted' || params.environmentType === 'cloud'
      ? params.environmentType
      : undefined

  const result = await runManagedAgentSession({
    apiKey,
    agentId,
    environmentId,
    userMessage: (params.userMessage ?? '').toString(),
    ...(environmentType ? { environmentType } : {}),
    ...(title ? { title } : {}),
    ...(vaultIds.length > 0 ? { vaultIds } : {}),
    ...(memoryStoreId ? { memoryStoreId } : {}),
    ...(memoryStoreId && memoryAccess ? { memoryAccess } : {}),
    ...(memoryStoreId && memoryInstructions ? { memoryInstructions } : {}),
    ...(files.length > 0 ? { files } : {}),
    ...(sessionParameters ? { sessionParameters } : {}),
    ...(signal ? { signal } : {}),
  })

  if (!result.ok) {
    return {
      success: false,
      output: { content: result.content, sessionId: result.sessionId ?? '' },
      error: result.error ?? 'Managed Agent session failed',
    }
  }

  return {
    success: true,
    output: {
      content: result.content,
      sessionId: result.sessionId ?? '',
      ...(result.inputTokens !== undefined ? { inputTokens: result.inputTokens } : {}),
      ...(result.outputTokens !== undefined ? { outputTokens: result.outputTokens } : {}),
    },
  }
}
