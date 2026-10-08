import type {
  RampListReimbursementsParams,
  RampListReimbursementsResponse,
} from '@/tools/ramp/types'
import { RAMP_REIMBURSEMENT_PROPERTIES } from '@/tools/ramp/types'
import {
  appendRampPagination,
  buildRampHeaders,
  getRampPagination,
  parseRampResponse,
  projectReimbursement,
} from '@/tools/ramp/utils'
import type { ToolConfig } from '@/tools/types'

export const rampListReimbursementsTool: ToolConfig<
  RampListReimbursementsParams,
  RampListReimbursementsResponse
> = {
  id: 'ramp_list_reimbursements',
  name: 'Ramp List Reimbursements',
  description: 'List reimbursements in one page in Ramp',
  version: '1.0.0',
  oauth: { required: true, provider: 'ramp' },
  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Ramp OAuth access token',
    },
    user_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by user id',
    },
    reimbursement_state: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by reimbursement state.',
    },
    from_date: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter reimbursements created after this date.',
    },
    to_date: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter reimbursements created before this date.',
    },
    sync_status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by sync status. Supersedes has_no_sync_commits and sync_ready.',
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
      if (params.user_id) query.set('user_id', params.user_id.trim())
      if (params.reimbursement_state) query.set('state', params.reimbursement_state.trim())
      if (params.from_date) query.set('from_date', params.from_date.trim())
      if (params.to_date) query.set('to_date', params.to_date.trim())
      if (params.sync_status) query.set('sync_status', params.sync_status.trim())
      return `https://api.ramp.com/developer/v1/reimbursements?${query}`
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
      output: { reimbursements: data.data.map(projectReimbursement), ...getRampPagination(data) },
    }
  },
  outputs: {
    reimbursements: {
      type: 'array',
      description: 'One page of reimbursements',
      items: { type: 'object', properties: RAMP_REIMBURSEMENT_PROPERTIES },
    },
    nextCursor: {
      type: 'string',
      description: 'Pass this cursor as start to fetch the next page',
      nullable: true,
    },
    nextPageUrl: {
      type: 'string',
      description: 'Ramp URL for the next page, or null on the last page',
      nullable: true,
    },
  },
}
