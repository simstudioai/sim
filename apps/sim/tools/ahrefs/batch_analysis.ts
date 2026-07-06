import type { AhrefsBatchAnalysisParams, AhrefsBatchAnalysisResponse } from '@/tools/ahrefs/types'
import type { ToolConfig } from '@/tools/types'

const SELECT_FIELDS =
  'url,domain_rating,ahrefs_rank,backlinks,refdomains,org_traffic,org_keywords,paid_traffic'

export const batchAnalysisTool: ToolConfig<AhrefsBatchAnalysisParams, AhrefsBatchAnalysisResponse> =
  {
    id: 'ahrefs_batch_analysis',
    name: 'Ahrefs Batch Analysis',
    description:
      'Get bulk SEO metrics (Domain Rating, backlinks, referring domains, organic traffic, and more) for multiple domains or URLs in a single request. Useful for comparing many competitors at once.',
    version: '1.0.0',

    params: {
      targets: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description:
          'Comma-separated list of domains or URLs to analyze. Example: "example.com,competitor.com"',
      },
      mode: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Analysis mode applied to every target: domain (entire domain), prefix (URL prefix), subdomains (include all subdomains, default), exact (exact URL match)',
      },
      protocol: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Protocol applied to every target: "both" (default), "http", or "https"',
      },
      country: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Country code for traffic data. Example: "us", "gb", "de"',
      },
      volumeMode: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Search volume calculation: "monthly" or "average" (default: "monthly")',
      },
      apiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Ahrefs API Key',
      },
    },

    request: {
      url: () => 'https://api.ahrefs.com/v3/batch-analysis/batch-analysis',
      method: 'POST',
      headers: (params) => ({
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.apiKey}`,
      }),
      body: (params) => {
        const targets = params.targets
          .split(',')
          .map((target) => target.trim())
          .filter((target) => target.length > 0)
          .map((url) => ({
            url,
            mode: params.mode || 'subdomains',
            protocol: params.protocol || 'both',
          }))

        return {
          select: SELECT_FIELDS.split(','),
          targets,
          ...(params.country ? { country: params.country } : {}),
          volume_mode: params.volumeMode || 'monthly',
        }
      },
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error?.message || data.error || 'Failed to run batch analysis')
      }

      const results = (data.targets || []).map((item: any) => ({
        url: item.url || '',
        index: item.index ?? 0,
        domainRating: item.domain_rating ?? null,
        ahrefsRank: item.ahrefs_rank ?? null,
        backlinks: item.backlinks ?? null,
        referringDomains: item.refdomains ?? null,
        organicTraffic: item.org_traffic ?? null,
        organicKeywords: item.org_keywords ?? null,
        paidTraffic: item.paid_traffic ?? null,
        error: item.error ?? null,
      }))

      return {
        success: true,
        output: {
          results,
        },
      }
    },

    outputs: {
      results: {
        type: 'array',
        description: 'Bulk metrics for each analyzed target, in submission order',
        items: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'The analyzed target URL or domain' },
            index: { type: 'number', description: 'Index of the target in the submitted list' },
            domainRating: {
              type: 'number',
              description: 'Domain Rating score (0-100)',
              optional: true,
            },
            ahrefsRank: {
              type: 'number',
              description: 'Ahrefs Rank (global ranking)',
              optional: true,
            },
            backlinks: {
              type: 'number',
              description: 'Total backlinks to the target',
              optional: true,
            },
            referringDomains: {
              type: 'number',
              description: 'Unique domains linking to the target',
              optional: true,
            },
            organicTraffic: {
              type: 'number',
              description: 'Estimated monthly organic traffic',
              optional: true,
            },
            organicKeywords: {
              type: 'number',
              description: 'Number of organic keywords ranked (top 100)',
              optional: true,
            },
            paidTraffic: {
              type: 'number',
              description: 'Estimated monthly paid search traffic',
              optional: true,
            },
            error: {
              type: 'string',
              description: 'Error message if this target could not be analyzed',
              optional: true,
            },
          },
        },
      },
    },
  }
