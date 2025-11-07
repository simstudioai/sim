import type { ListReleasesParams, ListReleasesResponse } from '@/tools/github/types'
import type { ToolConfig } from '@/tools/types'

export const listReleasesTool: ToolConfig<ListReleasesParams, ListReleasesResponse> = {
  id: 'github_list_releases',
  name: 'GitHub List Releases',
  description:
    'List all releases for a GitHub repository. Returns release information including tags, names, and download URLs.',
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
    per_page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results per page (max 100)',
      default: 30,
    },
    page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page number of the results to fetch',
      default: 1,
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'GitHub Personal Access Token',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(`https://api.github.com/repos/${params.owner}/${params.repo}/releases`)
      if (params.per_page) {
        url.searchParams.append('per_page', Number(params.per_page).toString())
      }
      if (params.page) {
        url.searchParams.append('page', Number(params.page).toString())
      }
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${params.apiKey}`,
      'X-GitHub-Api-Version': '2022-11-28',
    }),
  },

  transformResponse: async (response) => {
    const releases = await response.json()

    const totalReleases = releases.length
    const releasesList = releases
      .map(
        (release: any, index: number) =>
          `${index + 1}. ${release.name || release.tag_name} (${release.tag_name})
   ${release.draft ? '[DRAFT] ' : ''}${release.prerelease ? '[PRERELEASE] ' : ''}
   Published: ${release.published_at || 'Not published'}
   URL: ${release.html_url}`
      )
      .join('\n\n')

    const content = `Total releases: ${totalReleases}

${releasesList}

Summary of tags: ${releases.map((r: any) => r.tag_name).join(', ')}`

    return {
      success: true,
      output: {
        content,
        metadata: {
          total_count: totalReleases,
          releases: releases.map((release: any) => ({
            id: release.id,
            tag_name: release.tag_name,
            name: release.name || release.tag_name,
            html_url: release.html_url,
            tarball_url: release.tarball_url,
            zipball_url: release.zipball_url,
            draft: release.draft,
            prerelease: release.prerelease,
            created_at: release.created_at,
            published_at: release.published_at,
          })),
        },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Human-readable list of releases with summary' },
    metadata: {
      type: 'object',
      description: 'Releases metadata',
      properties: {
        total_count: { type: 'number', description: 'Total number of releases returned' },
        releases: {
          type: 'array',
          description: 'Array of release objects',
          items: {
            type: 'object',
            properties: {
              id: { type: 'number', description: 'Release ID' },
              tag_name: { type: 'string', description: 'Git tag name' },
              name: { type: 'string', description: 'Release name' },
              html_url: { type: 'string', description: 'GitHub web URL' },
              tarball_url: { type: 'string', description: 'Tarball download URL' },
              zipball_url: { type: 'string', description: 'Zipball download URL' },
              draft: { type: 'boolean', description: 'Is draft release' },
              prerelease: { type: 'boolean', description: 'Is prerelease' },
              created_at: { type: 'string', description: 'Creation timestamp' },
              published_at: { type: 'string', description: 'Publication timestamp' },
            },
          },
        },
      },
    },
  },
}
