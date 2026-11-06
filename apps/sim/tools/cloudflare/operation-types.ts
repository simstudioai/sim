import type {
  ACCESS_GROUP_OUTPUTS,
  ACCESS_POLICY_OUTPUTS,
  DNS_RECORD_OUTPUTS,
  R2_CORS_OUTPUTS,
  R2_LIFECYCLE_OUTPUTS,
  RULESET_OUTPUTS,
  SERVICE_TOKEN_OUTPUTS,
  SERVICE_TOKEN_SECRET_OUTPUTS,
  TUNNEL_CONFIGURATION_OUTPUTS,
  TUNNEL_OUTPUTS,
  WORKER_ROUTE_OUTPUTS,
  ZONE_OUTPUTS,
} from '@/tools/cloudflare/outputs'
import type { CloudflareOutput } from '@/tools/cloudflare/utils'
import type { ToolResponse } from '@/tools/types'

export interface CloudflareGetTunnelTokenParams {
  accountId: string
  tunnelId: string
  apiKey: string
}

export interface CloudflareGetTunnelTokenResponse extends ToolResponse {
  output: { token: string | null }
}

export interface CloudflareGetDnsRecordParams {
  zoneId: string
  recordId: string
  apiKey: string
  include_shadow_metadata?: boolean
}

export interface CloudflareGetDnsRecordResponse extends ToolResponse {
  output: CloudflareOutput<typeof DNS_RECORD_OUTPUTS>
}

export interface CloudflareUpdateZoneParams {
  zoneId: string
  apiKey: string
  paused?: boolean
  plan?: string | Record<string, unknown> | unknown[]
  type?: string
  vanity_name_servers?: string | Record<string, unknown> | unknown[]
}

export interface CloudflareUpdateZoneResponse extends ToolResponse {
  output: CloudflareOutput<typeof ZONE_OUTPUTS>
}

export interface CloudflareUpdateRulesetParams {
  zoneId: string
  rulesetId: string
  apiKey: string
  description?: string
  rules?: string | Record<string, unknown> | unknown[]
  dry_run?: boolean
}

export interface CloudflareUpdateRulesetResponse extends ToolResponse {
  output: CloudflareOutput<typeof RULESET_OUTPUTS>
}

export interface CloudflareDeleteRulesetParams {
  zoneId: string
  rulesetId: string
  apiKey: string
  dry_run?: boolean
}

export interface CloudflareDeleteRulesetResponse extends ToolResponse {
  output: { success: boolean }
}

export interface CloudflareGetAccessPolicyParams {
  accountId: string
  appId: string
  policyId: string
  apiKey: string
}

export interface CloudflareGetAccessPolicyResponse extends ToolResponse {
  output: CloudflareOutput<typeof ACCESS_POLICY_OUTPUTS>
}

export interface CloudflareGetAccessGroupParams {
  accountId: string
  groupId: string
  apiKey: string
}

export interface CloudflareGetAccessGroupResponse extends ToolResponse {
  output: CloudflareOutput<typeof ACCESS_GROUP_OUTPUTS>
}

export interface CloudflareCreateAccessGroupParams {
  accountId: string
  apiKey: string
  exclude?: string | Record<string, unknown> | unknown[]
  include: string | Record<string, unknown> | unknown[]
  is_default?: boolean
  name: string
  require?: string | Record<string, unknown> | unknown[]
}

export interface CloudflareCreateAccessGroupResponse extends ToolResponse {
  output: CloudflareOutput<typeof ACCESS_GROUP_OUTPUTS>
}

export interface CloudflareUpdateAccessGroupParams {
  accountId: string
  groupId: string
  apiKey: string
  exclude?: string | Record<string, unknown> | unknown[]
  include: string | Record<string, unknown> | unknown[]
  is_default?: boolean
  name: string
  require?: string | Record<string, unknown> | unknown[]
}

export interface CloudflareUpdateAccessGroupResponse extends ToolResponse {
  output: CloudflareOutput<typeof ACCESS_GROUP_OUTPUTS>
}

export interface CloudflareDeleteAccessGroupParams {
  accountId: string
  groupId: string
  apiKey: string
}

export interface CloudflareDeleteAccessGroupResponse extends ToolResponse {
  output: { id: string | null }
}

export interface CloudflareGetAccessServiceTokenParams {
  accountId: string
  serviceTokenId: string
  apiKey: string
}

export interface CloudflareGetAccessServiceTokenResponse extends ToolResponse {
  output: CloudflareOutput<typeof SERVICE_TOKEN_OUTPUTS>
}

export interface CloudflareUpdateAccessServiceTokenParams {
  accountId: string
  serviceTokenId: string
  apiKey: string
  client_secret_version?: number
  duration?: string
  enabled?: boolean
  name?: string
  previous_client_secret_expires_at?: string
}

export interface CloudflareUpdateAccessServiceTokenResponse extends ToolResponse {
  output: CloudflareOutput<typeof SERVICE_TOKEN_OUTPUTS>
}

