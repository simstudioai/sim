import type { GitLabGetFileParams, GitLabGetFileResponse } from '@/tools/gitlab/types'
import { getGitLabApiBase } from '@/tools/gitlab/utils'
import type { ToolConfig } from '@/tools/types'

export const gitlabGetFileTool: ToolConfig<GitLabGetFileParams, GitLabGetFileResponse> = {
  id: 'gitlab_get_file',
  name: 'GitLab Get File',
  description: 'Get the contents of a file from a GitLab project repository',
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
    ref: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Branch, tag, or commit SHA',
    },
  },

  request: {
    url: (params) => {
      const encodedId = encodeURIComponent(String(params.projectId).trim())
      const encodedPath = encodeURIComponent(String(params.filePath))
      const ref = encodeURIComponent(String(params.ref))
      return `${getGitLabApiBase(params.host)}/projects/${encodedId}/repository/files/${encodedPath}?ref=${ref}`
    },
    method: 'GET',
    headers: (params) => ({
      'PRIVATE-TOKEN': params.accessToken,
    }),
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
    const decoded = Buffer.from(data.content ?? '', 'base64').toString('utf-8')
    // Repository blobs can be hundreds of MB; cap what flows into the workflow
    // payload so a huge file cannot blow up the execution log.
    const maxContentChars = 1_000_000
    const truncated = decoded.length > maxContentChars

    return {
      success: true,
      output: {
        filePath: data.file_path ?? null,
        fileName: data.file_name ?? null,
        size: data.size ?? null,
        ref: data.ref ?? null,
        blobId: data.blob_id ?? null,
        lastCommitId: data.last_commit_id ?? null,
        content: truncated ? decoded.slice(0, maxContentChars) : decoded,
        truncated,
      },
    }
  },

  outputs: {
    filePath: {
      type: 'string',
      description: 'The file path',
    },
    fileName: {
      type: 'string',
      description: 'The file name',
    },
    size: {
      type: 'number',
      description: 'The file size in bytes',
    },
    ref: {
      type: 'string',
      description: 'The branch, tag, or commit SHA',
    },
    blobId: {
      type: 'string',
      description: 'The blob ID',
    },
    lastCommitId: {
      type: 'string',
      description: 'The last commit ID that modified the file',
    },
    content: {
      type: 'string',
      description: 'The decoded file content, truncated to 1M characters',
    },
    truncated: {
      type: 'boolean',
      description: 'Whether the content was truncated',
    },
  },
}
