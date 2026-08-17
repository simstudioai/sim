import type {
  CloudflareRulesetResponse,
  CloudflareUpdateRateLimitRuleParams,
} from '@/tools/cloudflare/types'
import {
  cloudflareErrorMessage,
  cloudflareHeaders,
  emptyRuleset,
  mapRuleset,
  parseCsvParam,
  parseJsonObjectParam,
} from '@/tools/cloudflare/utils'
import type { ToolConfig } from '@/tools/types'

export const updateRateLimitRuleTool: ToolConfig<
  CloudflareUpdateRateLimitRuleParams,
  CloudflareRulesetResponse
> = {
  id: 'cloudflare_update_rate_limit_rule',
  name: 'Cloudflare Update Rate Limiting Rule',
  description:
    'Updates a rate limiting rule in the http_ratelimit phase entry point ruleset of a zone, using the current Rulesets-based rate limiting API. Cloudflare replaces the rule definition rather than merging it, so send the complete rule — every field you omit is reset. Run "List Rate Limiting Rules" first to read the current definition and get the ruleset ID. Requires an API token with Zone WAF Edit.',
  version: '1.0.0',

  params: {
    zoneId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The zone ID that owns the rule',
    },
    rulesetId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The http_ratelimit entry point ruleset ID, as returned by "List Rate Limiting Rules"',
    },
    ruleId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The rate limiting rule ID to update',
    },
    expression: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Cloudflare filter expression selecting the requests the rule applies to',
    },
    characteristics: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Comma-separated counting characteristics. cf.colo.id is mandatory. ip.src and cf.unique_visitor_id are mutually exclusive — include at most one.',
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
      required: true,
      visibility: 'user-or-llm',
      description:
        'Action applied once the limit is exceeded: block, managed_challenge, js_challenge, challenge, or log. Required because this endpoint replaces the rule rather than merging into it — a defaulted action would silently convert an existing log or challenge rule into a hard block',
    },
    mitigationTimeout: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Seconds the action stays applied. Cloudflare accepts only 0, 10, 60, 120, 300, 600, 3600, or 86400',
    },
    counting_expression: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional expression defining which requests are counted',
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
    ref: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Reference tag that stays stable across rule updates. Because the update replaces the rule, omitting it resets the tag to the rule ID and breaks anything matching on the old value',
    },
    actionParameters: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON object of action-specific parameters for the mitigation action, e.g. {"response":{"status_code":429,"content":"{\\"error\\":\\"rate limited\\"}","content_type":"application/json"}} for a custom block response. Because the update replaces the rule, omitting it resets action_parameters to {} and the rule falls back to Cloudflare\'s default block page',
    },
    logging: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON logging configuration to preserve, e.g. {"enabled":true}. Omitting it on a rule that had logging configured resets it to the default',
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
      `https://api.cloudflare.com/client/v4/zones/${params.zoneId.trim()}/rulesets/${params.rulesetId.trim()}/rules/${params.ruleId.trim()}`,
    method: 'PATCH',
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
        action: params.action,
        expression: params.expression,
        ratelimit,
      }
      if (params.description !== undefined) body.description = params.description
      if (params.enabled !== undefined) body.enabled = params.enabled
      if (params.ref) body.ref = params.ref

      /**
       * PATCH replaces the whole rule definition, so any of these left out falls
       * back to its schema default: a custom block response reverts to
       * Cloudflare's default block page and the logging configuration resets.
       * Forward them whenever the caller resends them.
       * https://developers.cloudflare.com/ruleset-engine/rulesets-api/update-rule/
       */
      const actionParameters = parseJsonObjectParam(params.actionParameters, 'Action Parameters')
      if (actionParameters) body.action_parameters = actionParameters

      const logging = parseJsonObjectParam(params.logging, 'Logging Configuration')
      if (logging) body.logging = logging

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      return {
        success: false,
        output: emptyRuleset(),
        error: cloudflareErrorMessage(data, 'Failed to update rate limiting rule'),
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
