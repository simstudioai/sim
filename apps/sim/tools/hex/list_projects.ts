import type { HexListProjectsParams, HexListProjectsResponse } from '@/tools/hex/types'
import type { ToolConfig } from '@/tools/types'

export const listProjectsTool: ToolConfig<HexListProjectsParams, HexListProjectsResponse> = {
  id: 'hex_list_projects',
  name: 'Hex List Projects',
  description: 'List all projects in your Hex workspace with optional filtering by status.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Hex API token (Personal or Workspace)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of projects to return (1-100)',
    },
    includeArchived: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Include archived projects in results',
    },
    statusFilter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by status: PUBLISHED, DRAFT, or ALL',
    },
    includeComponents: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Include components in results',
    },
    includeTrashed: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Include trashed projects in results',
    },
    creatorEmail: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by creator email',
    },
    ownerEmail: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by owner email',
    },
    collectionId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by collection UUID',
    },
    categories: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON array of category names to filter by (e.g., ["Marketing", "Finance"])',
    },
    sortBy: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Sort by field: CREATED_AT, LAST_EDITED_AT, or LAST_PUBLISHED_AT',
    },
    sortDirection: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Sort direction: ASC or DESC',
    },
    after: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Cursor to fetch the page of results after this value',
    },
    before: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Cursor to fetch the page of results before this value',
    },
  },

  request: {
    url: (params) => {
      const searchParams = new URLSearchParams()
      if (params.limit) searchParams.set('limit', String(params.limit))
      if (params.includeArchived) searchParams.set('includeArchived', 'true')
      if (params.includeComponents) searchParams.set('includeComponents', 'true')
      if (params.includeTrashed) searchParams.set('includeTrashed', 'true')
      if (params.statusFilter) searchParams.append('statuses[]', params.statusFilter)
      if (params.creatorEmail) searchParams.set('creatorEmail', params.creatorEmail)
      if (params.ownerEmail) searchParams.set('ownerEmail', params.ownerEmail)
      if (params.collectionId) searchParams.set('collectionId', params.collectionId)
      if (params.categories) {
        let categories: string[]
        try {
          categories =
            typeof params.categories === 'string'
              ? JSON.parse(params.categories)
              : (params.categories as string[])
        } catch {
          throw new Error('categories must be a valid JSON array of category name strings')
        }
        for (const category of categories) {
          searchParams.append('categories[]', category)
        }
      }
      if (params.sortBy) searchParams.set('sortBy', params.sortBy)
      if (params.sortDirection) searchParams.set('sortDirection', params.sortDirection)
      if (params.after) searchParams.set('after', params.after)
      if (params.before) searchParams.set('before', params.before)
      const qs = searchParams.toString()
      return `https://app.hex.tech/api/v1/projects${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    const projects = Array.isArray(data) ? data : (data.values ?? [])

    return {
      success: true,
      output: {
        projects: projects.map((p: Record<string, unknown>) => ({
          id: (p.id as string) ?? null,
          title: (p.title as string) ?? null,
          description: (p.description as string) ?? null,
          status: p.status ? { name: (p.status as Record<string, string>).name ?? null } : null,
          type: (p.type as string) ?? null,
          creator: p.creator
            ? { email: (p.creator as Record<string, string>).email ?? null }
            : null,
          owner: p.owner ? { email: (p.owner as Record<string, string>).email ?? null } : null,
          categories: Array.isArray(p.categories)
            ? (p.categories as Array<Record<string, string>>).map((c) => ({
                name: c.name ?? null,
                description: c.description ?? null,
              }))
            : [],
          lastEditedAt: (p.lastEditedAt as string) ?? null,
          lastPublishedAt: (p.lastPublishedAt as string) ?? null,
          createdAt: (p.createdAt as string) ?? null,
          archivedAt: (p.archivedAt as string) ?? null,
          trashedAt: (p.trashedAt as string) ?? null,
        })),
        total: projects.length,
        after: data.pagination?.after ?? null,
        before: data.pagination?.before ?? null,
      },
    }
  },

  outputs: {
    projects: {
      type: 'array',
      description: 'List of Hex projects',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Project UUID' },
          title: { type: 'string', description: 'Project title' },
          description: { type: 'string', description: 'Project description', optional: true },
          status: {
            type: 'object',
            description: 'Project status',
            properties: {
              name: { type: 'string', description: 'Status name (e.g., PUBLISHED, DRAFT)' },
            },
          },
          type: { type: 'string', description: 'Project type (PROJECT or COMPONENT)' },
          creator: {
            type: 'object',
            description: 'Project creator',
            optional: true,
            properties: {
              email: { type: 'string', description: 'Creator email' },
            },
          },
          owner: {
            type: 'object',
            description: 'Project owner',
            optional: true,
            properties: {
              email: { type: 'string', description: 'Owner email' },
            },
          },
          lastEditedAt: {
            type: 'string',
            description: 'Last edited timestamp',
            optional: true,
          },
          lastPublishedAt: {
            type: 'string',
            description: 'Last published timestamp',
            optional: true,
          },
          createdAt: { type: 'string', description: 'Creation timestamp' },
          archivedAt: { type: 'string', description: 'Archived timestamp', optional: true },
        },
      },
    },
    total: { type: 'number', description: 'Total number of projects returned' },
    after: { type: 'string', description: 'Cursor for the next page of results', optional: true },
    before: {
      type: 'string',
      description: 'Cursor for the previous page of results',
      optional: true,
    },
  },
}
