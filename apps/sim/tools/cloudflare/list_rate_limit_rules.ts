import type {
  CloudflareListRateLimitRulesParams,
  CloudflareRulesetResponse,
} from '@/tools/cloudflare/types'
import {
  cloudflareErrorMessage,
  cloudflareHeaders,
  emptyRuleset,
  mapRuleset,
} from '@/tools/cloudflare/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const listRateLimitRulesTool: ToolConfig<
  CloudflareListRateLimitRulesParams,
  CloudflareRulesetResponse
> = {
  id: 'cloudflare_list_rate_limit_rules',
  name: 'Cloudflare List Rate Limiting Rules',
  description:
    'Lists the rate limiting rules on a zone by reading the http_ratelimit phase entry point ruleset. This uses the current Rulesets-based rate limiting API; the legacy rate_limits endpoint is no longer available. The returned ruleset ID is what "Create Rate Limiting Rule", "Update Rate Limiting Rule", and "Delete Ruleset Rule" need. Requires an API token with Zone WAF Read.',
  version: '1.0.0',

  params: {
    zoneId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The zone ID to list rate limiting rules for',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Cloudflare API Token',
    },
  },

  request: {
    url: (params) =>
      `https://api.cloudflare.com/client/v4/zones/${safeUrlPathSegment(params.zoneId, 'zoneId')}/rulesets/phases/http_ratelimit/entrypoint`,
    method: 'GET',
    headers: (params) => cloudflareHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      return {
        success: false,
        output: emptyRuleset(),
        error: cloudflareErrorMessage(data, 'Failed to list rate limiting rules'),
      }
    }

    return { success: true, output: mapRuleset(data.result) }
  },

  outputs: {
    id: {
      type: 'string',
      description: 'Ruleset ID of the http_ratelimit entry point, needed to create or edit rules',
    },
    name: { type: 'string', description: 'Ruleset name' },
    description: { type: 'string', description: 'Ruleset description' },
    kind: { type: 'string', description: 'Ruleset kind' },
    phase: { type: 'string', description: 'Phase the ruleset runs in (http_ratelimit)' },
    version: { type: 'string', description: 'Ruleset version', optional: true },
    last_updated: {
      type: 'string',
      description: 'RFC 3339 timestamp of the last change',
      optional: true,
    },
    rules: {
      type: 'array',
      description: 'Rate limiting rules, in evaluation order',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Rule identifier' },
          version: { type: 'string', description: 'Rule version', optional: true },
          action: {
            type: 'string',
            description: 'Action applied once the rate limit is exceeded',
          },
          action_parameters: {
            type: 'json',
            description: 'Action-specific parameters, such as a custom block response',
            optional: true,
          },
          expression: {
            type: 'string',
            description: 'Filter expression selecting the requests the rule applies to',
          },
          description: { type: 'string', description: 'Rule description' },
          enabled: { type: 'boolean', description: 'Whether the rule is enabled' },
          ref: { type: 'string', description: 'Rule reference tag', optional: true },
          last_updated: {
            type: 'string',
            description: 'RFC 3339 timestamp of the last change',
            optional: true,
          },
          categories: {
            type: 'array',
            description: 'Managed-rule categories',
            items: { type: 'string', description: 'Category tag' },
          },
          logging: { type: 'json', description: 'Logging configuration', optional: true },
          ratelimit: {
            type: 'json',
            description:
              'Rate limiting configuration (characteristics, period, requests_per_period, mitigation_timeout, counting_expression, requests_to_origin)',
            optional: true,
          },
        },
      },
    },
  },
}
