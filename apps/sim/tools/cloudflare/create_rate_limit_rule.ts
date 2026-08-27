import type {
  CloudflareCreateRateLimitRuleParams,
  CloudflareRulesetResponse,
} from '@/tools/cloudflare/types'
import {
  cloudflareErrorMessage,
  cloudflareHeaders,
  emptyRuleset,
  mapRuleset,
  parseCsvParam,
} from '@/tools/cloudflare/utils'
import type { ToolConfig } from '@/tools/types'

export const createRateLimitRuleTool: ToolConfig<
  CloudflareCreateRateLimitRuleParams,
  CloudflareRulesetResponse
> = {
  id: 'cloudflare_create_rate_limit_rule',
  name: 'Cloudflare Create Rate Limiting Rule',
  description:
    'Creates a rate limiting rule in the http_ratelimit phase entry point ruleset of a zone, using the current Rulesets-based rate limiting API (the legacy rate_limits endpoint is no longer available). Run "List Rate Limiting Rules" first to get the ruleset ID. Requires an API token with Zone WAF Edit.',
  version: '1.0.0',

  params: {
    zoneId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The zone ID to add the rate limiting rule to',
    },
    rulesetId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The http_ratelimit entry point ruleset ID, as returned by "List Rate Limiting Rules"',
    },
    expression: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Cloudflare filter expression selecting the requests the rule applies to, e.g. (http.request.uri.path matches "^/api/")',
    },
    characteristics: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Comma-separated counting characteristics. cf.colo.id is mandatory. ip.src and cf.unique_visitor_id are mutually exclusive — include at most one. Example: cf.colo.id,ip.src',
    },
    period: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Counting window in seconds. Cloudflare accepts only 10, 60, 120, 300, 600, or 3600',
    },
    requestsPerPeriod: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Number of requests allowed within the counting period before the action fires',
    },
    action: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Action applied once the limit is exceeded, e.g. block, managed_challenge, js_challenge, challenge, or log. Defaults to block',
    },
    mitigationTimeout: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Seconds the action stays applied after the limit is exceeded. Cloudflare accepts only 0, 10, 60, 120, 300, 600, 3600, or 86400',
    },
    counting_expression: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Optional expression defining which requests are counted, when it differs from the matching expression',
    },
    requestsToOrigin: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'When true, only requests that reach the origin are counted',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Human-readable description of the rule',
    },
    enabled: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the rule is enabled',
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
      `https://api.cloudflare.com/client/v4/zones/${params.zoneId.trim()}/rulesets/${params.rulesetId.trim()}/rules`,
    method: 'POST',
    headers: (params) => cloudflareHeaders(params.apiKey),
    body: (params) => {
      const characteristics = parseCsvParam(params.characteristics)
      if (!characteristics) {
        throw new Error('Characteristics must list at least one counting characteristic')
      }

      const ratelimit: Record<string, unknown> = {
        characteristics,
        period: params.period,
        requests_per_period: params.requestsPerPeriod,
      }
      if (params.mitigationTimeout !== undefined) {
        ratelimit.mitigation_timeout = params.mitigationTimeout
      }
      if (params.counting_expression) ratelimit.counting_expression = params.counting_expression
      if (params.requestsToOrigin !== undefined) {
        ratelimit.requests_to_origin = params.requestsToOrigin
      }

      const body: Record<string, unknown> = {
        action: params.action || 'block',
        expression: params.expression,
        ratelimit,
      }
      if (params.description) body.description = params.description
      if (params.enabled !== undefined) body.enabled = params.enabled

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      return {
        success: false,
        output: emptyRuleset(),
        error: cloudflareErrorMessage(data, 'Failed to create rate limiting rule'),
      }
    }

    return { success: true, output: mapRuleset(data.result) }
  },

  outputs: {
    id: { type: 'string', description: 'Ruleset ID of the http_ratelimit entry point' },
    name: { type: 'string', description: 'Ruleset name' },
    description: { type: 'string', description: 'Ruleset description' },
    kind: { type: 'string', description: 'Ruleset kind' },
    phase: { type: 'string', description: 'Phase the ruleset runs in (http_ratelimit)' },
    version: { type: 'string', description: 'Ruleset version after the change', optional: true },
    last_updated: {
      type: 'string',
      description: 'RFC 3339 timestamp of the last change',
      optional: true,
    },
    rules: {
      type: 'array',
      description: 'Rate limiting rules after the change, in evaluation order',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Rule identifier' },
          version: { type: 'string', description: 'Rule version', optional: true },
          action: { type: 'string', description: 'Action applied once the limit is exceeded' },
          action_parameters: {
            type: 'json',
            description: 'Action-specific parameters',
            optional: true,
          },
          expression: { type: 'string', description: 'Filter expression' },
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
            description: 'Rate limiting configuration applied to the rule',
            optional: true,
          },
        },
      },
    },
  },
}
