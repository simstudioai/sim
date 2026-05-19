import type {
  AzureDevOpsWorkItem,
  GetWorkItemsBatchParams,
  GetWorkItemsBatchResponse,
} from '@/tools/azure_devops/types'
import type { AzureDevOpsRawWorkItem } from '@/tools/azure_devops/utils'
import { formatWorkItem, mapWorkItem } from '@/tools/azure_devops/utils'
import type { ToolConfig } from '@/tools/types'

export const getWorkItemsBatchTool: ToolConfig<GetWorkItemsBatchParams, GetWorkItemsBatchResponse> =
  {
    id: 'azure_devops_get_work_items_batch',
    name: 'Azure DevOps Get Work Items Batch',
    description:
      'Fetch full details for multiple work items by ID from Azure DevOps in a single call. Pass comma-separated IDs (e.g. "123,456,789"). Maximum 200 IDs per request.',
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
      ids: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description:
          'Comma-separated work item IDs to fetch (e.g. "123,456,789"). Maximum 200 IDs.',
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
          `https://dev.azure.com/${params.organization.trim()}/${params.project.trim()}/_apis/wit/workitems`
        )
        url.searchParams.set('ids', params.ids)
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
      const data = await response.json()
      const workItems: AzureDevOpsWorkItem[] = (data.value ?? []).map(
        (raw: AzureDevOpsRawWorkItem) => mapWorkItem(raw)
      )

      const content =
        workItems.length === 0
          ? 'No work items found for the provided IDs.'
          : `Found ${workItems.length} work item(s):\n\n${workItems.map(formatWorkItem).join('\n\n')}`

      return {
        success: true,
        output: {
          content,
          metadata: { count: workItems.length, workItems },
        },
      }
    },

    outputs: {
      content: {
        type: 'string',
        description: 'Human-readable summary of the fetched work items',
      },
      metadata: {
        type: 'object',
        description: 'Work items metadata',
        properties: {
          count: { type: 'number', description: 'Number of work items returned' },
          workItems: {
            type: 'array',
            description: 'Array of work item details',
            items: {
              type: 'object',
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
    },
  }
