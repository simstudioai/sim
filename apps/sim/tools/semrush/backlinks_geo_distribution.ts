import type {
  SemrushBacklinksGeoDistributionParams,
  SemrushBacklinksGeoDistributionResponse,
  SemrushBacklinksGeoDistributionRow,
} from '@/tools/semrush/types'
import {
  buildSemrushUrl,
  normalizeLimit,
  readSemrushReport,
  SEMRUSH_BACKLINKS_URL,
} from '@/tools/semrush/utils'
import type { ToolConfig } from '@/tools/types'

const COLUMNS = ['country', 'domains_num', 'backlinks_num'] as const

export const semrushBacklinksGeoDistributionTool: ToolConfig<
  SemrushBacklinksGeoDistributionParams,
  SemrushBacklinksGeoDistributionResponse
> = {
  id: 'semrush_backlinks_geo_distribution',
  name: 'Semrush Backlink Country Distribution',
  description: 'Break a target backlink profile down by the country of its referring domains.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Semrush API key',
    },
    target: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Root domain, subdomain, or URL to analyze',
    },
    targetType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Scope of the target: root_domain, domain, or url. Defaults to root_domain',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of rows to return, capped at 100,000',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of rows to skip, for pagination',
    },
    displaySort: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort order, for example domains_num_desc or backlinks_num_desc',
    },
  },

  request: {
    url: (params) =>
      buildSemrushUrl(SEMRUSH_BACKLINKS_URL, {
        apiKey: params.apiKey,
        type: 'backlinks_geo',
        columnCodes: COLUMNS,
        extra: {
          target: params.target,
          target_type: params.targetType || 'root_domain',
          display_limit: normalizeLimit(params.limit, 50),
          display_offset: params.offset,
          display_sort: params.displaySort,
        },
      }),
    method: 'GET',
    headers: () => ({ Accept: 'text/csv' }),
  },

  transformResponse: async (response: Response) => {
    const rows = await readSemrushReport<SemrushBacklinksGeoDistributionRow>(response, COLUMNS)

    return {
      success: true,
      output: { countries: rows },
    }
  },

  outputs: {
    countries: {
      type: 'array',
      description: 'Referring domain and backlink counts per country',
      items: {
        type: 'object',
        properties: {
          country: {
            type: 'string',
            description: 'Country of the referring domain',
            optional: true,
            nullable: true,
          },
          domainsNum: {
            type: 'number',
            description: 'Number of referring domains',
            optional: true,
            nullable: true,
          },
          backlinksNum: {
            type: 'number',
            description: 'Number of backlinks',
            optional: true,
            nullable: true,
          },
        },
      },
    },
  },
}
