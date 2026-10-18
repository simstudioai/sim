import type {
  ACCESS_APPLICATION_OUTPUTS,
  ACCESS_GROUP_OUTPUTS,
  ACCESS_POLICY_OUTPUTS,
  CERTIFICATE_OUTPUTS,
  DNS_RECORD_OUTPUTS,
  IDENTITY_PROVIDER_OUTPUTS,
  LIST_RULESETS_OUTPUTS,
  R2_BUCKET_OUTPUTS,
  RULESET_OUTPUTS,
  SERVICE_TOKEN_OUTPUTS,
  SERVICE_TOKEN_SECRET_OUTPUTS,
  TUNNEL_CONFIGURATION_OUTPUTS,
  TUNNEL_OUTPUTS,
  WORKER_ROUTE_OUTPUTS,
  WORKER_SCRIPT_OUTPUTS,
  WORKER_SETTINGS_OUTPUTS,
  ZONE_OUTPUTS,
} from '@/tools/cloudflare/outputs'
import type { CloudflareOutput } from '@/tools/cloudflare/utils'
import type { ToolResponse } from '@/tools/types'

interface CloudflareBaseParams {
  apiKey: string
}

/**
 * Pagination metadata Cloudflare attaches to list endpoints. Page-based
 * endpoints populate `page`/`per_page`/`total_count`; the Rulesets engine and
 * R2 use cursors instead, so every field is optional.
 */
interface CloudflareResultInfo {
  page?: number
  per_page?: number
  count?: number
  total_count?: number
  total_pages?: number
  cursor?: string
  cursors?: {
    before?: string
    after?: string
  }
}

/**
 * The Cloudflare v4 response envelope. Every endpoint answers with this shape,
 * and a `200 OK` carrying `success: false` is a failure — callers must branch
 * on `success` rather than the HTTP status. `result` is absent on failures.
 */
export interface CloudflareEnvelope<TResult = unknown> {
  success?: boolean
  errors?: Array<{ code?: number; message?: string }>
  messages?: unknown[]
  result?: TResult
  result_info?: CloudflareResultInfo
}

/** Raw rule payload inside a ruleset, as returned by the Rulesets API. */
interface CloudflareRawRule {
  id?: string
  version?: string
  action?: string
  action_parameters?: {
    id?: string
    overrides?: Record<string, unknown>
    [key: string]: unknown
  }
  expression?: string
  description?: string
  enabled?: boolean
  ref?: string
  last_updated?: string
  categories?: string[]
  logging?: Record<string, unknown>
  ratelimit?: Record<string, unknown>
}

/** Raw ruleset payload. `rules` is omitted by the list-rulesets endpoint. */
export interface CloudflareRawRuleset {
  id?: string
  name?: string
  description?: string
  kind?: string
  phase?: string
  version?: string
  last_updated?: string
  rules?: CloudflareRawRule[]
}

/** Raw Cloudflare Access application payload. */

/** Raw Cloudflare Access policy payload. */

/** Raw Cloudflare Access group payload. */

/** Raw Cloudflare Access identity provider payload. */

/** Raw Cloudflare Access service token payload. `client_secret` only on create. */

/** Raw R2 bucket payload. */

/** Raw Workers script payload from the list-scripts endpoint. */

/** Raw Workers route payload. */

/** Raw Cloudflare Tunnel (cloudflared) payload. */

/** Raw zone payload from the zones endpoints. */

/** Raw DNS record payload. */

/** Raw hostname-validation record shared by certificate pack validation fields. */

/** Raw certificate inside a certificate pack. */

/** Raw certificate pack payload. */

/** Raw DNS analytics aggregate block (`totals`, `min`, and `max` share this shape). */
interface CloudflareRawDnsAnalyticsAggregate {
  queryCount?: number
  uncachedCount?: number
  staleCount?: number
  responseTimeAvg?: number
  responseTimeMedian?: number
  responseTime90th?: number
  responseTime99th?: number
}

