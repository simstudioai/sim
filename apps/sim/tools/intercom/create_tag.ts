import { buildIntercomUrl, handleIntercomError } from '@/tools/intercom/types'
import type { ToolConfig } from '@/tools/types'

export interface IntercomCreateTagParams {
  accessToken: string
  name: string
  id?: string
}

export interface IntercomCreateTagV2Response {
  success: boolean
  output: {
    id: string
    name: string
    type: string
  }
}

const createTagBase = {
  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Intercom API access token',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The name of the tag. Will create a new tag if not found, or update the name if id is provided.',
    },
    id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The ID of an existing tag to update. Omit to create a new tag.',
    },
  },

  request: {
    url: () => buildIntercomUrl('/tags'),
    method: 'POST',
    headers: (params: IntercomCreateTagParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
      'Intercom-Version': '2.14',
    }),
    body: (params: IntercomCreateTagParams) => {
      const payload: any = {
        name: params.name,
      }

      if (params.id) {
        payload.id = params.id
      }

      return payload
    },
  },
} satisfies Pick<ToolConfig<IntercomCreateTagParams, any>, 'params' | 'request'>

export const intercomCreateTagV2Tool: ToolConfig<
  IntercomCreateTagParams,
  IntercomCreateTagV2Response
> = {
  ...createTagBase,
  id: 'intercom_create_tag_v2',
  name: 'Create Tag in Intercom',
  description: 'Create a new tag or update an existing tag name',
  version: '2.0.0',

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleIntercomError(data, response.status, 'create_tag')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        id: data.id,
        name: data.name,
        type: data.type ?? 'tag',
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Unique identifier for the tag' },
    name: { type: 'string', description: 'Name of the tag' },
    type: { type: 'string', description: 'Object type (tag)' },
  },
}
