import type { HexGetProjectParams, HexGetProjectResponse } from '@/tools/hex/types'
import { HEX_PROJECT_OUTPUT_PROPERTIES } from '@/tools/hex/types'
import type { ToolConfig } from '@/tools/types'

export const getProjectTool: ToolConfig<HexGetProjectParams, HexGetProjectResponse> = {
  id: 'hex_get_project',
  name: 'Hex Get Project',
  description: 'Get metadata and details for a specific Hex project by its ID.',
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
      description: 'The UUID of the Hex project',
    },
  },

  request: {
    url: (params) => `https://app.hex.tech/api/v1/projects/${params.projectId}`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
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
    id: HEX_PROJECT_OUTPUT_PROPERTIES.id,
    title: HEX_PROJECT_OUTPUT_PROPERTIES.title,
    description: HEX_PROJECT_OUTPUT_PROPERTIES.description,
    status: HEX_PROJECT_OUTPUT_PROPERTIES.status,
    type: HEX_PROJECT_OUTPUT_PROPERTIES.type,
    creator: HEX_PROJECT_OUTPUT_PROPERTIES.creator,
    owner: HEX_PROJECT_OUTPUT_PROPERTIES.owner,
    categories: HEX_PROJECT_OUTPUT_PROPERTIES.categories,
    lastEditedAt: HEX_PROJECT_OUTPUT_PROPERTIES.lastEditedAt,
    lastPublishedAt: HEX_PROJECT_OUTPUT_PROPERTIES.lastPublishedAt,
    createdAt: HEX_PROJECT_OUTPUT_PROPERTIES.createdAt,
    archivedAt: HEX_PROJECT_OUTPUT_PROPERTIES.archivedAt,
    trashedAt: HEX_PROJECT_OUTPUT_PROPERTIES.trashedAt,
  },
}