/** Raw DNS analytics report payload. */
export interface CloudflareRawDnsAnalyticsReport {
  totals?: CloudflareRawDnsAnalyticsAggregate
  min?: Record<string, unknown>
  max?: Record<string, unknown>
  data?: Array<{ dimensions?: string[]; metrics?: number[] }>
  data_lag?: number
  rows?: number
  query?: {
    since?: string
    until?: string
    metrics?: string[]
    dimensions?: string[]
    filters?: string
    sort?: string[]
    limit?: number
  }
}

export interface CloudflareListZonesParams extends CloudflareBaseParams {
  type?: string
  account_name?: string

  name?: string
  status?: string
  page?: number
  per_page?: number
  accountId?: string
  order?: string
  direction?: string
  match?: string
}

export interface CloudflareListZonesResponse extends ToolResponse {
  output: {
    zones: CloudflareOutput<typeof ZONE_OUTPUTS>[]
    total_count: number
    result_info: CloudflareResultInfo | null
  }
}

export interface CloudflareGetZoneParams extends CloudflareBaseParams {
  zoneId: string
}

export interface CloudflareGetZoneResponse extends ToolResponse {
  output: CloudflareOutput<typeof ZONE_OUTPUTS>
}

export interface CloudflareCreateZoneParams extends CloudflareBaseParams {
  name: string
  accountId: string
  type?: string
}

export interface CloudflareCreateZoneResponse extends ToolResponse {
  output: CloudflareOutput<typeof ZONE_OUTPUTS>
}

export interface CloudflareDeleteZoneParams extends CloudflareBaseParams {
  zoneId: string
}

export interface CloudflareDeleteZoneResponse extends ToolResponse {
  output: {
    id: string
  }
}

export interface CloudflareListDnsRecordsParams extends CloudflareBaseParams {
  name_contains?: string
  name_startswith?: string
  name_endswith?: string
  content_contains?: string
  content_startswith?: string
  content_endswith?: string
  comment_present?: boolean
  comment_absent?: boolean
  comment_exact?: string
  comment_startswith?: string
  comment_endswith?: string
  tag_present?: string
  tag_absent?: string
  tag_contains?: string
  tag_startswith?: string
  tag_endswith?: string
  include_shadow_metadata?: boolean
  shadowed_by_name?: string
  shadowing_name?: string

  zoneId: string
  type?: string
  name?: string
  content?: string
  page?: number
  per_page?: number
  direction?: string
  match?: string
  order?: string
  proxied?: boolean
  search?: string
  tag?: string
  tag_match?: string
  commentFilter?: string
}

export interface CloudflareListDnsRecordsResponse extends ToolResponse {
  output: {
    records: CloudflareOutput<typeof DNS_RECORD_OUTPUTS>[]
    total_count: number
    result_info: CloudflareResultInfo | null
  }
}

export interface CloudflareCreateDnsRecordParams extends CloudflareBaseParams {
  settings?: string | Record<string, unknown> | unknown[]
  private_routing?: boolean
  data?: string | Record<string, unknown> | unknown[]
  include_shadow_metadata?: boolean

  zoneId: string
  type: string
  name: string
  content?: string
  ttl?: number
  proxied?: boolean
  priority?: number
  comment?: string
  tags?: string
}

export interface CloudflareCreateDnsRecordResponse extends ToolResponse {
  output: CloudflareOutput<typeof DNS_RECORD_OUTPUTS>
}

export interface CloudflareUpdateDnsRecordParams extends CloudflareBaseParams {
  clearComment?: boolean
  settings?: string | Record<string, unknown> | unknown[]
  private_routing?: boolean
  data?: string | Record<string, unknown> | unknown[]
  include_shadow_metadata?: boolean

  zoneId: string
  recordId: string
  type?: string
  name?: string
  content?: string
  ttl?: number
  proxied?: boolean
  priority?: number
  comment?: string
  tags?: string
}

