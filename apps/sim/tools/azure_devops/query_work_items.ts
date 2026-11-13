import type {
  AzureDevOpsWorkItem,
  AzureDevOpsWorkItemLink,
  QueryWorkItemsParams,
  QueryWorkItemsResponse,
} from '@/tools/azure_devops/types'
import {
  azureDevOpsProjectUrl,
  fetchWorkItemsChunk,
  formatWorkItem,
  WORK_ITEM_LIST_DETAIL_OUTPUT_PROPERTIES,
  WORK_ITEMS_BATCH_SIZE,
} from '@/tools/azure_devops/utils'
import { AZURE_DEVOPS_CREDENTIAL_OAUTH } from '@/tools/shared/saved-credentials'
import type { ToolConfig } from '@/tools/types'

export const queryWorkItemsTool: ToolConfig<QueryWorkItemsParams, QueryWorkItemsResponse> = {
  id: 'azure_devops_query_work_items',
  name: 'Azure DevOps Query Work Items',
  description:
    'Execute a WIQL query to search for work items in Azure DevOps and return full field details. Supports flat queries and link queries (FROM WorkItemLinks). Use the top parameter to limit results.',
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
    wiqlQuery: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'WIQL query string (e.g. "SELECT [System.Id] FROM workitems WHERE [System.State] = \'Doing\' ORDER BY [System.Id] ASC"). Link queries (FROM WorkItemLinks) are supported.',
    },
    top: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Maximum number of work items the query returns (WIQL $top). Each matched item is fetched with full details, so set this for broad queries.',
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
      const url = new URL(`${azureDevOpsProjectUrl(params)}/_apis/wit/wiql`)
      if (params.top) url.searchParams.set('$top', Number(params.top).toString())
      url.searchParams.set('api-version', '7.2-preview.2')
      return url.toString()
    },
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Basic ${btoa(`:${params.accessToken}`)}`,
    }),
    body: (params) => ({ query: params.wiqlQuery }),
  },

  transformResponse: async (response, params, context) => {
    const wiqlData: AzureDevOpsRawWiqlResult = await response.json()
    const links: AzureDevOpsWorkItemLink[] = (wiqlData.workItemRelations ?? []).map((link) => ({
      rel: link.rel ?? null,
      sourceId: link.source?.id ?? null,
      targetId: link.target?.id ?? null,
    }))
    const linkIds = links.flatMap((link) =>
      [link.sourceId, link.targetId].filter((id): id is number => typeof id === 'number')
    )
    const allIds = Array.from(
      new Set([...(wiqlData.workItems ?? []).map((wi) => wi.id), ...linkIds])
    )
    const linkMetadata = wiqlData.workItemRelations ? { workItemRelations: links } : {}

    if (allIds.length === 0) {
      return {
        success: true,
        output: {
          content: 'No work items matched the query.',
          metadata: { count: 0, workItems: [], ...linkMetadata },
        },
      }
    }

    if (!params) {
      throw new Error('Query Work Items requires organization, project, and access token.')
    }

    const workItems: AzureDevOpsWorkItem[] = []
    for (let i = 0; i < allIds.length; i += WORK_ITEMS_BATCH_SIZE) {
      const chunk = allIds.slice(i, i + WORK_ITEMS_BATCH_SIZE)
      workItems.push(
        ...(await fetchWorkItemsChunk(
          params,
          chunk,
          'Failed to hydrate work item details',
          context?.signal
        ))
      )
    }

    const content =
      workItems.length === 0
        ? 'No work item details found.'
        : `Found ${workItems.length} work item(s) (of ${allIds.length} matched):\n\n${workItems.map(formatWorkItem).join('\n\n')}`

    return {
      success: true,
      output: {
        content,
        metadata: {
          count: workItems.length,
          totalMatched: allIds.length,
          workItems,
          ...linkMetadata,
        },
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
        workItemRelations: {
          type: 'array',
          description:
            'Links returned by a link query (FROM WorkItemLinks); source and target items are included in workItems',
          optional: true,
          items: {
            type: 'object',
            properties: {
              rel: {
                type: 'string',
                description: 'Link type, or null for a root item',
                nullable: true,
              },
              sourceId: { type: 'number', description: 'Source work item ID', nullable: true },
              targetId: { type: 'number', description: 'Target work item ID', nullable: true },
            },
          },
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

interface AzureDevOpsRawWiqlResult {
  workItems?: Array<{ id: number; url: string }>
  workItemRelations?: Array<{
    rel?: string | null
    source?: { id: number } | null
    target?: { id: number } | null
  }>
}
