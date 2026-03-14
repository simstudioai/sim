import type { BrandfetchGetBrandParams, BrandfetchGetBrandResponse } from '@/tools/brandfetch/types'
import type { ToolConfig } from '@/tools/types'

export const brandfetchGetBrandTool: ToolConfig<
  BrandfetchGetBrandParams,
  BrandfetchGetBrandResponse
> = {
  id: 'brandfetch_get_brand',
  name: 'Brandfetch Get Brand',
  description:
    'Retrieve brand assets including logos, colors, fonts, and company info by domain, ticker, ISIN, or crypto symbol',
  version: '1.0.0',

  hosting: {
    envKeyPrefix: 'BRANDFETCH_API_KEY',
    apiKeyParam: 'apiKey',
    byokProviderId: 'brandfetch',
    pricing: {
      type: 'per_request',
      // Brand API: $99/month for 2,500 calls = $0.0396/request — https://docs.brandfetch.com/brand-api/quotas-and-usage
      cost: 0.04,
    },
    rateLimit: {
      mode: 'per_request',
      requestsPerMinute: 30,
    },
  },

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Brandfetch API key',
    },
    identifier: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Brand identifier: domain (nike.com), stock ticker (NKE), ISIN (US6541061031), or crypto symbol (BTC)',
    },
  },

  request: {
    url: (params) =>
      `https://api.brandfetch.io/v2/brands/${encodeURIComponent(params.identifier.trim())}`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      Accept: 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Brandfetch API error (${response.status}): ${errorText}`)
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        id: data.id ?? '',
        name: data.name ?? null,
        domain: data.domain ?? '',
        claimed: data.claimed ?? false,
        description: data.description ?? null,
        longDescription: data.longDescription ?? null,
        links: data.links ?? [],
        logos: data.logos ?? [],
        colors: data.colors ?? [],
        fonts: data.fonts ?? [],
        company: data.company ?? null,
        qualityScore: data.qualityScore ?? null,
        isNsfw: data.isNsfw ?? false,
      },
    }
  },

  outputs: {
    id: {
      type: 'string',
      description: 'Unique brand identifier',
    },
    name: {
      type: 'string',
      description: 'Brand name',
      optional: true,
    },
    domain: {
      type: 'string',
      description: 'Brand domain',
    },
    claimed: {
      type: 'boolean',
      description: 'Whether the brand profile is claimed',
    },
    description: {
      type: 'string',
      description: 'Short brand description',
      optional: true,
    },
    longDescription: {
      type: 'string',
      description: 'Detailed brand description',
      optional: true,
    },
    links: {
      type: 'array',
      description: 'Social media and website links',
      items: {
        type: 'json',
        properties: {
          name: { type: 'string', description: 'Link name (e.g., twitter, linkedin)' },
          url: { type: 'string', description: 'Link URL' },
        },
      },
    },
    logos: {
      type: 'array',
      description: 'Brand logos with formats and themes',
      items: {
        type: 'json',
        properties: {
          type: { type: 'string', description: 'Logo type (logo, icon, symbol, other)' },
          theme: { type: 'string', description: 'Logo theme (light, dark)' },
          formats: {
            type: 'array',
            description: 'Available formats with src URL, format, width, and height',
          },
        },
      },
    },
    colors: {
      type: 'array',
      description: 'Brand colors with hex values and types',
      items: {
        type: 'json',
        properties: {
          hex: { type: 'string', description: 'Hex color code' },
          type: { type: 'string', description: 'Color type (accent, dark, light, brand)' },
          brightness: { type: 'number', description: 'Brightness value' },
        },
      },
    },
    fonts: {
      type: 'array',
      description: 'Brand fonts with names and types',
      items: {
        type: 'json',
        properties: {
          name: { type: 'string', description: 'Font name' },
          type: { type: 'string', description: 'Font type (title, body)' },
          origin: { type: 'string', description: 'Font origin (google, custom, system)' },
        },
      },
    },
    company: {
      type: 'json',
      description: 'Company firmographic data including employees, location, and industries',
      optional: true,
    },
    qualityScore: {
      type: 'number',
      description: 'Data quality score from 0 to 1',
      optional: true,
    },
    isNsfw: {
      type: 'boolean',
      description: 'Whether the brand contains adult content',
    },
  },
}
