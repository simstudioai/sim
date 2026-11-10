import type {
  SemrushReferringDomainsParams,
  SemrushReferringDomainsResponse,
  SemrushReferringDomainsRow,
} from '@/tools/semrush/types'
import {
  buildSemrushUrl,
  normalizeLimit,
  readSemrushReport,
  SEMRUSH_BACKLINKS_URL,
} from '@/tools/semrush/utils'
import type { ToolConfig } from '@/tools/types'

const COLUMNS = [
  'domain_ascore',
  'domain',
  'backlinks_num',
  'ip',
  'country',
  'first_seen',
  'last_seen',
] as const

export const semrushReferringDomainsTool: ToolConfig<
  SemrushReferringDomainsParams,
  SemrushReferringDomainsResponse
> = {
  id: 'semrush_referring_domains',
  name: 'Semrush Referring Domains',
  description:
    'List the domains linking to a target, with Authority Score, backlink count, and country.',
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
      description: 'Sort order, for example backlinks_num_desc or domain_ascore_desc',
    },
    displayFilter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Semrush display_filter expression, for example +|zone||com',
    },
  },

  request: {
    url: (params) =>
      buildSemrushUrl(SEMRUSH_BACKLINKS_URL, {
        apiKey: params.apiKey,
        type: 'backlinks_refdomains',
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
    const rows = await readSemrushReport<SemrushReferringDomainsRow>(response, COLUMNS)

    return {
      success: true,
      output: { domains: rows },
    }
  },

  outputs: {
    domains: {
      type: 'array',
      description: 'Domains linking to the target',
      items: {
        type: 'object',
        properties: {
          domainAuthorityScore: {
            type: 'number',
            description: 'Authority Score of the referring domain',
            optional: true,
            nullable: true,
          },
          domain: {
            type: 'string',
            description: 'Domain name',
            optional: true,
            nullable: true,
          },
          backlinksNum: {
            type: 'number',
            description: 'Number of backlinks',
            optional: true,
            nullable: true,
          },
          ip: {
            type: 'string',
            description: 'IP address',
            optional: true,
            nullable: true,
          },
          country: {
            type: 'string',
            description: 'Country of the referring domain',
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
