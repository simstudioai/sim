import type {
  SemrushReferringIpsParams,
  SemrushReferringIpsResponse,
  SemrushReferringIpsRow,
} from '@/tools/semrush/types'
import {
  buildSemrushUrl,
  normalizeLimit,
  readSemrushReport,
  SEMRUSH_BACKLINKS_URL,
} from '@/tools/semrush/utils'
import type { ToolConfig } from '@/tools/types'

const COLUMNS = [
  'ip',
  'country',
  'domains_num',
  'backlinks_num',
  'first_seen',
  'last_seen',
] as const

export const semrushReferringIpsTool: ToolConfig<
  SemrushReferringIpsParams,
  SemrushReferringIpsResponse
> = {
  id: 'semrush_referring_ips',
  name: 'Semrush Referring IPs',
  description:
    'List the IP addresses linking to a target, with the domain and backlink counts behind each one.',
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
        type: 'backlinks_refips',
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
    const rows = await readSemrushReport<SemrushReferringIpsRow>(response, COLUMNS)

    return {
      success: true,
      output: { ips: rows },
    }
  },

  outputs: {
    ips: {
      type: 'array',
      description: 'IP addresses linking to the target',
      items: {
        type: 'object',
        properties: {
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
