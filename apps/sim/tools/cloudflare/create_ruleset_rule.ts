import { isRecordLike } from '@sim/utils/object'
import { RULESET_OUTPUTS } from '@/tools/cloudflare/outputs'
import type {
  CloudflareCreateRulesetRuleParams,
  CloudflareRulesetResponse,
} from '@/tools/cloudflare/types'
import {
  appendParam,
  cloudflareErrorMessage,
  cloudflareHeaders,
  mapCloudflareRuleset,
  parseJsonObjectParam,
  readCloudflareResponse,
} from '@/tools/cloudflare/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

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
    exposed_credential_check: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON object. Configuration for exposed credential checking. Fields: password_expression, username_expression.',
    },
    id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The unique ID of the rule.',
    },
    logging: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        "JSON object. An object configuring the rule's logging behavior. Fields: enabled.",
    },
    ratelimit: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        "JSON object. An object configuring the rule's rate limit behavior. Fields: characteristics, counting_expression, mitigation_timeout, period, requests_per_period, requests_to_origin, score_per_period, score_response_header_name.",
    },
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
    url: (params) => {
      const url = new URL(
        `https://api.cloudflare.com/client/v4/zones/${safeUrlPathSegment(params.zoneId, 'zoneId')}/rulesets/${safeUrlPathSegment(params.rulesetId, 'rulesetId')}/rules`
      )
      appendParam(url, 'dry_run', params.dry_run)
      return url.toString()
    },
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

      if (params.exposed_credential_check !== undefined && params.exposed_credential_check !== '')
        body.exposed_credential_check = parseJsonObjectParam(
          params.exposed_credential_check,
          'exposed_credential_check'
        )
      if (params.id !== undefined && params.id !== '') body.id = params.id
      if (params.logging !== undefined && params.logging !== '')
        body.logging = parseJsonObjectParam(params.logging, 'logging')
      if (params.ratelimit !== undefined && params.ratelimit !== '')
        body.ratelimit = parseJsonObjectParam(params.ratelimit, 'ratelimit')
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
      ...(!success ? { error: cloudflareErrorMessage(data, 'Failed to create ruleset rule') } : {}),
    }
  },
  outputs: RULESET_OUTPUTS,
}
