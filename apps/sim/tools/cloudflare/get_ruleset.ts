import type {
  CloudflareGetRulesetParams,
  CloudflareRulesetResponse,
} from '@/tools/cloudflare/types'
import {
  cloudflareErrorMessage,
  cloudflareHeaders,
  emptyRuleset,
  mapRuleset,
} from '@/tools/cloudflare/utils'
import type { ToolConfig } from '@/tools/types'

export const getRulesetTool: ToolConfig<CloudflareGetRulesetParams, CloudflareRulesetResponse> = {
  id: 'cloudflare_get_ruleset',
  name: 'Cloudflare Get Ruleset',
  description:
    'Reads a single zone ruleset including every rule it contains, in evaluation order. Requires an API token with Zone WAF Read (or another matching ruleset Read permission).',
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
      description: 'The ruleset ID to read',
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
      `https://api.cloudflare.com/client/v4/zones/${params.zoneId.trim()}/rulesets/${params.rulesetId.trim()}`,
    method: 'GET',
    headers: (params) => cloudflareHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      return {
        success: false,
        output: emptyRuleset(),
        error: cloudflareErrorMessage(data, 'Failed to get ruleset'),
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
