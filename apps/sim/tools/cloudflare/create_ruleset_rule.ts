import type {
  CloudflareCreateRulesetRuleParams,
  CloudflareRulesetResponse,
} from '@/tools/cloudflare/types'
import {
  cloudflareErrorMessage,
  cloudflareHeaders,
  emptyRuleset,
  mapRuleset,
  parseJsonObjectParam,
} from '@/tools/cloudflare/utils'
import type { ToolConfig } from '@/tools/types'

export const createRulesetRuleTool: ToolConfig<
  CloudflareCreateRulesetRuleParams,
  CloudflareRulesetResponse
> = {
  id: 'cloudflare_create_ruleset_rule',
  name: 'Cloudflare Create Ruleset Rule',
  description:
    'Adds a rule to a zone ruleset. Use "Get Phase Entry Point Ruleset" first to find the ruleset ID for the phase you want (for example http_request_firewall_custom for a WAF custom rule, or http_request_firewall_managed with action "execute" to deploy a managed ruleset). The rule is appended to the end of the ruleset unless a position is given. Requires an API token with Zone WAF Edit (or another matching ruleset Write permission).',
  version: '1.0.0',

  params: {
    zoneId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The zone ID that owns the ruleset',
    },
    rulesetId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ruleset ID to add the rule to',
    },
    action: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The action the rule performs. Valid values depend on the phase — e.g. block, challenge, js_challenge, managed_challenge, log, skip, or execute (to deploy a managed ruleset)',
    },
    expression: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Cloudflare filter expression selecting matching requests, e.g. (ip.src.country in {"GB" "FR"}). Use "true" to match every request',
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
      description: 'Reference tag that stays stable across rule updates',
    },
    actionParameters: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON object of action-specific parameters. For an "execute" rule this carries the managed ruleset id and any overrides, e.g. {"id":"<MANAGED_RULESET_ID>","overrides":{"action":"log"}}',
    },
    position: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON object placing the rule within the ruleset. Exactly one of {"before":"<RULE_ID>"}, {"after":"<RULE_ID>"}, or {"index":<1-based position>}',
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
      const body: Record<string, unknown> = {
        action: params.action,
        expression: params.expression,
      }
      if (params.description) body.description = params.description
      if (params.enabled !== undefined) body.enabled = params.enabled
      if (params.ref) body.ref = params.ref

      const actionParameters = parseJsonObjectParam(params.actionParameters, 'Action Parameters')
      if (actionParameters) body.action_parameters = actionParameters

      const position = parseJsonObjectParam(params.position, 'Position')
      if (position) body.position = position

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      return {
        success: false,
        output: emptyRuleset(),
        error: cloudflareErrorMessage(data, 'Failed to create ruleset rule'),
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
    version: { type: 'string', description: 'Ruleset version after the change', optional: true },
    last_updated: {
      type: 'string',
      description: 'RFC 3339 timestamp of the last change',
      optional: true,
    },
    rules: {
      type: 'array',
      description: 'Rules in the ruleset after the change, in evaluation order',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Rule identifier' },
          version: { type: 'string', description: 'Rule version', optional: true },
          action: { type: 'string', description: 'Action the rule performs' },
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
            description: 'Rate limiting configuration',
            optional: true,
          },
        },
      },
    },
  },
}
