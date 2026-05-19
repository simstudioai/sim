import type { GetPipelineRunParams, GetPipelineRunResponse } from '@/tools/azure_devops/types'
import type { ToolConfig } from '@/tools/types'

export const getPipelineRunTool: ToolConfig<GetPipelineRunParams, GetPipelineRunResponse> = {
  id: 'azure_devops_get_pipeline_run',
  name: 'Azure DevOps Get Pipeline Run',
  description:
    'Get details for a specific pipeline run in an Azure DevOps project. Returns run state, result, timestamps, and the pipeline reference.',
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
      description: 'ID of the pipeline',
    },
    runId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the run to retrieve',
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
        `https://dev.azure.com/${params.organization.trim()}/${params.project.trim()}/_apis/pipelines/${params.pipelineId}/runs/${params.runId}`
      )
      url.searchParams.set('api-version', '7.2-preview.1')
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

    const run: AzureDevOpsPipelineRunDetailItem = {
      id: data.id,
      name: data.name,
      state: data.state,
      result: data.result,
      createdDate: data.createdDate,
      finishedDate: data.finishedDate,
      url: data.url,
      webUrl: data._links?.web?.href ?? '',
      pipeline: {
        id: data.pipeline?.id,
        name: data.pipeline?.name,
        folder: data.pipeline?.folder ?? '\\',
        revision: data.pipeline?.revision,
        url: data.pipeline?.url ?? '',
      },
    }

    const resultLine = run.result ? ` | Result: ${run.result}` : ''
    const finishedLine = run.finishedDate ? ` | Finished: ${run.finishedDate}` : ''

    const content =
      `Run: ${run.name} (ID: ${run.id})\n` +
      `Pipeline: ${run.pipeline.name} (ID: ${run.pipeline.id})\n` +
      `State: ${run.state}${resultLine}\n` +
      `Created: ${run.createdDate}${finishedLine}\n` +
      `Web URL: ${run.webUrl}`

    return {
      success: true,
      output: {
        content,
        metadata: { run },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Human-readable summary of the pipeline run' },
    metadata: {
      type: 'object',
      description: 'Pipeline run metadata',
      properties: {
        run: {
          type: 'object',
          description: 'Full pipeline run detail object',
          properties: {
            id: { type: 'number', description: 'Run ID' },
            name: { type: 'string', description: 'Run name (e.g. "20210601.1")' },
            state: { type: 'string', description: 'Run state (e.g. "completed", "inProgress")' },
            result: {
              type: 'string',
              description: 'Run result (e.g. "succeeded", "failed") — absent if still running',
            },
            createdDate: { type: 'string', description: 'ISO 8601 creation timestamp' },
            finishedDate: {
              type: 'string',
              description: 'ISO 8601 finish timestamp — absent if still running',
            },
            url: { type: 'string', description: 'Run API URL' },
            webUrl: { type: 'string', description: 'Browser URL for the run' },
            pipeline: {
              type: 'object',
              description: 'Pipeline reference',
              properties: {
                id: { type: 'number', description: 'Pipeline ID' },
                name: { type: 'string', description: 'Pipeline name' },
                folder: { type: 'string', description: 'Pipeline folder' },
                revision: { type: 'number', description: 'Pipeline revision number' },
                url: { type: 'string', description: 'Pipeline API URL' },
              },
            },
          },
        },
      },
    },
  },
}

interface AzureDevOpsPipelineRunDetailItem {
  id: number
  name: string
  state: string
  result?: string
  createdDate: string
  finishedDate?: string
  url: string
  webUrl: string
  pipeline: {
    id: number
    name: string
    folder: string
    revision: number
    url: string
  }
}
