import type {
  MintlifyFeedbackEntry,
  MintlifyGetFeedbackParams,
  MintlifyGetFeedbackResponse,
} from '@/tools/mintlify/types'
import {
  appendParam,
  MINTLIFY_API_BASE,
  mintlifyHeaders,
  pathSegment,
  readMintlifyJson,
  toNullableString,
} from '@/tools/mintlify/utils'
import type { ToolConfig } from '@/tools/types'

function toFeedbackEntries(value: unknown): MintlifyFeedbackEntry[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => {
    const entry = (item ?? {}) as Record<string, unknown>
    return {
      id: toNullableString(entry.id),
      path: toNullableString(entry.path),
      comment: toNullableString(entry.comment),
      createdAt: toNullableString(entry.createdAt),
      source: toNullableString(entry.source),
      status: toNullableString(entry.status),
      helpful: typeof entry.helpful === 'boolean' ? entry.helpful : null,
      contact: toNullableString(entry.contact),
      code: toNullableString(entry.code),
      filename: toNullableString(entry.filename),
      lang: toNullableString(entry.lang),
    }
  })
}

export const mintlifyGetFeedbackTool: ToolConfig<
  MintlifyGetFeedbackParams,
  MintlifyGetFeedbackResponse
> = {
  id: 'mintlify_get_feedback',
  name: 'Mintlify Get Feedback',
  description:
    'Export paginated user feedback from a Mintlify documentation project, with optional date-range, source, and status filters.',
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
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Max results per page, between 1 and 100 (default 50)',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor returned as nextCursor by a previous call',
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
        `${MINTLIFY_API_BASE}/v1/analytics/${pathSegment(params.projectId)}/feedback`
      )
      appendParam(url, 'dateFrom', params.dateFrom)
      appendParam(url, 'dateTo', params.dateTo)
      appendParam(url, 'source', params.source)
      appendParam(url, 'status', params.status)
      appendParam(url, 'limit', params.limit)
      appendParam(url, 'cursor', params.cursor)
      return url.toString()
    },
    method: 'GET',
    headers: (params) => mintlifyHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await readMintlifyJson(response, 'Failed to get Mintlify feedback')

    return {
      success: true,
      output: {
        feedback: toFeedbackEntries(data.feedback),
        nextCursor: toNullableString(data.nextCursor),
        hasMore: data.hasMore === true,
      },
    }
  },

  outputs: {
    feedback: {
      type: 'array',
      description: 'Feedback entries for the requested window',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Unique feedback identifier', nullable: true },
          path: { type: 'string', description: 'Path or URL of the page', nullable: true },
          comment: { type: 'string', description: 'Text of the feedback comment', nullable: true },
          createdAt: { type: 'string', description: 'Submission timestamp', nullable: true },
          source: {
            type: 'string',
            description: 'Origin: code_snippet, contextual, agent, or thumbs_only',
            nullable: true,
          },
          status: {
            type: 'string',
            description: 'Review status: pending, in_progress, resolved, or dismissed',
            nullable: true,
          },
          helpful: {
            type: 'boolean',
            description: 'Whether the user found the content helpful (contextual feedback only)',
            nullable: true,
          },
          contact: {
            type: 'string',
            description: 'Email the user provided for follow-up (contextual feedback only)',
            nullable: true,
          },
          code: {
            type: 'string',
            description: 'Code snippet the feedback relates to (code_snippet feedback only)',
            nullable: true,
          },
          filename: {
            type: 'string',
            description: 'Filename of the code snippet (code_snippet feedback only)',
            nullable: true,
          },
          lang: {
            type: 'string',
            description: 'Language of the code snippet (code_snippet feedback only)',
            nullable: true,
          },
        },
      },
    },
    nextCursor: {
      type: 'string',
      description: 'Cursor for the next page, or null when there are no more results',
      nullable: true,
    },
    hasMore: { type: 'boolean', description: 'Whether additional results are available' },
  },
}
