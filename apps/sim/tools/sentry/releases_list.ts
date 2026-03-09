import type { SentryListReleasesParams, SentryListReleasesResponse } from '@/tools/sentry/types'
import type { ToolConfig } from '@/tools/types'

export const listReleasesTool: ToolConfig<SentryListReleasesParams, SentryListReleasesResponse> = {
  id: 'sentry_releases_list',
  name: 'List Releases',
  description:
    'List releases for a Sentry organization or project. Returns release details including version, commits, deploy information, and associated projects.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Sentry API authentication token',
    },
    organizationSlug: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The slug of the organization (e.g., "my-org")',
    },
    projectSlug: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter releases by specific project slug (e.g., "my-project")',
    },
    query: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search query to filter releases (e.g., "1.0" to match version patterns)',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor for retrieving next page of results',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of releases to return per page (default: 25, max: 100)',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = `https://sentry.io/api/0/organizations/${params.organizationSlug}/releases/`
      const queryParams: string[] = []

      if (params.projectSlug && params.projectSlug !== null && params.projectSlug !== '') {
        queryParams.push(`project=${encodeURIComponent(params.projectSlug)}`)
      }

      if (params.query && params.query !== null && params.query !== '') {
        queryParams.push(`query=${encodeURIComponent(params.query)}`)
      }

      if (params.cursor && params.cursor !== null && params.cursor !== '') {
        queryParams.push(`cursor=${encodeURIComponent(params.cursor)}`)
      }

      if (params.limit && params.limit !== null) {
        queryParams.push(`limit=${Number(params.limit)}`)
      }

      return queryParams.length > 0 ? `${baseUrl}?${queryParams.join('&')}` : baseUrl
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    // Extract pagination info from Link header
    const linkHeader = response.headers.get('Link')
    let nextCursor: string | undefined
    let hasMore = false

    if (linkHeader) {
      const nextMatch = linkHeader.match(
        /<[^>]*cursor=([^&>]+)[^>]*>;\s*rel="next";\s*results="true"/
      )
      if (nextMatch) {
        nextCursor = decodeURIComponent(nextMatch[1])
        hasMore = true
      }
    }

    return {
      success: true,
      output: {
        releases: data.map((release: any) => ({
          id: release.id,
          version: release.version,
          shortVersion: release.shortVersion,
          ref: release.ref ?? null,
          url: release.url ?? null,
          dateReleased: release.dateReleased ?? null,
          dateCreated: release.dateCreated,
          dateStarted: release.dateStarted ?? null,
          data: release.data || {},
          newGroups: release.newGroups || 0,
          owner: release.owner
            ? {
                id: release.owner.id,
                name: release.owner.name,
                email: release.owner.email,
              }
            : null,
          commitCount: release.commitCount || 0,
          lastCommit: release.lastCommit
            ? {
                id: release.lastCommit.id,
                message: release.lastCommit.message,
                dateCreated: release.lastCommit.dateCreated,
              }
            : null,
          deployCount: release.deployCount || 0,
          lastDeploy: release.lastDeploy
            ? {
                id: release.lastDeploy.id,
                environment: release.lastDeploy.environment,
                dateStarted: release.lastDeploy.dateStarted,
                dateFinished: release.lastDeploy.dateFinished,
              }
            : null,
          authors:
            release.authors?.map((author: any) => ({
              id: author.id,
              name: author.name,
              email: author.email,
            })) || [],
          projects:
            release.projects?.map((project: any) => ({
              id: project.id,
              name: project.name,
              slug: project.slug,
              platform: project.platform,
            })) || [],
          firstEvent: release.firstEvent ?? null,
          lastEvent: release.lastEvent ?? null,
          versionInfo: {
            buildHash: release.versionInfo?.buildHash || null,
            version: {
              raw: release.versionInfo?.version?.raw || release.version,
            },
            package: release.versionInfo?.package || null,
          },
        })),
        metadata: {
          nextCursor,
          hasMore,
        },
      },
    }
  },

  outputs: {
    releases: {
      type: 'array',
      description: 'List of Sentry releases',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Unique release ID' },
          version: { type: 'string', description: 'Release version identifier' },
          shortVersion: { type: 'string', description: 'Shortened version identifier' },
          ref: {
            type: 'string',
            description: 'Git reference (commit SHA, tag, or branch)',
            optional: true,
          },
          url: {
            type: 'string',
            description: 'URL to the release (e.g., GitHub release page)',
            optional: true,
          },
          dateReleased: {
            type: 'string',
            description: 'When the release was deployed (ISO timestamp)',
            optional: true,
          },
          dateCreated: {
            type: 'string',
            description: 'When the release was created (ISO timestamp)',
          },
          dateStarted: {
            type: 'string',
            description: 'When the release started (ISO timestamp)',
            optional: true,
          },
          newGroups: {
            type: 'number',
            description: 'Number of new issues introduced in this release',
          },
          owner: {
            type: 'object',
            description: 'Owner of the release',
            properties: {
              id: { type: 'string', description: 'User ID' },
              name: { type: 'string', description: 'User name' },
              email: { type: 'string', description: 'User email' },
            },
          },
          commitCount: { type: 'number', description: 'Number of commits in this release' },
          deployCount: { type: 'number', description: 'Number of deploys for this release' },
          lastCommit: {
            type: 'object',
            description: 'Last commit in the release',
            properties: {
              id: { type: 'string', description: 'Commit SHA' },
              message: { type: 'string', description: 'Commit message' },
              dateCreated: { type: 'string', description: 'Commit timestamp' },
            },
          },
          lastDeploy: {
            type: 'object',
            description: 'Last deploy of the release',
            properties: {
              id: { type: 'string', description: 'Deploy ID' },
              environment: { type: 'string', description: 'Deploy environment' },
              dateStarted: { type: 'string', description: 'Deploy start timestamp' },
              dateFinished: { type: 'string', description: 'Deploy finish timestamp' },
            },
          },
          authors: {
            type: 'array',
            description: 'Authors of commits in the release',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Author ID' },
                name: { type: 'string', description: 'Author name' },
                email: { type: 'string', description: 'Author email' },
              },
            },
          },
          projects: {
            type: 'array',
            description: 'Projects associated with this release',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Project ID' },
                name: { type: 'string', description: 'Project name' },
                slug: { type: 'string', description: 'Project slug' },
                platform: { type: 'string', description: 'Project platform' },
              },
            },
          },
          firstEvent: { type: 'string', description: 'First event timestamp', optional: true },
          lastEvent: { type: 'string', description: 'Last event timestamp', optional: true },
          versionInfo: {
            type: 'object',
            description: 'Version metadata',
            properties: {
              buildHash: { type: 'string', description: 'Build hash' },
              version: {
                type: 'object',
                description: 'Version details',
                properties: {
                  raw: { type: 'string', description: 'Raw version string' },
                },
              },
              package: { type: 'string', description: 'Package name' },
            },
          },
        },
      },
    },
    metadata: {
      type: 'object',
      description: 'Pagination metadata',
      properties: {
        nextCursor: {
          type: 'string',
          description: 'Cursor for the next page of results (if available)',
        },
        hasMore: {
          type: 'boolean',
          description: 'Whether there are more results available',
        },
      },
    },
  },
}
