import { isRecordLike } from '@sim/utils/object'
import { RULESET_OUTPUTS } from '@/tools/cloudflare/outputs'
import type {
  CloudflareGetRulesetEntrypointParams,
  CloudflareRulesetResponse,
} from '@/tools/cloudflare/types'
import {
  cloudflareErrorMessage,
  cloudflareHeaders,
  mapCloudflareRuleset,
  readCloudflareResponse,
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
    const data = await readCloudflareResponse(response)
    const success = response.ok && data.success === true && isRecordLike(data.result)
    return {
      success,
      output: mapCloudflareRuleset(data.result),
      ...(!success
        ? { error: cloudflareErrorMessage(data, 'Failed to get ruleset entrypoint') }
        : {}),
    }
  },
  outputs: RULESET_OUTPUTS,
}
