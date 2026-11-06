import { isRecordLike } from '@sim/utils/object'
import { RULESET_OUTPUTS } from '@/tools/cloudflare/outputs'
import type {
  CloudflareCreateRulesetParams,
  CloudflareRulesetResponse,
} from '@/tools/cloudflare/types'
import {
  appendParam,
  cloudflareErrorMessage,
  cloudflareHeaders,
  mapCloudflareRuleset,
  parseJsonArrayParam,
  readCloudflareResponse,
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
    dry_run: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'dry run',
    },
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
    url: (params) => {
      const url = new URL(
        `https://api.cloudflare.com/client/v4/zones/${safeUrlPathSegment(params.zoneId, 'zoneId')}/rulesets`
      )
      appendParam(url, 'dry_run', params.dry_run)
      return url.toString()
    },
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

  transformResponse: async (response: Response, params) => {
    const data = await readCloudflareResponse(response)
    const success =
      response.ok &&
      data.success === true &&
      (isRecordLike(data.result) || (params?.dry_run === true && data.result === null))
    return {
      success,
      output: mapCloudflareRuleset(data.result),
      ...(!success ? { error: cloudflareErrorMessage(data, 'Failed to create ruleset') } : {}),
    }
  },
  outputs: RULESET_OUTPUTS,
}
