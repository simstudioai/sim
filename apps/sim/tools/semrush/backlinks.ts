import type {
  SemrushBacklinksParams,
  SemrushBacklinksResponse,
  SemrushBacklinksRow,
} from '@/tools/semrush/types'
import {
  buildSemrushUrl,
  normalizeLimit,
  readSemrushReport,
  SEMRUSH_BACKLINKS_URL,
} from '@/tools/semrush/utils'
import type { ToolConfig } from '@/tools/types'

const COLUMNS = [
  'page_ascore',
  'source_title',
  'source_url',
  'target_url',
  'anchor',
  'nofollow',
  'external_num',
  'internal_num',
  'first_seen',
  'last_seen',
] as const

export const semrushBacklinksTool: ToolConfig<SemrushBacklinksParams, SemrushBacklinksResponse> = {
  id: 'semrush_backlinks',
  name: 'Semrush Backlinks',
  description:
    'List the backlinks pointing at a domain, subdomain, or URL, with source page, anchor, and authority.',
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
      description: 'Sort order, for example page_ascore_desc or last_seen_desc',
    },
    displayFilter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Semrush display_filter expression, for example +|type||newlink',
    },
  },

  request: {
    url: (params) =>
      buildSemrushUrl(SEMRUSH_BACKLINKS_URL, {
        apiKey: params.apiKey,
        type: 'backlinks',
        columnCodes: COLUMNS,
        extra: {
          target: params.target,
          target_type: params.targetType || 'root_domain',
          display_limit: normalizeLimit(params.limit, 100),
          display_offset: params.offset,
          display_sort: params.displaySort,
          display_filter: params.displayFilter,
        },
      }),
    method: 'GET',
    headers: () => ({ Accept: 'text/csv' }),
  },

  transformResponse: async (response: Response) => {
    const rows = await readSemrushReport<SemrushBacklinksRow>(response, COLUMNS)

    return {
      success: true,
      output: { backlinks: rows },
    }
  },

  outputs: {
    backlinks: {
      type: 'array',
      description: 'Backlinks pointing at the target',
      items: {
        type: 'object',
        properties: {
          pageAuthorityScore: {
            type: 'number',
            description: 'Authority Score of the source page',
            optional: true,
            nullable: true,
          },
          sourceTitle: {
            type: 'string',
            description: 'Title of the linking page',
            optional: true,
            nullable: true,
          },
          sourceUrl: {
            type: 'string',
            description: 'URL of the linking page',
            optional: true,
            nullable: true,
          },
          targetUrl: {
            type: 'string',
            description: 'URL the backlink points to',
            optional: true,
            nullable: true,
          },
          anchor: {
            type: 'string',
            description: 'Anchor text of the backlink',
            optional: true,
            nullable: true,
          },
          nofollow: {
            type: 'string',
            description: 'Raw rel="nofollow" flag as returned by the API',
            optional: true,
            nullable: true,
          },
          externalLinksNum: {
            type: 'number',
            description: 'External links on the source page',
            optional: true,
            nullable: true,
          },
          internalLinksNum: {
            type: 'number',
            description: 'Internal links on the source page',
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
