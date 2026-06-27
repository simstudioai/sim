import {
  DOWNDETECTOR_API_BASE,
  type DowndetectorListCategoriesParams,
  type DowndetectorListCategoriesResponse,
} from '@/tools/downdetector/types'
import { downdetectorHeaders, extractDowndetectorError } from '@/tools/downdetector/utils'
import type { ToolConfig } from '@/tools/types'

interface RawCategory {
  id?: number
  name?: string
  slug?: string
}

export const listCategoriesTool: ToolConfig<
  DowndetectorListCategoriesParams,
  DowndetectorListCategoriesResponse
> = {
  id: 'downdetector_list_categories',
  name: 'Downdetector List Categories',
  description:
    'List all Downdetector categories (e.g. "Telecom", "Gaming", "Social Media"). Use the returned category id to filter company searches.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Downdetector API Bearer token',
    },
  },

  request: {
    url: () => `${DOWNDETECTOR_API_BASE}/categories`,
    method: 'GET',
    headers: (params) => downdetectorHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(extractDowndetectorError(data, 'Failed to list categories'))
    }

    const rows: RawCategory[] = Array.isArray(data) ? data : []
    const categories = rows.map((category) => ({
      id: category.id ?? null,
      name: category.name ?? null,
      slug: category.slug ?? null,
    }))

    return { success: true, output: { categories } }
  },

  outputs: {
    categories: {
      type: 'array',
      description: 'List of Downdetector categories',
      items: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'Category id' },
          name: { type: 'string', description: 'Category name' },
          slug: { type: 'string', description: 'Category slug' },
        },
      },
    },
  },
}
