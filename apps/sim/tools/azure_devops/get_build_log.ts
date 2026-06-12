import type { GetBuildLogParams, GetBuildLogResponse } from '@/tools/azure_devops/types'
import type { ToolConfig } from '@/tools/types'

export const getBuildLogTool: ToolConfig<GetBuildLogParams, GetBuildLogResponse> = {
  id: 'azure_devops_get_build_log',
  name: 'Azure DevOps Get Build Log',
  description:
    'Fetch the text content of a specific build log in Azure DevOps. Use List Build Logs first to get the log ID. Optionally retrieve only a line range with startLine/endLine.',
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
    buildId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'The build ID containing the log',
    },
    logId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'The log entry ID to fetch (from List Build Logs)',
    },
    startLine: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'First line to return (1-based, inclusive)',
    },
    endLine: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Last line to return (1-based, inclusive)',
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
        `https://dev.azure.com/${params.organization.trim()}/${params.project.trim()}/_apis/build/builds/${params.buildId}/logs/${params.logId}`
      )
      url.searchParams.set('api-version', '7.2-preview.2')
      if (params.startLine !== undefined)
        url.searchParams.set('startLine', Number(params.startLine).toString())
      if (params.endLine !== undefined)
        url.searchParams.set('endLine', Number(params.endLine).toString())
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      Accept: 'text/plain',
      Authorization: `Basic ${btoa(`:${params.accessToken}`)}`,
    }),
  },

  transformResponse: async (response) => {
    const text = await response.text()
    const trimmed = text.trim()
    const lineCount = trimmed.length === 0 ? 0 : trimmed.split('\n').length

    return {
      success: true,
      output: {
        content: trimmed.length === 0 ? 'Log is empty.' : text,
        metadata: {
          lineCount,
        },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Raw log text' },
    metadata: {
      type: 'object',
      description: 'Log metadata',
      properties: {
        lineCount: { type: 'number', description: 'Number of lines in the returned log text' },
      },
    },
  },
}
