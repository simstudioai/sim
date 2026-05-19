import type { ListPipelineRunsParams, ListPipelineRunsResponse } from '@/tools/azure_devops/types'
import type { ToolConfig } from '@/tools/types'

export const listPipelineRunsTool: ToolConfig<ListPipelineRunsParams, ListPipelineRunsResponse> = {
  id: 'azure_devops_list_pipeline_runs',
  name: 'Azure DevOps List Pipeline Runs',
  description:
    'List runs for a specific pipeline in an Azure DevOps project. Returns run ID, name, state, result, and timestamps.',
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
      description: 'ID of the pipeline whose runs to list',
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
        `https://dev.azure.com/${params.organization.trim()}/${params.project.trim()}/_apis/pipelines/${params.pipelineId}/runs`
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

    const runs: AzureDevOpsPipelineRunItem[] = (data.value ?? []).map((r: AzureDevOpsRawRun) => ({
      id: r.id,
      name: r.name,
      state: r.state,
      result: r.result,
      createdDate: r.createdDate,
      finishedDate: r.finishedDate,
      url: r.url,
      webUrl: r._links?.web?.href ?? '',
    }))

    const content =
      runs.length === 0
        ? 'No pipeline runs found.'
        : `Found ${data.count ?? runs.length} run(s):\n\n${runs
            .map(
              (r) =>
                `- Run ${r.name} (ID: ${r.id})\n` +
                `  State: ${r.state}${r.result ? ` | Result: ${r.result}` : ''}\n` +
                `  Created: ${r.createdDate}${r.finishedDate ? ` | Finished: ${r.finishedDate}` : ''}`
            )
            .join('\n')}`

    return {
      success: true,
      output: {
        content,
        metadata: {
          count: data.count ?? runs.length,
          runs,
        },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Human-readable summary of pipeline runs' },
    metadata: {
      type: 'object',
      description: 'Pipeline runs metadata',
      properties: {
        count: { type: 'number', description: 'Total number of runs returned' },
        runs: {
          type: 'array',
          description: 'Array of pipeline run objects',
          items: {
            type: 'object',
            properties: {
              id: { type: 'number', description: 'Run ID' },
              name: { type: 'string', description: 'Run name (e.g. "20210601.1")' },
              state: {
                type: 'string',
                description: 'Run state (e.g. "completed", "inProgress")',
              },
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
            },
          },
        },
      },
    },
  },
}

interface AzureDevOpsPipelineRunItem {
  id: number
  name: string
  state: string
  result?: string
  createdDate: string
  finishedDate?: string
  url: string
  webUrl: string
}

interface AzureDevOpsRawRun {
  id: number
  name: string
  state: string
  result?: string
  createdDate: string
  finishedDate?: string
  url: string
  _links?: { web?: { href: string } }
}
