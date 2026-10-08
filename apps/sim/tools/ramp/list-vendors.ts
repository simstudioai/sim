import type { RampListVendorsParams, RampListVendorsResponse } from '@/tools/ramp/types'
import { RAMP_VENDOR_PROPERTIES } from '@/tools/ramp/types'
import {
  appendRampPagination,
  buildRampHeaders,
  getRampPagination,
  parseRampResponse,
  projectVendor,
} from '@/tools/ramp/utils'
import type { ToolConfig } from '@/tools/types'

export const rampListVendorsTool: ToolConfig<RampListVendorsParams, RampListVendorsResponse> = {
  id: 'ramp_list_vendors',
  name: 'Ramp List Vendors',
  description: 'List vendors in one page in Ramp',
  version: '1.0.0',
  oauth: { required: true, provider: 'ramp' },
  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Ramp OAuth access token',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by name',
    },
    external_vendor_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Filter by customer-defined external vendor ID. This is independent of accounting system remote IDs.',
    },
    vendor_owner_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Unique identifier of the user which owns this vendor.',
    },
    start: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Next cursor from the previous response',
    },
    page_size: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Results per page, from 2 to 100 (default 20)',
    },
  },
  request: {
    url: (params) => {
      const query = new URLSearchParams()
      appendRampPagination(query, params)
      if (params.name) query.set('name', params.name.trim())
      if (params.external_vendor_id)
        query.set('external_vendor_id', params.external_vendor_id.trim())
      if (params.vendor_owner_id) query.set('vendor_owner_id', params.vendor_owner_id.trim())
      return `https://api.ramp.com/developer/v1/vendors?${query}`
    },
    method: 'GET',
    headers: (params) => buildRampHeaders(params.accessToken),
  },
  transformResponse: async (response) => {
    const data = await parseRampResponse(response)
    if (!Array.isArray(data.data)) throw new Error('Ramp returned an invalid list response')
    if (data.data.length > 100) throw new Error('Ramp returned more than 100 results in one page')
    return {
      success: true,
      output: { vendors: data.data.map(projectVendor), ...getRampPagination(data) },
    }
  },
  outputs: {
    vendors: {
      type: 'array',
      description: 'One page of vendors',
      items: { type: 'object', properties: RAMP_VENDOR_PROPERTIES },
    },
    nextCursor: {
      type: 'string',
      description: 'Pass this cursor as start to fetch the next page',
      optional: true,
    },
    nextPageUrl: {
      type: 'string',
      description: 'Ramp URL for the next page, or null on the last page',
      optional: true,
    },
  },
}
