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
 * This is a thin, client-safe `ToolConfig`: it normalizes the block's raw
 * subblock values and proxies to the internal `/api/tools/managed-agent/run`
 * route, which resolves the workspace's Claude Platform BYOK key and runs the
 * session lifecycle server-side. No server-only code is imported here, so the
 * tool registry stays safe to walk from the client.
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
    files: {
      type: 'array',
      required: false,
      visibility: 'user-only',
      description: 'Files-API file ids to attach as file resources (cloud environments).',
    },
    sessionParameters: {
      type: 'object',
      required: false,
      visibility: 'user-only',
      description: 'Key/value session metadata forwarded to the session.',
    },
  },

  request: {
    url: '/api/tools/managed-agent/run',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => {
      const vaults = normalizeStringList(params.vaults)
      const fileIds = normalizeFiles(params.files)
      const sessionParameters = normalizeSessionParameters(params.sessionParameters)
      const memoryStoreId = params.memoryStoreId?.trim() || undefined
      const memoryAccess = normalizeMemoryAccess(params.memoryAccess)
      return {
        agent: params.agent?.trim() ?? '',
        environment: params.environment?.trim() ?? '',
        userMessage: params.userMessage,
        ...(vaults.length > 0 ? { vaults, vaultsAck: isTruthyAck(params.vaultsAck) } : {}),
        ...(memoryStoreId ? { memoryStoreId } : {}),
        ...(memoryStoreId && memoryAccess ? { memoryAccess } : {}),
        ...(fileIds.length > 0 ? { fileIds } : {}),
        ...(sessionParameters ? { sessionParameters } : {}),
      }
    },
  },

  transformResponse: async (response: Response) => response.json(),

  outputs: {
    content: {
      type: 'string',
      description: 'Final assistant text from the Managed Agent session.',
    },
    sessionId: {
      type: 'string',
      description: 'Anthropic session id (for logs / linking).',
    },
  },
}
