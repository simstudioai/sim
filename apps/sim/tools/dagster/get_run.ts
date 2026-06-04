import type { DagsterGetRunParams, DagsterGetRunResponse } from '@/tools/dagster/types'
import {
  dagsterGraphqlUrl,
  dagsterRequestHeaders,
  dagsterUnionErrorMessage,
  parseDagsterGraphqlResponse,
} from '@/tools/dagster/utils'
import type { ToolConfig } from '@/tools/types'

/** Fields selected on `runOrError` when the union resolves to `Run`. */
interface DagsterGetRunGraphqlRun {
  runId: string
  jobName: string | null
  status: string
  mode: string | null
  startTime: number | null
  endTime: number | null
  creationTime: number | null
  updateTime: number | null
  parentRunId: string | null
  rootRunId: string | null
  canTerminate: boolean
  assetSelection: Array<{ path: string[] }> | null
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
        mode
        startTime
        endTime
        creationTime
        updateTime
        parentRunId
        rootRunId
        canTerminate
        assetSelection {
          path
        }
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
    url: (params) => dagsterGraphqlUrl(params.host),
    method: 'POST',
    headers: (params) => dagsterRequestHeaders(params),
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
        mode: run.mode ?? null,
        startTime: run.startTime ?? null,
        endTime: run.endTime ?? null,
        creationTime: run.creationTime ?? null,
        updateTime: run.updateTime ?? null,
        parentRunId: run.parentRunId ?? null,
        rootRunId: run.rootRunId ?? null,
        canTerminate: run.canTerminate ?? false,
        assetSelection: run.assetSelection
          ? run.assetSelection.map((key) => key.path.join('/'))
          : null,
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
    mode: {
      type: 'string',
      description: 'Execution mode of the run',
      optional: true,
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
    creationTime: {
      type: 'number',
      description: 'Time the run was created as Unix timestamp',
      optional: true,
    },
    updateTime: {
      type: 'number',
      description: 'Time the run was last updated as Unix timestamp',
      optional: true,
    },
    parentRunId: {
      type: 'string',
      description: 'ID of the immediate parent run (for re-executions)',
      optional: true,
    },
    rootRunId: {
      type: 'string',
      description: 'ID of the root run in the re-execution group',
      optional: true,
    },
    canTerminate: {
      type: 'boolean',
      description: 'Whether the run can currently be terminated',
    },
    assetSelection: {
      type: 'json',
      description: 'Asset keys targeted by the run, as slash-joined strings',
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
