import { TASK_ITEM_PROPERTIES, TIMESTAMP_OUTPUT } from '@/tools/confluence/types'
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
    localId: string
    spaceId: string | null
    pageId: string | null
    blogPostId: string | null
    status: string
    body: Record<string, unknown> | null
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
    description: 'Get a specific task by its ID from Confluence.',
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
        action: 'get',
        domain: params.domain,
        accessToken: params.accessToken,
        taskId: params.taskId?.trim(),
        cloudId: params.cloudId,
      }),
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()
      return {
        success: true,
        output: {
          ts: new Date().toISOString(),
          id: data.id ?? '',
          localId: data.localId ?? '',
          spaceId: data.spaceId ?? null,
          pageId: data.pageId ?? null,
          blogPostId: data.blogPostId ?? null,
          status: data.status ?? '',
          body: data.body ?? null,
          createdBy: data.createdBy ?? null,
          assignedTo: data.assignedTo ?? null,
          completedBy: data.completedBy ?? null,
          createdAt: data.createdAt ?? null,
          updatedAt: data.updatedAt ?? null,
          dueAt: data.dueAt ?? null,
          completedAt: data.completedAt ?? null,
        },
      }
    },

    outputs: {
      ts: TIMESTAMP_OUTPUT,
      ...TASK_ITEM_PROPERTIES,
    },
  }
