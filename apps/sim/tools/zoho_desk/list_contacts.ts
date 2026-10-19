import type { ToolConfig } from '@/tools/types'
import {
  projectZohoDeskResource,
  readZohoDeskList,
  ZOHO_DESK_AUTH_PARAMS,
} from '@/tools/zoho_desk/request'
import type {
  ZohoDeskListContactsParams,
  ZohoDeskListContactsResponse,
} from '@/tools/zoho_desk/types'
import { ZOHO_DESK_CONTACT_PROPERTIES } from '@/tools/zoho_desk/types'
import {
  buildZohoDeskHeaders,
  getZohoDeskApiBase,
  normalizeZohoDeskCommaList,
} from '@/tools/zoho_desk/utils'

export const zohoDeskListContactsTool: ToolConfig<
  ZohoDeskListContactsParams,
  ZohoDeskListContactsResponse
> = {
  id: 'zoho_desk_list_contacts',
  name: 'Zoho Desk List Contacts',
  description: 'List Contacts in Zoho Desk.',
  version: '1.0.0',
  oauth: { required: true, provider: 'zoho-desk' },
  params: {
    ...ZOHO_DESK_AUTH_PARAMS,
    contactSelectedFields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Key that returns the values of mentioned fields (both pre-defined and custom) in your portal. All field types except multi-text are supported. Standard, non-editable fields are supported too. These fields include: photoURL, webUrl. Maximum of 30 fields is supported as comma separated values. Comma-separated values.',
    },
    contactViewId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ID of the view to apply while fetching the resources',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page size (1-100).',
    },
    from: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination start index; use the provider index for this endpoint (default 1).',
    },
    contactListInclude: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Secondary information related to the contact.Value supported is accounts. Comma-separated values.',
    },
    contactListSortBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Sort field: firstName, lastName, phone, email, account, createdTime, modifiedTime. Prefix with - for descending.',
    },
  },
  request: {
    url: (params) => {
      const query = new URLSearchParams({ from: String(params.from ?? 1) })
      if (params.contactSelectedFields != null && params.contactSelectedFields !== '') {
        const value = normalizeZohoDeskCommaList(params.contactSelectedFields)
        if (value !== undefined) query.set('fields', String(value))
      }
      const viewId = String(params.contactViewId ?? '').trim()
      if (viewId) query.set('viewId', viewId)
      if (params.limit != null) {
        const value = Number(params.limit)
        if (!Number.isInteger(value) || value < 1 || value > 100)
          throw new Error('limit is outside the documented range')
        query.set('limit', String(value))
      }
      if (params.from != null) {
        const value = Number(params.from)
        if (!Number.isInteger(value) || value < 0)
          throw new Error('from is outside the documented range')
        query.set('from', String(value))
      }
      if (params.contactListInclude != null && params.contactListInclude !== '') {
        const value = normalizeZohoDeskCommaList(params.contactListInclude)
        if (value !== undefined) query.set('include', String(value))
      }
      if (params.contactListSortBy != null && params.contactListSortBy !== '') {
        query.set('sortBy', String(params.contactListSortBy))
      }
      return `${getZohoDeskApiBase(params)}/contacts${query.size ? `?${query}` : ''}`
    },
    method: 'GET',
    headers: buildZohoDeskHeaders,
  },
  transformResponse: async (response, params) => {
    const { items } = await readZohoDeskList(response)
    return {
      success: true,
      output: {
        contacts: items.map((item) =>
          projectZohoDeskResource(item, ZOHO_DESK_CONTACT_PROPERTIES, params?.contactSelectedFields)
        ),
        count: items.length,
        nextFrom: items.length ? Number(params?.from ?? 1) + items.length : null,
      },
    }
  },
  outputs: {
    contacts: {
      type: 'array',
      description: 'Contacts records, including explicitly requested portal fields',
      items: { type: 'object', properties: ZOHO_DESK_CONTACT_PROPERTIES },
    },
    count: { type: 'number', description: 'Number of results in this page' },
    nextFrom: {
      type: 'number',
      nullable: true,
      description:
        'Next index to request; null when this page is empty. The next request may return an empty page.',
    },
  },
}
