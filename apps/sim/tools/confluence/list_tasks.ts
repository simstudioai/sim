import { TIMESTAMP_OUTPUT } from '@/tools/confluence/types'
import type { ToolConfig } from '@/tools/types'

export interface ConfluenceListTasksParams {
  accessToken: string
  domain: string
  pageId?: string
  spaceId?: string
  assignedTo?: string
  status?: string
  limit?: number
  cursor?: string
  cloudId?: string
}

export interface ConfluenceListTasksResponse {
  success: boolean
  output: {
    ts: string
    tasks: Array<{
      id: string
      localId: string | null
      spaceId: string | null
      pageId: string | null
      blogPostId: string | null
      status: string
      body: string | null
      createdBy: string | null
      assignedTo: string | null
      completedBy: string | null
      createdAt: string | null
      updatedAt: string | null
      dueAt: string | null
      completedAt: string | null
    }>
    nextCursor: string | null
  }
}

export const confluenceListTasksTool: ToolConfig<
  ConfluenceListTasksParams,
  ConfluenceListTasksResponse
> = {
  id: 'confluence_list_tasks',
  name: 'Confluence List Tasks',
  description:
    'List inline tasks from Confluence. Optionally filter by page, space, assignee, or status.',
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
    pageId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter tasks by page ID',
    },
    spaceId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter tasks by space ID',
    },
    assignedTo: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter tasks by assignee account ID',
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
    url: () => '/api/tools/confluence/tasks',
    method: 'POST',
    headers: (params: ConfluenceListTasksParams) => ({
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.accessToken}`,
    }),
    body: (params: ConfluenceListTasksParams) => ({
      domain: params.domain,
      accessToken: params.accessToken,
      cloudId: params.cloudId,
      pageId: params.pageId,
      spaceId: params.spaceId,
      assignedTo: params.assignedTo,
      status: params.status,
      limit: params.limit,
      cursor: params.cursor,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        ts: new Date().toISOString(),
        tasks: data.tasks || [],
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
        properties: {
          id: { type: 'string', description: 'Task ID' },
          localId: { type: 'string', description: 'Local task ID', optional: true },
          spaceId: { type: 'string', description: 'Space ID', optional: true },
          pageId: { type: 'string', description: 'Page ID', optional: true },
          blogPostId: { type: 'string', description: 'Blog post ID', optional: true },
          status: { type: 'string', description: 'Task status (complete or incomplete)' },
          body: {
            type: 'string',
            description: 'Task body content in storage format',
            optional: true,
          },
          createdBy: { type: 'string', description: 'Creator account ID', optional: true },
          assignedTo: { type: 'string', description: 'Assignee account ID', optional: true },
          completedBy: { type: 'string', description: 'Completer account ID', optional: true },
          createdAt: { type: 'string', description: 'Creation timestamp', optional: true },
          updatedAt: { type: 'string', description: 'Last update timestamp', optional: true },
          dueAt: { type: 'string', description: 'Due date', optional: true },
          completedAt: { type: 'string', description: 'Completion timestamp', optional: true },
        },
      },
    },
    nextCursor: {
      type: 'string',
      description: 'Cursor for fetching the next page of results',
      optional: true,
    },
  },
}
