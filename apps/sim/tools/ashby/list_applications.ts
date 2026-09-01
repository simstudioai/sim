import type {
  AshbyListApplicationsParams,
  AshbyListApplicationsResponse,
} from '@/tools/ashby/types'
import {
  APPLICATION_OUTPUTS,
  ashbyAuthHeaders,
  ashbyErrorMessage,
  ashbyLimit,
  ashbyTimestamp,
  mapApplication,
} from '@/tools/ashby/utils'
import type { ToolConfig } from '@/tools/types'

export const listApplicationsTool: ToolConfig<
  AshbyListApplicationsParams,
  AshbyListApplicationsResponse
> = {
  id: 'ashby_list_applications',
  name: 'Ashby List Applications',
  description:
    'Lists all applications in an Ashby organization with pagination and optional filters for status, job, and creation date.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Ashby API Key',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Opaque pagination cursor from a previous response nextCursor value',
    },
    perPage: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results per page (default 100)',
    },
    status: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'One application status or an array of statuses to include: Active, Hired, Archived, or Lead',
    },
    jobId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter applications by a specific job UUID',
    },
    createdAfter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Filter to applications created after this ISO 8601 timestamp (e.g. 2024-01-01T00:00:00Z)',
    },
    createdBefore: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter to applications created before this ISO 8601 timestamp',
    },
    syncToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Opaque token from a completed prior sync run',
    },
    expand: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Ashby-supported application expansions to request',
    },
  },

  request: {
    url: 'https://api.ashbyhq.com/application.list',
    method: 'POST',
    headers: (params) => ashbyAuthHeaders(params.apiKey),
    body: (params) => {
      const body: Record<string, unknown> = {}
      if (params.cursor) body.cursor = params.cursor
      const limit = ashbyLimit(params.perPage)
      if (limit) body.limit = limit
      if (Array.isArray(params.status) && params.status.length > 0) body.status = params.status
      else if (typeof params.status === 'string' && params.status.trim())
        body.status = [params.status.trim()]
      if (params.jobId) body.jobId = params.jobId.trim()
      if (params.syncToken) body.syncToken = params.syncToken
      if (params.createdAfter)
        body.createdAfter = ashbyTimestamp(params.createdAfter, 'createdAfter')
      if (params.createdBefore)
        body.createdBefore = ashbyTimestamp(params.createdBefore, 'createdBefore')
      if (Array.isArray(params.expand) && params.expand.length > 0) body.expand = params.expand
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      throw new Error(ashbyErrorMessage(data, 'Failed to list applications'))
    }

    return {
      success: true,
      output: {
        applications: (data.results ?? []).map(mapApplication),
        moreDataAvailable: data.moreDataAvailable ?? false,
        nextCursor: data.nextCursor ?? null,
        nextSyncCursor: data.syncToken ?? null,
      },
    }
  },

  outputs: {
    applications: {
      type: 'array',
      description: 'List of applications',
      items: {
        type: 'object',
        properties: APPLICATION_OUTPUTS,
      },
    },
    moreDataAvailable: {
      type: 'boolean',
      description: 'Whether more pages of results exist',
    },
    nextCursor: {
      type: 'string',
      description: 'Opaque cursor for fetching the next page',
      optional: true,
    },
    nextSyncCursor: {
      type: 'string',
      description: 'Opaque token for the next incremental sync, returned on the final page',
      optional: true,
    },
  },
}
