import type { EnrichCompanyLookupParams, EnrichCompanyLookupResponse } from '@/tools/enrich/types'
import type { ToolConfig } from '@/tools/types'

export const companyLookupTool: ToolConfig<EnrichCompanyLookupParams, EnrichCompanyLookupResponse> =
  {
    id: 'enrich_company_lookup',
    name: 'Enrich Company Lookup',
    description:
      'Look up comprehensive company information by name or domain including funding, location, and social profiles.',
    version: '1.0.0',

    params: {
      apiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Enrich API key',
      },
      name: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Company name (e.g., Google)',
      },
      domain: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Company domain (e.g., google.com)',
      },
    },

    request: {
      url: (params) => {
        const url = new URL('https://api.enrich.so/v1/api/company')
        if (params.name) {
          url.searchParams.append('name', params.name.trim())
        }
        if (params.domain) {
          url.searchParams.append('domain', params.domain.trim())
        }
        return url.toString()
      },
      method: 'GET',
      headers: (params) => ({
        Authorization: `Bearer ${params.apiKey}`,
        'Content-Type': 'application/json',
      }),
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()

      const fundingRounds =
        data.fundingData?.map((round: any) => ({
          roundType: round.fundingRound ?? '',
          amount: round.moneyRaised?.amount ?? null,
          currency: round.moneyRaised?.currency ?? null,
          investors: round.investors ?? [],
        })) ?? []

      return {
        success: true,
        output: {
          name: data.name ?? null,
          universalName: data.universal_name ?? null,
          companyId: data.company_id ?? null,
          description: data.description ?? null,
          phone: data.phone ?? null,
          linkedInUrl: data.url ?? null,
          websiteUrl: data.website ?? null,
          followers: data.followers ?? null,
          staffCount: data.staffCount ?? null,
          foundedDate: data.founded ?? null,
          type: data.type ?? null,
          industries: data.industries ?? [],
          specialties: data.specialities ?? [],
          headquarters: {
            city: data.headquarter?.city ?? null,
            country: data.headquarter?.country ?? null,
            postalCode: data.headquarter?.postalCode ?? null,
            line1: data.headquarter?.line1 ?? null,
          },
          logo: data.logo ?? null,
          coverImage: data.cover ?? null,
          fundingRounds,
        },
      }
    },

    outputs: {
      name: {
        type: 'string',
        description: 'Company name',
        optional: true,
      },
      universalName: {
        type: 'string',
        description: 'Universal company name',
        optional: true,
      },
      companyId: {
        type: 'string',
        description: 'Company ID',
        optional: true,
      },
      description: {
        type: 'string',
        description: 'Company description',
        optional: true,
      },
      phone: {
        type: 'string',
        description: 'Phone number',
        optional: true,
      },
      linkedInUrl: {
        type: 'string',
        description: 'LinkedIn company URL',
        optional: true,
      },
      websiteUrl: {
        type: 'string',
        description: 'Company website',
        optional: true,
      },
      followers: {
        type: 'number',
        description: 'Number of LinkedIn followers',
        optional: true,
      },
      staffCount: {
        type: 'number',
        description: 'Number of employees',
        optional: true,
      },
      foundedDate: {
        type: 'string',
        description: 'Date founded',
        optional: true,
      },
      type: {
        type: 'string',
        description: 'Company type',
        optional: true,
      },
      industries: {
        type: 'array',
        description: 'Industries',
        items: {
          type: 'string',
          description: 'Industry',
        },
      },
      specialties: {
        type: 'array',
        description: 'Company specialties',
        items: {
          type: 'string',
          description: 'Specialty',
        },
      },
      headquarters: {
        type: 'json',
        description: 'Headquarters location',
        properties: {
          city: { type: 'string', description: 'City' },
          country: { type: 'string', description: 'Country' },
          postalCode: { type: 'string', description: 'Postal code' },
          line1: { type: 'string', description: 'Address line 1' },
        },
      },
      logo: {
        type: 'string',
        description: 'Company logo URL',
        optional: true,
      },
      coverImage: {
        type: 'string',
        description: 'Cover image URL',
        optional: true,
      },
      fundingRounds: {
        type: 'array',
        description: 'Funding history',
        items: {
          type: 'object',
          properties: {
            roundType: { type: 'string', description: 'Funding round type' },
            amount: { type: 'number', description: 'Amount raised' },
            currency: { type: 'string', description: 'Currency' },
            investors: { type: 'array', description: 'Investors' },
          },
        },
      },
    },
  }
