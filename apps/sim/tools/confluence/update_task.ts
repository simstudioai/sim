import { TIMESTAMP_OUTPUT } from '@/tools/confluence/types'
import type { ToolConfig } from '@/tools/types'

export interface ConfluenceUpdateTaskParams {
  accessToken: string
  domain: string
  taskId: string
  status: string
  cloudId?: string
}

export interface ConfluenceUpdateTaskResponse {
  success: boolean
  output: {
    ts: string
    id: string
    status: string
    updated: boolean
  }
}

export const confluenceUpdateTaskTool: ToolConfig<
  ConfluenceUpdateTaskParams,
  ConfluenceUpdateTaskResponse
> = {
  id: 'confluence_update_task',
  name: 'Confluence Update Task',
  description: 'Update the status of a Confluence task (mark as complete or incomplete).',
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
      description: 'The ID of the task to update',
    },
    status: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'New status for the task (complete or incomplete)',
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
    method: 'PUT',
    headers: (params: ConfluenceUpdateTaskParams) => ({
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.accessToken}`,
    }),
    body: (params: ConfluenceUpdateTaskParams) => ({
      domain: params.domain,
      accessToken: params.accessToken,
      taskId: params.taskId?.trim(),
      status: params.status,
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
        status: data.status ?? '',
        updated: true,
      },
    }
  },

  outputs: {
    ts: TIMESTAMP_OUTPUT,
    id: { type: 'string', description: 'ID of the updated task' },
    status: { type: 'string', description: 'Updated task status' },
    updated: { type: 'boolean', description: 'Update status' },
  },
}
