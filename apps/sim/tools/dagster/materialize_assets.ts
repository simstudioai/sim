import type {
  DagsterMaterializeAssetsParams,
  DagsterMaterializeAssetsResponse,
} from '@/tools/dagster/types'
import {
  dagsterGraphqlUrl,
  dagsterRequestHeaders,
  dagsterUnionErrorMessage,
  parseAssetSelection,
  parseDagsterGraphqlResponse,
} from '@/tools/dagster/utils'
import type { ToolConfig } from '@/tools/types'

interface MaterializeAssetsResult {
  type: string
  run?: { runId: string }
  message?: string
  errors?: Array<{ message: string }>
}

function buildMaterializeMutation(hasTags: boolean) {
  const varDefs = [
    '$repositoryLocationName: String!',
    '$repositoryName: String!',
    '$jobName: String!',
    '$assetSelection: [AssetKeyInput!]',
  ]
  if (hasTags) varDefs.push('$tags: [ExecutionTag!]')

  const execParams = [
    `selector: {
          repositoryLocationName: $repositoryLocationName
          repositoryName: $repositoryName
          jobName: $jobName
          assetSelection: $assetSelection
        }`,
  ]
  if (hasTags) execParams.push('executionMetadata: { tags: $tags }')

  return `
    mutation MaterializeAssets(${varDefs.join(', ')}) {
      launchRun(
        executionParams: {
          ${execParams.join('\n          ')}
        }
      ) {
        type: __typename
        ... on LaunchRunSuccess {
          run {
            runId
          }
        }
        ... on RunConfigValidationInvalid {
          errors {
            message
          }
        }
        ... on PipelineNotFoundError {
          message
        }
        ... on InvalidSubsetError {
          message
        }
        ... on UnauthorizedError {
          message
        }
        ... on ConflictingExecutionParamsError {
          message
        }
        ... on PresetNotFoundError {
          message
        }
        ... on RunConflict {
          message
        }
        ... on PythonError {
          message
        }
      }
    }
  `
}

export const materializeAssetsTool: ToolConfig<
  DagsterMaterializeAssetsParams,
  DagsterMaterializeAssetsResponse
> = {
  id: 'dagster_materialize_assets',
  name: 'Dagster Materialize Assets',
  description: 'Materialize selected assets by launching their asset job with an asset selection.',
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
    repositoryLocationName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Repository location (code location) name',
    },
    repositoryName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Repository name within the code location',
    },
    jobName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Asset job that contains the assets, e.g. "__ASSET_JOB" or a named asset job',
    },
    assetSelection: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Comma- or newline-separated asset keys to materialize, each slash-delimited (e.g. "raw/events, summary")',
    },
    tags: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Tags as a JSON array of {key, value} objects (optional)',
    },
  },

  request: {
    url: (params) => dagsterGraphqlUrl(params.host),
    method: 'POST',
    headers: (params) => dagsterRequestHeaders(params),
    body: (params) => {
      const assetSelection = parseAssetSelection(params.assetSelection)
      if (assetSelection.length === 0) {
        throw new Error('assetSelection must contain at least one asset key')
      }

      const variables: Record<string, unknown> = {
        repositoryLocationName: params.repositoryLocationName,
        repositoryName: params.repositoryName,
        jobName: params.jobName,
        assetSelection,
      }

      let hasTags = false
      if (params.tags) {
        try {
          variables.tags = JSON.parse(params.tags)
          hasTags = true
        } catch {
          throw new Error('Invalid JSON in tags')
        }
      }

      return { query: buildMaterializeMutation(hasTags), variables }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await parseDagsterGraphqlResponse<{ launchRun?: unknown }>(response)

    const result = data.data?.launchRun as MaterializeAssetsResult | undefined
    if (!result) throw new Error('Unexpected response from Dagster')

    if (result.type === 'LaunchRunSuccess' && result.run) {
      return {
        success: true,
        output: { runId: result.run.runId },
      }
    }

    if (result.type === 'RunConfigValidationInvalid' && result.errors?.length) {
      throw new Error(
        `RunConfigValidationInvalid: ${result.errors.map((e) => e.message).join('; ')}`
      )
    }

    throw new Error(
      `${result.type}: ${dagsterUnionErrorMessage(result, 'Materialize assets failed')}`
    )
  },

  outputs: {
    runId: {
      type: 'string',
      description: 'The globally unique ID of the launched materialization run',
    },
  },
}
