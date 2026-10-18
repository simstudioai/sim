import { isRecordLike } from '@sim/utils/object'
import type {
  CloudflareUpdateRulesetParams,
  CloudflareUpdateRulesetResponse,
} from '@/tools/cloudflare/operation-types'
import { RULESET_OUTPUTS } from '@/tools/cloudflare/outputs'
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

export const updateRulesetTool: ToolConfig<
  CloudflareUpdateRulesetParams,
  CloudflareUpdateRulesetResponse
> = {
  id: 'cloudflare_update_ruleset',
  name: 'Cloudflare Update Ruleset',
  description:
    'Updates a zone ruleset, creating a new version. Replaces the configuration; resend all values to retain.',
  version: '1.0.0',
  params: {
    zoneId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Zone id',
    },
    rulesetId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Ruleset id',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Cloudflare API token',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'An informative description of the ruleset.',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The human-readable name of the ruleset.',
    },
    kind: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The kind of the ruleset. Allowed values: managed, custom, root, zone.',
    },
    phase: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The phase of the ruleset. Allowed values: ddos_l4, ddos_l7, http_config_settings, http_custom_errors, http_log_custom_fields, http_ratelimit, http_request_cache_settings, http_request_dynamic_redirect, http_request_firewall_custom, http_request_firewall_managed, http_request_late_transform, http_request_origin, http_request_redirect, http_request_sanitize, http_request_sbfm, http_request_transform, http_response_cache_settings, http_response_compression, http_response_firewall_custom, http_response_firewall_managed, http_response_headers_transform, magic_transit, magic_transit_ids_managed, magic_transit_managed, magic_transit_ratelimit.',
    },
    rules: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON array. The list of rules in the ruleset. Fields: action, action_parameters, categories, description, enabled, exposed_credential_check, expression, id, last_updated, logging, ratelimit, ref, version.',
    },
    dry_run: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Validates the request without persisting changes when set to `true`. Responses that normally return 200 return `result: null`; endpoints that normally return 204 continue to return 204.',
    },
  },
  request: {
    url: (params) => {
      const url = new URL(
        `https://api.cloudflare.com/client/v4/zones/${safeUrlPathSegment(params.zoneId, 'zoneId')}/rulesets/${safeUrlPathSegment(params.rulesetId, 'rulesetId')}`
      )
      appendParam(url, 'dry_run', params.dry_run)
      return url.toString()
    },
    method: 'PUT',
    headers: (params) => ({ ...cloudflareHeaders(params.apiKey) }),
    body: (params) => ({
      description: params.description,
      name: params.name,
      kind: params.kind,
      phase: params.phase,
      rules: parseJsonArrayParam(params.rules, 'rules'),
    }),
  },
  transformResponse: async (response, params) => {
    const data = await readCloudflareResponse(response)
    const success =
      response.ok &&
      data.success === true &&
      (isRecordLike(data.result) || (params?.dry_run === true && data.result === null))
    return {
      success,
      output: mapCloudflareRuleset(data.result),
      ...(!success ? { error: cloudflareErrorMessage(data, 'Failed to update ruleset') } : {}),
    }
  },
  outputs: RULESET_OUTPUTS,
}
