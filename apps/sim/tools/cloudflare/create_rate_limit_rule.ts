import { isRecordLike } from '@sim/utils/object'
import { RULESET_OUTPUTS } from '@/tools/cloudflare/outputs'
import type {
  CloudflareCreateRateLimitRuleParams,
  CloudflareRulesetResponse,
} from '@/tools/cloudflare/types'
import {
  appendParam,
  cloudflareErrorMessage,
  cloudflareHeaders,
  mapCloudflareRuleset,
  parseCsvParam,
  parseJsonObjectParam,
  readCloudflareResponse,
} from '@/tools/cloudflare/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const createRateLimitRuleTool: ToolConfig<
  CloudflareCreateRateLimitRuleParams,
  CloudflareRulesetResponse
> = {
  id: 'cloudflare_create_rate_limit_rule',
  name: 'Cloudflare Create Rate Limiting Rule',
  description:
    'Creates a rate limiting rule in the http_ratelimit phase entry point ruleset of a zone, using the current Rulesets-based rate limiting API (the legacy rate_limits endpoint is no longer available). Run "List Rate Limiting Rules" first to get the ruleset ID. Requires an API token with Zone WAF Edit.',
  version: '1.0.0',

  params: {
    actionParameters: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        "JSON object. The parameters configuring the rule's action. Fields: response, algorithms, id, matched_data, overrides, cookie_fields, raw_response_fields, request_fields, response_fields, transformed_request_fields, from_list, from_value, headers, uri, host_header, origin, sni, increment, content_type, status_code, content, asset_name, immutable, max-age, must-revalidate, must-understand, no-cache, no-store, no-transform, private, proxy-revalidate, public, s-maxage, stale-if-error, stale-while-revalidate, additional_cacheable_ports, browser_ttl, cache, cache_key, cache_reserve, edge_ttl, origin_cache_control, origin_error_page_passthru, origin_range_requests, read_timeout, respect_strong_etags, serve_stale, shared_dictionary, strip_etags, strip_last_modified, strip_set_cookie, vary, operation, values, expression, automatic_https_rewrites, autominify, bic, content_converter, disable_apps, disable_pay_per_crawl, disable_rum, disable_zaraz, email_obfuscation, fonts, hotlink_protection, mirage, opportunistic_encryption, polish, redirects_for_ai_training, request_body_buffering, response_body_buffering, rocket_loader, security_level, server_side_excludes, ssl, sxg, webmcp_enabled, webmcp_packs, phase, phases, products, rules, ruleset, rulesets, link_maze.",
    },
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
    ref: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "The reference of the rule (the rule's ID by default).",
    },
    position: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON object. An object configuring where the rule will be placed. Fields: before, after, index.',
    },
    score_per_period: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The score threshold per period for which the action will be executed the first time.',
    },
    score_response_header_name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'A response header name provided by the origin, which contains the score to increment rate limit counter with.',
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
      description: 'The zone ID to add the rate limiting rule to',
    },
    rulesetId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The http_ratelimit entry point ruleset ID, as returned by "List Rate Limiting Rules"',
    },
    expression: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Cloudflare filter expression selecting the requests the rule applies to, e.g. (http.request.uri.path matches "^/api/")',
    },
    characteristics: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Comma-separated counting characteristics. cf.colo.id is mandatory. ip.src and cf.unique_visitor_id are mutually exclusive — include at most one. Example: cf.colo.id,ip.src',
    },
    period: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Counting window in seconds. Cloudflare accepts only 10, 60, 120, 300, 600, or 3600',
    },
    requestsPerPeriod: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Number of requests allowed within the counting period before the action fires',
    },
    action: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Action applied once the limit is exceeded, e.g. block, managed_challenge, js_challenge, challenge, or log. Defaults to block',
    },
    mitigationTimeout: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Seconds the action stays applied after the limit is exceeded. Cloudflare accepts only 0, 10, 60, 120, 300, 600, 3600, or 86400',
    },
    counting_expression: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Optional expression defining which requests are counted, when it differs from the matching expression',
    },
    requestsToOrigin: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'When true, only requests that reach the origin are counted',
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
      const characteristics = parseCsvParam(params.characteristics)
      if (!characteristics) {
        throw new Error('Characteristics must list at least one counting characteristic')
      }

      const ratelimit: Record<string, unknown> = {
        characteristics,
        period: params.period,
        requests_per_period: params.requestsPerPeriod,
      }
      if (params.mitigationTimeout !== undefined) {
        ratelimit.mitigation_timeout = params.mitigationTimeout
      }
      if (params.counting_expression) ratelimit.counting_expression = params.counting_expression
      if (params.requestsToOrigin !== undefined) {
        ratelimit.requests_to_origin = params.requestsToOrigin
      }

      const body: Record<string, unknown> = {
        action: params.action || 'block',
        expression: params.expression,
        ratelimit,
      }
      if (params.description) body.description = params.description
      if (params.enabled !== undefined) body.enabled = params.enabled

      if (params.actionParameters !== undefined && params.actionParameters !== '')
        body.action_parameters = parseJsonObjectParam(params.actionParameters, 'actionParameters')
      if (params.exposed_credential_check !== undefined && params.exposed_credential_check !== '')
        body.exposed_credential_check = parseJsonObjectParam(
          params.exposed_credential_check,
          'exposed_credential_check'
        )
      if (params.id !== undefined && params.id !== '') body.id = params.id
      if (params.logging !== undefined && params.logging !== '')
        body.logging = parseJsonObjectParam(params.logging, 'logging')
      if (params.ref !== undefined && params.ref !== '') body.ref = params.ref
      if (params.position !== undefined && params.position !== '')
        body.position = parseJsonObjectParam(params.position, 'position')
      if (params.score_per_period !== undefined)
        ratelimit.score_per_period = params.score_per_period
      if (params.score_response_header_name !== undefined)
        ratelimit.score_response_header_name = params.score_response_header_name
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
      ...(!success
        ? { error: cloudflareErrorMessage(data, 'Failed to create rate limit rule') }
        : {}),
    }
  },
  outputs: RULESET_OUTPUTS,
}
