import type {
  MintlifyTriggerUpdateParams,
  MintlifyTriggerUpdateResponse,
} from '@/tools/mintlify/types'
import {
  MINTLIFY_API_BASE,
  mintlifyHeaders,
  pathSegment,
  readMintlifyJson,
  toNullableString,
} from '@/tools/mintlify/utils'
import type { ToolConfig } from '@/tools/types'

export const mintlifyTriggerUpdateTool: ToolConfig<
  MintlifyTriggerUpdateParams,
  MintlifyTriggerUpdateResponse
> = {
  id: 'mintlify_trigger_update',
  name: 'Mintlify Trigger Update',
  description:
    'Queue a deployment update for a Mintlify documentation project from its configured deployment branch. Returns a status ID for tracking progress.',
  version: '1.0.0',

  params: {
    projectId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Mintlify project ID, copied from the API keys page in your dashboard',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Mintlify admin API key (starts with mint_)',
    },
  },

  request: {
    url: (params) => `${MINTLIFY_API_BASE}/v1/project/update/${pathSegment(params.projectId)}`,
    method: 'POST',
    headers: (params) => mintlifyHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await readMintlifyJson(response, 'Failed to trigger Mintlify update')

    return {
      success: true,
      output: {
        statusId: toNullableString(data.statusId),
      },
    }
  },

  outputs: {
    statusId: {
      type: 'string',
      description: 'Status ID of the queued update. Poll it with Get Update Status.',
      nullable: true,
    },
  },
}
