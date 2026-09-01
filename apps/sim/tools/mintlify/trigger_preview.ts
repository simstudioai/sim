import type {
  MintlifyTriggerPreviewParams,
  MintlifyTriggerPreviewResponse,
} from '@/tools/mintlify/types'
import {
  MINTLIFY_API_BASE,
  mintlifyHeaders,
  pathSegment,
  readMintlifyJson,
  toNullableString,
} from '@/tools/mintlify/utils'
import type { ToolConfig } from '@/tools/types'

export const mintlifyTriggerPreviewTool: ToolConfig<
  MintlifyTriggerPreviewParams,
  MintlifyTriggerPreviewResponse
> = {
  id: 'mintlify_trigger_preview',
  name: 'Mintlify Trigger Preview Deployment',
  description:
    'Create or update a Mintlify preview deployment for a Git branch. Redeploys when a preview already exists for the branch.',
  version: '1.0.0',

  params: {
    projectId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Mintlify project ID, copied from the API keys page in your dashboard',
    },
    branch: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the Git branch to create a preview deployment for',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Mintlify admin API key (starts with mint_)',
    },
  },

  request: {
    url: (params) => `${MINTLIFY_API_BASE}/v1/project/preview/${pathSegment(params.projectId)}`,
    method: 'POST',
    headers: (params) => mintlifyHeaders(params.apiKey),
    body: (params) => ({ branch: params.branch }),
  },

  transformResponse: async (response: Response) => {
    const data = await readMintlifyJson(response, 'Failed to trigger Mintlify preview deployment')

    return {
      success: true,
      output: {
        statusId: toNullableString(data.statusId),
        previewUrl: toNullableString(data.previewUrl),
      },
    }
  },

  outputs: {
    statusId: {
      type: 'string',
      description: 'Status ID for tracking the preview deployment',
      nullable: true,
    },
    previewUrl: {
      type: 'string',
      description: 'URL where the preview deployment is hosted',
      nullable: true,
    },
  },
}
