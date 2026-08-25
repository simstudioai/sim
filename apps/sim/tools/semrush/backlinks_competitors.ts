import type {
  SemrushBacklinksCompetitorsParams,
  SemrushBacklinksCompetitorsResponse,
  SemrushBacklinksCompetitorsRow,
} from '@/tools/semrush/types'
import {
  buildSemrushUrl,
  normalizeLimit,
  readSemrushReport,
  SEMRUSH_BACKLINKS_URL,
} from '@/tools/semrush/utils'
import type { ToolConfig } from '@/tools/types'

const COLUMNS = [
  'ascore',
  'neighbour',
  'similarity',
  'common_refdomains',
  'domains_num',
  'backlinks_num',
] as const

export const semrushBacklinksCompetitorsTool: ToolConfig<
  SemrushBacklinksCompetitorsParams,
  SemrushBacklinksCompetitorsResponse
> = {
  id: 'semrush_backlinks_competitors',
  name: 'Semrush Backlink Competitors',
  description:
    'List domains with a backlink profile similar to the target, ranked by shared referring domains.',
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
  },

  request: {
    url: (params) =>
      buildSemrushUrl(SEMRUSH_BACKLINKS_URL, {
        apiKey: params.apiKey,
        type: 'backlinks_competitors',
        columnCodes: COLUMNS,
        extra: {
          target: params.target,
          target_type: params.targetType || 'root_domain',
          display_limit: normalizeLimit(params.limit, 50),
          display_offset: params.offset,
        },
      }),
    method: 'GET',
    headers: () => ({ Accept: 'text/csv' }),
  },

  transformResponse: async (response: Response) => {
    const rows = await readSemrushReport<SemrushBacklinksCompetitorsRow>(response, COLUMNS)

    return {
      success: true,
      output: { competitors: rows },
    }
  },

  outputs: {
    competitors: {
      type: 'array',
      description: 'Domains with backlink profiles similar to the target',
      items: {
        type: 'object',
        properties: {
          authorityScore: {
            type: 'number',
            description: 'Semrush Authority Score (0-100)',
            optional: true,
            nullable: true,
          },
          domain: {
            type: 'string',
            description: 'Domain name',
            optional: true,
            nullable: true,
          },
          similarity: {
            type: 'number',
            description: 'Backlink profile similarity to the target',
            optional: true,
            nullable: true,
          },
          commonRefdomains: {
            type: 'number',
            description: 'Referring domains shared with the target',
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
