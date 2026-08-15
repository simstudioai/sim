import type {
  CloudflareListRulesetsParams,
  CloudflareListRulesetsResponse,
} from '@/tools/cloudflare/types'
import { cloudflareErrorMessage, cloudflareHeaders } from '@/tools/cloudflare/utils'
import type { ToolConfig } from '@/tools/types'

export const listRulesetsTool: ToolConfig<
  CloudflareListRulesetsParams,
  CloudflareListRulesetsResponse
> = {
  id: 'cloudflare_list_rulesets',
  name: 'Cloudflare List Rulesets',
  description:
    'Lists every ruleset defined on a zone across all phases (WAF custom rules, managed rules, rate limiting, transform rules, and more). The list response deliberately omits the rules inside each ruleset — use "Get Ruleset" to read them. Requires an API token with Zone WAF Read (or another matching ruleset Read permission).',
  version: '1.0.0',

  params: {
    zoneId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The zone ID to list rulesets for',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Cloudflare API Token',
    },
  },

  request: {
    url: (params) => `https://api.cloudflare.com/client/v4/zones/${params.zoneId}/rulesets`,
    method: 'GET',
    headers: (params) => cloudflareHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      return {
        success: false,
        output: { rulesets: [], total_count: 0 },
        error: cloudflareErrorMessage(data, 'Failed to list rulesets'),
      }
    }

    const rulesets = Array.isArray(data.result) ? data.result : []

    return {
      success: true,
      output: {
        rulesets: rulesets.map((ruleset: any) => ({
          id: ruleset.id ?? '',
          name: ruleset.name ?? '',
          description: ruleset.description ?? '',
          kind: ruleset.kind ?? '',
          phase: ruleset.phase ?? '',
          version: ruleset.version ?? null,
          last_updated: ruleset.last_updated ?? null,
        })),
        total_count: rulesets.length,
      },
    }
  },

  outputs: {
    rulesets: {
      type: 'array',
      description: 'Rulesets defined on the zone',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Ruleset identifier' },
          name: { type: 'string', description: 'Ruleset name' },
          description: { type: 'string', description: 'Ruleset description' },
          kind: {
            type: 'string',
            description: 'Ruleset kind (managed, custom, root, or zone)',
          },
          phase: {
            type: 'string',
            description:
              'Phase the ruleset runs in (e.g., http_request_firewall_custom, http_request_firewall_managed, http_ratelimit)',
          },
          version: { type: 'string', description: 'Ruleset version', optional: true },
          last_updated: {
            type: 'string',
            description: 'RFC 3339 timestamp of the last change',
            optional: true,
          },
        },
      },
    },
    total_count: { type: 'number', description: 'Number of rulesets returned' },
  },
}
