import type {
  SemrushBacklinksIndexedPagesParams,
  SemrushBacklinksIndexedPagesResponse,
  SemrushBacklinksIndexedPagesRow,
} from '@/tools/semrush/types'
import {
  buildSemrushUrl,
  normalizeLimit,
  readSemrushReport,
  SEMRUSH_BACKLINKS_URL,
} from '@/tools/semrush/utils'
import type { ToolConfig } from '@/tools/types'

const COLUMNS = [
  'source_url',
  'source_title',
  'response_code',
  'backlinks_num',
  'domains_num',
  'last_seen',
  'external_num',
  'internal_num',
] as const

export const semrushBacklinksIndexedPagesTool: ToolConfig<
  SemrushBacklinksIndexedPagesParams,
  SemrushBacklinksIndexedPagesResponse
> = {
  id: 'semrush_backlinks_indexed_pages',
  name: 'Semrush Indexed Pages',
  description:
    'List the pages of a target that attract backlinks, with response code and link counts.',
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
        type: 'backlinks_pages',
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
    const rows = await readSemrushReport<SemrushBacklinksIndexedPagesRow>(response, COLUMNS)

    return {
      success: true,
      output: { pages: rows },
    }
  },

  outputs: {
    pages: {
      type: 'array',
      description: 'Indexed pages of the target and the links they attract',
      items: {
        type: 'object',
        properties: {
          sourceUrl: {
            type: 'string',
            description: 'URL of the linking page',
            optional: true,
            nullable: true,
          },
          sourceTitle: {
            type: 'string',
            description: 'Title of the linking page',
            optional: true,
            nullable: true,
          },
          responseCode: {
            type: 'number',
            description: 'HTTP status code the page returned when last crawled',
            optional: true,
            nullable: true,
          },
          backlinksNum: {
            type: 'number',
            description: 'Number of backlinks',
            optional: true,
            nullable: true,
          },
          domainsNum: {
            type: 'number',
            description: 'Number of referring domains',
            optional: true,
            nullable: true,
          },
          lastSeen: {
            type: 'number',
            description: 'Unix timestamp when the link was last seen',
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
        },
      },
    },
  },
}
