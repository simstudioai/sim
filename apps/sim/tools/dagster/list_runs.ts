import type { DagsterListRunsParams, DagsterListRunsResponse } from '@/tools/dagster/types'
import { dagsterUnionErrorMessage, parseDagsterGraphqlResponse } from '@/tools/dagster/utils'
import type { ToolConfig } from '@/tools/types'

/** Shape of each run in the `runsOrError` → `Runs.results` GraphQL selection set. */
interface DagsterListRunsGraphqlRow {
  runId: string
  jobName: string | null
  status: string
  tags: Array<{ key: string; value: string }> | null
  startTime: number | null
  endTime: number | null
}

function buildListRunsQuery(hasFilter: boolean) {
  return `
    query ListRuns($limit: Int${hasFilter ? ', $filter: RunsFilter' : ''}) {
      runsOrError(limit: $limit${hasFilter ? ', filter: $filter' : ''}) {
        ... on Runs {
          results {
            runId
            jobName
            status
            tags {
              key
              value
            }
            startTime
            endTime
          }
        }
        ... on InvalidPipelineRunsFilterError {
          __typename
          message
        }
        ... on PythonError {
          __typename
          message
        }
      }
    }
  `
}

export const listRunsTool: ToolConfig<DagsterListRunsParams, DagsterListRunsResponse> = {
  id: 'dagster_list_runs',
  name: 'Dagster List Runs',
  description: 'List recent Dagster runs, optionally filtered by job name.',
  version: '1.0.0',

  params: {
    host: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description:
        'Dagster host URL (e.g., https://myorg.dagster.cloud/prod or http://localhost:3001)',
    },
    apiKey: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Dagster+ API token (leave blank for OSS / self-hosted)',
    },
    jobName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter runs by job name (optional)',
    },
    statuses: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated run statuses to filter by, e.g. "SUCCESS,FAILURE" (optional)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of runs to return (default 20)',
    },
  },

  request: {
    url: (params) => `${params.host.replace(/\/$/, '')}/graphql`,
    method: 'POST',
    headers: (params) => {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (params.apiKey) headers['Dagster-Cloud-Api-Token'] = params.apiKey
      return headers
    },
    body: (params) => {
      const filter: Record<string, unknown> = {}
      if (params.jobName) filter.pipelineName = params.jobName
      if (params.statuses) {
        filter.statuses = params.statuses
          .split(',')
          .map((s: string) => s.trim())
          .filter(Boolean)
      }

      const hasFilter = Object.keys(filter).length > 0
      const variables: Record<string, unknown> = { limit: params.limit || 20 }
      if (hasFilter) variables.filter = filter

      return {
        query: buildListRunsQuery(hasFilter),
        variables,
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await parseDagsterGraphqlResponse<{ runsOrError?: unknown }>(response)

    const result = data.data?.runsOrError as
      | { results?: DagsterListRunsGraphqlRow[]; message?: string }
      | undefined
    if (!result) throw new Error('Unexpected response from Dagster')

    if (!Array.isArray(result.results)) {
      throw new Error(dagsterUnionErrorMessage(result, 'Dagster returned an error listing runs'))
    }

    const runs = result.results.map((r: DagsterListRunsGraphqlRow) => ({
      runId: r.runId,
      jobName: r.jobName ?? null,
      status: r.status,
      tags: r.tags ?? null,
      startTime: r.startTime ?? null,
      endTime: r.endTime ?? null,
    }))

    return {
      success: true,
      output: { runs },
    }
  },

  outputs: {
    runs: {
      type: 'json',
      description: 'Array of runs',
      properties: {
        runId: { type: 'string', description: 'Run ID' },
        jobName: { type: 'string', description: 'Job name' },
        status: { type: 'string', description: 'Run status' },
        tags: { type: 'json', description: 'Run tags as array of {key, value} objects' },
        startTime: { type: 'number', description: 'Start time as Unix timestamp' },
        endTime: { type: 'number', description: 'End time as Unix timestamp' },
      },
    },
  },
}
