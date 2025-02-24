import { ToolConfig } from '../types'
import { PROperationParams, PullRequestResponse } from './types'

export const prTool: ToolConfig<PROperationParams, PullRequestResponse> = {
  id: 'github_pr',
  name: 'GitHub PR Reader',
  description: 'Fetch PR details including diff and files changed',
  version: '1.0.0',

  params: {
    owner: {
      type: 'string',
      required: true,
      description: 'Repository owner',
    },
    repo: {
      type: 'string',
      required: true,
      description: 'Repository name',
    },
    pullNumber: {
      type: 'number',
      required: true,
      description: 'Pull request number',
    },
    apiKey: {
      type: 'string',
      required: true,
      requiredForToolCall: true,
      description: 'GitHub API token',
    },
  },

  request: {
    url: (params) =>
      `https://api.github.com/repos/${params.owner}/${params.repo}/pulls/${params.pullNumber}`,
    method: 'GET',
    headers: (params) => ({
      Accept: 'application/vnd.github.v3+json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response) => {
    const pr = await response.json()

    // Fetch the PR diff
    const diffResponse = await fetch(pr.diff_url)
    const diff = await diffResponse.text()

    // Fetch files changed
    const filesResponse = await fetch(
      `https://api.github.com/repos/${pr.base.repo.owner.login}/${pr.base.repo.name}/pulls/${pr.number}/files`
    )
    const files = await filesResponse.json()

    return {
      success: true,
      output: {
        number: pr.number,
        title: pr.title,
        body: pr.body || '',
        state: pr.state,
        html_url: pr.html_url,
        diff_url: pr.diff_url,
        created_at: pr.created_at,
        updated_at: pr.updated_at,
        diff,
        files: files.map((file: any) => ({
          filename: file.filename,
          additions: file.additions,
          deletions: file.deletions,
          changes: file.changes,
          patch: file.patch,
          blob_url: file.blob_url,
          raw_url: file.raw_url,
          status: file.status,
        })),
      },
    }
  },

  transformError: (error) => {
    return error instanceof Error ? error.message : 'Failed to fetch PR details'
  },
}
