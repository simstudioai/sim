import type { DagsterTerminateRunParams, DagsterTerminateRunResponse } from '@/tools/dagster/types'
import { dagsterUnionErrorMessage, parseDagsterGraphqlResponse } from '@/tools/dagster/utils'
import type { ToolConfig } from '@/tools/types'

/** Fields returned from `terminateRun` for all union members. */
interface DagsterTerminateRunPayload {
  __typename?: string
  run?: { runId: string }
  message?: string
}

const TERMINATE_RUN_MUTATION = `
  mutation TerminateRun($runId: String!) {
    terminateRun(runId: $runId) {
      __typename
      ... on TerminateRunSuccess {
        run {
          runId
        }
      }
      ... on TerminateRunFailure {
        run {
          runId
        }
        message
      }
      ... on RunNotFoundError {
        message
      }
      ... on UnauthorizedError {
        message
      }
      ... on PythonError {
        message
      }
    }
  }
`

export const terminateRunTool: ToolConfig<DagsterTerminateRunParams, DagsterTerminateRunResponse> =
  {
    id: 'dagster_terminate_run',
    name: 'Dagster Terminate Run',
    description: 'Terminate an in-progress Dagster run.',
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
      runId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'The ID of the run to terminate',
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
        query: TERMINATE_RUN_MUTATION,
        variables: { runId: params.runId },
      }),
    },

    transformResponse: async (response: Response) => {
      const data = await parseDagsterGraphqlResponse<{ terminateRun?: DagsterTerminateRunPayload }>(
        response
      )

      const result = data.data?.terminateRun
      if (!result) throw new Error('Unexpected response from Dagster')

      if (result.__typename === 'TerminateRunSuccess' && result.run?.runId) {
        return {
          success: true,
          output: {
            success: true,
            runId: result.run.runId,
            message: null,
          },
        }
      }

      if (result.__typename === 'TerminateRunFailure') {
        throw new Error(
          `TerminateRunFailure: ${dagsterUnionErrorMessage(result, 'Terminate run failed')}`
        )
      }

      throw new Error(dagsterUnionErrorMessage(result, 'Terminate run failed'))
    },

    outputs: {
      success: {
        type: 'boolean',
        description: 'Whether the run was successfully terminated',
      },
      runId: {
        type: 'string',
        description: 'The ID of the terminated run',
      },
      message: {
        type: 'string',
        description: 'Error or status message if termination failed',
        optional: true,
      },
    },
  }
