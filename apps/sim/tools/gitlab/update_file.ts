import type { GitLabUpdateFileParams, GitLabUpdateFileResponse } from '@/tools/gitlab/types'
import { getGitLabApiBase } from '@/tools/gitlab/utils'
import type { ToolConfig } from '@/tools/types'

export const gitlabUpdateFileTool: ToolConfig<GitLabUpdateFileParams, GitLabUpdateFileResponse> = {
  id: 'gitlab_update_file',
  name: 'GitLab Update File',
  description: 'Update an existing file in a GitLab project repository',
  version: '1.0.0',

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'GitLab Personal Access Token',
    },
    host: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Self-managed GitLab host (e.g. gitlab.example.com). Defaults to gitlab.com.',
    },
    projectId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Project ID or path (e.g. mygroup/myproject)',
    },
    filePath: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Path to the file in the repository',
    },
    branch: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Branch to commit the update to',
    },
    content: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'New file content',
    },
    startBranch: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Name of the base branch to create the target branch from, if it does not exist',
    },
    authorName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Commit author name (defaults to the token user)',
    },
    authorEmail: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Commit author email (defaults to the token user)',
    },
    executeFilemode: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Enable or disable the execute flag on the file',
    },
    commitMessage: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Commit message',
    },
    lastCommitId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Last known commit ID for the file (optimistic locking)',
    },
  },

  request: {
    url: (params) => {
      const encodedId = encodeURIComponent(String(params.projectId).trim())
      const encodedPath = encodeURIComponent(String(params.filePath))
      return `${getGitLabApiBase(params.host)}/projects/${encodedId}/repository/files/${encodedPath}`
    },
    method: 'PUT',
    headers: (params) => ({
      'Content-Type': 'application/json',
      'PRIVATE-TOKEN': params.accessToken,
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        branch: params.branch,
        content: params.content,
        commit_message: params.commitMessage,
        encoding: 'text',
      }

      if (params.lastCommitId) body.last_commit_id = params.lastCommitId
      if (params.startBranch) body.start_branch = params.startBranch
      if (params.authorName) body.author_name = params.authorName
      if (params.authorEmail) body.author_email = params.authorEmail
      if (params.executeFilemode !== undefined) body.execute_filemode = params.executeFilemode

      return body
    },
  },

  transformResponse: async (response) => {
    if (!response.ok) {
      const errorText = await response.text()
      return {
        success: false,
        error: `GitLab API error: ${response.status} ${errorText}`,
        output: {},
      }
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        filePath: data.file_path ?? null,
        branch: data.branch ?? null,
      },
    }
  },

  outputs: {
    filePath: {
      type: 'string',
      description: 'The updated file path',
    },
    branch: {
      type: 'string',
      description: 'The branch the update was committed to',
    },
  },
}
