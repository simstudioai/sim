import type { SentryCreateReleaseParams, SentryCreateReleaseResponse } from '@/tools/sentry/types'
import type { ToolConfig } from '@/tools/types'

export const createReleaseTool: ToolConfig<SentryCreateReleaseParams, SentryCreateReleaseResponse> =
  {
    id: 'sentry_releases_create',
    name: 'Create Release',
    description:
      'Create a new release in Sentry. A release is a version of your code deployed to an environment. Can include commit information and associated projects. Returns the created release details.',
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
      version: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description:
          'Version identifier for the release (e.g., "2.0.0", "my-app@1.0.0", or a git commit SHA)',
      },
      projects: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Comma-separated list of project slugs to associate with this release',
      },
      ref: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Git reference (commit SHA, tag, or branch) for this release',
      },
      url: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'URL pointing to the release (e.g., GitHub release page)',
      },
      dateReleased: {
        type: 'string',
        required: false,
        visibility: 'user-only',
        description:
          'ISO 8601 timestamp for when the release was deployed (defaults to current time)',
      },
      commits: {
        type: 'string',
        required: false,
        visibility: 'user-only',
        description:
          'JSON array of commit objects with id, repository (optional), and message (optional). Example: [{"id":"abc123","message":"Fix bug"}]',
      },
    },

    request: {
      url: (params) => `https://sentry.io/api/0/organizations/${params.organizationSlug}/releases/`,
      method: 'POST',
      headers: (params) => ({
        Authorization: `Bearer ${params.apiKey}`,
        'Content-Type': 'application/json',
      }),
      body: (params) => {
        const body: Record<string, any> = {
          version: params.version,
          projects: params.projects
            .split(',')
            .map((p: string) => p.trim())
            .filter((p: string) => p.length > 0),
        }

        if (params.ref && params.ref !== null && params.ref !== '') {
          body.ref = params.ref
        }

        if (params.url && params.url !== null && params.url !== '') {
          body.url = params.url
        }

        if (params.dateReleased && params.dateReleased !== null && params.dateReleased !== '') {
          body.dateReleased = params.dateReleased
        }

        if (params.commits && params.commits !== null && params.commits !== '') {
          try {
            body.commits = JSON.parse(params.commits)
          } catch (e) {
            // If JSON parsing fails, ignore commits parameter
          }
        }

        return body
      },
    },

    transformResponse: async (response: Response) => {
      const release = await response.json()

      return {
        success: true,
        output: {
          release: {
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
          },
        },
      }
    },

    outputs: {
      release: {
        type: 'object',
        description: 'The newly created Sentry release',
        properties: {
          id: { type: 'string', description: 'Unique release ID' },
          version: { type: 'string', description: 'Release version identifier' },
          shortVersion: { type: 'string', description: 'Shortened version identifier' },
          ref: {
            type: 'string',
            description: 'Git reference (commit SHA, tag, or branch)',
            optional: true,
          },
          url: { type: 'string', description: 'URL to the release', optional: true },
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
          newGroups: { type: 'number', description: 'Number of new issues introduced' },
          commitCount: { type: 'number', description: 'Number of commits in this release' },
          deployCount: { type: 'number', description: 'Number of deploys for this release' },
          owner: {
            type: 'object',
            description: 'Release owner',
            properties: {
              id: { type: 'string', description: 'Owner ID' },
              name: { type: 'string', description: 'Owner name' },
              email: { type: 'string', description: 'Owner email' },
            },
          },
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
  }
