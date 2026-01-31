import type { SentryGetProjectParams, SentryGetProjectResponse } from '@/tools/sentry/types'
import type { ToolConfig } from '@/tools/types'

export const getProjectTool: ToolConfig<SentryGetProjectParams, SentryGetProjectResponse> = {
  id: 'sentry_projects_get',
  name: 'Get Project',
  description:
    'Retrieve detailed information about a specific Sentry project by its slug. Returns complete project details including teams, features, and configuration.',
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
      description: 'The slug of the project to retrieve (e.g., "my-project")',
    },
  },

  request: {
    url: (params) =>
      `https://sentry.io/api/0/projects/${params.organizationSlug}/${params.projectSlug}/`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
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
      description: 'Detailed information about the Sentry project',
      properties: {
        id: { type: 'string', description: 'Unique project ID' },
        slug: { type: 'string', description: 'URL-friendly project identifier' },
        name: { type: 'string', description: 'Project name' },
        platform: {
          type: 'string',
          description: 'Platform/language (e.g., javascript, python)',
          optional: true,
        },
        dateCreated: {
          type: 'string',
          description: 'When the project was created (ISO timestamp)',
        },
        isBookmarked: { type: 'boolean', description: 'Whether the project is bookmarked' },
        isMember: { type: 'boolean', description: 'Whether the user is a member of the project' },
        features: {
          type: 'array',
          description: 'Enabled features for the project',
          items: { type: 'string' },
        },
        firstEvent: {
          type: 'string',
          description: 'When the first event was received (ISO timestamp)',
          optional: true,
        },
        firstTransactionEvent: {
          type: 'string',
          description: 'When the first transaction event was received',
          optional: true,
        },
        access: { type: 'array', description: 'Access permissions' },
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
        isPublic: { type: 'boolean', description: 'Whether the project is publicly visible' },
        isInternal: { type: 'boolean', description: 'Whether the project is internal' },
        hasAccess: { type: 'boolean', description: 'Whether the user has access to this project' },
        hasMinifiedStackTrace: {
          type: 'boolean',
          description: 'Whether minified stack traces are available',
        },
        hasMonitors: {
          type: 'boolean',
          description: 'Whether the project has monitors configured',
        },
        hasProfiles: { type: 'boolean', description: 'Whether the project has profiling enabled' },
        hasReplays: {
          type: 'boolean',
          description: 'Whether the project has session replays enabled',
        },
        hasSessions: { type: 'boolean', description: 'Whether the project has sessions enabled' },
      },
    },
  },
}
