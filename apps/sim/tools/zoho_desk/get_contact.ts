import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'
import { readZohoDeskResponse } from '@/tools/zoho_desk/request'
import type { ZohoDeskGetContactParams, ZohoDeskResponse } from '@/tools/zoho_desk/types'
import { ZOHO_DESK_CONTACT_PROPERTIES } from '@/tools/zoho_desk/types'
import {
  buildZohoDeskHeaders,
  getZohoDeskApiBase,
  normalizeZohoDeskCommaList,
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
    include: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated related data to embed. Allowed: accounts, owner',
    },
  },

  request: {
    url: (params) => {
      const query = new URLSearchParams()
      const include = normalizeZohoDeskCommaList(params.include)
      if (include) query.set('include', include)
      const qs = query.toString()
      return `${getZohoDeskApiBase(params)}/contacts/${safeUrlPathSegment(params.contactId, 'Contact ID')}${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params) => buildZohoDeskHeaders(params),
  },

  transformResponse: async (response) => {
    const data = await readZohoDeskResponse(response)
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
