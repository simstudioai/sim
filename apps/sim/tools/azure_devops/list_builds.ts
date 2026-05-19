import type { ListBuildsParams, ListBuildsResponse } from '@/tools/azure_devops/types'
import type { ToolConfig } from '@/tools/types'

export const listBuildsTool: ToolConfig<ListBuildsParams, ListBuildsResponse> = {
  id: 'azure_devops_list_builds',
  name: 'Azure DevOps List Builds',
  description:
    'List builds in an Azure DevOps project. Optionally filter by pipeline definition, status, result, or branch.',
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
    definitionIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated pipeline definition IDs to filter by (e.g. "1,2,3")',
    },
    top: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of builds to return',
    },
    statusFilter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Filter by build status: inProgress, completed, cancelling, postponed, notStarted, none',
    },
    resultFilter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by build result: succeeded, partiallySucceeded, failed, canceled',
    },
    branchName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by source branch name (e.g. "refs/heads/main")',
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
        `https://dev.azure.com/${params.organization.trim()}/${params.project.trim()}/_apis/build/builds`
      )
      url.searchParams.set('api-version', '7.2-preview.8')
      if (params.definitionIds) url.searchParams.set('definitions', params.definitionIds)
      if (params.top) url.searchParams.set('$top', Number(params.top).toString())
      if (params.statusFilter) url.searchParams.set('statusFilter', params.statusFilter)
      if (params.resultFilter) url.searchParams.set('resultFilter', params.resultFilter)
      if (params.branchName) url.searchParams.set('branchName', params.branchName)
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

    const builds: AzureDevOpsBuildItem[] = (data.value ?? []).map((b: AzureDevOpsRawBuild) => ({
      id: b.id,
      buildNumber: b.buildNumber,
      status: b.status,
      result: b.result,
      queueTime: b.queueTime,
      startTime: b.startTime,
      finishTime: b.finishTime,
      sourceBranch: b.sourceBranch,
      sourceVersion: b.sourceVersion,
      definition: { id: b.definition?.id ?? 0, name: b.definition?.name ?? '' },
      webUrl: b._links?.web?.href ?? '',
    }))

    const content =
      builds.length === 0
        ? 'No builds found.'
        : `Found ${data.count ?? builds.length} build(s):\n\n${builds
            .map(
              (b) =>
                `- Build ${b.buildNumber} (ID: ${b.id})\n` +
                `  Pipeline: ${b.definition.name}\n` +
                `  Status: ${b.status}${b.result ? ` | Result: ${b.result}` : ''}\n` +
                `  Branch: ${b.sourceBranch}\n` +
                `  Queued: ${b.queueTime}${b.finishTime ? ` | Finished: ${b.finishTime}` : ''}`
            )
            .join('\n')}`

    return {
      success: true,
      output: {
        content,
        metadata: {
          count: data.count ?? builds.length,
          builds,
        },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Human-readable summary of builds' },
    metadata: {
      type: 'object',
      description: 'Builds metadata',
      properties: {
        count: { type: 'number', description: 'Total number of builds returned' },
        builds: {
          type: 'array',
          description: 'Array of build objects',
          items: {
            type: 'object',
            properties: {
              id: { type: 'number', description: 'Build ID' },
              buildNumber: { type: 'string', description: 'Build number (e.g. "20210601.1")' },
              status: {
                type: 'string',
                description: 'Build status (e.g. "completed", "inProgress")',
              },
              result: {
                type: 'string',
                description: 'Build result (e.g. "succeeded", "failed") — absent if still running',
              },
              queueTime: { type: 'string', description: 'ISO 8601 queue timestamp' },
              startTime: { type: 'string', description: 'ISO 8601 start timestamp' },
              finishTime: {
                type: 'string',
                description: 'ISO 8601 finish timestamp — absent if still running',
              },
              sourceBranch: {
                type: 'string',
                description: 'Source branch (e.g. "refs/heads/main")',
              },
              sourceVersion: { type: 'string', description: 'Source commit SHA' },
              definition: {
                type: 'object',
                description: 'Pipeline definition reference',
                properties: {
                  id: { type: 'number', description: 'Definition ID' },
                  name: { type: 'string', description: 'Definition name' },
                },
              },
              webUrl: { type: 'string', description: 'Browser URL for the build' },
            },
          },
        },
      },
    },
  },
}

interface AzureDevOpsBuildItem {
  id: number
  buildNumber: string
  status: string
  result?: string
  queueTime: string
  startTime?: string
  finishTime?: string
  sourceBranch: string
  sourceVersion: string
  definition: { id: number; name: string }
  webUrl: string
}

interface AzureDevOpsRawBuild {
  id: number
  buildNumber: string
  status: string
  result?: string
  queueTime: string
  startTime?: string
  finishTime?: string
  sourceBranch: string
  sourceVersion: string
  definition?: { id: number; name?: string }
  _links?: { web?: { href: string } }
}
