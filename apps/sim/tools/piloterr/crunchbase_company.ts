import { toNumberOrNull, toStringOrNull } from '@sim/utils/coerce'
import { toArray, toRecord } from '@sim/utils/object'
import type {
  PiloterrCrunchbaseCategory,
  PiloterrCrunchbaseCompanyParams,
  PiloterrCrunchbaseCompanyResponse,
  PiloterrCrunchbaseInvestor,
  PiloterrCrunchbaseLocation,
  PiloterrCrunchbaseProduct,
} from '@/tools/piloterr/types'
import {
  PILOTERR_CRUNCHBASE_CATEGORY_OUTPUT_PROPERTIES,
  PILOTERR_CRUNCHBASE_INVESTOR_OUTPUT_PROPERTIES,
  PILOTERR_CRUNCHBASE_LOCATION_OUTPUT_PROPERTIES,
  PILOTERR_CRUNCHBASE_PRODUCT_OUTPUT_PROPERTIES,
} from '@/tools/piloterr/types'
import {
  mapPiloterrCrunchbaseCategory,
  mapPiloterrCrunchbaseInvestor,
  mapPiloterrCrunchbaseLocation,
  mapPiloterrCrunchbaseProduct,
} from '@/tools/piloterr/utils'
import type { ToolConfig } from '@/tools/types'

export const piloterrCrunchbaseCompanyTool: ToolConfig<
  PiloterrCrunchbaseCompanyParams,
  PiloterrCrunchbaseCompanyResponse
> = {
  id: 'piloterr_crunchbase_company',
  name: 'Piloterr Get Crunchbase Company',
  description:
    "Get a company's Crunchbase profile by name, permalink or URL, or by website domain: description, size, categories, locations, investors and products.",
  version: '1.0.0',

  params: {
    query: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Company name, Crunchbase permalink or URL (e.g., "openai")',
    },
    domain: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Company website domain, for a reverse lookup (e.g., "openai.com")',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Piloterr API key',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(`https://api.piloterr.com/v2/crunchbase/company/info`)
      if (params.query?.trim()) url.searchParams.set('query', params.query.trim())
      if (params.domain?.trim()) url.searchParams.set('domain', params.domain.trim())
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      'x-api-key': params.apiKey,
      Accept: 'application/json',
    }),
  },

  transformResponse: async (response) => {
    const data = toRecord(await response.json())
    return {
      success: true,
      output: {
        name: toStringOrNull(data.name),
        permalink: toStringOrNull(data.permalink),
        headline: toStringOrNull(data.headline),
        description: toStringOrNull(data.description),
        website: toStringOrNull(data.website),
        logo: toStringOrNull(data.logo),
        companyType: toStringOrNull(data.company_type),
        employeeCount: toStringOrNull(data.employee_count),
        foundedOn: toStringOrNull(data.founded),
        phoneNumber: toStringOrNull(data.phone_number),
        contactEmail: toStringOrNull(data.contact_email),
        heatScore: toNumberOrNull(toRecord(data.growth_and_heat).heat_score),
        growthScore: toNumberOrNull(toRecord(data.growth_and_heat).growth_score),
        aliases: toArray(data.aliases).filter((item): item is string => typeof item === 'string'),
        tags: toArray(data.tags).filter((item): item is string => typeof item === 'string'),
        categories: toArray(data.categories)
          .map(mapPiloterrCrunchbaseCategory)
          .filter((item): item is PiloterrCrunchbaseCategory => item !== null),
        headquartersLocation: toArray(data.location)
          .map(mapPiloterrCrunchbaseLocation)
          .filter((item): item is PiloterrCrunchbaseLocation => item !== null),
        investors: toArray(data.investors_list)
          .map(mapPiloterrCrunchbaseInvestor)
          .filter((item): item is PiloterrCrunchbaseInvestor => item !== null),
        products: toArray(data.product)
          .map(mapPiloterrCrunchbaseProduct)
          .filter((item): item is PiloterrCrunchbaseProduct => item !== null),
      },
    }
  },

  outputs: {
    name: {
      type: 'string',
      description: 'Name of the company',
      optional: true,
    },
    permalink: {
      type: 'string',
      description: 'Crunchbase permalink of the company',
      optional: true,
    },
    headline: {
      type: 'string',
      description: 'Short description',
      optional: true,
    },
    description: {
      type: 'string',
      description: 'Full description',
      optional: true,
    },
    website: {
      type: 'string',
      description: 'Website of the company',
      optional: true,
    },
    logo: {
      type: 'string',
      description: 'URL of the company logo',
      optional: true,
    },
    companyType: {
      type: 'string',
      description: 'Company type, such as for profit',
      optional: true,
    },
    employeeCount: {
      type: 'string',
      description: 'Employee count range',
      optional: true,
    },
    foundedOn: {
      type: 'string',
      description: 'Founding date',
      optional: true,
    },
    phoneNumber: {
      type: 'string',
      description: 'Phone number of the company',
      optional: true,
    },
    contactEmail: {
      type: 'string',
      description: 'Contact email of the company',
      optional: true,
    },
    heatScore: {
      type: 'number',
      description: 'Crunchbase heat score',
      optional: true,
    },
    growthScore: {
      type: 'number',
      description: 'Crunchbase growth score',
      optional: true,
    },
    aliases: {
      type: 'array',
      description: 'Other names of the company',
      optional: true,
      items: { type: 'string' },
    },
    tags: {
      type: 'array',
      description: 'Crunchbase tags, such as unicorn',
      optional: true,
      items: { type: 'string' },
    },
    categories: {
      type: 'array',
      description: 'Industry categories',
      optional: true,
      items: { type: 'object', properties: PILOTERR_CRUNCHBASE_CATEGORY_OUTPUT_PROPERTIES },
    },
    headquartersLocation: {
      type: 'array',
      description: 'Headquarters location, from city to continent',
      optional: true,
      items: { type: 'object', properties: PILOTERR_CRUNCHBASE_LOCATION_OUTPUT_PROPERTIES },
    },
    investors: {
      type: 'array',
      description: 'Investors of the company',
      optional: true,
      items: { type: 'object', properties: PILOTERR_CRUNCHBASE_INVESTOR_OUTPUT_PROPERTIES },
    },
    products: {
      type: 'array',
      description: 'Products of the company',
      optional: true,
      items: { type: 'object', properties: PILOTERR_CRUNCHBASE_PRODUCT_OUTPUT_PROPERTIES },
    },
  },
}
