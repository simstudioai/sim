import type {
  CloudflareCreateRulesetParams,
  CloudflareRulesetResponse,
} from '@/tools/cloudflare/types'
import {
  cloudflareErrorMessage,
  cloudflareHeaders,
  emptyRuleset,
  mapRuleset,
  parseJsonArrayParam,
} from '@/tools/cloudflare/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const createRulesetTool: ToolConfig<
  CloudflareCreateRulesetParams,
  CloudflareRulesetResponse
> = {
  id: 'cloudflare_create_ruleset',
  name: 'Cloudflare Create Ruleset',
  description:
    'Creates a zone ruleset for a phase, optionally seeded with its first rules. Use this when a phase has no entry point ruleset yet — reading the entry point returns 404 on a zone that has never had a rule in that phase, and rules can only be appended to a ruleset that already exists. Create the entry point with kind "zone" and the target phase (for example http_ratelimit for rate limiting rules or http_request_firewall_custom for WAF custom rules), then use the returned ruleset ID for later rule operations. Requires an API token with Zone WAF Edit (or another matching ruleset Edit permission).',
  version: '1.0.0',

  params: {
    zoneId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The zone ID to create the ruleset in',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Human-readable name for the ruleset',
    },
    phase: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The ruleset phase, e.g. http_ratelimit, http_request_firewall_custom, http_request_firewall_managed, http_request_transform, http_request_dynamic_redirect',
    },
    kind: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Ruleset kind: zone or custom. Use zone to create a phase entry point ruleset and custom for a ruleset an execute rule deploys. Defaults to zone. "root" is the account-level phase entry point and "managed" is Cloudflare-owned, so neither can be created on this zone-scoped endpoint',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Description of the ruleset',
    },
    rules: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON array of rules to seed the ruleset with, in evaluation order. Each rule takes action, expression, and optionally description, enabled, action_parameters, and ratelimit',
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
      `https://api.cloudflare.com/client/v4/zones/${safeUrlPathSegment(params.zoneId, 'zoneId')}/rulesets`,
    method: 'POST',
    headers: (params) => cloudflareHeaders(params.apiKey),
    body: (params) => {
      const body: Record<string, unknown> = {
        name: params.name,
        kind: params.kind || 'zone',
        phase: params.phase,
      }
      if (params.description) body.description = params.description

      const rules = parseJsonArrayParam(params.rules, 'Rules')
      body.rules = rules ?? []

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      return {
        success: false,
        output: emptyRuleset(),
        error: cloudflareErrorMessage(data, 'Failed to create ruleset'),
      }
    }

    return { success: true, output: mapRuleset(data.result) }
  },

  outputs: {
    id: { type: 'string', description: 'Ruleset identifier' },
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
