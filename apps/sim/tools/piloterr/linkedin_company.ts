import { toNumberOrNull, toStringOrNull } from '@sim/utils/coerce'
import { toArray, toRecord } from '@sim/utils/object'
import type {
  PiloterrLinkedinCompanyLink,
  PiloterrLinkedinCompanyParams,
  PiloterrLinkedinCompanyResponse,
} from '@/tools/piloterr/types'
import {
  PILOTERR_LINKEDIN_COMPANY_LINK_OUTPUT_PROPERTIES,
  PILOTERR_LINKEDIN_HEADQUARTER_OUTPUT_PROPERTIES,
} from '@/tools/piloterr/types'
import {
  mapPiloterrLinkedinCompanyLink,
  mapPiloterrLinkedinHeadquarter,
} from '@/tools/piloterr/utils'
import type { ToolConfig } from '@/tools/types'

export const piloterrLinkedinCompanyTool: ToolConfig<
  PiloterrLinkedinCompanyParams,
  PiloterrLinkedinCompanyResponse
> = {
  id: 'piloterr_linkedin_company',
  name: 'Piloterr Get LinkedIn Company',
  description:
    "Get a LinkedIn company's profile by page URL, slug or ID, or by website domain: industry, size, headquarters, specialties and followers.",
  version: '1.0.0',

  params: {
    query: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'LinkedIn company page URL, slug or ID (e.g., "https://www.linkedin.com/company/ferrari")',
    },
    domain: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Company website domain, when the LinkedIn page is unknown (e.g., "ferrari.com")',
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
      const url = new URL(`https://api.piloterr.com/v2/linkedin/company/info`)
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
        companyName: toStringOrNull(data.company_name),
        companyId: toNumberOrNull(data.company_id),
        companyUrl: toStringOrNull(data.company_url),
        tagline: toStringOrNull(data.tagline),
        description: toStringOrNull(data.description),
        website: toStringOrNull(data.website),
        industry: toStringOrNull(data.industry),
        founded: toNumberOrNull(data.founded),
        staffCount: toNumberOrNull(data.staff_count),
        staffRange: toStringOrNull(data.staff_range),
        followerCount: toNumberOrNull(data.follower_count),
        logoUrl: toStringOrNull(data.logo_url),
        specialities: toArray(data.specialities).filter(
          (item): item is string => typeof item === 'string'
        ),
        locations: toArray(data.locations).filter(
          (item): item is string => typeof item === 'string'
        ),
        headquarter: mapPiloterrLinkedinHeadquarter(data.headquarter),
        similarCompanies: toArray(data.similar_companies)
          .map(mapPiloterrLinkedinCompanyLink)
          .filter((item): item is PiloterrLinkedinCompanyLink => item !== null),
      },
    }
  },

  outputs: {
    companyName: {
      type: 'string',
      description: 'Name of the company',
      optional: true,
    },
    companyId: {
      type: 'number',
      description: 'LinkedIn ID of the company',
      optional: true,
    },
    companyUrl: {
      type: 'string',
      description: 'URL of the LinkedIn page',
      optional: true,
    },
    tagline: {
      type: 'string',
      description: 'Tagline of the company',
      optional: true,
    },
    description: {
      type: 'string',
      description: 'About text of the company',
      optional: true,
    },
    website: {
      type: 'string',
      description: 'Website of the company',
      optional: true,
    },
    industry: {
      type: 'string',
      description: 'Industry of the company',
      optional: true,
    },
    founded: {
      type: 'number',
      description: 'Year the company was founded',
      optional: true,
    },
    staffCount: {
      type: 'number',
      description: 'Number of employees on LinkedIn',
      optional: true,
    },
    staffRange: {
      type: 'string',
      description: 'Company size range',
      optional: true,
    },
    followerCount: {
      type: 'number',
      description: 'Number of LinkedIn followers',
      optional: true,
    },
    logoUrl: {
      type: 'string',
      description: 'URL of the company logo',
      optional: true,
    },
    specialities: {
      type: 'array',
      description: 'Specialties of the company',
      optional: true,
      items: { type: 'string' },
    },
    locations: {
      type: 'array',
      description: 'Office addresses',
      optional: true,
      items: { type: 'string' },
    },
    headquarter: {
      type: 'object',
      description: 'Headquarters address',
      optional: true,
      properties: PILOTERR_LINKEDIN_HEADQUARTER_OUTPUT_PROPERTIES,
    },
    similarCompanies: {
      type: 'array',
      description: 'Similar companies LinkedIn suggests',
      optional: true,
      items: { type: 'object', properties: PILOTERR_LINKEDIN_COMPANY_LINK_OUTPUT_PROPERTIES },
    },
  },
}
