import { buildIntercomUrl, handleIntercomError } from '@/tools/intercom/types'
import type { ToolConfig } from '@/tools/types'

export interface IntercomTagContactParams {
  accessToken: string
  contactId: string
  tagId: string
}

export interface IntercomTagContactV2Response {
  success: boolean
  output: {
    id: string
    name: string
    type: string
  }
}

const tagContactBase = {
  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Intercom API access token',
    },
    contactId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the contact to tag',
    },
    tagId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the tag to apply',
    },
  },

  request: {
    url: (params: IntercomTagContactParams) =>
      buildIntercomUrl(`/contacts/${params.contactId}/tags`),
    method: 'POST',
    headers: (params: IntercomTagContactParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
      'Intercom-Version': '2.14',
    }),
    body: (params: IntercomTagContactParams) => ({
      id: params.tagId,
    }),
  },
} satisfies Pick<ToolConfig<IntercomTagContactParams, any>, 'params' | 'request'>

export const intercomTagContactV2Tool: ToolConfig<
  IntercomTagContactParams,
  IntercomTagContactV2Response
> = {
  ...tagContactBase,
  id: 'intercom_tag_contact_v2',
  name: 'Tag Contact in Intercom',
  description: 'Add a tag to a specific contact',
  version: '2.0.0',

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleIntercomError(data, response.status, 'tag_contact')
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
