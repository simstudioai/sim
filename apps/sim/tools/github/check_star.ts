import { isRecordLike } from '@sim/utils/object'
import { GITHUB_GRAPHQL_URL, githubGraphQlHeaders, readGraphQlData } from '@/tools/github/graphql'
import { GITHUB_CREDENTIAL_OAUTH } from '@/tools/shared/saved-credentials'
import type { ToolConfig } from '@/tools/types'

interface CheckStarParams {
  owner: string
  repo: string
  apiKey: string
}

interface CheckStarResponse {
  success: boolean
  output: {
    content: string
    metadata: {
      starred: boolean
      owner: string
      repo: string
    }
  }
}

/**
 * Asks GraphQL rather than REST: `GET /user/starred/{owner}/{repo}` answers "not
 * starred" with a 404, and the executor fails every non-2xx response before a
 * transform runs, so the REST form could only ever report `starred: true`.
 */
const VIEWER_HAS_STARRED_QUERY = `
  query($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      viewerHasStarred
    }
  }
`

async function readViewerHasStarred(response: Response): Promise<boolean> {
  const data = await readGraphQlData(response, 'GitHub check star')
  const repository = data.repository
  if (!isRecordLike(repository)) {
    throw new Error('GitHub check star: repository not found')
  }
  if (typeof repository.viewerHasStarred !== 'boolean') {
    throw new Error('GitHub check star: viewerHasStarred must be a boolean')
  }
  return repository.viewerHasStarred
}

export const checkStarTool: ToolConfig<CheckStarParams, CheckStarResponse> = {
  id: 'github_check_star',
  name: 'GitHub Check Star',
  description: 'Check if you have starred a repository',
  version: '1.0.0',
  oauth: GITHUB_CREDENTIAL_OAUTH,

  params: {
    owner: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Repository owner',
    },
    repo: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Repository name',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'GitHub API token',
    },
  },

  request: {
    url: GITHUB_GRAPHQL_URL,
    method: 'POST',
    headers: (params) => githubGraphQlHeaders(params.apiKey),
    body: (params) => ({
      query: VIEWER_HAS_STARRED_QUERY,
      variables: { owner: params.owner, name: params.repo },
    }),
  },

  transformResponse: async (response, params) => {
    const starred = await readViewerHasStarred(response)

    return {
      success: true,
      output: {
        content: starred
          ? `You have starred ${params?.owner}/${params?.repo}`
          : `You have not starred ${params?.owner}/${params?.repo}`,
        metadata: {
          starred,
          owner: params?.owner ?? '',
          repo: params?.repo ?? '',
        },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Human-readable result' },
    metadata: {
      type: 'object',
      description: 'Check star metadata',
      properties: {
        starred: { type: 'boolean', description: 'Whether you have starred the repo' },
        owner: { type: 'string', description: 'Repository owner' },
        repo: { type: 'string', description: 'Repository name' },
      },
    },
  },
}

export const checkStarV2Tool: ToolConfig<CheckStarParams, any> = {
  id: 'github_check_star_v2',
  name: checkStarTool.name,
  description: checkStarTool.description,
  version: '2.0.0',
  oauth: GITHUB_CREDENTIAL_OAUTH,
  params: checkStarTool.params,
  request: checkStarTool.request,

  transformResponse: async (response: Response, params) => {
    const starred = await readViewerHasStarred(response)
    return {
      success: true,
      output: {
        starred,
        owner: params?.owner ?? '',
        repo: params?.repo ?? '',
      },
    }
  },

  outputs: {
    starred: { type: 'boolean', description: 'Whether you have starred the repo' },
    owner: { type: 'string', description: 'Repository owner' },
    repo: { type: 'string', description: 'Repository name' },
  },
}