export interface CloudflareUpdateDnsRecordResponse extends ToolResponse {
  output: CloudflareOutput<typeof DNS_RECORD_OUTPUTS>
}

export interface CloudflareDeleteDnsRecordParams extends CloudflareBaseParams {
  zoneId: string
  recordId: string
}

export interface CloudflareDeleteDnsRecordResponse extends ToolResponse {
  output: {
    id: string
  }
}

export interface CloudflareListCertificatesParams extends CloudflareBaseParams {
  zoneId: string
  status?: string
  page?: number
  per_page?: number
  deploy?: string
}

export interface CloudflareListCertificatesResponse extends ToolResponse {
  output: {
    certificates: CloudflareOutput<typeof CERTIFICATE_OUTPUTS>[]
    total_count: number
    result_info: CloudflareResultInfo | null
  }
}

export interface CloudflarePurgeCacheParams extends CloudflareBaseParams {
  zoneId: string
  purge_everything?: boolean
  files?: string
  tags?: string
  hosts?: string
  prefixes?: string
}

export interface CloudflarePurgeCacheResponse extends ToolResponse {
  output: {
    id: string
  }
}

export interface CloudflareDnsAnalyticsParams extends CloudflareBaseParams {
  zoneId: string
  since?: string
  until?: string
  metrics?: string
  dimensions?: string
  filters?: string
  sort?: string
  limit?: number
}

/**
 * Aggregate metric block. Cloudflare only populates the metrics that were
 * requested, so every field is optional — an absent field means "not requested"
 * rather than zero.
 */
interface CloudflareDnsAnalyticsTotals {
  queryCount?: number
  uncachedCount?: number
  staleCount?: number
  responseTimeAvg?: number
  responseTimeMedian?: number
  responseTime90th?: number
  responseTime99th?: number
}

interface CloudflareDnsAnalyticsQuery {
  since: string
  until: string
  metrics: string[]
  dimensions: string[]
  filters: string
  sort: string[]
  limit: number
}

export interface CloudflareDnsAnalyticsResponse extends ToolResponse {
  output: {
    totals: CloudflareDnsAnalyticsTotals
    /** Cloudflare documents this as "currently always an empty object". */
    min: Record<string, unknown> | null
    /** Cloudflare documents this as "currently always an empty object". */
    max: Record<string, unknown> | null
    data: Array<{
      dimensions: string[]
      metrics: number[]
    }>
    data_lag: number
    rows: number
    query: CloudflareDnsAnalyticsQuery
  }
}

export interface CloudflareGetZoneSettingsParams extends CloudflareBaseParams {
  zoneId: string
  settingIds?: string
}

interface CloudflareZoneSetting {
  id: string
  value: string
  editable: boolean
  modified_on: string
  time_remaining?: number
}

/** Raw zone setting payload, as returned by the per-setting endpoint. */
export interface CloudflareRawZoneSetting {
  enabled?: boolean
  id?: string
  value?: unknown
  editable?: boolean
  modified_on?: string | null
  time_remaining?: number | null
}

/** A setting Cloudflare refused, so the caller sees the gap rather than a silent omission. */
interface CloudflareUnreadableZoneSetting {
  id: string
  error: string
}

export interface CloudflareGetZoneSettingsResponse extends ToolResponse {
  output: {
    settings: CloudflareZoneSetting[]
    unreadable: CloudflareUnreadableZoneSetting[]
  }
}

export interface CloudflareUpdateZoneSettingParams extends CloudflareBaseParams {
  zoneId: string
  settingId: string
  enabled?: boolean
  value?: string
}

export interface CloudflareUpdateZoneSettingResponse extends ToolResponse {
  output: {
    id: string
    value: string
    editable: boolean
    modified_on: string
    time_remaining?: number
  }
}

export interface CloudflareListRulesetsParams extends CloudflareBaseParams {
  zoneId: string
  per_page?: number
  cursor?: string
}

