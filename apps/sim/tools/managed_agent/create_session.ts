import { ACCESS_TOKEN_PARAM, CREDENTIAL_PARAM } from '@/tools/managed_agent/shared'
import type {
  ManagedAgentCreateSessionParams,
  ManagedAgentCreateSessionResponse,
} from '@/tools/managed_agent/types'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

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

export const managedAgentCreateSessionTool: InternalToolConfig<
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
    sessionId: { type: 'string', description: 'Anthropic session id (sesn_...).' },
    started: {
      type: 'boolean',
      description: 'True when a first message was seeded, so the agent is already running.',
    },
  },
}
