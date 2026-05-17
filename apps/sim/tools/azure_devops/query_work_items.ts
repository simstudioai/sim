import type {
  AzureDevOpsWorkItem,
  QueryWorkItemsParams,
  QueryWorkItemsResponse,
} from '@/tools/azure_devops/types'
import type { AzureDevOpsRawWorkItem } from '@/tools/azure_devops/utils'
import { formatWorkItem, mapWorkItem } from '@/tools/azure_devops/utils'
import type { ToolConfig } from '@/tools/types'

export const queryWorkItemsTool: ToolConfig<QueryWorkItemsParams, QueryWorkItemsResponse> = {
  id: 'azure_devops_query_work_items',
  name: 'Azure DevOps Query Work Items',
  description:
    'Execute a WIQL query to search for work items in Azure DevOps and return full field details. Use TOP N in your query to limit results (Azure enforces a 200-item maximum per batch fetch).',
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
    wiqlQuery: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'WIQL query string (e.g. "SELECT [System.Id] FROM workitems WHERE [System.State] = \'Doing\' ORDER BY [System.Id] ASC"). Use TOP N to limit results.',
    },
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Azure DevOps Personal Access Token (scopes: Work Items: Read)',
    },
  },

  request: {
    url: (params) =>
      `https://dev.azure.com/${params.organization}/${params.project}/_apis/wit/wiql?api-version=7.2-preview.2`,
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Basic ${btoa(`:${params.accessToken}`)}`,
    }),
    body: (params) => ({ query: params.wiqlQuery }),
  },

  transformResponse: async (response, params) => {
    const wiqlData = await response.json()
    const workItemRefs: Array<{ id: number; url: string }> = wiqlData.workItems ?? []

    if (workItemRefs.length === 0) {
      return {
        success: true,
        output: {
          content: 'No work items matched the query.',
          metadata: { count: 0, workItems: [] },
        },
      }
    }

    const ids = workItemRefs
      .slice(0, 200)
      .map((wi) => wi.id)
      .join(',')

    const detailsUrl = new URL(
      `https://dev.azure.com/${params!.organization}/${params!.project}/_apis/wit/workitems`
    )
    detailsUrl.searchParams.set('ids', ids)
    detailsUrl.searchParams.set('$expand', 'all')
    detailsUrl.searchParams.set('api-version', '7.2-preview.3')

    const detailsResponse = await fetch(detailsUrl.toString(), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${btoa(`:${params!.accessToken}`)}`,
      },
    })

    const detailsData = await detailsResponse.json()
    const workItems: AzureDevOpsWorkItem[] = (detailsData.value ?? []).map(
      (raw: AzureDevOpsRawWorkItem) => mapWorkItem(raw)
    )

    const content =
      workItems.length === 0
        ? 'No work item details found.'
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
      description: 'Human-readable summary of matching work items',
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