export interface CloudflareListRulesetsResponse extends ToolResponse {
  output: {
    rulesets: CloudflareOutput<typeof LIST_RULESETS_OUTPUTS>[]
    total_count: number
    result_info: CloudflareResultInfo | null
    cursor: string | null
  }
}

export interface CloudflareGetRulesetParams extends CloudflareBaseParams {
  zoneId: string
  rulesetId: string
}

export interface CloudflareRulesetResponse extends ToolResponse {
  output: CloudflareOutput<typeof RULESET_OUTPUTS>
}

export interface CloudflareCreateRulesetRuleParams extends CloudflareBaseParams {
  exposed_credential_check?: string | Record<string, unknown> | unknown[]
  id?: string
  logging?: string | Record<string, unknown> | unknown[]
  ratelimit?: string | Record<string, unknown> | unknown[]
  dry_run?: boolean

  zoneId: string
  rulesetId: string
  action: string
  expression: string
  description?: string
  enabled?: boolean
  ref?: string
  position?: string
  actionParameters?: string
}

export interface CloudflareUpdateRulesetRuleParams extends CloudflareBaseParams {
  exposed_credential_check?: string | Record<string, unknown> | unknown[]
  position?: string | Record<string, unknown> | unknown[]
  dry_run?: boolean

  zoneId: string
  rulesetId: string
  ruleId: string
  action: string
  expression: string
  description?: string
  enabled?: boolean
  ref?: string
  actionParameters?: string
  ratelimit?: string
  logging?: string
}

export interface CloudflareDeleteRulesetRuleParams extends CloudflareBaseParams {
  dry_run?: boolean

  zoneId: string
  rulesetId: string
  ruleId: string
}

export interface CloudflareGetRulesetEntrypointParams extends CloudflareBaseParams {
  zoneId: string
  phase: string
}

export interface CloudflareCreateRulesetParams extends CloudflareBaseParams {
  dry_run?: boolean

  zoneId: string
  name: string
  phase: string
  kind?: string
  description?: string
  rules?: unknown
}

export interface CloudflareListRateLimitRulesParams extends CloudflareBaseParams {
  zoneId: string
}

export interface CloudflareListManagedRulesetOverridesParams extends CloudflareBaseParams {
  zoneId: string
}

export interface CloudflareListManagedRulesetOverridesResponse extends ToolResponse {
  output: {
    ruleset_id: string
    deployments: Array<{
      rule_id: string
      managed_ruleset_id: string | null
      description: string
      expression: string
      enabled: boolean
      overrides: Record<string, unknown> | null
    }>
    total_count: number
  }
}

export interface CloudflareCreateRateLimitRuleParams extends CloudflareBaseParams {
  actionParameters?: string | Record<string, unknown> | unknown[]
  exposed_credential_check?: string | Record<string, unknown> | unknown[]
  id?: string
  logging?: string | Record<string, unknown> | unknown[]
  ref?: string
  position?: string | Record<string, unknown> | unknown[]
  score_per_period?: number
  score_response_header_name?: string
  dry_run?: boolean

  zoneId: string
  rulesetId: string
  expression: string
  characteristics: string
  period: number
  requestsPerPeriod: number
  action?: string
  mitigationTimeout?: number
  counting_expression?: string
  requestsToOrigin?: boolean
  description?: string
  enabled?: boolean
}

export interface CloudflareUpdateRateLimitRuleParams extends CloudflareBaseParams {
  exposed_credential_check?: string | Record<string, unknown> | unknown[]
  position?: string | Record<string, unknown> | unknown[]
  score_per_period?: number
  score_response_header_name?: string
  dry_run?: boolean

  zoneId: string
  rulesetId: string
  ruleId: string
  expression: string
  characteristics: string
  period: number
  requestsPerPeriod: number
  action: string
  mitigationTimeout?: number
  counting_expression?: string
  requestsToOrigin?: boolean
  description?: string
  enabled?: boolean
  ref?: string
  actionParameters?: string
  logging?: string
}

