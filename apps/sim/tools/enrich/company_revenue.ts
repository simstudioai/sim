import type { EnrichCompanyRevenueParams, EnrichCompanyRevenueResponse } from '@/tools/enrich/types'
import type { ToolConfig } from '@/tools/types'

export const companyRevenueTool: ToolConfig<
  EnrichCompanyRevenueParams,
  EnrichCompanyRevenueResponse
> = {
  id: 'enrich_company_revenue',
  name: 'Enrich Company Revenue',
  description:
    'Retrieve company revenue data, CEO information, and competitive analysis by domain.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Enrich API key',
    },
    domain: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Company domain (e.g., clay.io)',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://api.enrich.so/v1/api/company-revenue-plus')
      url.searchParams.append('domain', params.domain.trim())
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

    const competitors =
      data.competitors?.map((comp: any) => ({
        name: comp.name ?? '',
        revenue: comp.revenue ?? null,
        employeeCount: comp.employee_count ?? comp.employeeCount ?? null,
        headquarters: comp.headquarters ?? null,
      })) ?? []

    // Handle socialLinks as array [{type, url}] or object {linkedIn, twitter, facebook}
    const socialLinksArray = data.socialLinks ?? data.social_links
    let socialLinks = {
      linkedIn: null as string | null,
      twitter: null as string | null,
      facebook: null as string | null,
    }
    if (Array.isArray(socialLinksArray)) {
      for (const link of socialLinksArray) {
        const linkType = (link.type ?? '').toLowerCase()
        if (linkType === 'linkedin') socialLinks.linkedIn = link.url ?? null
        else if (linkType === 'twitter') socialLinks.twitter = link.url ?? null
        else if (linkType === 'facebook') socialLinks.facebook = link.url ?? null
      }
    } else if (socialLinksArray && typeof socialLinksArray === 'object') {
      socialLinks = {
        linkedIn: socialLinksArray.linkedIn ?? socialLinksArray.linkedin ?? null,
        twitter: socialLinksArray.twitter ?? null,
        facebook: socialLinksArray.facebook ?? null,
      }
    }

    // Handle fundingRounds as array or number
    const fundingRoundsData = data.fundingRounds ?? data.funding_rounds
    const fundingRoundsCount = Array.isArray(fundingRoundsData)
      ? fundingRoundsData.length
      : fundingRoundsData

    // Handle revenueDetails array for min/max
    const revenueDetails = data.revenueDetails ?? data.revenue_details
    let revenueMin = data.revenueMin ?? data.revenue_min ?? null
    let revenueMax = data.revenueMax ?? data.revenue_max ?? null
    if (Array.isArray(revenueDetails) && revenueDetails.length > 0) {
      revenueMin = revenueDetails[0]?.rangeBegin ?? revenueDetails[0]?.range_begin ?? revenueMin
      revenueMax = revenueDetails[0]?.rangeEnd ?? revenueDetails[0]?.range_end ?? revenueMax
    }

    return {
      success: true,
      output: {
        companyName: data.companyName ?? data.company_name ?? null,
        shortDescription: data.shortDescription ?? data.short_description ?? null,
        fullSummary: data.fullSummary ?? data.full_summary ?? null,
        revenue: data.revenue ?? null,
        revenueMin,
        revenueMax,
        employeeCount: data.employeeCount ?? data.employee_count ?? null,
        founded: data.founded ?? null,
        ownership: data.ownership ?? null,
        status: data.status ?? null,
        website: data.website ?? null,
        ceo: {
          name: data.ceo?.fullName ?? data.ceo?.name ?? null,
          designation: data.ceo?.designation ?? data.ceo?.title ?? null,
          rating: data.ceo?.rating ?? null,
        },
        socialLinks,
        totalFunding: data.totalFunding ?? data.total_funding ?? null,
        fundingRounds: fundingRoundsCount ?? null,
        competitors,
      },
    }
  },

  outputs: {
    companyName: {
      type: 'string',
      description: 'Company name',
      optional: true,
    },
    shortDescription: {
      type: 'string',
      description: 'Short company description',
      optional: true,
    },
    fullSummary: {
      type: 'string',
      description: 'Full company summary',
      optional: true,
    },
    revenue: {
      type: 'string',
      description: 'Company revenue',
      optional: true,
    },
    revenueMin: {
      type: 'number',
      description: 'Minimum revenue estimate',
      optional: true,
    },
    revenueMax: {
      type: 'number',
      description: 'Maximum revenue estimate',
      optional: true,
    },
    employeeCount: {
      type: 'number',
      description: 'Number of employees',
      optional: true,
    },
    founded: {
      type: 'string',
      description: 'Year founded',
      optional: true,
    },
    ownership: {
      type: 'string',
      description: 'Ownership type',
      optional: true,
    },
    status: {
      type: 'string',
      description: 'Company status (e.g., Active)',
      optional: true,
    },
    website: {
      type: 'string',
      description: 'Company website URL',
      optional: true,
    },
    ceo: {
      type: 'json',
      description: 'CEO information',
      properties: {
        name: { type: 'string', description: 'CEO name' },
        designation: { type: 'string', description: 'CEO designation/title' },
        rating: { type: 'number', description: 'CEO rating' },
      },
    },
    socialLinks: {
      type: 'json',
      description: 'Social media links',
      properties: {
        linkedIn: { type: 'string', description: 'LinkedIn URL' },
        twitter: { type: 'string', description: 'Twitter URL' },
        facebook: { type: 'string', description: 'Facebook URL' },
      },
    },
    totalFunding: {
      type: 'string',
      description: 'Total funding raised',
      optional: true,
    },
    fundingRounds: {
      type: 'number',
      description: 'Number of funding rounds',
      optional: true,
    },
    competitors: {
      type: 'array',
      description: 'Competitors',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Competitor name' },
          revenue: { type: 'string', description: 'Revenue' },
          employeeCount: { type: 'number', description: 'Employee count' },
          headquarters: { type: 'string', description: 'Headquarters' },
        },
      },
    },
  },
}
