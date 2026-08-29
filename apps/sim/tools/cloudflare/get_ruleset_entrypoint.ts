import type {
  CloudflareGetRulesetEntrypointParams,
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

export const getRulesetEntrypointTool: ToolConfig<
  CloudflareGetRulesetEntrypointParams,
  CloudflareRulesetResponse
> = {
  id: 'cloudflare_get_ruleset_entrypoint',
  name: 'Cloudflare Get Phase Entry Point Ruleset',
  description:
    'Reads the entry point ruleset for a phase on a zone, including all of its rules. This is how you find the ruleset ID you need before adding, updating, or deleting a rule — for example http_request_firewall_custom for WAF custom rules, http_request_firewall_managed for managed-ruleset deployments and overrides, or http_ratelimit for rate limiting rules. Requires an API token with Zone WAF Read (or another matching ruleset Read permission).',
  version: '1.0.0',

  params: {
    zoneId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The zone ID to read the phase entry point for',
    },
    phase: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The ruleset phase, e.g. http_request_firewall_custom, http_request_firewall_managed, http_ratelimit, http_request_transform, http_request_dynamic_redirect',
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
      `https://api.cloudflare.com/client/v4/zones/${safeUrlPathSegment(params.zoneId, 'zoneId')}/rulesets/phases/${safeUrlPathSegment(params.phase, 'phase')}/entrypoint`,
    method: 'GET',
    headers: (params) => cloudflareHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      return {
        success: false,
        output: emptyRuleset(),
        error: cloudflareErrorMessage(data, 'Failed to get phase entry point ruleset'),
      }
    }

    return { success: true, output: mapRuleset(data.result) }
  },

  outputs: {
    id: { type: 'string', description: 'Entry point ruleset identifier' },
    name: { type: 'string', description: 'Ruleset name' },
    description: { type: 'string', description: 'Ruleset description' },
    kind: { type: 'string', description: 'Ruleset kind (managed, custom, root, or zone)' },
    phase: { type: 'string', description: 'Phase the ruleset runs in' },
    version: { type: 'string', description: 'Ruleset version', optional: true },
    last_updated: {
      type: 'string',
      description: 'RFC 3339 timestamp of the last change',
      optional: true,
    },
    rules: {
      type: 'array',
      description: 'Rules contained in the ruleset, in evaluation order',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Rule identifier' },
          version: { type: 'string', description: 'Rule version', optional: true },
          action: {
            type: 'string',
            description: 'Action the rule performs (e.g., block, challenge, log, skip, execute)',
          },
          action_parameters: {
            type: 'json',
            description:
              'Action-specific parameters, including managed-ruleset overrides on execute rules',
            optional: true,
          },
          expression: {
            type: 'string',
            description:
              'Filter expression selecting matching requests. Empty on managed-ruleset rules',
          },
          description: { type: 'string', description: 'Rule description' },
          enabled: { type: 'boolean', description: 'Whether the rule is enabled' },
          ref: {
            type: 'string',
            description: 'Rule reference tag that survives rule updates',
            optional: true,
          },
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
            description: 'Rate limiting configuration for rules in the http_ratelimit phase',
            optional: true,
          },
        },
      },
    },
  },
}
