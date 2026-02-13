import { TASK_ITEM_PROPERTIES, TIMESTAMP_OUTPUT } from '@/tools/confluence/types'
import type { ToolConfig } from '@/tools/types'

export interface ConfluenceListTasksParams {
  accessToken: string
  domain: string
  spaceId?: string
  pageId?: string
  status?: string
  limit?: number
  cursor?: string
  cloudId?: string
}

export interface ConfluenceListTasksResponse {
  success: boolean
  output: {
    ts: string
    tasks: Array<Record<string, unknown>>
    nextCursor: string | null
  }
}

export const confluenceListTasksTool: ToolConfig<
  ConfluenceListTasksParams,
  ConfluenceListTasksResponse
> = {
  id: 'confluence_list_tasks',
  name: 'Confluence List Tasks',
  description: 'List tasks from Confluence, optionally filtered by space, page, or status.',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'confluence',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token for Confluence',
    },
    domain: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your Confluence domain (e.g., yourcompany.atlassian.net)',
    },
    spaceId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter tasks by space ID',
    },
    pageId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter tasks by page ID',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter tasks by status (complete or incomplete)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of tasks to return (default: 50, max: 250)',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor from previous response',
    },
    cloudId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'Confluence Cloud ID for the instance. If not provided, it will be fetched using the domain.',
    },
  },

  request: {
    url: (params: ConfluenceListTasksParams) => {
      const query = new URLSearchParams({
        domain: params.domain,
        accessToken: params.accessToken,
        limit: String(params.limit || 50),
      })
      if (params.spaceId) query.set('spaceId', params.spaceId)
      if (params.pageId) query.set('pageId', params.pageId)
      if (params.status) query.set('status', params.status)
      if (params.cursor) query.set('cursor', params.cursor)
      if (params.cloudId) query.set('cloudId', params.cloudId)
      return `/api/tools/confluence/tasks?${query.toString()}`
    },
    method: 'GET',
    headers: (params: ConfluenceListTasksParams) => ({
      Accept: 'application/json',
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        ts: new Date().toISOString(),
        tasks: data.tasks ?? [],
        nextCursor: data.nextCursor ?? null,
      },
    }
  },

  outputs: {
    ts: TIMESTAMP_OUTPUT,
    tasks: {
      type: 'array',
      description: 'Array of Confluence tasks',
      items: {
        type: 'object',
        properties: TASK_ITEM_PROPERTIES,
      },
    },
    nextCursor: {
      type: 'string',
      description: 'Cursor for fetching the next page of results',
      optional: true,
    },
  },
}
