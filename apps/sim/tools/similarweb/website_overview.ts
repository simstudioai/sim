import type {
  SimilarwebWebsiteOverviewParams,
  SimilarwebWebsiteOverviewResponse,
} from '@/tools/similarweb/types'
import type { ToolConfig } from '@/tools/types'

export const similarwebWebsiteOverviewTool: ToolConfig<
  SimilarwebWebsiteOverviewParams,
  SimilarwebWebsiteOverviewResponse
> = {
  id: 'similarweb_website_overview',
  name: 'SimilarWeb Website Overview',
  description:
    'Get comprehensive website analytics including traffic, rankings, engagement, and traffic sources',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'SimilarWeb API key',
    },
    domain: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Website domain to analyze (e.g., "example.com" without www or protocol)',
    },
  },

  request: {
    url: (params) => {
      const domain = params.domain
        ?.trim()
        .replace(/^(https?:\/\/)?(www\.)?/, '')
        .replace(/\/$/, '')
      const url = new URL(`https://api.similarweb.com/v1/website/${domain}/general-data/all`)
      url.searchParams.set('api_key', params.apiKey?.trim())
      url.searchParams.set('format', 'json')
      return url.toString()
    },
    method: 'GET',
    headers: () => ({
      Accept: 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error?.message || data.message || 'Failed to get website overview')
    }

    const topCountriesRaw = data.TopCountryShares ?? data.top_country_shares ?? []
    const topCountries = topCountriesRaw.map(
      (c: {
        Country?: number
        CountryCode?: string
        Value?: number
        country?: number
        country_code?: string
        value?: number
      }) => ({
        country: c.CountryCode ?? c.country_code ?? String(c.Country ?? c.country ?? ''),
        share: c.Value ?? c.value ?? 0,
      })
    )

    const sources = data.TrafficSources ?? data.traffic_sources ?? {}

    const engagements = data.Engagements ?? data.engagements ?? data.engagments ?? {}

    const getGlobalRank = () => {
      if (data.GlobalRank?.Rank !== undefined) return data.GlobalRank.Rank
      if (data.global_rank?.rank !== undefined) return data.global_rank.rank
      if (typeof data.GlobalRank === 'number') return data.GlobalRank
      if (typeof data.global_rank === 'number') return data.global_rank
      return null
    }

    const getCountryRank = () => {
      if (data.CountryRank?.Rank !== undefined) return data.CountryRank.Rank
      if (data.country_rank?.rank !== undefined) return data.country_rank.rank
      if (typeof data.CountryRank === 'number') return data.CountryRank
      if (typeof data.country_rank === 'number') return data.country_rank
      return null
    }

    const getCategoryRank = () => {
      if (data.CategoryRank?.Rank !== undefined) return data.CategoryRank.Rank
      if (data.category_rank?.rank !== undefined) return data.category_rank.rank
      if (typeof data.CategoryRank === 'number') return data.CategoryRank
      if (typeof data.category_rank === 'number') return data.category_rank
      return null
    }

    return {
      success: true,
      output: {
        siteName: data.SiteName ?? data.site_name ?? null,
        description: data.Description ?? data.description ?? null,
        globalRank: getGlobalRank(),
        countryRank: getCountryRank(),
        categoryRank: getCategoryRank(),
        category: data.Category ?? data.category ?? null,
        monthlyVisits: engagements.Visits ?? engagements.visits ?? null,
        engagementVisitDuration: engagements.TimeOnSite ?? engagements.time_on_site ?? null,
        engagementPagesPerVisit: engagements.PagePerVisit ?? engagements.page_per_visit ?? null,
        engagementBounceRate: engagements.BounceRate ?? engagements.bounce_rate ?? null,
        topCountries,
        trafficSources: {
          direct: sources.Direct ?? sources.direct ?? null,
          referrals: sources.Referrals ?? sources.referrals ?? null,
          search: sources.Search ?? sources.search ?? null,
          social: sources.Social ?? sources.social ?? null,
          mail: sources.Mail ?? sources.mail ?? null,
          paidReferrals: sources['Paid Referrals'] ?? sources.paid_referrals ?? null,
        },
      },
    }
  },

  outputs: {
    siteName: {
      type: 'string',
      description: 'Website name',
    },
    description: {
      type: 'string',
      description: 'Website description',
      optional: true,
    },
    globalRank: {
      type: 'number',
      description: 'Global traffic rank',
      optional: true,
    },
    countryRank: {
      type: 'number',
      description: 'Country traffic rank',
      optional: true,
    },
    categoryRank: {
      type: 'number',
      description: 'Category traffic rank',
      optional: true,
    },
    category: {
      type: 'string',
      description: 'Website category',
      optional: true,
    },
    monthlyVisits: {
      type: 'number',
      description: 'Estimated monthly visits',
      optional: true,
    },
    engagementVisitDuration: {
      type: 'number',
      description: 'Average visit duration in seconds',
      optional: true,
    },
    engagementPagesPerVisit: {
      type: 'number',
      description: 'Average pages per visit',
      optional: true,
    },
    engagementBounceRate: {
      type: 'number',
      description: 'Bounce rate (0-1)',
      optional: true,
    },
    topCountries: {
      type: 'array',
      description: 'Top countries by traffic share',
      items: {
        type: 'object',
        properties: {
          country: { type: 'string', description: 'Country code' },
          share: { type: 'number', description: 'Traffic share (0-1)' },
        },
      },
    },
    trafficSources: {
      type: 'json',
      description: 'Traffic source breakdown',
      properties: {
        direct: { type: 'number', description: 'Direct traffic share' },
        referrals: { type: 'number', description: 'Referral traffic share' },
        search: { type: 'number', description: 'Search traffic share' },
        social: { type: 'number', description: 'Social traffic share' },
        mail: { type: 'number', description: 'Email traffic share' },
        paidReferrals: { type: 'number', description: 'Paid referral traffic share' },
      },
    },
  },
}
