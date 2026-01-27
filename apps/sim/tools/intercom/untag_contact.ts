import { buildIntercomUrl, handleIntercomError } from '@/tools/intercom/types'
import type { ToolConfig } from '@/tools/types'

export interface IntercomUntagContactParams {
  accessToken: string
  contactId: string
  tagId: string
}

export interface IntercomUntagContactV2Response {
  success: boolean
  output: {
    id: string
    name: string
    type: string
  }
}

const untagContactBase = {
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
      description: 'The ID of the contact to untag',
    },
    tagId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the tag to remove',
    },
  },

  request: {
    url: (params: IntercomUntagContactParams) =>
      buildIntercomUrl(`/contacts/${params.contactId}/tags/${params.tagId}`),
    method: 'DELETE',
    headers: (params: IntercomUntagContactParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Intercom-Version': '2.14',
    }),
  },
} satisfies Pick<ToolConfig<IntercomUntagContactParams, any>, 'params' | 'request'>

export const intercomUntagContactV2Tool: ToolConfig<
  IntercomUntagContactParams,
  IntercomUntagContactV2Response
> = {
  ...untagContactBase,
  id: 'intercom_untag_contact_v2',
  name: 'Untag Contact in Intercom',
  description: 'Remove a tag from a specific contact',
  version: '2.0.0',

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleIntercomError(data, response.status, 'untag_contact')
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
    id: { type: 'string', description: 'Unique identifier for the tag that was removed' },
    name: { type: 'string', description: 'Name of the tag that was removed' },
    type: { type: 'string', description: 'Object type (tag)' },
  },
}
