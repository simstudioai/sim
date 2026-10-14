import type { AshbyListJobsParams, AshbyListJobsResponse } from '@/tools/ashby/types'
import {
  ashbyAuthHeaders,
  ashbyErrorMessage,
  ashbyLimit,
  ashbyTimestamp,
  JOB_OUTPUTS,
  mapJob,
} from '@/tools/ashby/utils'
import type { ToolConfig } from '@/tools/types'

/** Normalize the array schema plus legacy scalar and JSON-string status inputs. */
function normalizeJobStatuses(value: unknown): string[] | undefined {
  if (value === undefined || value === null || value === '') return undefined
  let candidate = value
  if (typeof candidate === 'string') {
    const trimmed = candidate.trim()
    if (!trimmed) return undefined
    try {
      candidate = JSON.parse(trimmed)
    } catch {
      candidate = trimmed
    }
  }
  const rawStatuses = Array.isArray(candidate) ? candidate : [candidate]
  const statuses = rawStatuses.map((status) => {
    if (typeof status !== 'string' || !status.trim()) {
      throw new Error('Invalid status: expected a status string or an array of status strings.')
    }
    return status.trim()
  })
  return statuses.length > 0 ? statuses : undefined
}

export const listJobsTool: ToolConfig<AshbyListJobsParams, AshbyListJobsResponse> = {
  id: 'ashby_list_jobs',
  name: 'Ashby List Jobs',
  description:
    'Lists all jobs in an Ashby organization. By default returns Open, Closed, and Archived jobs. Specify status to filter.',
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
      description:
        'Number of results per page (default and max 100). Ashby silently caps larger values rather than erroring.',
    },
    syncToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Opaque token from a prior sync to fetch only jobs changed since then. Ashby only returns a new syncToken on the last page, so drain moreDataAvailable/nextCursor before persisting it.',
    },
    status: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description:
        'One job status or an array of statuses to include: Open, Closed, Archived, or Draft',
      items: { type: 'string' },
    },
    createdAfter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Only return jobs created after this ISO 8601 timestamp (e.g. 2024-01-01T00:00:00Z)',
    },
    openedAfter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return jobs opened after this ISO 8601 timestamp',
    },
    openedBefore: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return jobs opened before this ISO 8601 timestamp',
    },
    closedAfter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return jobs closed after this ISO 8601 timestamp',
    },
    closedBefore: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return jobs closed before this ISO 8601 timestamp',
    },
    includeUnpublishedJobPostingsIds: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include IDs for unpublished job postings on each job',
    },
  },

  request: {
    url: 'https://api.ashbyhq.com/job.list',
    method: 'POST',
    headers: (params) => ashbyAuthHeaders(params.apiKey),
    body: (params) => {
      const body: Record<string, unknown> = { expand: ['openings', 'location'] }
      if (params.cursor) body.cursor = params.cursor
      const limit = ashbyLimit(params.perPage)
      if (limit) body.limit = limit
      if (params.syncToken) body.syncToken = params.syncToken
      const statuses = normalizeJobStatuses(params.status)
      if (statuses) body.status = statuses
      if (params.createdAfter)
        body.createdAfter = ashbyTimestamp(params.createdAfter, 'createdAfter')
      if (params.openedAfter) body.openedAfter = ashbyTimestamp(params.openedAfter, 'openedAfter')
      if (params.openedBefore)
        body.openedBefore = ashbyTimestamp(params.openedBefore, 'openedBefore')
      if (params.closedAfter) body.closedAfter = ashbyTimestamp(params.closedAfter, 'closedAfter')
      if (params.closedBefore)
        body.closedBefore = ashbyTimestamp(params.closedBefore, 'closedBefore')
      if (params.includeUnpublishedJobPostingsIds !== undefined) {
        body.includeUnpublishedJobPostingsIds = params.includeUnpublishedJobPostingsIds
      }
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      throw new Error(ashbyErrorMessage(data, 'Failed to list jobs'))
    }

    return {
      success: true,
      output: {
        jobs: (data.results ?? []).map(mapJob),
        moreDataAvailable: data.moreDataAvailable ?? false,
        nextCursor: data.nextCursor ?? null,
        nextSyncCursor: data.syncToken ?? null,
      },
    }
  },

  outputs: {
    jobs: {
      type: 'array',
      description: 'List of jobs',
      items: {
        type: 'object',
        properties: JOB_OUTPUTS,
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
      description:
        "Ashby's syncToken for the next incremental run, returned only once the last page is drained. Named as a cursor because that is what it is - an opaque resumption marker, not a credential - so it stays readable in block output alongside nextCursor.",
      optional: true,
    },
  },
}
