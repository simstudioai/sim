import type { ToolConfig } from '@/tools/types'
import type { ProfoundCategoryPromptsParams, ProfoundCategoryPromptsResponse } from './types'

export const profoundCategoryPromptsTool: ToolConfig<
  ProfoundCategoryPromptsParams,
  ProfoundCategoryPromptsResponse
> = {
  id: 'profound_category_prompts',
  name: 'Profound Category Prompts',
  description: 'List prompts for a specific category in Profound',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Profound API Key',
    },
    categoryId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Category ID (UUID)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of results (default 10000, max 10000)',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor from previous response',
    },
    orderDir: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort direction: asc or desc (default desc)',
    },
    promptType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated prompt types to filter: visibility, sentiment',
    },
    topicId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated topic IDs (UUIDs) to filter by',
    },
    tagId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated tag IDs (UUIDs) to filter by',
    },
    regionId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated region IDs (UUIDs) to filter by',
    },
    platformId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated platform IDs (UUIDs) to filter by',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(
        `https://api.tryprofound.com/v1/org/categories/${encodeURIComponent(params.categoryId)}/prompts`
      )
      if (params.limit != null) url.searchParams.set('limit', String(params.limit))
      if (params.cursor) url.searchParams.set('cursor', params.cursor)
      if (params.orderDir) url.searchParams.set('order_dir', params.orderDir)
      if (params.promptType) {
        for (const pt of params.promptType.split(',').map((s) => s.trim())) {
          url.searchParams.append('prompt_type', pt)
        }
      }
      if (params.topicId) {
        for (const tid of params.topicId.split(',').map((s) => s.trim())) {
          url.searchParams.append('topic_id', tid)
        }
      }
      if (params.tagId) {
        for (const tid of params.tagId.split(',').map((s) => s.trim())) {
          url.searchParams.append('tag_id', tid)
        }
      }
      if (params.regionId) {
        for (const rid of params.regionId.split(',').map((s) => s.trim())) {
          url.searchParams.append('region_id', rid)
        }
      }
      if (params.platformId) {
        for (const pid of params.platformId.split(',').map((s) => s.trim())) {
          url.searchParams.append('platform_id', pid)
        }
      }
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      'X-API-Key': params.apiKey,
      Accept: 'application/json',
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.detail?.[0]?.msg || 'Failed to list category prompts')
    }
    return {
      success: true,
      output: {
        totalRows: data.info?.total_rows ?? 0,
        nextCursor: data.info?.next_cursor ?? null,
        prompts: (data.data ?? []).map(
          (item: {
            id: string
            prompt: string
            prompt_type: string
            topic: { id: string; name: string }
            tags: Array<{ id: string; name: string }>
            regions: Array<{ id: string; name: string }>
            platforms: Array<{ id: string; name: string }>
            created_at: string
          }) => ({
            id: item.id ?? null,
            prompt: item.prompt ?? null,
            promptType: item.prompt_type ?? null,
            topicId: item.topic?.id ?? null,
            topicName: item.topic?.name ?? null,
            tags: (item.tags ?? []).map((t: { id: string; name: string }) => ({
              id: t.id ?? null,
              name: t.name ?? null,
            })),
            regions: (item.regions ?? []).map((r: { id: string; name: string }) => ({
              id: r.id ?? null,
              name: r.name ?? null,
            })),
            platforms: (item.platforms ?? []).map((p: { id: string; name: string }) => ({
              id: p.id ?? null,
              name: p.name ?? null,
            })),
            createdAt: item.created_at ?? null,
          })
        ),
      },
    }
  },

  outputs: {
    totalRows: {
      type: 'number',
      description: 'Total number of prompts',
    },
    nextCursor: {
      type: 'string',
      description: 'Cursor for next page of results',
      optional: true,
    },
    prompts: {
      type: 'json',
      description: 'List of prompts',
      properties: {
        id: { type: 'string', description: 'Prompt ID' },
        prompt: { type: 'string', description: 'Prompt text' },
        promptType: { type: 'string', description: 'Prompt type (visibility or sentiment)' },
        topicId: { type: 'string', description: 'Topic ID' },
        topicName: { type: 'string', description: 'Topic name' },
        tags: { type: 'json', description: 'Associated tags' },
        regions: { type: 'json', description: 'Associated regions' },
        platforms: { type: 'json', description: 'Associated platforms' },
        createdAt: { type: 'string', description: 'When the prompt was created' },
      },
    },
  },
}
