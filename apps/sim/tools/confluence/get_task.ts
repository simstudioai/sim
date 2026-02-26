import { TIMESTAMP_OUTPUT } from '@/tools/confluence/types'
import type { ToolConfig } from '@/tools/types'

export interface ConfluenceGetTaskParams {
  accessToken: string
  domain: string
  taskId: string
  cloudId?: string
}

export interface ConfluenceGetTaskResponse {
  success: boolean
  output: {
    ts: string
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
  }
}

export const confluenceGetTaskTool: ToolConfig<ConfluenceGetTaskParams, ConfluenceGetTaskResponse> =
  {
    id: 'confluence_get_task',
    name: 'Confluence Get Task',
    description: 'Get a specific Confluence inline task by ID.',
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
      taskId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'The ID of the task to retrieve',
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
      headers: (params: ConfluenceGetTaskParams) => ({
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.accessToken}`,
      }),
      body: (params: ConfluenceGetTaskParams) => ({
        domain: params.domain,
        accessToken: params.accessToken,
        cloudId: params.cloudId,
        taskId: params.taskId,
      }),
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()
      const task = data.task || data
      return {
        success: true,
        output: {
          ts: new Date().toISOString(),
          id: task.id ?? '',
          localId: task.localId ?? null,
          spaceId: task.spaceId ?? null,
          pageId: task.pageId ?? null,
          blogPostId: task.blogPostId ?? null,
          status: task.status ?? '',
          body: task.body ?? null,
          createdBy: task.createdBy ?? null,
          assignedTo: task.assignedTo ?? null,
          completedBy: task.completedBy ?? null,
          createdAt: task.createdAt ?? null,
          updatedAt: task.updatedAt ?? null,
          dueAt: task.dueAt ?? null,
          completedAt: task.completedAt ?? null,
        },
      }
    },

    outputs: {
      ts: TIMESTAMP_OUTPUT,
      id: { type: 'string', description: 'Task ID' },
      localId: { type: 'string', description: 'Local task ID', optional: true },
      spaceId: { type: 'string', description: 'Space ID', optional: true },
      pageId: { type: 'string', description: 'Page ID', optional: true },
      blogPostId: { type: 'string', description: 'Blog post ID', optional: true },
      status: { type: 'string', description: 'Task status (complete or incomplete)' },
      body: { type: 'string', description: 'Task body content in storage format', optional: true },
      createdBy: { type: 'string', description: 'Creator account ID', optional: true },
      assignedTo: { type: 'string', description: 'Assignee account ID', optional: true },
      completedBy: { type: 'string', description: 'Completer account ID', optional: true },
      createdAt: { type: 'string', description: 'Creation timestamp', optional: true },
      updatedAt: { type: 'string', description: 'Last update timestamp', optional: true },
      dueAt: { type: 'string', description: 'Due date', optional: true },
      completedAt: { type: 'string', description: 'Completion timestamp', optional: true },
    },
  }
