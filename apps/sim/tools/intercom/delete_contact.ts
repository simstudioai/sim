import { buildIntercomUrl, handleIntercomError } from '@/tools/intercom/types'
import type { ToolConfig } from '@/tools/types'

export interface IntercomDeleteContactParams {
  accessToken: string
  contactId: string
}

export interface IntercomDeleteContactResponse {
  success: boolean
  output: {
    id: string
    deleted: boolean
    metadata: {
      operation: 'delete_contact'
    }
    success: boolean
  }
}

const intercomDeleteContactBase = {
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
      description: 'Contact ID to delete',
    },
  },

  request: {
    url: (params: IntercomDeleteContactParams) => buildIntercomUrl(`/contacts/${params.contactId}`),
    method: 'DELETE',
    headers: (params: IntercomDeleteContactParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
      'Intercom-Version': '2.14',
    }),
  },
} satisfies Pick<ToolConfig<IntercomDeleteContactParams, any>, 'params' | 'request'>

export const intercomDeleteContactTool: ToolConfig<
  IntercomDeleteContactParams,
  IntercomDeleteContactResponse
> = {
  id: 'intercom_delete_contact',
  name: 'Delete Contact from Intercom',
  description: 'Delete a contact from Intercom by ID',
  version: '1.0.0',

  ...intercomDeleteContactBase,

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleIntercomError(data, response.status, 'delete_contact')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        id: data.id,
        deleted: true,
        metadata: {
          operation: 'delete_contact' as const,
        },
        success: true,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'ID of deleted contact' },
    deleted: { type: 'boolean', description: 'Whether the contact was deleted' },
    metadata: {
      type: 'object',
      description: 'Operation metadata',
      properties: {
        operation: { type: 'string', description: 'The operation performed (delete_contact)' },
      },
    },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}

interface IntercomDeleteContactV2Response {
  success: boolean
  output: {
    id: string
    deleted: boolean
  }
}

export const intercomDeleteContactV2Tool: ToolConfig<
  IntercomDeleteContactParams,
  IntercomDeleteContactV2Response
> = {
  ...intercomDeleteContactBase,
  id: 'intercom_delete_contact_v2',
  name: 'Delete Contact from Intercom',
  description: 'Delete a contact from Intercom by ID. Returns API-aligned fields only.',
  version: '2.0.0',

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleIntercomError(data, response.status, 'delete_contact')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        id: data.id,
        deleted: true,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'ID of deleted contact' },
    deleted: { type: 'boolean', description: 'Whether the contact was deleted' },
  },
}
