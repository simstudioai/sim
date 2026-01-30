import type { PROperationParams, PullRequestResponse } from '@/tools/github/types'
import { BRANCH_REF_OUTPUT, PR_FILE_OUTPUT_PROPERTIES, USER_OUTPUT } from '@/tools/github/types'
import type { ToolConfig } from '@/tools/types'

export const prTool: ToolConfig<PROperationParams, PullRequestResponse> = {
  id: 'github_pr',
  name: 'GitHub PR Reader',
  description: 'Fetch PR details including diff and files changed',
  version: '1.0.0',

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
    pullNumber: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Pull request number',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
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

    const filesResponse = await fetch(
      `https://api.github.com/repos/${pr.base.repo.owner.login}/${pr.base.repo.name}/pulls/${pr.number}/files`
    )
    const files = await filesResponse.json()

    const content = `PR #${pr.number}: "${pr.title}" (${pr.state}) - Created: ${pr.created_at}, Updated: ${pr.updated_at}
Description: ${pr.body || 'No description'}
Files changed: ${files.length}
URL: ${pr.html_url}`

    return {
      success: true,
      output: {
        content,
        metadata: {
          number: pr.number,
          title: pr.title,
          state: pr.state,
          html_url: pr.html_url,
          diff_url: pr.diff_url,
          created_at: pr.created_at,
          updated_at: pr.updated_at,
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
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Human-readable PR summary' },
    metadata: {
      type: 'object',
      description: 'Detailed PR metadata including file changes',
      properties: {
        number: { type: 'number', description: 'Pull request number' },
        title: { type: 'string', description: 'PR title' },
        state: { type: 'string', description: 'PR state (open/closed/merged)' },
        html_url: { type: 'string', description: 'GitHub web URL' },
        diff_url: { type: 'string', description: 'Raw diff URL' },
        created_at: { type: 'string', description: 'Creation timestamp' },
        updated_at: { type: 'string', description: 'Last update timestamp' },
        files: {
          type: 'array',
          description: 'Files changed in the PR',
          items: {
            type: 'object',
            properties: {
              filename: { type: 'string', description: 'File path' },
              additions: { type: 'number', description: 'Lines added' },
              deletions: { type: 'number', description: 'Lines deleted' },
              changes: { type: 'number', description: 'Total changes' },
              patch: { type: 'string', description: 'File diff patch' },
              blob_url: { type: 'string', description: 'GitHub blob URL' },
              raw_url: { type: 'string', description: 'Raw file URL' },
              status: { type: 'string', description: 'Change type (added/modified/deleted)' },
            },
          },
        },
      },
    },
  },
}

export const prV2Tool: ToolConfig<PROperationParams, any> = {
  id: 'github_pr_v2',
  name: prTool.name,
  description: prTool.description,
  version: '2.0.0',
  params: prTool.params,
  request: prTool.request,

  transformResponse: async (response: Response) => {
    const pr = await response.json()

    // Fetch files changed
    const filesResponse = await fetch(
      `https://api.github.com/repos/${pr.base.repo.owner.login}/${pr.base.repo.name}/pulls/${pr.number}/files`
    )
    const files = await filesResponse.json()

    return {
      success: true,
      output: {
        id: pr.id,
        number: pr.number,
        title: pr.title,
        state: pr.state,
        html_url: pr.html_url,
        diff_url: pr.diff_url,
        body: pr.body ?? null,
        user: pr.user,
        head: pr.head,
        base: pr.base,
        merged: pr.merged,
        mergeable: pr.mergeable ?? null,
        merged_by: pr.merged_by ?? null,
        comments: pr.comments,
        review_comments: pr.review_comments,
        commits: pr.commits,
        additions: pr.additions,
        deletions: pr.deletions,
        changed_files: pr.changed_files,
        created_at: pr.created_at,
        updated_at: pr.updated_at,
        closed_at: pr.closed_at ?? null,
        merged_at: pr.merged_at ?? null,
        files: files ?? [],
      },
    }
  },

  outputs: {
    id: { type: 'number', description: 'Pull request ID' },
    number: { type: 'number', description: 'Pull request number' },
    title: { type: 'string', description: 'PR title' },
    state: { type: 'string', description: 'PR state (open/closed)' },
    html_url: { type: 'string', description: 'GitHub web URL' },
    diff_url: { type: 'string', description: 'Raw diff URL' },
    body: { type: 'string', description: 'PR description' },
    user: USER_OUTPUT,
    head: BRANCH_REF_OUTPUT,
    base: BRANCH_REF_OUTPUT,
    merged: { type: 'boolean', description: 'Whether PR is merged' },
    mergeable: { type: 'boolean', description: 'Whether PR is mergeable' },
    merged_by: USER_OUTPUT,
    comments: { type: 'number', description: 'Number of comments' },
    review_comments: { type: 'number', description: 'Number of review comments' },
    commits: { type: 'number', description: 'Number of commits' },
    additions: { type: 'number', description: 'Lines added' },
    deletions: { type: 'number', description: 'Lines deleted' },
    changed_files: { type: 'number', description: 'Number of changed files' },
    created_at: { type: 'string', description: 'Creation timestamp' },
    updated_at: { type: 'string', description: 'Last update timestamp' },
    closed_at: { type: 'string', description: 'Close timestamp' },
    merged_at: { type: 'string', description: 'Merge timestamp' },
    files: {
      type: 'array',
      description: 'Array of changed file objects',
      items: {
        type: 'object',
        properties: PR_FILE_OUTPUT_PROPERTIES,
      },
    },
  },
}
