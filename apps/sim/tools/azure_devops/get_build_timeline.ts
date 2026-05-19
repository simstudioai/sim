import type {
  AzureDevOpsBuildTimelineRecord,
  GetBuildTimelineParams,
  GetBuildTimelineResponse,
} from '@/tools/azure_devops/types'
import type { ToolConfig } from '@/tools/types'

export const getBuildTimelineTool: ToolConfig<GetBuildTimelineParams, GetBuildTimelineResponse> = {
  id: 'azure_devops_get_build_timeline',
  name: 'Azure DevOps Get Build Timeline',
  description:
    'Get the execution timeline for an Azure DevOps build — every stage, job, and task with its result and log ID. Use this to identify which steps failed before fetching their logs with Get Build Log.',
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
      description: 'ID of the build whose timeline to retrieve',
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
      `https://dev.azure.com/${params.organization.trim()}/${params.project.trim()}/_apis/build/builds/${Number(params.buildId)}/timeline?api-version=7.2-preview.3`,
    method: 'GET',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Basic ${btoa(`:${params.accessToken}`)}`,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    const records: AzureDevOpsBuildTimelineRecord[] = (data.records ?? []).map(
      (r: {
        id: string
        name: string
        type: string
        result: string | null
        log?: { id?: number } | null
        errorCount?: number
        warningCount?: number
        startTime?: string
        finishTime?: string
      }) => ({
        id: r.id,
        name: r.name,
        type: r.type,
        result: r.result ?? null,
        logId: r.log?.id ?? null,
        errorCount: r.errorCount ?? 0,
        warningCount: r.warningCount ?? 0,
        startTime: r.startTime ?? '',
        finishTime: r.finishTime ?? '',
      })
    )

    const failedRecords = records.filter((r) => {
      const result = r.result?.toLowerCase()
      return (
        result === 'failed' || result === 'partiallysucceeded' || result === 'succeededwithissues'
      )
    })

    const content =
      failedRecords.length === 0
        ? `Build timeline: ${records.length} record(s), no failures detected.`
        : `Build timeline: ${records.length} record(s), ${failedRecords.length} failed:\n\n` +
          failedRecords
            .map(
              (r) =>
                `[${r.type}] ${r.name} — result: ${r.result}, logId: ${r.logId ?? 'none'}, errors: ${r.errorCount}`
            )
            .join('\n')

    return {
      success: true,
      output: {
        content,
        metadata: {
          totalCount: records.length,
          failedCount: failedRecords.length,
          records,
          failedRecords,
        },
      },
    }
  },

  outputs: {
    content: {
      type: 'string',
      description: 'Summary of the build timeline, highlighting failed steps',
    },
    metadata: {
      type: 'object',
      description: 'Build timeline metadata',
      properties: {
        totalCount: { type: 'number', description: 'Total number of timeline records' },
        failedCount: { type: 'number', description: 'Number of failed records' },
        records: {
          type: 'array',
          description: 'All timeline records (stages, jobs, tasks)',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Record GUID' },
              name: { type: 'string', description: 'Step name (e.g. "Run tests")' },
              type: { type: 'string', description: 'Stage | Phase | Job | Task' },
              result: {
                type: 'string',
                description: 'succeeded | failed | skipped | canceled | null',
              },
              logId: { type: 'number', description: 'Log ID to pass to Get Build Log, or null' },
              errorCount: { type: 'number', description: 'Number of errors' },
              warningCount: { type: 'number', description: 'Number of warnings' },
              startTime: { type: 'string', description: 'ISO 8601 start timestamp' },
              finishTime: { type: 'string', description: 'ISO 8601 finish timestamp' },
            },
          },
        },
        failedRecords: {
          type: 'array',
          description:
            'Subset of records where result is failed, partiallySucceeded, or succeededWithIssues — use logId to fetch logs',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Record GUID' },
              name: { type: 'string', description: 'Step name' },
              type: { type: 'string', description: 'Stage | Phase | Job | Task' },
              result: { type: 'string', description: 'failed' },
              logId: { type: 'number', description: 'Log ID to pass to Get Build Log' },
              errorCount: { type: 'number', description: 'Number of errors' },
              warningCount: { type: 'number', description: 'Number of warnings' },
              startTime: { type: 'string', description: 'ISO 8601 start timestamp' },
              finishTime: { type: 'string', description: 'ISO 8601 finish timestamp' },
            },
          },
        },
      },
    },
  },
}
