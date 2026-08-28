import type {
  ManagedAgentRunSessionParams,
  ManagedAgentRunSessionResponse,
} from '@/tools/managed_agent/types'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

/**
 * Opens a Claude Platform Managed Agent session and returns the assistant
 * response as text.
 *
 * The block's `credential` picker supplies a Claude Platform service-account
 * credential; the executor resolves it to the workspace API key and injects
 * `accessToken` before the registered operation runs.
 */

export const managedAgentRunSessionTool: InternalToolConfig<
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
    accessToken: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'Workspace API key injected by the executor from the selected credential.',
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
    environmentType: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        "Environment execution model hint ('cloud' | 'self_hosted'); the actual type is re-resolved server-side for routing.",
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
  operation: {
    input: createInternalToolOperationInput,
    modelInput: {
      mode: 'project',
      select: (params) => ({
        userMessage: params.userMessage,
        memoryInstructions: params.memoryInstructions,
      }),
    },
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
