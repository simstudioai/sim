import type { MintlifyAgentJobResponse, MintlifyCreateAgentJobParams } from '@/tools/mintlify/types'
import {
  AGENT_JOB_OUTPUTS,
  MINTLIFY_API_BASE,
  mintlifyHeaders,
  pathSegment,
  readMintlifyJson,
  toAgentJobOutput,
} from '@/tools/mintlify/utils'
import type { ToolConfig } from '@/tools/types'

export const mintlifyCreateAgentJobTool: ToolConfig<
  MintlifyCreateAgentJobParams,
  MintlifyAgentJobResponse
> = {
  id: 'mintlify_create_agent_job',
  name: 'Mintlify Create Agent Job',
  description:
    'Create a background Mintlify agent job that edits your documentation from a prompt. Opens a pull request when the agent successfully edits files.',
  version: '1.0.0',

  params: {
    projectId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Mintlify project ID, copied from the API keys page in your dashboard',
    },
    prompt: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The instruction for the agent to execute',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Mintlify admin API key (starts with mint_)',
    },
  },

  request: {
    url: (params) => `${MINTLIFY_API_BASE}/v2/agent/${pathSegment(params.projectId)}/job`,
    method: 'POST',
    headers: (params) => mintlifyHeaders(params.apiKey),
    body: (params) => ({ prompt: params.prompt }),
  },

  transformResponse: async (response: Response) => {
    const data = await readMintlifyJson(response, 'Failed to create Mintlify agent job')

    return {
      success: true,
      output: toAgentJobOutput(data),
    }
  },

  outputs: AGENT_JOB_OUTPUTS,
}
