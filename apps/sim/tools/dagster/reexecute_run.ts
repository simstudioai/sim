import type { DagsterReexecuteRunParams, DagsterReexecuteRunResponse } from '@/tools/dagster/types'
import { dagsterUnionErrorMessage, parseDagsterGraphqlResponse } from '@/tools/dagster/utils'
import type { ToolConfig } from '@/tools/types'

interface ReexecuteRunResult {
  type: string
  run?: { runId: string }
  message?: string
  /** Returned by InvalidStepError */
  invalidStepKey?: string
  /** Returned by InvalidOutputError */
  invalidOutputName?: string
  stepKey?: string
  /** Returned by RunConfigValidationInvalid */
  errors?: Array<{ message: string }>
}

const REEXECUTE_RUN_MUTATION = `
  mutation LaunchRunReexecution($parentRunId: String!, $strategy: ReexecutionStrategy!) {
    launchRunReexecution(
      reexecutionParams: {
        parentRunId: $parentRunId
        strategy: $strategy
      }
    ) {
      type: __typename
      ... on LaunchRunSuccess {
        run {
          runId
        }
      }
      ... on InvalidStepError {
        invalidStepKey
      }
      ... on InvalidOutputError {
        stepKey
        invalidOutputName
      }
      ... on RunConfigValidationInvalid {
        errors {
          message
        }
      }
      ... on PipelineNotFoundError {
        message
      }
      ... on RunConflict {
        message
      }
      ... on UnauthorizedError {
        message
      }
      ... on InvalidSubsetError {
        message
      }
      ... on PresetNotFoundError {
        message
      }
      ... on ConflictingExecutionParamsError {
        message
      }
      ... on NoModeProvidedError {
        message
      }
      ... on PythonError {
        message
      }
    }
  }
`

export const reexecuteRunTool: ToolConfig<DagsterReexecuteRunParams, DagsterReexecuteRunResponse> =
  {
    id: 'dagster_reexecute_run',
    name: 'Dagster Reexecute Run',
    description: 'Reexecute an existing Dagster run, optionally resuming only from failed steps.',
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
      parentRunId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'The ID of the run to reexecute',
      },
      strategy: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description:
          'Reexecution strategy: ALL_STEPS reruns everything, FROM_FAILURE resumes from failed steps, FROM_ASSET_FAILURE resumes from failed assets',
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
        query: REEXECUTE_RUN_MUTATION,
        variables: {
          parentRunId: params.parentRunId,
          strategy: params.strategy,
        },
      }),
    },

    transformResponse: async (response: Response) => {
      const data = await parseDagsterGraphqlResponse<{ launchRunReexecution?: unknown }>(response)

      const result = data.data?.launchRunReexecution as ReexecuteRunResult | undefined
      if (!result) throw new Error('Unexpected response from Dagster')

      if (result.type === 'LaunchRunSuccess' && result.run) {
        return {
          success: true,
          output: { runId: result.run.runId },
        }
      }

      let detail: string
      if (result.type === 'InvalidStepError' && result.invalidStepKey) {
        detail = `Invalid step key: ${result.invalidStepKey}`
      } else if (result.type === 'InvalidOutputError' && result.invalidOutputName) {
        detail = `Invalid output "${result.invalidOutputName}" on step "${result.stepKey}"`
      } else if (result.type === 'RunConfigValidationInvalid' && result.errors?.length) {
        detail = result.errors.map((e) => e.message).join('; ')
      } else {
        detail = dagsterUnionErrorMessage(result, 'Reexecute run failed')
      }

      throw new Error(`${result.type}: ${detail}`)
    },

    outputs: {
      runId: {
        type: 'string',
        description: 'The ID of the newly launched reexecution run',
      },
    },
  }
