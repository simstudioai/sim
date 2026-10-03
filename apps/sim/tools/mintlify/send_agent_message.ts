import type {
  MintlifyAgentJobResponse,
  MintlifySendAgentMessageParams,
} from '@/tools/mintlify/types'
import {
  AGENT_JOB_OUTPUTS,
  MINTLIFY_API_BASE,
  mintlifyHeaders,
  pathSegment,
  readMintlifyJson,
  toAgentJobOutput,
} from '@/tools/mintlify/utils'
import type { ToolConfig } from '@/tools/types'

export const mintlifySendAgentMessageTool: ToolConfig<
  MintlifySendAgentMessageParams,
  MintlifyAgentJobResponse
> = {
  id: 'mintlify_send_agent_message',
  name: 'Mintlify Send Agent Message',
  description:
    'Send a follow-up instruction to an existing Mintlify agent job. The message is processed asynchronously.',
  version: '1.0.0',

  params: {
    projectId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Mintlify project ID, copied from the API keys page in your dashboard',
    },
    jobId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Unique identifier of the agent job to send a message to',
    },
    prompt: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The follow-up instruction for the agent',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Mintlify admin API key (starts with mint_)',
    },
  },

  request: {
    url: (params) =>
      `${MINTLIFY_API_BASE}/v2/agent/${pathSegment(params.projectId)}/job/${pathSegment(params.jobId)}/message`,
    method: 'POST',
    headers: (params) => mintlifyHeaders(params.apiKey),
    body: (params) => ({ prompt: params.prompt }),
  },

  transformResponse: async (response: Response) => {
    const data = await readMintlifyJson(response, 'Failed to send Mintlify agent message')

    return {
      success: true,
      output: toAgentJobOutput(data),
    }
  },

  outputs: AGENT_JOB_OUTPUTS,
}
