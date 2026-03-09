import type { HexUpdateProjectParams, HexUpdateProjectResponse } from '@/tools/hex/types'
import type { ToolConfig } from '@/tools/types'

export const updateProjectTool: ToolConfig<HexUpdateProjectParams, HexUpdateProjectResponse> = {
  id: 'hex_update_project',
  name: 'Hex Update Project',
  description:
    'Update a Hex project status label (e.g., endorsement or custom workspace statuses).',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Hex API token (Personal or Workspace)',
    },
    projectId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The UUID of the Hex project to update',
    },
    status: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'New project status name (custom workspace status label)',
    },
  },

  request: {
    url: (params) => `https://app.hex.tech/api/v1/projects/${params.projectId}`,
    method: 'PATCH',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      status: params.status,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        id: data.id ?? null,
        title: data.title ?? null,
        description: data.description ?? null,
        status: data.status ? { name: data.status.name ?? null } : null,
        type: data.type ?? null,
        creator: data.creator ? { email: data.creator.email ?? null } : null,
        owner: data.owner ? { email: data.owner.email ?? null } : null,
        categories: Array.isArray(data.categories)
          ? data.categories.map((c: Record<string, string>) => ({
              name: c.name ?? null,
              description: c.description ?? null,
            }))
          : [],
        lastEditedAt: data.lastEditedAt ?? null,
        lastPublishedAt: data.lastPublishedAt ?? null,
        createdAt: data.createdAt ?? null,
        archivedAt: data.archivedAt ?? null,
        trashedAt: data.trashedAt ?? null,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Project UUID' },
    title: { type: 'string', description: 'Project title' },
    description: { type: 'string', description: 'Project description', optional: true },
    status: {
      type: 'object',
      description: 'Updated project status',
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
    categories: {
      type: 'array',
      description: 'Project categories',
      optional: true,
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Category name' },
          description: { type: 'string', description: 'Category description' },
        },
      },
    },
    lastEditedAt: { type: 'string', description: 'Last edited timestamp', optional: true },
    lastPublishedAt: { type: 'string', description: 'Last published timestamp', optional: true },
    createdAt: { type: 'string', description: 'Creation timestamp' },
    archivedAt: { type: 'string', description: 'Archived timestamp', optional: true },
    trashedAt: { type: 'string', description: 'Trashed timestamp', optional: true },
  },
}
