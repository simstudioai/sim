import {
  buildIntercomUrl,
  handleIntercomError,
  INTERCOM_CONTACT_OUTPUT_PROPERTIES,
} from '@/tools/intercom/types'
import type { ToolConfig } from '@/tools/types'

export interface IntercomGetContactParams {
  accessToken: string
  contactId: string
}

export interface IntercomGetContactResponse {
  success: boolean
  output: {
    contact: any
    metadata: {
      operation: 'get_contact'
    }
    success: boolean
  }
}

const intercomGetContactBase = {
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
      description: 'Contact ID to retrieve',
    },
  },

  request: {
    url: (params: IntercomGetContactParams) => buildIntercomUrl(`/contacts/${params.contactId}`),
    method: 'GET',
    headers: (params: IntercomGetContactParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Intercom-Version': '2.14',
    }),
  },
} satisfies Pick<ToolConfig<IntercomGetContactParams, any>, 'params' | 'request'>

export const intercomGetContactTool: ToolConfig<
  IntercomGetContactParams,
  IntercomGetContactResponse
> = {
  id: 'intercom_get_contact',
  name: 'Get Single Contact from Intercom',
  description: 'Get a single contact by ID from Intercom',
  version: '1.0.0',

  ...intercomGetContactBase,

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleIntercomError(data, response.status, 'get_contact')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        contact: data,
        metadata: {
          operation: 'get_contact' as const,
        },
        success: true,
      },
    }
  },

  outputs: {
    contact: {
      type: 'object',
      description: 'Contact object',
      properties: INTERCOM_CONTACT_OUTPUT_PROPERTIES,
    },
    metadata: {
      type: 'object',
      description: 'Operation metadata',
      properties: {
        operation: { type: 'string', description: 'The operation performed (get_contact)' },
      },
    },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}

interface IntercomGetContactV2Response {
  success: boolean
  output: {
    contact: any
  }
}

export const intercomGetContactV2Tool: ToolConfig<
  IntercomGetContactParams,
  IntercomGetContactV2Response
> = {
  ...intercomGetContactBase,
  id: 'intercom_get_contact_v2',
  name: 'Get Single Contact from Intercom',
  description: 'Get a single contact by ID from Intercom. Returns API-aligned fields only.',
  version: '2.0.0',

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleIntercomError(data, response.status, 'get_contact')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        contact: data,
      },
    }
  },

  outputs: {
    contact: {
      type: 'object',
      description: 'Contact object',
      properties: INTERCOM_CONTACT_OUTPUT_PROPERTIES,
    },
  },
}
