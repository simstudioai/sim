import type { GitLabCreateReleaseParams, GitLabCreateReleaseResponse } from '@/tools/gitlab/types'
import { getGitLabApiBase } from '@/tools/gitlab/utils'
import type { ToolConfig } from '@/tools/types'

export const gitlabCreateReleaseTool: ToolConfig<
  GitLabCreateReleaseParams,
  GitLabCreateReleaseResponse
> = {
  id: 'gitlab_create_release',
  name: 'GitLab Create Release',
  description: 'Create a new release in a GitLab project',
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
    tagName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The Git tag for the release',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The release name',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Release description/notes (Markdown supported)',
    },
    ref: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Commit SHA, branch, or tag to create the tag from if it does not already exist',
    },
    releasedAt: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ISO 8601 date for an upcoming or historical release',
    },
    tagMessage: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Annotation message to use if creating a new annotated tag',
    },
    assetLinks: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Release asset links: array of objects with name, url, and optional link_type (other, runbook, image, package)',
    },
    milestones: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Array of milestone titles to associate with the release',
    },
  },

  request: {
    url: (params) => {
      const encodedId = encodeURIComponent(String(params.projectId).trim())
      return `${getGitLabApiBase(params.host)}/projects/${encodedId}/releases`
    },
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      'PRIVATE-TOKEN': params.accessToken,
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        tag_name: params.tagName,
      }

      if (params.tagMessage) body.tag_message = params.tagMessage
      if (params.assetLinks) {
        // Tolerate a single link object by wrapping it into the array GitLab expects.
        const links = Array.isArray(params.assetLinks) ? params.assetLinks : [params.assetLinks]
        if (links.length > 0) body.assets = { links }
      }

      if (params.name) body.name = params.name
      if (params.description) body.description = params.description
      if (params.ref) body.ref = params.ref
      if (params.releasedAt) body.released_at = params.releasedAt
      if (params.milestones && params.milestones.length > 0) body.milestones = params.milestones

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

    const release = await response.json()

    return {
      success: true,
      output: {
        release,
      },
    }
  },

  outputs: {
    release: {
      type: 'object',
      description: 'The created GitLab release',
    },
  },
}