export interface CloudflareRefreshAccessServiceTokenParams {
  accountId: string
  serviceTokenId: string
  apiKey: string
}

export interface CloudflareRefreshAccessServiceTokenResponse extends ToolResponse {
  output: CloudflareOutput<typeof SERVICE_TOKEN_OUTPUTS>
}

export interface CloudflareRotateAccessServiceTokenParams {
  accountId: string
  serviceTokenId: string
  apiKey: string
  previous_client_secret_expires_at?: string
}

export interface CloudflareRotateAccessServiceTokenResponse extends ToolResponse {
  output: CloudflareOutput<typeof SERVICE_TOKEN_SECRET_OUTPUTS>
}

export interface CloudflareGetWorkerRouteParams {
  zoneId: string
  routeId: string
  apiKey: string
}

export interface CloudflareGetWorkerRouteResponse extends ToolResponse {
  output: CloudflareOutput<typeof WORKER_ROUTE_OUTPUTS>
}

export interface CloudflareCreateWorkerRouteParams {
  zoneId: string
  apiKey: string
  pattern: string
  script?: string
}

export interface CloudflareCreateWorkerRouteResponse extends ToolResponse {
  output: CloudflareOutput<typeof WORKER_ROUTE_OUTPUTS>
}

export interface CloudflareUpdateWorkerRouteParams {
  zoneId: string
  routeId: string
  apiKey: string
  pattern: string
  script?: string
}

export interface CloudflareUpdateWorkerRouteResponse extends ToolResponse {
  output: CloudflareOutput<typeof WORKER_ROUTE_OUTPUTS>
}

export interface CloudflareDeleteWorkerRouteParams {
  zoneId: string
  routeId: string
  apiKey: string
}

export interface CloudflareDeleteWorkerRouteResponse extends ToolResponse {
  output: { id: string | null }
}

export interface CloudflareDeleteWorkerScriptParams {
  accountId: string
  scriptName: string
  apiKey: string
  force?: boolean
}

export interface CloudflareDeleteWorkerScriptResponse extends ToolResponse {
  output: { success: boolean }
}

export interface CloudflareCreateTunnelParams {
  accountId: string
  apiKey: string
  config_src?: string
  name: string
  tunnel_secret?: string
}

export interface CloudflareCreateTunnelResponse extends ToolResponse {
  output: CloudflareOutput<typeof TUNNEL_OUTPUTS>
}

export interface CloudflareUpdateTunnelParams {
  accountId: string
  tunnelId: string
  apiKey: string
  name?: string
  tunnel_secret?: string
}

export interface CloudflareUpdateTunnelResponse extends ToolResponse {
  output: CloudflareOutput<typeof TUNNEL_OUTPUTS>
}

export interface CloudflareDeleteTunnelParams {
  accountId: string
  tunnelId: string
  apiKey: string
}

export interface CloudflareDeleteTunnelResponse extends ToolResponse {
  output: CloudflareOutput<typeof TUNNEL_OUTPUTS>
}

export interface CloudflareUpdateTunnelConfigurationParams {
  accountId: string
  tunnelId: string
  apiKey: string
  config?: string | Record<string, unknown> | unknown[]
}

export interface CloudflareUpdateTunnelConfigurationResponse extends ToolResponse {
  output: CloudflareOutput<typeof TUNNEL_CONFIGURATION_OUTPUTS>
}

export interface CloudflareGetR2BucketCorsParams {
  accountId: string
  bucketName: string
  apiKey: string
  jurisdiction?: string
}

export interface CloudflareGetR2BucketCorsResponse extends ToolResponse {
  output: CloudflareOutput<typeof R2_CORS_OUTPUTS>
}

export interface CloudflareUpdateR2BucketCorsParams {
  accountId: string
  bucketName: string
  apiKey: string
  rules?: string | Record<string, unknown> | unknown[]
  jurisdiction?: string
}

export interface CloudflareUpdateR2BucketCorsResponse extends ToolResponse {
  output: { success: boolean }
}

export interface CloudflareDeleteR2BucketCorsParams {
  accountId: string
  bucketName: string
  apiKey: string
  jurisdiction?: string
}

export interface CloudflareDeleteR2BucketCorsResponse extends ToolResponse {
  output: { success: boolean }
}

export interface CloudflareGetR2BucketLifecycleParams {
  accountId: string
  bucketName: string
  apiKey: string
  jurisdiction?: string
}

export interface CloudflareGetR2BucketLifecycleResponse extends ToolResponse {
  output: CloudflareOutput<typeof R2_LIFECYCLE_OUTPUTS>
}

export interface CloudflareUpdateR2BucketLifecycleParams {
  accountId: string
  bucketName: string
  apiKey: string
  rules: string | unknown[]
  jurisdiction?: string
}

export interface CloudflareUpdateR2BucketLifecycleResponse extends ToolResponse {
  output: { success: boolean }
}
