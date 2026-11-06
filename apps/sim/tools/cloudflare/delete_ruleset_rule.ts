import { isRecordLike } from '@sim/utils/object'
import { RULESET_OUTPUTS } from '@/tools/cloudflare/outputs'
import type {
  CloudflareDeleteRulesetRuleParams,
  CloudflareRulesetResponse,
} from '@/tools/cloudflare/types'
import {
  appendParam,
  cloudflareErrorMessage,
  cloudflareHeaders,
  mapCloudflareRuleset,
  readCloudflareResponse,
} from '@/tools/cloudflare/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const deleteRulesetRuleTool: ToolConfig<
  CloudflareDeleteRulesetRuleParams,
  CloudflareRulesetResponse
> = {
  id: 'cloudflare_delete_ruleset_rule',
  name: 'Cloudflare Delete Ruleset Rule',
  description:
    'Permanently deletes a rule from a zone ruleset. This takes effect immediately on live traffic and cannot be undone — deleting a WAF custom rule, a managed-ruleset deployment, or a rate limiting rule removes that protection from the zone. Also use this to delete rate limiting rules, which live in the http_ratelimit phase ruleset. Requires an API token with Zone WAF Edit (or another matching ruleset Write permission).',
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
      description: 'The rule ID to delete permanently',
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
    method: 'DELETE',
    headers: (params) => cloudflareHeaders(params.apiKey),
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
      ...(!success ? { error: cloudflareErrorMessage(data, 'Failed to delete ruleset rule') } : {}),
    }
  },
  outputs: RULESET_OUTPUTS,
}