export interface CloudflareListAccessApplicationsParams extends CloudflareBaseParams {
  target_attributes?: string

  accountId: string
  name?: string
  domain?: string
  aud?: string
  search?: string
  exact?: boolean
  page?: number
  per_page?: number
}

export interface CloudflareListAccessApplicationsResponse extends ToolResponse {
  output: {
    applications: CloudflareOutput<typeof ACCESS_APPLICATION_OUTPUTS>[]
    total_count: number
    result_info: CloudflareResultInfo | null
  }
}

export interface CloudflareGetAccessApplicationParams extends CloudflareBaseParams {
  accountId: string
  appId: string
}

export interface CloudflareAccessApplicationResponse extends ToolResponse {
  output: CloudflareOutput<typeof ACCESS_APPLICATION_OUTPUTS>
}

export interface CloudflareCreateAccessApplicationParams extends CloudflareBaseParams {
  destinations?: string | Record<string, unknown> | unknown[]
  oauth_configuration?: string | Record<string, unknown> | unknown[]
  self_hosted_domains?: string | Record<string, unknown> | unknown[]
  user_populations?: string | Record<string, unknown> | unknown[]
  allow_authenticate_via_warp?: boolean
  allow_iframe?: boolean
  cors_headers?: string | Record<string, unknown> | unknown[]
  custom_non_identity_deny_url?: string
  custom_pages?: string | Record<string, unknown> | unknown[]
  eager_redirect_cookie_setting?: boolean
  enable_binding_cookie?: boolean
  http_only_cookie_attribute?: boolean
  mfa_config?: string | Record<string, unknown> | unknown[]
  options_preflight_bypass?: boolean
  path_cookie_attribute?: boolean
  read_service_tokens_from_header?: string
  same_site_cookie_attribute?: string
  scim_config?: string | Record<string, unknown> | unknown[]
  service_auth_401_redirect?: boolean
  skip_interstitial?: boolean
  use_clientless_isolation_app_launcher_url?: boolean
  app_launcher_logo_url?: string
  bg_color?: string
  footer_links?: string | Record<string, unknown> | unknown[]
  header_bg_color?: string
  landing_page_design?: string | Record<string, unknown> | unknown[]
  skip_app_launcher_login_page?: boolean

  accountId: string
  type: string
  domain?: string
  name?: string
  sessionDuration?: string
  allowedIdps?: string
  appLauncherVisible?: boolean
  autoRedirectToIdentity?: boolean
  customDenyMessage?: string
  customDenyUrl?: string
  logoUrl?: string
  tags?: string
  policies?: string
  saasApp?: string
  targetCriteria?: string
}

export interface CloudflareUpdateAccessApplicationParams
  extends CloudflareCreateAccessApplicationParams {
  destinations?: string | Record<string, unknown> | unknown[]
  oauth_configuration?: string | Record<string, unknown> | unknown[]
  self_hosted_domains?: string | Record<string, unknown> | unknown[]
  user_populations?: string | Record<string, unknown> | unknown[]
  allow_authenticate_via_warp?: boolean
  allow_iframe?: boolean
  cors_headers?: string | Record<string, unknown> | unknown[]
  custom_non_identity_deny_url?: string
  custom_pages?: string | Record<string, unknown> | unknown[]
  eager_redirect_cookie_setting?: boolean
  enable_binding_cookie?: boolean
  http_only_cookie_attribute?: boolean
  mfa_config?: string | Record<string, unknown> | unknown[]
  options_preflight_bypass?: boolean
  path_cookie_attribute?: boolean
  read_service_tokens_from_header?: string
  same_site_cookie_attribute?: string
  scim_config?: string | Record<string, unknown> | unknown[]
  service_auth_401_redirect?: boolean
  skip_interstitial?: boolean
  use_clientless_isolation_app_launcher_url?: boolean
  app_launcher_logo_url?: string
  bg_color?: string
  footer_links?: string | Record<string, unknown> | unknown[]
  header_bg_color?: string
  landing_page_design?: string | Record<string, unknown> | unknown[]
  skip_app_launcher_login_page?: boolean

  appId: string
}

