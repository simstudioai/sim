import type { SentryCreateProjectParams, SentryCreateProjectResponse } from '@/tools/sentry/types'
import type { ToolConfig } from '@/tools/types'

export const createProjectTool: ToolConfig<SentryCreateProjectParams, SentryCreateProjectResponse> =
  {
    id: 'sentry_projects_create',
    name: 'Create Project',
    description:
      'Create a new Sentry project in an organization. Requires a team to associate the project with. Returns the created project details.',
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
      name: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'The name of the project',
      },
      teamSlug: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'The slug of the team that will own this project',
      },
      slug: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'URL-friendly project identifier (auto-generated from name if not provided)',
      },
      platform: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Platform/language for the project (e.g., javascript, python, node, react-native). If not specified, defaults to "other"',
      },
      defaultRules: {
        type: 'boolean',
        required: false,
        visibility: 'user-only',
        description: 'Whether to create default alert rules (default: true)',
      },
    },

    request: {
      url: (params) =>
        `https://sentry.io/api/0/teams/${params.organizationSlug}/${params.teamSlug}/projects/`,
      method: 'POST',
      headers: (params) => ({
        Authorization: `Bearer ${params.apiKey}`,
        'Content-Type': 'application/json',
      }),
      body: (params) => {
        const body: Record<string, any> = {
          name: params.name,
        }

        if (params.slug && params.slug !== null && params.slug !== '') {
          body.slug = params.slug
        }

        if (params.platform && params.platform !== null && params.platform !== '') {
          body.platform = params.platform
        }

        if (params.defaultRules !== undefined && params.defaultRules !== null) {
          body.default_rules = params.defaultRules
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
        description: 'The newly created Sentry project',
        properties: {
          id: { type: 'string', description: 'Unique project ID' },
          slug: { type: 'string', description: 'URL-friendly project identifier' },
          name: { type: 'string', description: 'Project name' },
          platform: { type: 'string', description: 'Platform/language', optional: true },
          dateCreated: {
            type: 'string',
            description: 'When the project was created (ISO timestamp)',
          },
          isBookmarked: { type: 'boolean', description: 'Whether the project is bookmarked' },
          isMember: { type: 'boolean', description: 'Whether the user is a member' },
          hasAccess: { type: 'boolean', description: 'Whether the user has access' },
          features: { type: 'array', description: 'Enabled features' },
          firstEvent: { type: 'string', description: 'First event timestamp', optional: true },
          organization: {
            type: 'object',
            description: 'Organization information',
            properties: {
              id: { type: 'string', description: 'Organization ID' },
              slug: { type: 'string', description: 'Organization slug' },
              name: { type: 'string', description: 'Organization name' },
            },
          },
          team: {
            type: 'object',
            description: 'Primary team for the project',
            properties: {
              id: { type: 'string', description: 'Team ID' },
              name: { type: 'string', description: 'Team name' },
              slug: { type: 'string', description: 'Team slug' },
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
          status: { type: 'string', description: 'Project status', optional: true },
          color: { type: 'string', description: 'Project color code', optional: true },
          isPublic: { type: 'boolean', description: 'Whether the project is public' },
        },
      },
    },
  }
