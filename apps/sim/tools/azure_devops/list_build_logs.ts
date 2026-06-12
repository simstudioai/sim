import type { ListBuildLogsParams, ListBuildLogsResponse } from '@/tools/azure_devops/types'
import type { ToolConfig } from '@/tools/types'

export const listBuildLogsTool: ToolConfig<ListBuildLogsParams, ListBuildLogsResponse> = {
  id: 'azure_devops_list_build_logs',
  name: 'Azure DevOps List Build Logs',
  description:
    'List all log entries for a specific build in Azure DevOps. Returns log IDs, types, and line counts — use the log ID with the Get Build Log tool to fetch actual log text.',
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
      description: 'The build ID whose logs to list',
    },
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Azure DevOps Personal Access Token (scopes: Build: Read)',
    },
  },

  request: {
    url: (params) =>
      `https://dev.azure.com/${params.organization.trim()}/${params.project.trim()}/_apis/build/builds/${params.buildId}/logs?api-version=7.2-preview.2`,
    method: 'GET',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Basic ${btoa(`:${params.accessToken}`)}`,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    const logs: AzureDevOpsBuildLogItem[] = (data.value ?? []).map((l: AzureDevOpsRawBuildLog) => ({
      id: l.id,
      type: l.type,
      url: l.url,
      lineCount: l.lineCount,
      createdOn: l.createdOn,
      lastChangedOn: l.lastChangedOn,
    }))

    const content =
      logs.length === 0
        ? 'No logs found.'
        : `Found ${data.count ?? logs.length} log(s):\n\n${logs
            .map(
              (l) =>
                `- Log ID: ${l.id}\n` +
                `  Type: ${l.type}\n` +
                `  Lines: ${l.lineCount}` +
                (l.lastChangedOn ? `\n  Last changed: ${l.lastChangedOn}` : '')
            )
            .join('\n')}`

    return {
      success: true,
      output: {
        content,
        metadata: {
          count: data.count ?? logs.length,
          logs,
        },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Human-readable summary of build logs' },
    metadata: {
      type: 'object',
      description: 'Build logs metadata',
      properties: {
        count: { type: 'number', description: 'Total number of log entries returned' },
        logs: {
          type: 'array',
          description: 'Array of log entry objects',
          items: {
            type: 'object',
            properties: {
              id: {
                type: 'number',
                description: 'Log entry ID — use with Get Build Log to fetch content',
              },
              type: {
                type: 'string',
                description: 'Log type (e.g. "Container", "Task", "Section")',
              },
              url: { type: 'string', description: 'API URL for the log entry' },
              lineCount: { type: 'number', description: 'Number of lines in the log' },
              createdOn: { type: 'string', description: 'ISO 8601 creation timestamp' },
              lastChangedOn: { type: 'string', description: 'ISO 8601 last-changed timestamp' },
            },
          },
        },
      },
    },
  },
}

interface AzureDevOpsBuildLogItem {
  id: number
  type: string
  url: string
  lineCount: number
  createdOn?: string
  lastChangedOn?: string
}

interface AzureDevOpsRawBuildLog {
  id: number
  type: string
  url: string
  lineCount: number
  createdOn?: string
  lastChangedOn?: string
}
