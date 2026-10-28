import { isRecordLike } from '@sim/utils/object'
import { RULESET_OUTPUTS } from '@/tools/cloudflare/outputs'
import type {
  CloudflareRulesetResponse,
  CloudflareUpdateRulesetRuleParams,
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

export const updateRulesetRuleTool: ToolConfig<
  CloudflareUpdateRulesetRuleParams,
  CloudflareRulesetResponse
> = {
  id: 'cloudflare_update_ruleset_rule',
  name: 'Cloudflare Update Ruleset Rule',
  description:
    'Updates a rule in a zone ruleset. Cloudflare replaces the rule definition rather than merging it, so you must send every field you want the rule to keep — any field you omit is reset to its default. Read the current rule with "Get Ruleset" first. Requires an API token with Zone WAF Edit (or another matching ruleset Write permission).',
  version: '1.0.0',

  params: {
    exposed_credential_check: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON object. Configuration for exposed credential checking. Fields: password_expression, username_expression.',
    },
    position: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON object. An object configuring where the rule will be placed. Fields: before, after, index.',
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
      description: 'The ruleset ID containing the rule',
    },
    ruleId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The rule ID to update',
    },
    action: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The action the rule performs, e.g. block, challenge, js_challenge, managed_challenge, log, skip, or execute. Required because this endpoint replaces the rule definition — omitting it resets the stored action',
    },
    expression: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Cloudflare filter expression selecting matching requests. Required because this endpoint replaces the rule definition — omitting it resets the stored expression',
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
        'JSON object of action-specific parameters, e.g. {"id":"<MANAGED_RULESET_ID>","overrides":{"rules":[{"id":"<RULE_ID>","action":"log","enabled":true,"score_threshold":40}]}}. Required on an execute rule and must be sent on every update: the endpoint replaces the rule, so omitting it resets action_parameters to {} — which unbinds the managed ruleset the rule deploys and every override under it',
    },
    ratelimit: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON rate limiting configuration to preserve on a rule in the http_ratelimit phase, e.g. {"characteristics":["cf.colo.id","ip.src"],"period":60,"requests_per_period":100}. Because the update replaces the rule, omitting this on a rate limiting rule stops it rate limiting',
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
    url: (params) => {
      const url = new URL(
        `https://api.cloudflare.com/client/v4/zones/${safeUrlPathSegment(params.zoneId, 'zoneId')}/rulesets/${safeUrlPathSegment(params.rulesetId, 'rulesetId')}/rules/${safeUrlPathSegment(params.ruleId, 'ruleId')}`
      )
      appendParam(url, 'dry_run', params.dry_run)
      return url.toString()
    },
    method: 'PATCH',
    headers: (params) => cloudflareHeaders(params.apiKey),
    body: (params) => {
      const body: Record<string, unknown> = {
        action: params.action,
        expression: params.expression,
      }
      if (params.description !== undefined) body.description = params.description
      if (params.enabled !== undefined) body.enabled = params.enabled
      if (params.ref) body.ref = params.ref

      const actionParameters = parseJsonObjectParam(params.actionParameters, 'Action Parameters')
      /**
       * PATCH replaces the rule, so action_parameters that is omitted falls back
       * to the schema default of {}. On an execute rule that drops the managed
       * ruleset ID, unbinding the WAF managed ruleset and every override under
       * it. An explicit `{}` is the same payload by a different route and does
       * the same damage, so emptiness is what is checked rather than presence.
       * Refuse rather than silently tear the rule down.
       */
      if (params.action === 'execute' && Object.keys(actionParameters ?? {}).length === 0) {
        throw new Error(
          'Action Parameters is required when the action is "execute". This endpoint replaces the rule, so sending it empty or omitting it would reset action_parameters and unbind the managed ruleset. Read the rule with "Get Ruleset" and resend its action_parameters.'
        )
      }
      if (actionParameters) body.action_parameters = actionParameters

      const ratelimit = parseJsonObjectParam(params.ratelimit, 'Rate Limiting Configuration')
      if (ratelimit) body.ratelimit = ratelimit

      const logging = parseJsonObjectParam(params.logging, 'Logging Configuration')
      if (logging) body.logging = logging

      if (params.exposed_credential_check !== undefined && params.exposed_credential_check !== '')
        body.exposed_credential_check = parseJsonObjectParam(
          params.exposed_credential_check,
          'exposed_credential_check'
        )
      if (params.position !== undefined && params.position !== '')
        body.position = parseJsonObjectParam(params.position, 'position')
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
      ...(!success ? { error: cloudflareErrorMessage(data, 'Failed to update ruleset rule') } : {}),
    }
  },
  outputs: RULESET_OUTPUTS,
}
