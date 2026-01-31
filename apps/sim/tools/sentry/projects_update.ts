import type { SentryUpdateProjectParams, SentryUpdateProjectResponse } from '@/tools/sentry/types'
import type { ToolConfig } from '@/tools/types'

export const updateProjectTool: ToolConfig<SentryUpdateProjectParams, SentryUpdateProjectResponse> =
  {
    id: 'sentry_projects_update',
    name: 'Update Project',
    description:
      'Update a Sentry project by changing its name, slug, platform, or other settings. Returns the updated project details.',
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
        required: true,
        visibility: 'user-or-llm',
        description: 'The slug of the project to update (e.g., "my-project")',
      },
      name: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'New name for the project',
      },
      slug: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'New URL-friendly project identifier',
      },
      platform: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'New platform/language for the project (e.g., javascript, python, node)',
      },
      isBookmarked: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'Whether to bookmark the project',
      },
      digestsMinDelay: {
        type: 'number',
        required: false,
        visibility: 'user-only',
        description: 'Minimum delay (in seconds) for digest notifications',
      },
      digestsMaxDelay: {
        type: 'number',
        required: false,
        visibility: 'user-only',
        description: 'Maximum delay (in seconds) for digest notifications',
      },
    },

    request: {
      url: (params) =>
        `https://sentry.io/api/0/projects/${params.organizationSlug}/${params.projectSlug}/`,
      method: 'PUT',
      headers: (params) => ({
        Authorization: `Bearer ${params.apiKey}`,
        'Content-Type': 'application/json',
      }),
      body: (params) => {
        const body: Record<string, any> = {}

        if (params.name !== undefined && params.name !== null && params.name !== '') {
          body.name = params.name
        }

        if (params.slug !== undefined && params.slug !== null && params.slug !== '') {
          body.slug = params.slug
        }

        if (params.platform !== undefined && params.platform !== null && params.platform !== '') {
          body.platform = params.platform
        }

        if (params.isBookmarked !== undefined && params.isBookmarked !== null) {
          body.isBookmarked = params.isBookmarked
        }

        if (params.digestsMinDelay !== undefined && params.digestsMinDelay !== null) {
          body.digestsMinDelay = Number(params.digestsMinDelay)
        }

        if (params.digestsMaxDelay !== undefined && params.digestsMaxDelay !== null) {
          body.digestsMaxDelay = Number(params.digestsMaxDelay)
        }

        return body
      },
    },

    transformResponse: async (response: Response) => {
      const project = await response.json()

      return {
        success: true,
        output: {
          project: {
            id: project.id,
            slug: project.slug,
            name: project.name,
            platform: project.platform ?? null,
            dateCreated: project.dateCreated,
            isBookmarked: project.isBookmarked,
            isMember: project.isMember,
            features: project.features || [],
            firstEvent: project.firstEvent ?? null,
            firstTransactionEvent: project.firstTransactionEvent ?? null,
            access: project.access || [],
            hasAccess: project.hasAccess,
            hasMinifiedStackTrace: project.hasMinifiedStackTrace,
            hasMonitors: project.hasMonitors,
            hasProfiles: project.hasProfiles,
            hasReplays: project.hasReplays,
            hasSessions: project.hasSessions,
            isInternal: project.isInternal,
            organization: {
              id: project.organization?.id || '',
              slug: project.organization?.slug || '',
              name: project.organization?.name || '',
            },
            team: {
              id: project.team?.id || '',
              name: project.team?.name || '',
              slug: project.team?.slug || '',
            },
            teams:
              project.teams?.map((team: any) => ({
                id: team.id,
                name: team.name,
                slug: team.slug,
              })) || [],
            status: project.status ?? null,
            color: project.color ?? null,
            isPublic: project.isPublic,
          },
        },
      }
    },

    outputs: {
      project: {
        type: 'object',
        description: 'The updated Sentry project',
        properties: {
          id: { type: 'string', description: 'Unique project ID' },
          slug: { type: 'string', description: 'URL-friendly project identifier' },
          name: { type: 'string', description: 'Project name' },
          platform: { type: 'string', description: 'Platform/language', optional: true },
          isBookmarked: { type: 'boolean', description: 'Whether the project is bookmarked' },
          organization: {
            type: 'object',
            description: 'Organization information',
            properties: {
              id: { type: 'string', description: 'Organization ID' },
              slug: { type: 'string', description: 'Organization slug' },
              name: { type: 'string', description: 'Organization name' },
            },
          },
          teams: {
            type: 'array',
            description: 'Teams associated with the project',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Team ID' },
                name: { type: 'string', description: 'Team name' },
                slug: { type: 'string', description: 'Team slug' },
              },
            },
          },
        },
      },
    },
  }
