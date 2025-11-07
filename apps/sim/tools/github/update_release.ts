import type { ReleaseResponse, UpdateReleaseParams } from '@/tools/github/types'
import type { ToolConfig } from '@/tools/types'

export const updateReleaseTool: ToolConfig<UpdateReleaseParams, ReleaseResponse> = {
  id: 'github_update_release',
  name: 'GitHub Update Release',
  description:
    'Update an existing GitHub release. Modify tag name, target commit, title, description, draft status, or prerelease status.',
  version: '1.0.0',

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
    release_id: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique identifier of the release',
    },
    tag_name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The name of the tag',
    },
    target_commitish: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Specifies the commitish value for where the tag is created from',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The name of the release',
    },
    body: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Text describing the contents of the release (markdown supported)',
    },
    draft: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'true to set as draft, false to publish',
    },
    prerelease: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'true to identify as a prerelease, false for a full release',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'GitHub Personal Access Token',
    },
  },

  request: {
    url: (params) =>
      `https://api.github.com/repos/${params.owner}/${params.repo}/releases/${params.release_id}`,
    method: 'PATCH',
    headers: (params) => ({
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${params.apiKey}`,
      'X-GitHub-Api-Version': '2022-11-28',
    }),
    body: (params) => {
      const body: any = {}

      if (params.tag_name) {
        body.tag_name = params.tag_name
      }
      if (params.target_commitish) {
        body.target_commitish = params.target_commitish
      }
      if (params.name !== undefined) {
        body.name = params.name
      }
      if (params.body !== undefined) {
        body.body = params.body
      }
      if (params.draft !== undefined) {
        body.draft = params.draft
      }
      if (params.prerelease !== undefined) {
        body.prerelease = params.prerelease
      }

      return body
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()

    const releaseType = data.draft ? 'Draft' : data.prerelease ? 'Prerelease' : 'Release'
    const content = `${releaseType} updated: "${data.name || data.tag_name}"
Tag: ${data.tag_name}
URL: ${data.html_url}
Last updated: ${data.updated_at || data.created_at}
${data.published_at ? `Published: ${data.published_at}` : 'Not yet published'}
Download URLs:
- Tarball: ${data.tarball_url}
- Zipball: ${data.zipball_url}`

    return {
      success: true,
      output: {
        content,
        metadata: {
          id: data.id,
          tag_name: data.tag_name,
          name: data.name || data.tag_name,
          html_url: data.html_url,
          tarball_url: data.tarball_url,
          zipball_url: data.zipball_url,
          draft: data.draft,
          prerelease: data.prerelease,
          created_at: data.created_at,
          published_at: data.published_at,
        },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Human-readable release update summary' },
    metadata: {
      type: 'object',
      description: 'Updated release metadata including download URLs',
      properties: {
        id: { type: 'number', description: 'Release ID' },
        tag_name: { type: 'string', description: 'Git tag name' },
        name: { type: 'string', description: 'Release name' },
        html_url: { type: 'string', description: 'GitHub web URL for the release' },
        tarball_url: { type: 'string', description: 'URL to download release as tarball' },
        zipball_url: { type: 'string', description: 'URL to download release as zipball' },
        draft: { type: 'boolean', description: 'Whether this is a draft release' },
        prerelease: { type: 'boolean', description: 'Whether this is a prerelease' },
        created_at: { type: 'string', description: 'Creation timestamp' },
        published_at: { type: 'string', description: 'Publication timestamp' },
      },
    },
  },
}
