import type { ToolResponse } from '@/tools/types'

interface CloudflareBaseParams {
  apiKey: string
}

/**
 * Pagination metadata Cloudflare attaches to list endpoints. Page-based
 * endpoints populate `page`/`per_page`/`total_count`; the Rulesets engine and
 * R2 use cursors instead, so every field is optional.
 */
export interface CloudflareResultInfo {
  page?: number
  per_page?: number
  count?: number
  total_count?: number
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
export interface CloudflareRawRule {
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
export interface CloudflareRawAccessApplication {
  id?: string
  name?: string
  domain?: string
  type?: string
  aud?: string
  session_duration?: string
  allowed_idps?: string[]
  app_launcher_visible?: boolean
  auto_redirect_to_identity?: boolean
  custom_deny_message?: string
  custom_deny_url?: string
  logo_url?: string
  self_hosted_domains?: string[]
  destinations?: unknown[]
  tags?: string[]
  policies?: unknown[]
}

/** Raw Cloudflare Access policy payload. */
export interface CloudflareRawAccessPolicy {
  id?: string
  name?: string
  decision?: string
  precedence?: number
  include?: unknown[]
  exclude?: unknown[]
  require?: unknown[]
  session_duration?: string
  approval_required?: boolean
  isolation_required?: boolean
  purpose_justification_required?: boolean
  purpose_justification_prompt?: string
  created_at?: string
  updated_at?: string
}

/** Raw Cloudflare Access group payload. */
export interface CloudflareRawAccessGroup {
  id?: string
  name?: string
  is_default?: unknown[]
  include?: unknown[]
  exclude?: unknown[]
  require?: unknown[]
  created_at?: string
  updated_at?: string
}

/** Raw Cloudflare Access identity provider payload. */
export interface CloudflareRawAccessIdentityProvider {
  id?: string
  name?: string
  type?: string
  read_only?: boolean
  config?: Record<string, unknown>
  scim_config?: Record<string, unknown>
}

/** Raw Cloudflare Access service token payload. `client_secret` only on create. */
export interface CloudflareRawAccessServiceToken {
  id?: string
  name?: string
  client_id?: string
  client_secret?: string
  duration?: string
  enabled?: boolean
  expires_at?: string
  last_seen_at?: string
  created_at?: string
  updated_at?: string
}

/** Raw R2 bucket payload. */
export interface CloudflareRawR2Bucket {
  name?: string
  creation_date?: string
  location?: string
  storage_class?: string
  jurisdiction?: string
}

/** Raw Workers script payload from the list-scripts endpoint. */
export interface CloudflareRawWorkerScript {
  id?: string
  tag?: string
  etag?: string
  created_on?: string
  modified_on?: string
  usage_model?: string
  placement_mode?: string
  logpush?: boolean
  has_assets?: boolean
  has_modules?: boolean
  compatibility_date?: string
  compatibility_flags?: string[]
  routes?: unknown[]
  tail_consumers?: unknown[]
}

/** Raw Workers route payload. */
export interface CloudflareRawWorkerRoute {
  id?: string
  pattern?: string
  script?: string
}

/** Raw Cloudflare Tunnel (cloudflared) payload. */
export interface CloudflareRawTunnel {
  id?: string
  name?: string
  account_tag?: string
  config_src?: string
  status?: string
  tun_type?: string
  remote_config?: boolean
  metadata?: Record<string, unknown>
  created_at?: string
  deleted_at?: string
  conns_active_at?: string
  conns_inactive_at?: string
  connections?: unknown[]
}

/** Raw zone payload from the zones endpoints. */
export interface CloudflareRawZone {
  id?: string
  name?: string
  status?: string
  paused?: boolean
  type?: string
  name_servers?: string[]
  original_name_servers?: string[]
  created_on?: string
  modified_on?: string
  activated_on?: string
  development_mode?: number
  plan?: {
    id?: string
    name?: string
    price?: number
    is_subscribed?: boolean
    frequency?: string
    currency?: string
    legacy_id?: string
  }
  account?: { id?: string; name?: string }
  owner?: { id?: string; name?: string; type?: string }
  meta?: {
    cdn_only?: boolean
    custom_certificate_quota?: number
    dns_only?: boolean
    foundation_dns?: boolean
    page_rule_quota?: number
    phishing_detected?: boolean
    step?: number
  }
  vanity_name_servers?: string[]
  permissions?: string[]
}

/** Raw DNS record payload. */
export interface CloudflareRawDnsRecord {
  id?: string
  zone_id?: string
  zone_name?: string
  type?: string
  name?: string
  content?: string
  proxiable?: boolean
  proxied?: boolean
  ttl?: number
  locked?: boolean
  priority?: number
  comment?: string
  tags?: string[]
  comment_modified_on?: string
  tags_modified_on?: string
  meta?: CloudflareDnsRecordMeta
  created_on?: string
  modified_on?: string
}

/** Raw hostname-validation record shared by certificate pack validation fields. */
export interface CloudflareRawValidationRecord {
  cname?: string
  cname_target?: string
  emails?: string[]
  http_body?: string
  http_url?: string
  status?: string
  txt_name?: string
  txt_value?: string
}

/** Raw certificate inside a certificate pack. */
export interface CloudflareRawCertificate {
  id?: string
  hosts?: string[]
  issuer?: string
  signature?: string
  status?: string
  bundle_method?: string
  zone_id?: string
  uploaded_on?: string
  modified_on?: string
  expires_on?: string
  priority?: number
  geo_restrictions?: CloudflareCertificateGeoRestrictions
}

/** Raw certificate pack payload. */
export interface CloudflareRawCertificatePack {
  id?: string
  type?: string
  hosts?: string[]
  primary_certificate?: string
  status?: string
  certificates?: CloudflareRawCertificate[]
  cloudflare_branding?: boolean
  validation_method?: string
  validity_days?: number
  certificate_authority?: string
  validation_errors?: Array<{ message?: string }>
  validation_records?: CloudflareRawValidationRecord[]
  dcv_delegation_records?: CloudflareRawValidationRecord[]
}

/** Raw DNS analytics aggregate block (`totals`, `min`, and `max` share this shape). */
export interface CloudflareRawDnsAnalyticsAggregate {
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
  name?: string
  status?: string
  page?: number
  per_page?: number
  accountId?: string
  order?: string
  direction?: string
  match?: string
}

interface CloudflareZonePlan {
  id: string
  name: string
  price: number
  is_subscribed: boolean
  frequency: string
  currency: string
  legacy_id: string
}

interface CloudflareZoneMeta {
  cdn_only: boolean
  custom_certificate_quota: number
  dns_only: boolean
  foundation_dns: boolean
  page_rule_quota: number
  phishing_detected: boolean
  step: number
}

interface CloudflareZone {
  id: string
  name: string
  status: string
  paused: boolean
  type: string
  name_servers: string[]
  original_name_servers?: string[]
  created_on: string
  modified_on: string
  activated_on?: string
  development_mode?: number
  plan?: CloudflareZonePlan
  account?: {
    id: string
    name: string
  }
  owner?: {
    id: string
    name: string
    type: string
  }
  meta?: CloudflareZoneMeta
  vanity_name_servers?: string[]
  permissions?: string[]
}

export interface CloudflareListZonesResponse extends ToolResponse {
  output: {
    zones: CloudflareZone[]
    total_count: number
  }
}

export interface CloudflareGetZoneParams extends CloudflareBaseParams {
  zoneId: string
}

export interface CloudflareGetZoneResponse extends ToolResponse {
  output: {
    id: string
    name: string
    status: string
    paused: boolean
    type: string
    name_servers: string[]
    original_name_servers: string[]
    created_on: string
    modified_on: string
    activated_on: string
    development_mode: number
    plan: CloudflareZonePlan
    account: {
      id: string
      name: string
    }
    owner: {
      id: string
      name: string
      type: string
    }
    meta: CloudflareZoneMeta
    vanity_name_servers: string[]
    permissions: string[]
  }
}

export interface CloudflareCreateZoneParams extends CloudflareBaseParams {
  name: string
  accountId: string
  type?: string
}

export interface CloudflareCreateZoneResponse extends ToolResponse {
  output: {
    id: string
    name: string
    status: string
    paused: boolean
    type: string
    name_servers: string[]
    original_name_servers: string[]
    created_on: string
    modified_on: string
    activated_on: string
    development_mode: number
    plan: CloudflareZonePlan
    account: {
      id: string
      name: string
    }
    owner: {
      id: string
      name: string
      type: string
    }
    meta: CloudflareZoneMeta
    vanity_name_servers: string[]
    permissions: string[]
  }
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

interface CloudflareDnsRecordMeta {
  source: string
}

interface CloudflareDnsRecord {
  id: string
  zone_id: string
  zone_name: string
  type: string
  name: string
  content: string
  proxiable: boolean
  proxied: boolean
  ttl: number
  locked: boolean
  priority?: number | null
  comment?: string | null
  tags: string[]
  comment_modified_on?: string | null
  tags_modified_on?: string | null
  meta?: CloudflareDnsRecordMeta | null
  created_on: string
  modified_on: string
}

export interface CloudflareListDnsRecordsResponse extends ToolResponse {
  output: {
    records: CloudflareDnsRecord[]
    total_count: number
  }
}

export interface CloudflareCreateDnsRecordParams extends CloudflareBaseParams {
  zoneId: string
  type: string
  name: string
  content: string
  ttl?: number
  proxied?: boolean
  priority?: number
  comment?: string
  tags?: string
}

export interface CloudflareCreateDnsRecordResponse extends ToolResponse {
  output: {
    id: string
    zone_id: string
    zone_name: string
    type: string
    name: string
    content: string
    proxiable: boolean
    proxied: boolean
    ttl: number
    locked: boolean
    priority?: number
    comment?: string | null
    tags: string[]
    comment_modified_on?: string | null
    tags_modified_on?: string | null
    meta?: CloudflareDnsRecordMeta | null
    created_on: string
    modified_on: string
  }
}

export interface CloudflareUpdateDnsRecordParams extends CloudflareBaseParams {
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
  output: {
    id: string
    zone_id: string
    zone_name: string
    type: string
    name: string
    content: string
    proxiable: boolean
    proxied: boolean
    ttl: number
    locked: boolean
    priority?: number
    comment?: string | null
    tags: string[]
    comment_modified_on?: string | null
    tags_modified_on?: string | null
    meta?: CloudflareDnsRecordMeta | null
    created_on: string
    modified_on: string
  }
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

interface CloudflareCertificateGeoRestrictions {
  label: string
}

interface CloudflareCertificate {
  id: string
  hosts: string[]
  issuer: string
  signature: string
  status: string
  bundle_method: string
  zone_id: string
  uploaded_on: string
  modified_on: string
  expires_on: string
  priority?: number
  geo_restrictions?: CloudflareCertificateGeoRestrictions
}

interface CloudflareCertificateValidationError {
  message: string
}

interface CloudflareDcvDelegationRecord {
  cname: string
  cname_target: string
  emails: string[]
  http_body: string
  http_url: string
  status: string
  txt_name: string
  txt_value: string
}

interface CloudflareCertificatePack {
  id: string
  type: string
  hosts: string[]
  primary_certificate: string
  status: string
  certificates: CloudflareCertificate[]
  cloudflare_branding?: boolean
  validation_method?: string
  validity_days?: number
  certificate_authority?: string
  validation_errors?: CloudflareCertificateValidationError[]
  validation_records?: CloudflareDcvDelegationRecord[]
  dcv_delegation_records?: CloudflareDcvDelegationRecord[]
}

export interface CloudflareListCertificatesResponse extends ToolResponse {
  output: {
    certificates: CloudflareCertificatePack[]
    total_count: number
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
  value: string
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

interface CloudflareRulesetSummary {
  id: string
  name: string
  description: string
  kind: string
  phase: string
  version: string | null
  last_updated: string | null
}

export interface CloudflareListRulesetsResponse extends ToolResponse {
  output: {
    rulesets: CloudflareRulesetSummary[]
    total_count: number
    cursor: string | null
  }
}

interface CloudflareRule {
  id: string
  version: string | null
  action: string
  action_parameters: Record<string, unknown> | null
  expression: string
  description: string
  enabled: boolean
  ref: string | null
  last_updated: string | null
  categories: string[]
  logging: Record<string, unknown> | null
  ratelimit: Record<string, unknown> | null
}

interface CloudflareRuleset extends CloudflareRulesetSummary {
  rules: CloudflareRule[]
}

export interface CloudflareGetRulesetParams extends CloudflareBaseParams {
  zoneId: string
  rulesetId: string
}

export interface CloudflareRulesetResponse extends ToolResponse {
  output: CloudflareRuleset
}

export interface CloudflareCreateRulesetRuleParams extends CloudflareBaseParams {
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
  zoneId: string
  rulesetId: string
  ruleId: string
}

export interface CloudflareGetRulesetEntrypointParams extends CloudflareBaseParams {
  zoneId: string
  phase: string
}

export interface CloudflareCreateRulesetParams extends CloudflareBaseParams {
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

interface CloudflareAccessApplication {
  id: string
  name: string | null
  domain: string | null
  type: string | null
  aud: string | null
  session_duration: string | null
  allowed_idps: string[] | null
  app_launcher_visible: boolean | null
  auto_redirect_to_identity: boolean | null
  custom_deny_message: string | null
  custom_deny_url: string | null
  logo_url: string | null
  self_hosted_domains: string[] | null
  destinations: unknown[] | null
  tags: string[] | null
  policies: unknown[] | null
}

export interface CloudflareListAccessApplicationsParams extends CloudflareBaseParams {
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
    applications: CloudflareAccessApplication[]
    total_count: number
  }
}

export interface CloudflareGetAccessApplicationParams extends CloudflareBaseParams {
  accountId: string
  appId: string
}

export interface CloudflareAccessApplicationResponse extends ToolResponse {
  output: CloudflareAccessApplication
}

export interface CloudflareCreateAccessApplicationParams extends CloudflareBaseParams {
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

interface CloudflareAccessPolicy {
  id: string
  name: string | null
  decision: string | null
  precedence: number | null
  include: unknown[] | null
  exclude: unknown[] | null
  require: unknown[] | null
  session_duration: string | null
  approval_required: boolean | null
  isolation_required: boolean | null
  purpose_justification_required: boolean | null
  purpose_justification_prompt: string | null
  created_at: string | null
  updated_at: string | null
}

export interface CloudflareListAccessPoliciesParams extends CloudflareBaseParams {
  accountId: string
  appId: string
  page?: number
  per_page?: number
}

export interface CloudflareListAccessPoliciesResponse extends ToolResponse {
  output: {
    policies: CloudflareAccessPolicy[]
    total_count: number
  }
}

export interface CloudflareCreateAccessPolicyParams extends CloudflareBaseParams {
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
  policyId: string
}

export interface CloudflareAccessPolicyResponse extends ToolResponse {
  output: CloudflareAccessPolicy
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
    groups: Array<{
      id: string
      name: string | null
      is_default: unknown[] | null
      include: unknown[] | null
      exclude: unknown[] | null
      require: unknown[] | null
      created_at: string | null
      updated_at: string | null
    }>
    total_count: number
  }
}

export interface CloudflareListAccessIdentityProvidersParams extends CloudflareBaseParams {
  accountId: string
}

export interface CloudflareListAccessIdentityProvidersResponse extends ToolResponse {
  output: {
    identity_providers: Array<{
      id: string
      name: string | null
      type: string | null
      read_only: boolean | null
      config: Record<string, unknown> | null
      scim_config: Record<string, unknown> | null
    }>
    total_count: number
  }
}

export interface CloudflareListAccessServiceTokensParams extends CloudflareBaseParams {
  accountId: string
  name?: string
  search?: string
  page?: number
  per_page?: number
}

interface CloudflareAccessServiceToken {
  id: string
  name: string | null
  client_id: string | null
  duration: string | null
  enabled: boolean | null
  expires_at: string | null
  last_seen_at: string | null
  created_at: string | null
  updated_at: string | null
}

export interface CloudflareListAccessServiceTokensResponse extends ToolResponse {
  output: {
    service_tokens: CloudflareAccessServiceToken[]
    total_count: number
  }
}

export interface CloudflareCreateAccessServiceTokenParams extends CloudflareBaseParams {
  accountId: string
  name: string
  duration?: string
}

export interface CloudflareCreateAccessServiceTokenResponse extends ToolResponse {
  output: CloudflareAccessServiceToken & {
    client_secret: string | null
  }
}

export interface CloudflareRevokeAccessServiceTokenParams extends CloudflareBaseParams {
  accountId: string
  serviceTokenId: string
}

export interface CloudflareAccessServiceTokenResponse extends ToolResponse {
  output: CloudflareAccessServiceToken
}

interface CloudflareR2Bucket {
  name: string
  creation_date: string | null
  location: string | null
  storage_class: string | null
  jurisdiction: string | null
}

export interface CloudflareListR2BucketsParams extends CloudflareBaseParams {
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
    buckets: CloudflareR2Bucket[]
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
  output: CloudflareR2Bucket
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
    scripts: Array<{
      id: string
      tag: string | null
      etag: string | null
      created_on: string | null
      modified_on: string | null
      usage_model: string | null
      placement_mode: string | null
      logpush: boolean | null
      has_assets: boolean | null
      has_modules: boolean | null
      compatibility_date: string | null
      compatibility_flags: string[] | null
      routes: unknown[] | null
      tail_consumers: unknown[] | null
    }>
    total_count: number
  }
}

export interface CloudflareGetWorkerScriptSettingsParams extends CloudflareBaseParams {
  accountId: string
  scriptName: string
}

export interface CloudflareGetWorkerScriptSettingsResponse extends ToolResponse {
  output: {
    bindings: unknown[] | null
    compatibility_date: string | null
    compatibility_flags: string[] | null
    limits: Record<string, unknown> | null
    logpush: boolean | null
    migrations: Record<string, unknown> | null
    observability: Record<string, unknown> | null
    placement: Record<string, unknown> | null
    tags: string[] | null
    tail_consumers: unknown[] | null
    usage_model: string | null
  }
}

export interface CloudflareListWorkerRoutesParams extends CloudflareBaseParams {
  zoneId: string
}

export interface CloudflareListWorkerRoutesResponse extends ToolResponse {
  output: {
    routes: Array<{
      id: string
      pattern: string
      script: string | null
    }>
    total_count: number
  }
}

interface CloudflareTunnel {
  id: string
  name: string | null
  account_tag: string | null
  config_src: string | null
  status: string | null
  tun_type: string | null
  remote_config: boolean | null
  metadata: Record<string, unknown> | null
  created_at: string | null
  deleted_at: string | null
  conns_active_at: string | null
  conns_inactive_at: string | null
  connections: unknown[] | null
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
    tunnels: CloudflareTunnel[]
    total_count: number
  }
}

export interface CloudflareGetTunnelParams extends CloudflareBaseParams {
  accountId: string
  tunnelId: string
}

export interface CloudflareTunnelResponse extends ToolResponse {
  output: CloudflareTunnel
}

export interface CloudflareGetTunnelConfigurationParams extends CloudflareBaseParams {
  accountId: string
  tunnelId: string
}

export interface CloudflareGetTunnelConfigurationResponse extends ToolResponse {
  output: {
    tunnel_id: string
    account_id: string
    version: number | null
    source: string | null
    created_at: string | null
    config: Record<string, unknown> | null
  }
}

export type CloudflareResponse =
  | CloudflareListRulesetsResponse
  | CloudflareRulesetResponse
  | CloudflareListManagedRulesetOverridesResponse
  | CloudflareListAccessApplicationsResponse
  | CloudflareAccessApplicationResponse
  | CloudflareListAccessPoliciesResponse
  | CloudflareAccessPolicyResponse
  | CloudflareListAccessGroupsResponse
  | CloudflareListAccessIdentityProvidersResponse
  | CloudflareListAccessServiceTokensResponse
  | CloudflareCreateAccessServiceTokenResponse
  | CloudflareAccessServiceTokenResponse
  | CloudflareDeletedIdResponse
  | CloudflareListR2BucketsResponse
  | CloudflareR2BucketResponse
  | CloudflareDeleteR2BucketResponse
  | CloudflareListWorkerScriptsResponse
  | CloudflareGetWorkerScriptSettingsResponse
  | CloudflareListWorkerRoutesResponse
  | CloudflareListTunnelsResponse
  | CloudflareTunnelResponse
  | CloudflareGetTunnelConfigurationResponse
  | CloudflareListZonesResponse
  | CloudflareGetZoneResponse
  | CloudflareCreateZoneResponse
  | CloudflareDeleteZoneResponse
  | CloudflareListDnsRecordsResponse
  | CloudflareCreateDnsRecordResponse
  | CloudflareUpdateDnsRecordResponse
  | CloudflareDeleteDnsRecordResponse
  | CloudflareListCertificatesResponse
  | CloudflarePurgeCacheResponse
  | CloudflareDnsAnalyticsResponse
  | CloudflareGetZoneSettingsResponse
  | CloudflareUpdateZoneSettingResponse
