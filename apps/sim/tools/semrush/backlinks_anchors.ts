import type {
  SemrushBacklinksAnchorsParams,
  SemrushBacklinksAnchorsResponse,
  SemrushBacklinksAnchorsRow,
} from '@/tools/semrush/types'
import {
  buildSemrushUrl,
  normalizeLimit,
  readSemrushReport,
  SEMRUSH_BACKLINKS_URL,
} from '@/tools/semrush/utils'
import type { ToolConfig } from '@/tools/types'

const COLUMNS = ['anchor', 'domains_num', 'backlinks_num', 'first_seen', 'last_seen'] as const

export const semrushBacklinksAnchorsTool: ToolConfig<
  SemrushBacklinksAnchorsParams,
  SemrushBacklinksAnchorsResponse
> = {
  id: 'semrush_backlinks_anchors',
  name: 'Semrush Backlink Anchors',
  description:
    'List the anchor texts used in backlinks to a target, with domain and backlink counts.',
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
      description: 'Sort order, for example backlinks_num_desc or domains_num_desc',
    },
  },

  request: {
    url: (params) =>
      buildSemrushUrl(SEMRUSH_BACKLINKS_URL, {
        apiKey: params.apiKey,
        type: 'backlinks_anchors',
        columnCodes: COLUMNS,
        extra: {
          target: params.target,
          target_type: params.targetType || 'root_domain',
          display_limit: normalizeLimit(params.limit, 100),
          display_offset: params.offset,
          display_sort: params.displaySort,
        },
      }),
    method: 'GET',
    headers: () => ({ Accept: 'text/csv' }),
  },

  transformResponse: async (response: Response) => {
    const rows = await readSemrushReport<SemrushBacklinksAnchorsRow>(response, COLUMNS)

    return {
      success: true,
      output: { anchors: rows },
    }
  },

  outputs: {
    anchors: {
      type: 'array',
      description: 'Anchor text distribution for the backlink profile',
      items: {
        type: 'object',
        properties: {
          anchor: {
            type: 'string',
            description: 'Anchor text of the backlink',
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
          firstSeen: {
            type: 'number',
            description: 'Unix timestamp when the link was first seen',
            optional: true,
            nullable: true,
          },
          lastSeen: {
            type: 'number',
            description: 'Unix timestamp when the link was last seen',
            optional: true,
            nullable: true,
          },
        },
      },
    },
  },
}
