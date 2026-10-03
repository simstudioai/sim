import { getErrorMessage } from '@sim/utils/errors'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import {
  type CreateSessionInput,
  createSession,
  getEnvironmentType,
} from '@/lib/managed-agents/session-client'
import {
  isTruthyAck,
  normalizeFiles,
  normalizeMemoryAccess,
  normalizeSessionParameters,
  normalizeStringList,
} from '@/tools/managed_agent/normalizers'
import type {
  ManagedAgentCreateSessionParams,
  ManagedAgentCreateSessionResponse,
} from '@/tools/managed_agent/types'

export const executeManagedAgentCreateSessionOperation: InternalToolOperationImplementation<
  ManagedAgentCreateSessionParams
> = async (params, signal, context): Promise<ManagedAgentCreateSessionResponse> => {
  const apiKey = params.accessToken
  if (!apiKey) {
    return {
      success: false,
      output: { sessionId: '', started: false },
      error: 'No Claude Platform credential is selected, or it could not be resolved.',
    }
  }

  const agentId = params.agent?.trim()
  const environmentId = params.environment?.trim()
  if (!agentId || !environmentId) {
    return {
      success: false,
      output: { sessionId: '', started: false },
      error: 'An agent and an environment are required.',
    }
  }

  const vaultIds = normalizeStringList(params.vaults)
  if (vaultIds.length > 0 && !isTruthyAck(params.vaultsAck)) {
    return {
      success: false,
      output: { sessionId: '', started: false },
      error:
        'Vault authorization is required — check the "I am authorized to use these vaults" acknowledgement on the block, or remove the selected vault(s).',
    }
  }

  const files = normalizeFiles(params.files)
  const sessionParameters = normalizeSessionParameters(params.sessionParameters)
  const memoryStoreId = params.memoryStoreId?.trim() || undefined
  const memoryAccess = normalizeMemoryAccess(params.memoryAccess)
  const memoryInstructions = params.memoryInstructions?.trim() || undefined
  const initialMessage = (params.userMessage ?? '').toString().trim() || undefined

  const workflowId = context?.workflowId.trim()
  const title = workflowId ? `Sim workflow ${workflowId}` : undefined

  // Self-hosted environments reject `resources`, so the payload must know the
  // execution model. The API is authoritative; the block's hint is a fallback.
  const hinted =
    params.environmentType === 'self_hosted' || params.environmentType === 'cloud'
      ? params.environmentType
      : undefined
  const environmentType =
    (await getEnvironmentType({ apiKey, environmentId, ...(signal ? { signal } : {}) })) ?? hinted

  const createInput: CreateSessionInput = {
    apiKey,
    agentId,
    environmentId,
    ...(environmentType ? { environmentType } : {}),
    ...(title ? { title } : {}),
    ...(vaultIds.length > 0 ? { vaultIds } : {}),
    ...(memoryStoreId ? { memoryStoreId } : {}),
    ...(memoryStoreId && memoryAccess ? { memoryAccess } : {}),
    ...(memoryStoreId && memoryInstructions ? { memoryInstructions } : {}),
    ...(files.length > 0 ? { files } : {}),
    ...(sessionParameters ? { sessionParameters } : {}),
    ...(initialMessage ? { initialMessage } : {}),
    ...(signal ? { signal } : {}),
  }

  try {
    const session = await createSession(createInput)
    return {
      success: true,
      output: { sessionId: session.id, started: Boolean(initialMessage) },
    }
  } catch (error) {
    return {
      success: false,
      output: { sessionId: '', started: false },
      error: getErrorMessage(error, 'Failed to create Managed Agent session'),
    }
  }
}
