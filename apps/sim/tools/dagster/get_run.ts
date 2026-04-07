import type { DagsterGetRunParams, DagsterGetRunResponse } from '@/tools/dagster/types'
import { dagsterUnionErrorMessage, parseDagsterGraphqlResponse } from '@/tools/dagster/utils'
import type { ToolConfig } from '@/tools/types'

/** Fields selected on `runOrError` when the union resolves to `Run`. */
interface DagsterGetRunGraphqlRun {
  runId: string
  jobName: string | null
  status: string
  startTime: number | null
  endTime: number | null
  runConfigYaml: string | null
  tags: Array<{ key: string; value: string }> | null
}

const GET_RUN_QUERY = `
  query GetRun($runId: ID!) {
    runOrError(runId: $runId) {
      ... on Run {
        runId
        jobName
        status
        startTime
        endTime
        runConfigYaml
        tags {
          key
          value
        }
      }
      ... on RunNotFoundError {
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

export const getRunTool: ToolConfig<DagsterGetRunParams, DagsterGetRunResponse> = {
  id: 'dagster_get_run',
  name: 'Dagster Get Run',
  description: 'Get the status and details of a Dagster run by its ID.',
  version: '1.0.0',

  params: {
    host: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description:
        'Dagster host URL (e.g., https://myorg.dagster.cloud/prod or http://localhost:3000)',
    },
    apiKey: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Dagster+ API token (leave blank for OSS / self-hosted)',
    },
    runId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the run to retrieve',
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
    body: (params) => ({
      query: GET_RUN_QUERY,
      variables: { runId: params.runId },
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await parseDagsterGraphqlResponse<{ runOrError?: unknown }>(response)

    const raw = data.data?.runOrError
    if (!raw || typeof raw !== 'object') throw new Error('Unexpected response from Dagster')

    if (!('runId' in raw) || typeof (raw as { runId: unknown }).runId !== 'string') {
      throw new Error(
        dagsterUnionErrorMessage(raw as { message?: string }, 'Run not found or Dagster error')
      )
    }

    const run = raw as DagsterGetRunGraphqlRun

    return {
      success: true,
      output: {
        runId: run.runId,
        jobName: run.jobName ?? null,
        status: run.status,
        startTime: run.startTime ?? null,
        endTime: run.endTime ?? null,
        runConfigYaml: run.runConfigYaml ?? null,
        tags: run.tags ?? null,
      },
    }
  },

  outputs: {
    runId: {
      type: 'string',
      description: 'Run ID',
    },
    jobName: {
      type: 'string',
      description: 'Name of the job this run belongs to',
      optional: true,
    },
    status: {
      type: 'string',
      description:
        'Run status (QUEUED, NOT_STARTED, STARTING, MANAGED, STARTED, SUCCESS, FAILURE, CANCELING, CANCELED)',
    },
    startTime: {
      type: 'number',
      description: 'Run start time as Unix timestamp',
      optional: true,
    },
    endTime: {
      type: 'number',
      description: 'Run end time as Unix timestamp',
      optional: true,
    },
    runConfigYaml: {
      type: 'string',
      description: 'Run configuration as YAML',
      optional: true,
    },
    tags: {
      type: 'json',
      description: 'Run tags as array of {key, value} objects',
      optional: true,
    },
  },
}
