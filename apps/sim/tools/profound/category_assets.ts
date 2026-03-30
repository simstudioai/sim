import type { ToolConfig } from '@/tools/types'
import type { ProfoundCategoryAssetsParams, ProfoundCategoryAssetsResponse } from './types'

export const profoundCategoryAssetsTool: ToolConfig<
  ProfoundCategoryAssetsParams,
  ProfoundCategoryAssetsResponse
> = {
  id: 'profound_category_assets',
  name: 'Profound Category Assets',
  description: 'List assets (companies/brands) for a specific category in Profound',
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
  },

  request: {
    url: (params) =>
      `https://api.tryprofound.com/v1/org/categories/${encodeURIComponent(params.categoryId)}/assets`,
    method: 'GET',
    headers: (params) => ({
      'X-API-Key': params.apiKey,
      Accept: 'application/json',
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.detail?.[0]?.msg || 'Failed to list category assets')
    }
    return {
      success: true,
      output: {
        assets: (data ?? []).map(
          (item: {
            id: string
            name: string
            website: string
            alternate_domains: string[] | null
            is_owned: boolean
            created_at: string
            logo_url: string
          }) => ({
            id: item.id ?? null,
            name: item.name ?? null,
            website: item.website ?? null,
            alternateDomains: item.alternate_domains ?? null,
            isOwned: item.is_owned ?? false,
            createdAt: item.created_at ?? null,
            logoUrl: item.logo_url ?? null,
          })
        ),
      },
    }
  },

  outputs: {
    assets: {
      type: 'json',
      description: 'List of assets in the category',
      properties: {
        id: { type: 'string', description: 'Asset ID' },
        name: { type: 'string', description: 'Asset/company name' },
        website: { type: 'string', description: 'Website URL' },
        alternateDomains: { type: 'json', description: 'Alternate domain names' },
        isOwned: { type: 'boolean', description: 'Whether the asset is owned by the organization' },
        createdAt: { type: 'string', description: 'When the asset was created' },
        logoUrl: { type: 'string', description: 'URL of the asset logo' },
      },
    },
  },
}
