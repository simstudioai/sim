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
      `https://dev.azure.com/${params.organization.trim()}/${params.project.trim()}/_apis/wit/wiql?api-version=7.2-preview.2`,
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

    const allIds = workItemRefs.map((wi) => wi.id)
    const BATCH_SIZE = 200
    const organization = params!.organization.trim()
    const project = params!.project.trim()
    const authHeader = `Basic ${btoa(`:${params!.accessToken}`)}`

    const workItems: AzureDevOpsWorkItem[] = []
    for (let i = 0; i < allIds.length; i += BATCH_SIZE) {
      const chunk = allIds.slice(i, i + BATCH_SIZE)
      const detailsUrl = new URL(
        `https://dev.azure.com/${organization}/${project}/_apis/wit/workitems`
      )
      detailsUrl.searchParams.set('ids', chunk.join(','))
      detailsUrl.searchParams.set('$expand', 'all')
      detailsUrl.searchParams.set('api-version', '7.2-preview.3')

      const detailsResponse = await fetch(detailsUrl.toString(), {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: authHeader,
        },
      })

      if (!detailsResponse.ok) {
        const errorBody = await detailsResponse.text().catch(() => '')
        throw new Error(
          `Failed to hydrate work item details (${detailsResponse.status}): ${errorBody || detailsResponse.statusText}`
        )
      }

      const detailsData = await detailsResponse.json()
      for (const raw of detailsData.value ?? []) {
        workItems.push(mapWorkItem(raw as AzureDevOpsRawWorkItem))
      }
    }

    const content =
      workItems.length === 0
        ? 'No work item details found.'
        : `Found ${workItems.length} work item(s) (of ${allIds.length} matched):\n\n${workItems.map(formatWorkItem).join('\n\n')}`

    return {
      success: true,
      output: {
        content,
        metadata: { count: workItems.length, totalMatched: allIds.length, workItems },
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
        count: { type: 'number', description: 'Number of work items returned (after hydration)' },
        totalMatched: {
          type: 'number',
          description: 'Total number of work items matched by the WIQL query before hydration',
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
            },
          },
        },
      },
    },
  },
}
