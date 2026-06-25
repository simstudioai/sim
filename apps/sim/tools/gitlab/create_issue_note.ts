import type { GitLabCreateIssueNoteParams, GitLabCreateNoteResponse } from '@/tools/gitlab/types'
import { getGitLabApiBase } from '@/tools/gitlab/utils'
import type { ToolConfig } from '@/tools/types'

export const gitlabCreateIssueNoteTool: ToolConfig<
  GitLabCreateIssueNoteParams,
  GitLabCreateNoteResponse
> = {
  id: 'gitlab_create_issue_note',
  name: 'GitLab Create Issue Comment',
  description: 'Add a comment to a GitLab issue',
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
      description: 'Project ID or URL-encoded path',
    },
    issueIid: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Issue internal ID (IID)',
    },
    body: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comment body (Markdown supported)',
    },
  },

  request: {
    url: (params) => {
      const encodedId = encodeURIComponent(String(params.projectId).trim())
      return `${getGitLabApiBase(params.host)}/projects/${encodedId}/issues/${params.issueIid}/notes`
    },
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      'PRIVATE-TOKEN': params.accessToken,
    }),
    body: (params) => ({
      body: params.body,
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

    const note = await response.json()

    return {
      success: true,
      output: {
        note,
      },
    }
  },

  outputs: {
    note: {
      type: 'object',
      description: 'The created comment',
    },
  },
}
