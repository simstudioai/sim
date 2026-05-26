import type {
  AzureDevOpsWorkItemRef,
  GetWorkItemsBetweenBuildsParams,
  GetWorkItemsBetweenBuildsResponse,
} from '@/tools/azure_devops/types'
import type { ToolConfig } from '@/tools/types'

export const getWorkItemsBetweenBuildsTool: ToolConfig<
  GetWorkItemsBetweenBuildsParams,
  GetWorkItemsBetweenBuildsResponse
> = {
  id: 'azure_devops_get_work_items_between_builds',
  name: 'Azure DevOps Get Work Items Between Builds',
  description:
    'Get work item references associated with commits between two builds in Azure DevOps. Returns work item IDs and URLs — use Get Work Items Batch for full field details.',
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
    fromBuildId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'The older build ID (start of range)',
    },
    toBuildId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'The newer build ID (end of range)',
    },
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Azure DevOps Personal Access Token (scopes: Build: Read)',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(
        `https://dev.azure.com/${params.organization.trim()}/${params.project.trim()}/_apis/build/workitems`
      )
      url.searchParams.set('fromBuildId', Number(params.fromBuildId).toString())
      url.searchParams.set('toBuildId', Number(params.toBuildId).toString())
      url.searchParams.set('api-version', '7.2-preview.2')
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

    const workItems: AzureDevOpsWorkItemRef[] = (data.value ?? []).map(
      (w: AzureDevOpsRawWorkItemRef) => ({
        id: String(w.id),
        url: w.url,
      })
    )

    const content =
      workItems.length === 0
        ? 'No work items found between these builds.'
        : `Found ${data.count ?? workItems.length} work item(s) between builds:\n\n${workItems
            .map((w) => `- Work Item ID: ${w.id}\n  URL: ${w.url}`)
            .join('\n')}`

    return {
      success: true,
      output: {
        content,
        metadata: {
          count: data.count ?? workItems.length,
          workItems,
        },
      },
    }
  },

  outputs: {
    content: {
      type: 'string',
      description: 'Human-readable summary of work items between builds',
    },
    metadata: {
      type: 'object',
      description: 'Work items metadata',
      properties: {
        count: { type: 'number', description: 'Total number of work item references returned' },
        workItems: {
          type: 'array',
          description: 'Array of work item references',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Work item ID' },
              url: { type: 'string', description: 'API URL for the work item' },
            },
          },
        },
      },
    },
  },
}

interface AzureDevOpsRawWorkItemRef {
  id: string | number
  url: string
}
