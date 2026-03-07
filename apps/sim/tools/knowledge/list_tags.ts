import type { KnowledgeListTagsResponse } from '@/tools/knowledge/types'
import type { ToolConfig } from '@/tools/types'

export const knowledgeListTagsTool: ToolConfig<any, KnowledgeListTagsResponse> = {
  id: 'knowledge_list_tags',
  name: 'Knowledge List Tags',
  description: 'List all tag definitions for a knowledge base',
  version: '1.0.0',

  params: {
    knowledgeBaseId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the knowledge base to list tags for',
    },
  },

  request: {
    url: (params) => `/api/knowledge/${params.knowledgeBaseId}/tag-definitions`,
    method: 'GET',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response, params): Promise<KnowledgeListTagsResponse> => {
    const result = await response.json()
    const tags = result.data || []

    return {
      success: true,
      output: {
        knowledgeBaseId: params?.knowledgeBaseId ?? '',
        tags: tags.map(
          (tag: {
            id: string
            tagSlot: string
            displayName: string
            fieldType: string
            createdAt: string
            updatedAt: string
          }) => ({
            id: tag.id,
            tagSlot: tag.tagSlot,
            displayName: tag.displayName,
            fieldType: tag.fieldType,
            createdAt: tag.createdAt ?? null,
            updatedAt: tag.updatedAt ?? null,
          })
        ),
        totalTags: tags.length,
      },
    }
  },

  outputs: {
    knowledgeBaseId: {
      type: 'string',
      description: 'ID of the knowledge base',
    },
    tags: {
      type: 'array',
      description: 'Array of tag definitions for the knowledge base',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Tag definition ID' },
          tagSlot: { type: 'string', description: 'Internal tag slot (e.g. tag1, number1)' },
          displayName: { type: 'string', description: 'Human-readable tag name' },
          fieldType: {
            type: 'string',
            description: 'Tag field type (text, number, date, boolean)',
          },
          createdAt: { type: 'string', description: 'Creation timestamp' },
          updatedAt: { type: 'string', description: 'Last update timestamp' },
        },
      },
    },
    totalTags: {
      type: 'number',
      description: 'Total number of tag definitions',
    },
  },
}
