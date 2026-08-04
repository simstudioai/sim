import type { ToolConfig } from '@/tools/types'
import type { ZohoDeskGetContactParams, ZohoDeskResponse } from '@/tools/zoho_desk/types'
import { ZOHO_DESK_CONTACT_PROPERTIES } from '@/tools/zoho_desk/types'
import {
  buildZohoDeskHeaders,
  getZohoDeskApiBase,
  getZohoDeskErrorMessage,
  requireZohoDeskId,
} from '@/tools/zoho_desk/utils'

export const zohoDeskGetContactTool: ToolConfig<ZohoDeskGetContactParams, ZohoDeskResponse> = {
  id: 'zoho_desk_get_contact',
  name: 'Zoho Desk Get Contact',
  description: 'Retrieve a Zoho Desk contact by ID.',
  version: '1.0.0',

  oauth: { required: true, provider: 'zoho-desk' },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Zoho Desk OAuth access token',
    },
    apiDomain: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'Zoho Desk data-center REST base URL',
    },
    orgId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Zoho Desk organization ID',
    },
    contactId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Contact ID to retrieve',
    },
  },

  request: {
    url: (params) =>
      `${getZohoDeskApiBase(params)}/contacts/${encodeURIComponent(requireZohoDeskId(params.contactId, 'Contact ID'))}`,
    method: 'GET',
    headers: (params) => buildZohoDeskHeaders(params),
  },

  transformResponse: async (response) => {
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(
        getZohoDeskErrorMessage(data, `Failed to get contact (HTTP ${response.status})`)
      )
    }
    return {
      success: true,
      output: { contact: data },
    }
  },

  outputs: {
    contact: {
      type: 'object',
      description: 'The contact',
      properties: ZOHO_DESK_CONTACT_PROPERTIES,
    },
  },
}