export interface CloudflareDeleteAccessApplicationParams extends CloudflareBaseParams {
  accountId: string
  appId: string
}

export interface CloudflareDeletedIdResponse extends ToolResponse {
  output: {
    id: string
  }
}

export interface CloudflareListAccessPoliciesParams extends CloudflareBaseParams {
  accountId: string
  appId: string
  page?: number
  per_page?: number
}

export interface CloudflareListAccessPoliciesResponse extends ToolResponse {
  output: {
    policies: CloudflareOutput<typeof ACCESS_POLICY_OUTPUTS>[]
    total_count: number
    result_info: CloudflareResultInfo | null
  }
}

export interface CloudflareCreateAccessPolicyParams extends CloudflareBaseParams {
  approval_groups?: string | Record<string, unknown> | unknown[]
  connection_rules?: string | Record<string, unknown> | unknown[]
  mfa_config?: string | Record<string, unknown> | unknown[]

  accountId: string
  appId: string
  name: string
  decision: string
  include: string
  exclude?: string
  require?: string
  precedence?: number
  sessionDuration?: string
  approvalRequired?: boolean
  isolationRequired?: boolean
  purposeJustificationRequired?: boolean
  purposeJustificationPrompt?: string
}

export interface CloudflareUpdateAccessPolicyParams extends CloudflareCreateAccessPolicyParams {
  approval_groups?: string | Record<string, unknown> | unknown[]
  connection_rules?: string | Record<string, unknown> | unknown[]
  mfa_config?: string | Record<string, unknown> | unknown[]

  policyId: string
}

export interface CloudflareAccessPolicyResponse extends ToolResponse {
  output: CloudflareOutput<typeof ACCESS_POLICY_OUTPUTS>
}

export interface CloudflareDeleteAccessPolicyParams extends CloudflareBaseParams {
  accountId: string
  appId: string
  policyId: string
}

export interface CloudflareListAccessGroupsParams extends CloudflareBaseParams {
  accountId: string
  name?: string
  search?: string
  page?: number
  per_page?: number
}

export interface CloudflareListAccessGroupsResponse extends ToolResponse {
  output: {
    groups: CloudflareOutput<typeof ACCESS_GROUP_OUTPUTS>[]
    total_count: number
    result_info: CloudflareResultInfo | null
  }
}

export interface CloudflareListAccessIdentityProvidersParams extends CloudflareBaseParams {
  scim_enabled?: string
  page?: number
  per_page?: number

  accountId: string
}

export interface CloudflareListAccessIdentityProvidersResponse extends ToolResponse {
  output: {
    identity_providers: CloudflareOutput<typeof IDENTITY_PROVIDER_OUTPUTS>[]
    total_count: number
    result_info: CloudflareResultInfo | null
  }
}

export interface CloudflareListAccessServiceTokensParams extends CloudflareBaseParams {
  accountId: string
  name?: string
  search?: string
  page?: number
  per_page?: number
}

export interface CloudflareListAccessServiceTokensResponse extends ToolResponse {
  output: {
    service_tokens: CloudflareOutput<typeof SERVICE_TOKEN_OUTPUTS>[]
    total_count: number
    result_info: CloudflareResultInfo | null
  }
}

export interface CloudflareCreateAccessServiceTokenParams extends CloudflareBaseParams {
  client_secret_version?: number
  enabled?: boolean
  previous_client_secret_expires_at?: string

  accountId: string
  name: string
  duration?: string
}

export interface CloudflareCreateAccessServiceTokenResponse extends ToolResponse {
  output: CloudflareOutput<typeof SERVICE_TOKEN_SECRET_OUTPUTS>
}

