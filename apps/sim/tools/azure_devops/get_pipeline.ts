import type { GetPipelineParams, GetPipelineResponse } from '@/tools/azure_devops/types'
import type { ToolConfig } from '@/tools/types'

export const getPipelineTool: ToolConfig<GetPipelineParams, GetPipelineResponse> = {
  id: 'azure_devops_get_pipeline',
  name: 'Azure DevOps Get Pipeline',
  description:
    'Get details for a specific pipeline in an Azure DevOps project, including configuration and repository info.',
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
    pipelineId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the pipeline to retrieve',
    },
    pipelineVersion: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Specific revision of the pipeline to retrieve (defaults to latest)',
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
      const url = new URL(
        `https://dev.azure.com/${params.organization.trim()}/${params.project.trim()}/_apis/pipelines/${params.pipelineId}`
      )
      url.searchParams.set('api-version', '7.2-preview.1')
      if (params.pipelineVersion)
        url.searchParams.set('pipelineVersion', Number(params.pipelineVersion).toString())
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

    const pipeline: AzureDevOpsPipelineDetailItem = {
      id: data.id,
      name: data.name,
      folder: data.folder ?? '\\',
      revision: data.revision,
      url: data.url,
      configuration: {
        type: data.configuration?.type ?? 'unknown',
        path: data.configuration?.path,
        repository: data.configuration?.repository
          ? { id: data.configuration.repository.id, type: data.configuration.repository.type }
          : undefined,
      },
      links: {
        self: data._links?.self?.href ?? '',
        web: data._links?.web?.href ?? '',
      },
    }

    const pathLine = pipeline.configuration.path ? `\n  Path: ${pipeline.configuration.path}` : ''
    const repoLine = pipeline.configuration.repository
      ? `\n  Repository: ${pipeline.configuration.repository.id} (${pipeline.configuration.repository.type})`
      : ''

    const content =
      `Pipeline: ${pipeline.name} (ID: ${pipeline.id})\n` +
      `Folder: ${pipeline.folder}\n` +
      `Revision: ${pipeline.revision}\n` +
      `Config type: ${pipeline.configuration.type}` +
      pathLine +
      repoLine +
      `\nWeb URL: ${pipeline.links.web}`

    return {
      success: true,
      output: {
        content,
        metadata: { pipeline },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Human-readable summary of the pipeline' },
    metadata: {
      type: 'object',
      description: 'Pipeline detail metadata',
      properties: {
        pipeline: {
          type: 'object',
          description: 'Full pipeline detail object',
          properties: {
            id: { type: 'number', description: 'Pipeline ID' },
            name: { type: 'string', description: 'Pipeline name' },
            folder: { type: 'string', description: 'Folder path' },
            revision: { type: 'number', description: 'Pipeline revision number' },
            url: { type: 'string', description: 'Pipeline API URL' },
            configuration: {
              type: 'object',
              description: 'Pipeline configuration',
              properties: {
                type: { type: 'string', description: 'Configuration type (e.g. "yaml")' },
                path: { type: 'string', description: 'YAML file path in the repository' },
                repository: {
                  type: 'object',
                  description: 'Source repository info',
                  properties: {
                    id: { type: 'string', description: 'Repository ID' },
                    type: {
                      type: 'string',
                      description: 'Repository type (e.g. "azureReposGit")',
                    },
                  },
                },
              },
            },
            links: {
              type: 'object',
              description: 'Hypermedia links',
              properties: {
                self: { type: 'string', description: 'API self-link' },
                web: { type: 'string', description: 'Browser URL for the pipeline' },
              },
            },
          },
        },
      },
    },
  },
}

interface AzureDevOpsPipelineDetailItem {
  id: number
  name: string
  folder: string
  revision: number
  url: string
  configuration: {
    type: string
    path?: string
    repository?: { id: string; type: string }
  }
  links: { self: string; web: string }
}
