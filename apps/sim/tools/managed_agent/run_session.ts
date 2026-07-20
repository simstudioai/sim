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
import type { ToolConfig } from '@/tools/types'

/**
 * Opens a Claude Platform Managed Agent session and returns the assistant
 * response as text.
 *
 * The block's `credential` picker supplies a Claude Platform service-account
 * credential; the executor resolves it to the workspace API key and injects
 * `accessToken` before `directExecution` runs. The session lifecycle
 * (`runManagedAgentSession`) is pure `fetch` with no server-only deps, so the
 * tool module stays safe to import from the client registry.
 */
export const managedAgentRunSessionTool: ToolConfig<
  ManagedAgentRunSessionParams,
  ManagedAgentRunSessionResponse
> = {
  id: 'managed_agent_run_session',
  name: 'Managed Agent Run Session',
  description:
    'Open a Claude Platform Managed Agent session and return the assistant response as text.',
  version: '1.0.0',

  params: {
    credential: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description:
        'Claude Platform credential (Anthropic workspace API key) to run the agent with.',
    },
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
    userMessage: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The user message to send to the Managed Agent.',
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

  // Unused: `directExecution` runs the session and short-circuits the HTTP
  // path, but `ToolConfig` requires a `request` shape.
  request: {
    url: () => '',
    method: 'POST',
    headers: () => ({}),
  },

  directExecution: async (params): Promise<ManagedAgentRunSessionResponse> => {
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

    const result = await runManagedAgentSession({
      apiKey,
      agentId,
      environmentId,
      userMessage: (params.userMessage ?? '').toString(),
      ...(vaultIds.length > 0 ? { vaultIds } : {}),
      ...(memoryStoreId ? { memoryStoreId } : {}),
      ...(memoryStoreId && memoryAccess ? { memoryAccess } : {}),
      ...(memoryStoreId && memoryInstructions ? { memoryInstructions } : {}),
      ...(files.length > 0 ? { files } : {}),
      ...(sessionParameters ? { sessionParameters } : {}),
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
  },

  outputs: {
    content: {
      type: 'string',
      description: 'Final assistant text from the Managed Agent session.',
    },
    sessionId: {
      type: 'string',
      description: 'Anthropic session id (for logs / linking).',
    },
    inputTokens: {
      type: 'number',
      description: 'Cumulative input tokens for the session.',
      optional: true,
    },
    outputTokens: {
      type: 'number',
      description: 'Cumulative output tokens for the session.',
      optional: true,
    },
  },
}
