import type {
  AzureDevOpsWorkItem,
  GetWorkItemsBatchParams,
  GetWorkItemsBatchResponse,
} from '@/tools/azure_devops/types'
import type { AzureDevOpsRawWorkItem } from '@/tools/azure_devops/utils'
import {
  azureDevOpsProjectUrl,
  fetchWorkItemsChunk,
  formatWorkItem,
  mapWorkItem,
  WORK_ITEM_LIST_DETAIL_OUTPUT_PROPERTIES,
  WORK_ITEMS_BATCH_SIZE,
} from '@/tools/azure_devops/utils'
import { AZURE_DEVOPS_CREDENTIAL_OAUTH } from '@/tools/shared/saved-credentials'
import type { ToolConfig } from '@/tools/types'

export const getWorkItemsBatchTool: ToolConfig<GetWorkItemsBatchParams, GetWorkItemsBatchResponse> =
  {
    id: 'azure_devops_get_work_items_batch',
    name: 'Azure DevOps Get Work Items Batch',
    description:
      'Fetch full details for multiple work items by ID from Azure DevOps. Pass comma-separated IDs (e.g. "123,456,789"). Requests with more than 200 IDs are automatically split into chunks.',
    version: '1.0.0',
    oauth: AZURE_DEVOPS_CREDENTIAL_OAUTH,

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
          'Comma-separated work item IDs to fetch (e.g. "123,456,789"). Lists longer than 200 IDs are chunked automatically.',
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
        const allIds = params.ids
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean)
        if (allIds.length === 0) {
          throw new Error('Get Work Items Batch requires at least one work item ID.')
        }
        const firstChunk = allIds.slice(0, 200)
        const url = new URL(`${azureDevOpsProjectUrl(params)}/_apis/wit/workitems`)
        url.searchParams.set('ids', firstChunk.join(','))
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

    transformResponse: async (response, params, context) => {
      const firstData = await response.json()
      const workItems: AzureDevOpsWorkItem[] = (firstData.value ?? []).map(
        (raw: AzureDevOpsRawWorkItem) => mapWorkItem(raw, { includeRawDetails: false })
      )

      const allIds = (params?.ids ?? '')
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean)

      if (allIds.length > WORK_ITEMS_BATCH_SIZE) {
        if (!params) {
          throw new Error('Get Work Items Batch requires organization, project, and access token.')
        }
        for (let i = WORK_ITEMS_BATCH_SIZE; i < allIds.length; i += WORK_ITEMS_BATCH_SIZE) {
          const chunk = allIds.slice(i, i + WORK_ITEMS_BATCH_SIZE)
          workItems.push(
            ...(await fetchWorkItemsChunk(
              params,
              chunk,
              'Failed to fetch work item batch chunk',
              context?.signal
            ))
          )
        }
      }

      const content =
        workItems.length === 0
          ? 'No work items found for the provided IDs.'
          : `Found ${workItems.length} work item(s) (of ${allIds.length} requested):\n\n${workItems.map(formatWorkItem).join('\n\n')}`

      return {
        success: true,
        output: {
          content,
          metadata: { count: workItems.length, totalRequested: allIds.length, workItems },
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
          totalRequested: {
            type: 'number',
            description: 'Total number of IDs requested (across all chunks)',
            optional: true,
          },
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
                ...WORK_ITEM_LIST_DETAIL_OUTPUT_PROPERTIES,
              },
            },
          },
        },
      },
    },
  }
