import type { DagsterTerminateRunParams, DagsterTerminateRunResponse } from '@/tools/dagster/types'
import type { ToolConfig } from '@/tools/types'

const TERMINATE_RUN_MUTATION = `
  mutation TerminateRun($runId: String!) {
    terminateRun(runId: $runId) {
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
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.errors?.[0]?.message || 'Dagster GraphQL request failed')
      }

      if (data.errors?.length) {
        throw new Error(data.errors[0].message)
      }

      const result = data.data?.terminateRun
      if (!result) throw new Error('Unexpected response from Dagster')

      // TerminateRunSuccess: has run.runId, no message
      if (result.run?.runId && !result.message) {
        return {
          success: true,
          output: {
            success: true,
            runId: result.run.runId,
            message: null,
          },
        }
      }

      // TerminateRunFailure: has run.runId and message
      if (result.run?.runId && result.message) {
        return {
          success: true,
          output: {
            success: false,
            runId: result.run.runId,
            message: result.message,
          },
        }
      }

      // RunNotFoundError: only has message
      throw new Error(result.message || 'Terminate run failed')
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
