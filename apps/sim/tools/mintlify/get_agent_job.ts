import type { MintlifyAgentJobResponse, MintlifyGetAgentJobParams } from '@/tools/mintlify/types'
import {
  AGENT_JOB_OUTPUTS,
  MINTLIFY_API_BASE,
  mintlifyHeaders,
  pathSegment,
  readMintlifyJson,
  toAgentJobOutput,
} from '@/tools/mintlify/utils'
import type { ToolConfig } from '@/tools/types'

export const mintlifyGetAgentJobTool: ToolConfig<
  MintlifyGetAgentJobParams,
  MintlifyAgentJobResponse
> = {
  id: 'mintlify_get_agent_job',
  name: 'Mintlify Get Agent Job',
  description:
    'Retrieve the current status and details of a Mintlify agent job, including the pull request link once the agent opens one.',
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
      description: 'Unique identifier of the agent job',
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
      `${MINTLIFY_API_BASE}/v2/agent/${pathSegment(params.projectId)}/job/${pathSegment(params.jobId)}`,
    method: 'GET',
    headers: (params) => mintlifyHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await readMintlifyJson(response, 'Failed to get Mintlify agent job')

    return {
      success: true,
      output: toAgentJobOutput(data),
    }
  },

  outputs: AGENT_JOB_OUTPUTS,
}
