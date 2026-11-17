import {
  COMMIT_DATA_OUTPUT,
  COMMIT_DATA_OUTPUT_PROPERTIES,
  type LatestCommitParams,
  type LatestCommitResponse,
  USER_FULL_OUTPUT,
} from '@/tools/github/types'
import { GITHUB_CREDENTIAL_OAUTH } from '@/tools/shared/saved-credentials'
import type { InternalToolConfig } from '@/tools/types'

export const latestCommitTool: InternalToolConfig<LatestCommitParams, LatestCommitResponse> = {
  id: 'github_latest_commit',
  name: 'GitHub Latest Commit',
  description: 'Retrieve the latest commit from a GitHub repository',
  version: '1.0.0',
  oauth: GITHUB_CREDENTIAL_OAUTH,

  params: {
    owner: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Repository owner (user or organization)',
    },
    repo: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Repository name',
    },
    branch: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "Branch name (defaults to the repository's default branch)",
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'GitHub API token',
    },
  },

  operation: {
    input: (params) => ({
      owner: params.owner,
      repo: params.repo,
      branch: params.branch,
      apiKey: params.apiKey,
    }),
  },

  outputs: {
    content: { type: 'string', description: 'Human-readable commit summary' },
    metadata: {
      type: 'object',
      description: 'Commit metadata',
    },
  },
}

export const latestCommitV2Tool: InternalToolConfig = {
  id: 'github_latest_commit_v2',
  name: latestCommitTool.name,
  description: latestCommitTool.description,
  version: '2.0.0',
  params: latestCommitTool.params,
  operation: latestCommitTool.operation,
  oauth: latestCommitTool.oauth,
  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error || 'Failed to fetch latest commit')
    }
    const metadata = data.output?.metadata ?? {}
    return {
      success: true,
      output: {
        sha: metadata.sha ?? '',
        html_url: metadata.html_url ?? '',
        commit: {
          url: metadata.commit_url ?? null,
          message: metadata.commit_message ?? '',
          comment_count: metadata.comment_count ?? null,
          author: metadata.author ?? null,
          committer: metadata.committer ?? null,
          tree: metadata.tree ?? null,
          verification: metadata.verification ?? null,
        },
        author: metadata.author ?? null,
        committer: metadata.committer ?? null,
      },
    }
  },
  outputs: {
    sha: { type: 'string', description: 'Commit SHA' },
    html_url: { type: 'string', description: 'GitHub web URL' },
    commit: {
      ...COMMIT_DATA_OUTPUT,
      properties: {
        ...COMMIT_DATA_OUTPUT_PROPERTIES,
        url: { ...COMMIT_DATA_OUTPUT_PROPERTIES.url, nullable: true },
        comment_count: { ...COMMIT_DATA_OUTPUT_PROPERTIES.comment_count, nullable: true },
        author: { ...COMMIT_DATA_OUTPUT_PROPERTIES.author, nullable: true },
        committer: { ...COMMIT_DATA_OUTPUT_PROPERTIES.committer, nullable: true },
        tree: { ...COMMIT_DATA_OUTPUT_PROPERTIES.tree, nullable: true },
        verification: { ...COMMIT_DATA_OUTPUT_PROPERTIES.verification, nullable: true },
      },
    },
    author: { ...USER_FULL_OUTPUT, nullable: true },
    committer: { ...USER_FULL_OUTPUT, nullable: true },
  },
}
