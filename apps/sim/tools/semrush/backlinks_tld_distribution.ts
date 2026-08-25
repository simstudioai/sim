import type {
  SemrushBacklinksTldDistributionParams,
  SemrushBacklinksTldDistributionResponse,
  SemrushBacklinksTldDistributionRow,
} from '@/tools/semrush/types'
import {
  buildSemrushUrl,
  normalizeLimit,
  readSemrushReport,
  SEMRUSH_BACKLINKS_URL,
} from '@/tools/semrush/utils'
import type { ToolConfig } from '@/tools/types'

const COLUMNS = ['zone', 'domains_num', 'backlinks_num'] as const

export const semrushBacklinksTldDistributionTool: ToolConfig<
  SemrushBacklinksTldDistributionParams,
  SemrushBacklinksTldDistributionResponse
> = {
  id: 'semrush_backlinks_tld_distribution',
  name: 'Semrush Backlink TLD Distribution',
  description:
    'Break a target backlink profile down by the top-level domain of its referring domains.',
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
        type: 'backlinks_tld',
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
    const rows = await readSemrushReport<SemrushBacklinksTldDistributionRow>(response, COLUMNS)

    return {
      success: true,
      output: { zones: rows },
    }
  },

  outputs: {
    zones: {
      type: 'array',
      description: 'Referring domain and backlink counts per top-level domain',
      items: {
        type: 'object',
        properties: {
          zone: {
            type: 'string',
            description: 'Top-level domain zone',
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