export interface CloudflareRevokeAccessServiceTokenParams extends CloudflareBaseParams {
  accountId: string
  serviceTokenId: string
}

export interface CloudflareAccessServiceTokenResponse extends ToolResponse {
  output: CloudflareOutput<typeof SERVICE_TOKEN_OUTPUTS>
}

export interface CloudflareListR2BucketsParams extends CloudflareBaseParams {
  order?: string
  accountId: string
  name_contains?: string
  start_after?: string
  cursor?: string
  direction?: string
  per_page?: number
  jurisdiction?: string
}

export interface CloudflareListR2BucketsResponse extends ToolResponse {
  output: {
    buckets: CloudflareOutput<typeof R2_BUCKET_OUTPUTS>[]
    total_count: number
    result_info: CloudflareResultInfo | null
    cursor: string | null
  }
}

export interface CloudflareGetR2BucketParams extends CloudflareBaseParams {
  accountId: string
  bucketName: string
  jurisdiction?: string
}

export interface CloudflareCreateR2BucketParams extends CloudflareBaseParams {
  accountId: string
  bucketName: string
  locationHint?: string
  storageClass?: string
  jurisdiction?: string
}

export interface CloudflareR2BucketResponse extends ToolResponse {
  output: CloudflareOutput<typeof R2_BUCKET_OUTPUTS>
}

export interface CloudflareDeleteR2BucketParams extends CloudflareBaseParams {
  accountId: string
  bucketName: string
  jurisdiction?: string
}

export interface CloudflareDeleteR2BucketResponse extends ToolResponse {
  output: {
    name: string
  }
}

export interface CloudflareListWorkerScriptsParams extends CloudflareBaseParams {
  accountId: string
  tags?: string
}

export interface CloudflareListWorkerScriptsResponse extends ToolResponse {
  output: {
    scripts: CloudflareOutput<typeof WORKER_SCRIPT_OUTPUTS>[]
    total_count: number
    result_info: CloudflareResultInfo | null
  }
}

export interface CloudflareGetWorkerScriptSettingsParams extends CloudflareBaseParams {
  accountId: string
  scriptName: string
}

export interface CloudflareGetWorkerScriptSettingsResponse extends ToolResponse {
  output: CloudflareOutput<typeof WORKER_SETTINGS_OUTPUTS>
}

export interface CloudflareListWorkerRoutesParams extends CloudflareBaseParams {
  zoneId: string
}

export interface CloudflareListWorkerRoutesResponse extends ToolResponse {
  output: {
    routes: CloudflareOutput<typeof WORKER_ROUTE_OUTPUTS>[]
    total_count: number
    result_info: CloudflareResultInfo | null
  }
}

export interface CloudflareListTunnelsParams extends CloudflareBaseParams {
  accountId: string
  name?: string
  status?: string
  uuid?: string
  is_deleted?: boolean
  include_prefix?: string
  exclude_prefix?: string
  existed_at?: string
  was_active_at?: string
  was_inactive_at?: string
  page?: number
  per_page?: number
}

export interface CloudflareListTunnelsResponse extends ToolResponse {
  output: {
    tunnels: CloudflareOutput<typeof TUNNEL_OUTPUTS>[]
    total_count: number
    result_info: CloudflareResultInfo | null
  }
}

export interface CloudflareGetTunnelParams extends CloudflareBaseParams {
  accountId: string
  tunnelId: string
}

export interface CloudflareTunnelResponse extends ToolResponse {
  output: CloudflareOutput<typeof TUNNEL_OUTPUTS>
}

export interface CloudflareGetTunnelConfigurationParams extends CloudflareBaseParams {
  accountId: string
  tunnelId: string
}

export interface CloudflareGetTunnelConfigurationResponse extends ToolResponse {
  output: CloudflareOutput<typeof TUNNEL_CONFIGURATION_OUTPUTS>
}
