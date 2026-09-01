import type { AshbyJob } from '@/tools/ashby/types'
import {
  ashbyAuthHeaders,
  ashbyErrorMessage,
  ashbyLimit,
  JOB_OUTPUTS,
  mapJob,
} from '@/tools/ashby/utils'
import type { ToolConfig, ToolResponse } from '@/tools/types'

interface Params {
  apiKey: string
  title?: string
  requisitionId?: string
  limit?: number
}
interface Response extends ToolResponse {
  output: { jobs: AshbyJob[]; moreDataAvailable: boolean }
}
export const searchJobsTool: ToolConfig<Params, Response> = {
  id: 'ashby_search_jobs',
  name: 'Ashby Search Jobs',
  description: 'Searches Ashby jobs by title and/or requisition ID.',
  version: '1.0.0',
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Ashby API Key',
    },
    title: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Job title search text',
    },
    requisitionId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Custom requisition ID',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum matches (1-100)',
    },
  },
  request: {
    url: 'https://api.ashbyhq.com/job.search',
    method: 'POST',
    headers: (p) => ashbyAuthHeaders(p.apiKey),
    body: (p) => {
      if (!p.title?.trim() && !p.requisitionId?.trim())
        throw new Error('Provide a job title or requisition ID.')
      return {
        ...(p.title?.trim() ? { title: p.title.trim() } : {}),
        ...(p.requisitionId?.trim() ? { requisitionId: p.requisitionId.trim() } : {}),
        ...(ashbyLimit(p.limit, 'limit') ? { limit: ashbyLimit(p.limit, 'limit') } : {}),
      }
    },
  },
  transformResponse: async (response) => {
    const data = await response.json()
    if (!data.success) throw new Error(ashbyErrorMessage(data, 'Failed to search jobs'))
    return {
      success: true,
      output: {
        jobs: (data.results ?? []).map(mapJob),
        moreDataAvailable: data.moreDataAvailable ?? false,
      },
    }
  },
  outputs: {
    jobs: {
      type: 'array',
      description: 'Matching jobs',
      items: { type: 'object', properties: JOB_OUTPUTS },
    },
    moreDataAvailable: { type: 'boolean', description: 'Whether more matches exist' },
  },
}
