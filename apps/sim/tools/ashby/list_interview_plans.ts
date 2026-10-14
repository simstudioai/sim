import { ashbyAuthHeaders, ashbyErrorMessage, ashbyLimit } from '@/tools/ashby/utils'
import type { ToolConfig, ToolResponse } from '@/tools/types'

interface Params {
  apiKey: string
  includeArchived?: boolean
  cursor?: string
  perPage?: number
  syncToken?: string
}
interface Response extends ToolResponse {
  output: {
    interviewPlans: Array<{
      id: string
      title: string
      isArchived: boolean
      createdAt: string
      updatedAt: string
    }>
    moreDataAvailable: boolean
    nextCursor: string | null
    nextSyncCursor: string | null
  }
}

export const listInterviewPlansTool: ToolConfig<Params, Response> = {
  id: 'ashby_list_interview_plans',
  name: 'Ashby List Interview Plans',
  description:
    'Lists Ashby interview plans, including optional archived plans and incremental changes.',
  version: '1.0.0',
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Ashby API Key',
    },
    includeArchived: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include archived interview plans',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor',
    },
    perPage: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Results per page (1-100)',
    },
    syncToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Opaque token from a completed prior sync run',
    },
  },
  request: {
    url: 'https://api.ashbyhq.com/interviewPlan.list',
    method: 'POST',
    headers: (p) => ashbyAuthHeaders(p.apiKey),
    body: (p) => ({
      ...(p.includeArchived !== undefined ? { includeArchived: p.includeArchived } : {}),
      ...(p.cursor ? { cursor: p.cursor } : {}),
      ...(ashbyLimit(p.perPage) ? { limit: ashbyLimit(p.perPage) } : {}),
      ...(p.syncToken ? { syncToken: p.syncToken } : {}),
    }),
  },
  transformResponse: async (response) => {
    const data = await response.json()
    if (!data.success) throw new Error(ashbyErrorMessage(data, 'Failed to list interview plans'))
    return {
      success: true,
      output: {
        interviewPlans: data.results ?? [],
        moreDataAvailable: data.moreDataAvailable ?? false,
        nextCursor: data.nextCursor ?? null,
        nextSyncCursor: data.syncToken ?? null,
      },
    }
  },
  outputs: {
    interviewPlans: {
      type: 'array',
      description: 'Interview plans',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Interview plan UUID' },
          title: { type: 'string', description: 'Plan title' },
          isArchived: { type: 'boolean', description: 'Whether archived' },
          createdAt: { type: 'string', description: 'Creation timestamp' },
          updatedAt: { type: 'string', description: 'Last update timestamp' },
        },
      },
    },
    moreDataAvailable: { type: 'boolean', description: 'Whether more pages exist' },
    nextCursor: { type: 'string', description: 'Next page cursor', optional: true },
    nextSyncCursor: { type: 'string', description: 'Next incremental sync token', optional: true },
  },
}
