import type { DagsterBaseParams, DagsterListJobsResponse } from '@/tools/dagster/types'
import { dagsterUnionErrorMessage, parseDagsterGraphqlResponse } from '@/tools/dagster/utils'
import type { ToolConfig } from '@/tools/types'

const LIST_JOBS_QUERY = `
  query ListJobNames {
    repositoriesOrError {
      ... on RepositoryConnection {
        nodes {
          name
          jobs {
            name
          }
        }
      }
      ... on RepositoryNotFoundError {
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

export const listJobsTool: ToolConfig<DagsterBaseParams, DagsterListJobsResponse> = {
  id: 'dagster_list_jobs',
  name: 'Dagster List Jobs',
  description: 'List all jobs across repositories in a Dagster instance.',
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
  },

  request: {
    url: (params) => `${params.host.replace(/\/$/, '')}/graphql`,
    method: 'POST',
    headers: (params) => {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (params.apiKey) headers['Dagster-Cloud-Api-Token'] = params.apiKey
      return headers
    },
    body: () => ({
      query: LIST_JOBS_QUERY,
      variables: {},
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await parseDagsterGraphqlResponse<{ repositoriesOrError?: unknown }>(response)

    const result = data.data?.repositoriesOrError as
      | { nodes?: Array<{ name: string; jobs?: Array<{ name: string }> }>; message?: string }
      | undefined
    if (!result) throw new Error('Unexpected response from Dagster')

    if (!Array.isArray(result.nodes)) {
      throw new Error(dagsterUnionErrorMessage(result, 'List jobs failed'))
    }

    const jobs: Array<{ name: string; repositoryName: string }> = []

    for (const repo of result.nodes) {
      for (const job of repo.jobs ?? []) {
        jobs.push({
          name: job.name,
          repositoryName: repo.name,
        })
      }
    }

    return {
      success: true,
      output: { jobs },
    }
  },

  outputs: {
    jobs: {
      type: 'json',
      description: 'Array of jobs with name and repositoryName',
      properties: {
        name: { type: 'string', description: 'Job name' },
        repositoryName: { type: 'string', description: 'Repository name' },
      },
    },
  },
}
