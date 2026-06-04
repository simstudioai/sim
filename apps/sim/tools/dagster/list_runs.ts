import type { DagsterListRunsParams, DagsterListRunsResponse } from '@/tools/dagster/types'
import {
  dagsterGraphqlUrl,
  dagsterRequestHeaders,
  dagsterUnionErrorMessage,
  parseDagsterGraphqlResponse,
} from '@/tools/dagster/utils'
import type { ToolConfig } from '@/tools/types'

/** Default page size applied when the caller omits `limit`, so paging stays bounded and `hasMore` is meaningful. */
const DEFAULT_LIST_RUNS_LIMIT = 20

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
    query ListRuns($limit: Int, $cursor: String${hasFilter ? ', $filter: RunsFilter' : ''}) {
      runsOrError(limit: $limit, cursor: $cursor${hasFilter ? ', filter: $filter' : ''}) {
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
  description:
    'List Dagster runs with optional filters by job name, status, and creation-time range, plus cursor pagination.',
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
    createdAfter: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return runs created at or after this Unix timestamp in seconds (optional)',
    },
    createdBefore: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Only return runs created at or before this Unix timestamp in seconds (optional)',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Run ID to page after, from a previous response cursor (optional)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of runs to return (default 20)',
    },
  },

  request: {
    url: (params) => dagsterGraphqlUrl(params.host),
    method: 'POST',
    headers: (params) => dagsterRequestHeaders(params),
    body: (params) => {
      const filter: Record<string, unknown> = {}
      if (params.jobName) filter.pipelineName = params.jobName
      if (params.statuses) {
        filter.statuses = params.statuses
          .split(',')
          .map((s: string) => s.trim())
          .filter(Boolean)
      }
      if (params.createdAfter != null) filter.createdAfter = params.createdAfter
      if (params.createdBefore != null) filter.createdBefore = params.createdBefore

      const hasFilter = Object.keys(filter).length > 0
      const pageSize = params.limit || DEFAULT_LIST_RUNS_LIMIT
      // Request one extra row so `hasMore` is exact even when the final page is exactly `pageSize` long.
      const variables: Record<string, unknown> = { limit: pageSize + 1 }
      if (params.cursor) variables.cursor = params.cursor
      if (hasFilter) variables.filter = filter

      return {
        query: buildListRunsQuery(hasFilter),
        variables,
      }
    },
  },

  transformResponse: async (response: Response, params?: DagsterListRunsParams) => {
    const data = await parseDagsterGraphqlResponse<{ runsOrError?: unknown }>(response)

    const result = data.data?.runsOrError as
      | { results?: DagsterListRunsGraphqlRow[]; message?: string }
      | undefined
    if (!result) throw new Error('Unexpected response from Dagster')

    if (!Array.isArray(result.results)) {
      throw new Error(dagsterUnionErrorMessage(result, 'Dagster returned an error listing runs'))
    }

    const pageSize = params?.limit || DEFAULT_LIST_RUNS_LIMIT
    const hasMore = result.results.length > pageSize
    const pageRows = hasMore ? result.results.slice(0, pageSize) : result.results

    const runs = pageRows.map((r: DagsterListRunsGraphqlRow) => ({
      runId: r.runId,
      jobName: r.jobName ?? null,
      status: r.status,
      tags: r.tags ?? null,
      startTime: r.startTime ?? null,
      endTime: r.endTime ?? null,
    }))

    return {
      success: true,
      output: {
        runs,
        cursor: runs.length > 0 ? runs[runs.length - 1].runId : null,
        hasMore,
      },
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
    cursor: {
      type: 'string',
      description: 'Run ID of the last returned run — pass as cursor to fetch the next page',
      optional: true,
    },
    hasMore: {
      type: 'boolean',
      description: 'Whether more runs are likely available beyond this page',
    },
  },
}
