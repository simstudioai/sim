import { buildIntercomUrl, handleIntercomError } from '@/tools/intercom/types'
import type { ToolConfig } from '@/tools/types'

export interface IntercomListTagsParams {
  accessToken: string
}

interface IntercomTag {
  type: string
  id: string
  name: string
}

export interface IntercomListTagsV2Response {
  success: boolean
  output: {
    tags: IntercomTag[]
    type: string
  }
}

const listTagsBase = {
  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Intercom API access token',
    },
  },

  request: {
    url: () => buildIntercomUrl('/tags'),
    method: 'GET',
    headers: (params: IntercomListTagsParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Intercom-Version': '2.14',
    }),
  },
} satisfies Pick<ToolConfig<IntercomListTagsParams, any>, 'params' | 'request'>

export const intercomListTagsV2Tool: ToolConfig<
  IntercomListTagsParams,
  IntercomListTagsV2Response
> = {
  ...listTagsBase,
  id: 'intercom_list_tags_v2',
  name: 'List Tags from Intercom',
  description: 'Fetch a list of all tags in the workspace',
  version: '2.0.0',

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleIntercomError(data, response.status, 'list_tags')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        tags: data.tags ?? [],
        type: data.type ?? 'tag.list',
      },
    }
  },

  outputs: {
    tags: {
      type: 'array',
      description: 'Array of tag objects',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Unique identifier for the tag' },
          type: { type: 'string', description: 'Object type (tag)' },
          name: { type: 'string', description: 'Name of the tag' },
        },
      },
    },
    type: { type: 'string', description: 'Object type (list)' },
  },
}
