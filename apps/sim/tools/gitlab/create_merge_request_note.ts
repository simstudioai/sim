import type {
  GitLabCreateMergeRequestNoteParams,
  GitLabCreateNoteResponse,
} from '@/tools/gitlab/types'
import type { ToolConfig } from '@/tools/types'

export const gitlabCreateMergeRequestNoteTool: ToolConfig<
  GitLabCreateMergeRequestNoteParams,
  GitLabCreateNoteResponse
> = {
  id: 'gitlab_create_merge_request_note',
  name: 'GitLab Create Merge Request Comment',
  description: 'Add a comment to a GitLab merge request',
  version: '1.0.0',

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'GitLab Personal Access Token',
    },
    projectId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Project ID or URL-encoded path',
    },
    mergeRequestIid: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Merge request internal ID (IID)',
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
      const encodedId = encodeURIComponent(String(params.projectId))
      return `https://gitlab.com/api/v4/projects/${encodedId}/merge_requests/${params.mergeRequestIid}/notes`
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
