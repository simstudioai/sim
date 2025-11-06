import type { GetReleaseParams, ReleaseResponse } from '@/tools/github/types'
import type { ToolConfig } from '@/tools/types'

export const getReleaseTool: ToolConfig<GetReleaseParams, ReleaseResponse> = {
  id: 'github_get_release',
  name: 'GitHub Get Release',
  description:
    'Get detailed information about a specific GitHub release by ID. Returns release metadata including assets and download URLs.',
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
    method: 'GET',
    headers: (params) => ({
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${params.apiKey}`,
      'X-GitHub-Api-Version': '2022-11-28',
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    const releaseType = data.draft ? 'Draft' : data.prerelease ? 'Prerelease' : 'Release'
    const assetsInfo =
      data.assets && data.assets.length > 0
        ? `\n\nAssets (${data.assets.length}):\n${data.assets.map((asset: any) => `- ${asset.name} (${asset.size} bytes, downloaded ${asset.download_count} times)`).join('\n')}`
        : '\n\nNo assets attached'

    const content = `${releaseType}: "${data.name || data.tag_name}"
Tag: ${data.tag_name}
Author: ${data.author?.login || 'Unknown'}
Created: ${data.created_at}
${data.published_at ? `Published: ${data.published_at}` : 'Not yet published'}
URL: ${data.html_url}

Description:
${data.body || 'No description provided'}

Download URLs:
- Tarball: ${data.tarball_url}
- Zipball: ${data.zipball_url}${assetsInfo}`

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
    content: { type: 'string', description: 'Human-readable release details' },
    metadata: {
      type: 'object',
      description: 'Release metadata including download URLs',
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
