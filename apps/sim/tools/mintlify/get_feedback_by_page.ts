import type {
  MintlifyFeedbackPageEntry,
  MintlifyGetFeedbackByPageParams,
  MintlifyGetFeedbackByPageResponse,
} from '@/tools/mintlify/types'
import {
  appendParam,
  MINTLIFY_API_BASE,
  mintlifyHeaders,
  pathSegment,
  readMintlifyJson,
  toNullableNumber,
  toNullableString,
} from '@/tools/mintlify/utils'
import type { ToolConfig } from '@/tools/types'

function toPageEntries(value: unknown): MintlifyFeedbackPageEntry[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => {
    const entry = (item ?? {}) as Record<string, unknown>
    return {
      path: toNullableString(entry.path),
      thumbsUp: toNullableNumber(entry.thumbsUp),
      thumbsDown: toNullableNumber(entry.thumbsDown),
      code: toNullableNumber(entry.code),
      total: toNullableNumber(entry.total),
    }
  })
}

export const mintlifyGetFeedbackByPageTool: ToolConfig<
  MintlifyGetFeedbackByPageParams,
  MintlifyGetFeedbackByPageResponse
> = {
  id: 'mintlify_get_feedback_by_page',
  name: 'Mintlify Get Feedback By Page',
  description:
    'Export Mintlify feedback counts aggregated by documentation page path, broken down into thumbs up, thumbs down, and code snippet feedback.',
  version: '1.0.0',

  params: {
    projectId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Mintlify project ID, copied from the API keys page in your dashboard',
    },
    dateFrom: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Inclusive start date in ISO 8601 or YYYY-MM-DD format',
    },
    dateTo: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Exclusive end date in ISO 8601 or YYYY-MM-DD format',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Max results per page, between 1 and 100 (default 10)',
    },
    source: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by feedback source: code_snippet, contextual, agent, or thumbs_only',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated statuses to filter by: pending, in_progress, resolved, dismissed',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Mintlify admin API key (starts with mint_)',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(
        `${MINTLIFY_API_BASE}/v1/analytics/${pathSegment(params.projectId)}/feedback/by-page`
      )
      appendParam(url, 'dateFrom', params.dateFrom)
      appendParam(url, 'dateTo', params.dateTo)
      appendParam(url, 'limit', params.limit)
      appendParam(url, 'source', params.source)
      appendParam(url, 'status', params.status)
      return url.toString()
    },
    method: 'GET',
    headers: (params) => mintlifyHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await readMintlifyJson(response, 'Failed to get Mintlify feedback by page')

    return {
      success: true,
      output: {
        feedback: toPageEntries(data.feedback),
        hasMore: data.hasMore === true,
      },
    }
  },

  outputs: {
    feedback: {
      type: 'array',
      description: 'Feedback counts aggregated by documentation page path',
      items: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'The documentation page path', nullable: true },
          thumbsUp: {
            type: 'number',
            description: 'Positive contextual feedback entries',
            nullable: true,
          },
          thumbsDown: {
            type: 'number',
            description: 'Negative contextual feedback entries',
            nullable: true,
          },
          code: { type: 'number', description: 'Code snippet feedback entries', nullable: true },
          total: { type: 'number', description: 'Total feedback entries', nullable: true },
        },
      },
    },
    hasMore: { type: 'boolean', description: 'Whether additional results are available' },
  },
}
