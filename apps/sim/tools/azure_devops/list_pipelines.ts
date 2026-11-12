import type { ListPipelinesParams, ListPipelinesResponse } from '@/tools/azure_devops/types'
import { azureDevOpsProjectUrl } from '@/tools/azure_devops/utils'
import { AZURE_DEVOPS_CREDENTIAL_OAUTH } from '@/tools/shared/saved-credentials'
import type { ToolConfig } from '@/tools/types'

export const listPipelinesTool: ToolConfig<ListPipelinesParams, ListPipelinesResponse> = {
  id: 'azure_devops_list_pipelines',
  name: 'Azure DevOps List Pipelines',
  description:
    'List all pipelines in an Azure DevOps project. Returns pipeline ID, name, folder, revision, and URL.',
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
    orderBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort expression (defaults to "name asc")',
    },
    top: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of pipelines to return',
    },
    continuationToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Continuation token for paginating results',
    },
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Azure DevOps Personal Access Token (scopes: Build: Read, Pipeline: Read)',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(`${azureDevOpsProjectUrl(params)}/_apis/pipelines`)
      url.searchParams.set('api-version', '7.2-preview.1')
      if (params.orderBy) url.searchParams.set('orderBy', params.orderBy)
      if (params.top) url.searchParams.set('$top', Number(params.top).toString())
      if (params.continuationToken)
        url.searchParams.set('continuationToken', params.continuationToken)
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

    const pipelines: AzureDevOpsPipelineItem[] = (data.value ?? []).map(
      (p: AzureDevOpsPipelineItem) => ({
        id: p.id,
        name: p.name,
        folder: p.folder ?? '\\',
        revision: p.revision,
        url: p.url,
      })
    )

    const content =
      pipelines.length === 0
        ? 'No pipelines found.'
        : `Found ${data.count ?? pipelines.length} pipeline(s):\n\n${pipelines
            .map((p) => `- ${p.name} (ID: ${p.id})\n  Folder: ${p.folder}\n  URL: ${p.url}`)
            .join('\n')}`

    return {
      success: true,
      output: {
        content,
        metadata: {
          count: data.count ?? pipelines.length,
          pipelines,
          continuationToken: response.headers.get('x-ms-continuationtoken'),
        },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Human-readable summary of pipelines' },
    metadata: {
      type: 'object',
      description: 'Pipelines metadata',
      properties: {
        count: { type: 'number', description: 'Total number of pipelines returned' },
        continuationToken: {
          type: 'string',
          description:
            'Token for the next page (from the x-ms-continuationtoken header); pass it back as continuationToken. Null on the last page.',
          optional: true,
          nullable: true,
        },
        pipelines: {
          type: 'array',
          description: 'Array of pipeline objects',
          items: {
            type: 'object',
            properties: {
              id: { type: 'number', description: 'Pipeline ID' },
              name: { type: 'string', description: 'Pipeline name' },
              folder: { type: 'string', description: 'Folder path (e.g. "\\\\")' },
              revision: { type: 'number', description: 'Pipeline revision number' },
              url: { type: 'string', description: 'Pipeline API URL' },
            },
          },
        },
      },
    },
  },
}

interface AzureDevOpsPipelineItem {
  id: number
  name: string
  folder: string
  revision: number
  url: string
}
