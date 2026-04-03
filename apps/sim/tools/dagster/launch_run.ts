import type { DagsterLaunchRunParams, DagsterLaunchRunResponse } from '@/tools/dagster/types'
import type { ToolConfig } from '@/tools/types'

interface LaunchRunResult {
  type: string
  run?: { runId: string }
  message?: string
}

function buildLaunchRunMutation(hasConfig: boolean, hasTags: boolean) {
  const varDefs = [
    '$repositoryLocationName: String!',
    '$repositoryName: String!',
    '$jobName: String!',
  ]
  if (hasConfig) varDefs.push('$runConfigData: RunConfigData')
  if (hasTags) varDefs.push('$tags: [ExecutionTag!]')

  const execParams = [
    `selector: {
          repositoryLocationName: $repositoryLocationName
          repositoryName: $repositoryName
          jobName: $jobName
        }`,
  ]
  if (hasConfig) execParams.push('runConfigData: $runConfigData')
  if (hasTags) execParams.push('executionMetadata: { tags: $tags }')

  return `
    mutation LaunchRun(${varDefs.join(', ')}) {
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
        ... on Error {
          message
        }
      }
    }
  `
}

export const launchRunTool: ToolConfig<DagsterLaunchRunParams, DagsterLaunchRunResponse> = {
  id: 'dagster_launch_run',
  name: 'Dagster Launch Run',
  description: 'Launch a job run on a Dagster instance.',
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
      description: 'Name of the job to launch',
    },
    runConfigJson: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Run configuration as a JSON object (optional)',
    },
    tags: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Tags as a JSON array of {key, value} objects (optional)',
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
      const variables: Record<string, unknown> = {
        repositoryLocationName: params.repositoryLocationName,
        repositoryName: params.repositoryName,
        jobName: params.jobName,
      }

      let hasConfig = false
      if (params.runConfigJson) {
        try {
          variables.runConfigData = JSON.parse(params.runConfigJson)
          hasConfig = true
        } catch {
          throw new Error('Invalid JSON in runConfigJson')
        }
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

      return {
        query: buildLaunchRunMutation(hasConfig, hasTags),
        variables,
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.errors?.[0]?.message || 'Dagster GraphQL request failed')
    }

    if (data.errors?.length) {
      throw new Error(data.errors[0].message)
    }

    const result = data.data?.launchRun as LaunchRunResult | undefined
    if (!result) throw new Error('Unexpected response from Dagster')

    if (result.type === 'LaunchRunSuccess' && result.run) {
      return {
        success: true,
        output: { runId: result.run.runId },
      }
    }

    throw new Error(`${result.type}: ${result.message ?? 'Launch run failed'}`)
  },

  outputs: {
    runId: {
      type: 'string',
      description: 'The globally unique ID of the launched run',
    },
  },
}
