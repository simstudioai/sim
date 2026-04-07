import type { ToolConfig } from '@/tools/types'
import type { ProfoundListAssetsParams, ProfoundListAssetsResponse } from './types'

export const profoundListAssetsTool: ToolConfig<
  ProfoundListAssetsParams,
  ProfoundListAssetsResponse
> = {
  id: 'profound_list_assets',
  name: 'Profound List Assets',
  description: 'List all organization assets (companies/brands) across all categories in Profound',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Profound API Key',
    },
  },

  request: {
    url: 'https://api.tryprofound.com/v1/org/assets',
    method: 'GET',
    headers: (params) => ({
      'X-API-Key': params.apiKey,
      Accept: 'application/json',
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.detail?.[0]?.msg || 'Failed to list assets')
    }
    return {
      success: true,
      output: {
        assets: (data.data ?? []).map(
          (item: {
            id: string
            name: string
            website: string
            alternate_domains: string[] | null
            is_owned: boolean
            created_at: string
            logo_url: string
            category: { id: string; name: string }
          }) => ({
            id: item.id ?? null,
            name: item.name ?? null,
            website: item.website ?? null,
            alternateDomains: item.alternate_domains ?? null,
            isOwned: item.is_owned ?? false,
            createdAt: item.created_at ?? null,
            logoUrl: item.logo_url ?? null,
            categoryId: item.category?.id ?? null,
            categoryName: item.category?.name ?? null,
          })
        ),
      },
    }
  },

  outputs: {
    assets: {
      type: 'json',
      description: 'List of organization assets with category info',
      properties: {
        id: { type: 'string', description: 'Asset ID' },
        name: { type: 'string', description: 'Asset/company name' },
        website: { type: 'string', description: 'Asset website URL' },
        alternateDomains: { type: 'json', description: 'Alternate domain names' },
        isOwned: {
          type: 'boolean',
          description: 'Whether this asset is owned by the organization',
        },
        createdAt: { type: 'string', description: 'When the asset was created' },
        logoUrl: { type: 'string', description: 'URL of the asset logo' },
        categoryId: { type: 'string', description: 'Category ID the asset belongs to' },
        categoryName: { type: 'string', description: 'Category name' },
      },
    },
  },
}
