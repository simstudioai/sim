import type { GetWorkItemParams, GetWorkItemResponse } from '@/tools/azure_devops/types'
import type { AzureDevOpsRawWorkItem } from '@/tools/azure_devops/utils'
import { formatWorkItem, mapWorkItem } from '@/tools/azure_devops/utils'
import type { ToolConfig } from '@/tools/types'

export const getWorkItemTool: ToolConfig<GetWorkItemParams, GetWorkItemResponse> = {
  id: 'azure_devops_get_work_item',
  name: 'Azure DevOps Get Work Item',
  description:
    'Fetch full details of a single work item by ID from Azure DevOps, including title, state, type, assignee, and area path.',
  version: '1.0.0',

  params: {
    organization: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Azure DevOps organization name',
    },
    project: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Azure DevOps project name',
    },
    workItemId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'The work item ID to fetch',
    },
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Azure DevOps Personal Access Token (scopes: Work Items: Read)',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(
        `https://dev.azure.com/${params.organization.trim()}/${params.project.trim()}/_apis/wit/workitems/${Number(params.workItemId)}`
      )
      url.searchParams.set('$expand', 'all')
      url.searchParams.set('api-version', '7.2-preview.3')
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Basic ${btoa(`:${params.accessToken}`)}`,
    }),
  },

  transformResponse: async (response) => {
    const raw: AzureDevOpsRawWorkItem = await response.json()
    const workItem = mapWorkItem(raw)

    return {
      success: true,
      output: {
        content: formatWorkItem(workItem),
        metadata: { workItem },
      },
    }
  },

  outputs: {
    content: {
      type: 'string',
      description: 'Human-readable summary of the work item',
    },
    metadata: {
      type: 'object',
      description: 'Work item metadata',
      properties: {
        workItem: {
          type: 'object',
          description: 'Full work item details',
          properties: {
            id: { type: 'number', description: 'Work item ID' },
            title: { type: 'string', description: 'Work item title' },
            state: {
              type: 'string',
              description: 'Current state for Basic process (e.g. To Do, Doing, Done)',
            },
            workItemType: {
              type: 'string',
              description: 'Work item type returned by Azure DevOps (e.g. Issue, Task, Epic)',
            },
            assignedTo: {
              type: 'string',
              description: 'Display name of assigned user, or null if unassigned',
            },
            areaPath: { type: 'string', description: 'Area path of the work item' },
            url: { type: 'string', description: 'API URL for the work item' },
          },
        },
      },
    },
  },
}
