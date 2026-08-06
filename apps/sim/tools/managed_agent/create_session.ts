import { getErrorMessage } from '@sim/utils/errors'
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
import { ACCESS_TOKEN_PARAM, CREDENTIAL_PARAM, UNUSED_REQUEST } from '@/tools/managed_agent/shared'
import type {
  ManagedAgentCreateSessionParams,
  ManagedAgentCreateSessionResponse,
} from '@/tools/managed_agent/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Creates a Managed Agent session and returns its id WITHOUT waiting for the
 * agent to finish.
 *
 * This is the non-blocking counterpart to `managed_agent_run_session`: it makes
 * the session a durable handle a later workflow run can address (via
 * `managed_agent_send_message` / `..._get_session`), which is what a
 * conversational or webhook-driven integration needs. Supplying a first message
 * seeds `initial_events`, so create-and-start is a single API call.
 */
export const managedAgentCreateSessionTool: ToolConfig<
  ManagedAgentCreateSessionParams,
  ManagedAgentCreateSessionResponse
> = {
  id: 'managed_agent_create_session',
  name: 'Managed Agent Create Session',
  description:
    'Create a Claude Platform Managed Agent session and return its id without waiting for a reply.',
  version: '1.0.0',

  params: {
    credential: CREDENTIAL_PARAM,
    accessToken: ACCESS_TOKEN_PARAM,
    agent: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Managed-agent id inside the linked Claude workspace.',
    },
    environment: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Environment id inside the linked Claude workspace.',
    },
    environmentType: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: "Environment execution model hint ('cloud' | 'self_hosted').",
    },
    userMessage: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional first message; seeds initial_events and starts the agent immediately.',
    },
    vaults: {
      type: 'array',
      required: false,
      visibility: 'user-only',
      description: 'Zero or more vault ids for MCP tool auth.',
    },
    vaultsAck: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Acknowledgement that the author may use the attached vaults.',
    },
    memoryStoreId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Optional Agent Memory Store id.',
    },
    memoryAccess: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: "Memory store access mode: 'read_write' (default) or 'read_only'.",
    },
    memoryInstructions: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Per-attachment guidance for how the agent should use the memory store.',
    },
    files: {
      type: 'array',
      required: false,
      visibility: 'user-only',
      description: 'File attachments (cloud envs only), as [{fileId, mountPath?}].',
    },
    sessionParameters: {
      type: 'object',
      required: false,
      visibility: 'user-only',
      description: 'Key/value session metadata forwarded to the session.',
    },
  },

  request: {
    ...UNUSED_REQUEST,
    modelInput: {
      mode: 'project',
      select: (params) => ({
        userMessage: params.userMessage,
        memoryInstructions: params.memoryInstructions,
      }),
    },
  },

  directExecution: async (params, signal): Promise<ManagedAgentCreateSessionResponse> => {
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

    const workflowId = params._context?.workflowId?.trim()
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
  },

  outputs: {
    sessionId: { type: 'string', description: 'Anthropic session id (sesn_...).' },
    started: {
      type: 'boolean',
      description: 'True when a first message was seeded, so the agent is already running.',
    },
  },
}
