import type { DagsterDeleteRunParams, DagsterDeleteRunResponse } from '@/tools/dagster/types'
import { dagsterUnionErrorMessage, parseDagsterGraphqlResponse } from '@/tools/dagster/utils'
import type { ToolConfig } from '@/tools/types'

interface DeleteRunResult {
  type: string
  runId?: string
  message?: string
}

const DELETE_RUN_MUTATION = `
  mutation DeleteRun($runId: String!) {
    deleteRun(runId: $runId) {
      type: __typename
      ... on DeletePipelineRunSuccess {
        runId
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

export const deleteRunTool: ToolConfig<DagsterDeleteRunParams, DagsterDeleteRunResponse> = {
  id: 'dagster_delete_run',
  name: 'Dagster Delete Run',
  description: 'Permanently delete a Dagster run record.',
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
      description: 'The ID of the run to delete',
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
      query: DELETE_RUN_MUTATION,
      variables: { runId: params.runId },
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await parseDagsterGraphqlResponse<{ deleteRun?: unknown }>(response)

    const result = data.data?.deleteRun as DeleteRunResult | undefined
    if (!result) throw new Error('Unexpected response from Dagster')

    if (result.type === 'DeletePipelineRunSuccess' && result.runId) {
      return {
        success: true,
        output: { runId: result.runId },
      }
    }

    throw new Error(`${result.type}: ${dagsterUnionErrorMessage(result, 'Delete run failed')}`)
  },

  outputs: {
    runId: {
      type: 'string',
      description: 'The ID of the deleted run',
    },
  },
}
