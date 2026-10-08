import type { RampListBillsParams, RampListBillsResponse } from '@/tools/ramp/types'
import { RAMP_BILL_PROPERTIES } from '@/tools/ramp/types'
import {
  appendRampPagination,
  buildRampHeaders,
  getRampPagination,
  parseRampResponse,
  projectBill,
} from '@/tools/ramp/utils'
import type { ToolConfig } from '@/tools/types'

export const rampListBillsTool: ToolConfig<RampListBillsParams, RampListBillsResponse> = {
  id: 'ramp_list_bills',
  name: 'Ramp List Bills',
  description: 'List bills in one page in Ramp',
  version: '1.0.0',
  oauth: { required: true, provider: 'ramp' },
  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Ramp OAuth access token',
    },
    vendor_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter bills by vendor.',
    },
    payment_status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'List bills of the provided payment status.',
    },
    approval_status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'List bills of the provided bill approval status. Note that this is separate from the approval status for payment release.',
    },
    from_due_date: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Shows only bills with a due_at on or after this date. This parameter should be provided as a datetime string that conforms to ISO 8601',
    },
    to_due_date: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Shows only bills with a due_at on or before this date. This parameter should be provided as a datetime string that conforms to ISO 8601',
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
      if (params.vendor_id) query.set('vendor_id', params.vendor_id.trim())
      if (params.payment_status) query.set('payment_status', params.payment_status.trim())
      if (params.approval_status) query.set('approval_status', params.approval_status.trim())
      if (params.from_due_date) query.set('from_due_date', params.from_due_date.trim())
      if (params.to_due_date) query.set('to_due_date', params.to_due_date.trim())
      return `https://api.ramp.com/developer/v1/bills?${query}`
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
      output: { bills: data.data.map(projectBill), ...getRampPagination(data) },
    }
  },
  outputs: {
    bills: {
      type: 'array',
      description: 'One page of bills',
      items: { type: 'object', properties: RAMP_BILL_PROPERTIES },
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
