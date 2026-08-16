import { createAccessApplicationTool } from '@/tools/cloudflare/create_access_application'
import { createAccessPolicyTool } from '@/tools/cloudflare/create_access_policy'
import { createAccessServiceTokenTool } from '@/tools/cloudflare/create_access_service_token'
import { createDnsRecordTool } from '@/tools/cloudflare/create_dns_record'
import { createR2BucketTool } from '@/tools/cloudflare/create_r2_bucket'
import { createRateLimitRuleTool } from '@/tools/cloudflare/create_rate_limit_rule'
import { createRulesetTool } from '@/tools/cloudflare/create_ruleset'
import { createRulesetRuleTool } from '@/tools/cloudflare/create_ruleset_rule'
import { createZoneTool } from '@/tools/cloudflare/create_zone'
import { deleteAccessApplicationTool } from '@/tools/cloudflare/delete_access_application'
import { deleteAccessPolicyTool } from '@/tools/cloudflare/delete_access_policy'
import { deleteDnsRecordTool } from '@/tools/cloudflare/delete_dns_record'
import { deleteR2BucketTool } from '@/tools/cloudflare/delete_r2_bucket'
import { deleteRulesetRuleTool } from '@/tools/cloudflare/delete_ruleset_rule'
import { deleteZoneTool } from '@/tools/cloudflare/delete_zone'
import { dnsAnalyticsTool } from '@/tools/cloudflare/dns_analytics'
import { getAccessApplicationTool } from '@/tools/cloudflare/get_access_application'
import { getR2BucketTool } from '@/tools/cloudflare/get_r2_bucket'
import { getRulesetTool } from '@/tools/cloudflare/get_ruleset'
import { getRulesetEntrypointTool } from '@/tools/cloudflare/get_ruleset_entrypoint'
import { getTunnelTool } from '@/tools/cloudflare/get_tunnel'
import { getTunnelConfigurationTool } from '@/tools/cloudflare/get_tunnel_configuration'
import { getWorkerScriptSettingsTool } from '@/tools/cloudflare/get_worker_script_settings'
import { getZoneTool } from '@/tools/cloudflare/get_zone'
import { getZoneSettingsTool } from '@/tools/cloudflare/get_zone_settings'
import { listAccessApplicationsTool } from '@/tools/cloudflare/list_access_applications'
import { listAccessGroupsTool } from '@/tools/cloudflare/list_access_groups'
import { listAccessIdentityProvidersTool } from '@/tools/cloudflare/list_access_identity_providers'
import { listAccessPoliciesTool } from '@/tools/cloudflare/list_access_policies'
import { listAccessServiceTokensTool } from '@/tools/cloudflare/list_access_service_tokens'
import { listCertificatesTool } from '@/tools/cloudflare/list_certificates'
import { listDnsRecordsTool } from '@/tools/cloudflare/list_dns_records'
import { listManagedRulesetOverridesTool } from '@/tools/cloudflare/list_managed_ruleset_overrides'
import { listR2BucketsTool } from '@/tools/cloudflare/list_r2_buckets'
import { listRateLimitRulesTool } from '@/tools/cloudflare/list_rate_limit_rules'
import { listRulesetsTool } from '@/tools/cloudflare/list_rulesets'
import { listTunnelsTool } from '@/tools/cloudflare/list_tunnels'
import { listWorkerRoutesTool } from '@/tools/cloudflare/list_worker_routes'
import { listWorkerScriptsTool } from '@/tools/cloudflare/list_worker_scripts'
import { listZonesTool } from '@/tools/cloudflare/list_zones'
import { purgeCacheTool } from '@/tools/cloudflare/purge_cache'
import { revokeAccessServiceTokenTool } from '@/tools/cloudflare/revoke_access_service_token'
import { updateAccessApplicationTool } from '@/tools/cloudflare/update_access_application'
import { updateAccessPolicyTool } from '@/tools/cloudflare/update_access_policy'
import { updateDnsRecordTool } from '@/tools/cloudflare/update_dns_record'
import { updateRateLimitRuleTool } from '@/tools/cloudflare/update_rate_limit_rule'
import { updateRulesetRuleTool } from '@/tools/cloudflare/update_ruleset_rule'
import { updateZoneSettingTool } from '@/tools/cloudflare/update_zone_setting'

export const cloudflareCreateAccessApplicationTool = createAccessApplicationTool
export const cloudflareCreateAccessPolicyTool = createAccessPolicyTool
export const cloudflareCreateAccessServiceTokenTool = createAccessServiceTokenTool
export const cloudflareCreateDnsRecordTool = createDnsRecordTool
export const cloudflareCreateR2BucketTool = createR2BucketTool
export const cloudflareCreateRateLimitRuleTool = createRateLimitRuleTool
export const cloudflareCreateRulesetTool = createRulesetTool
export const cloudflareCreateRulesetRuleTool = createRulesetRuleTool
export const cloudflareCreateZoneTool = createZoneTool
export const cloudflareDeleteAccessApplicationTool = deleteAccessApplicationTool
export const cloudflareDeleteAccessPolicyTool = deleteAccessPolicyTool
export const cloudflareDeleteDnsRecordTool = deleteDnsRecordTool
export const cloudflareDeleteR2BucketTool = deleteR2BucketTool
export const cloudflareDeleteRulesetRuleTool = deleteRulesetRuleTool
export const cloudflareDeleteZoneTool = deleteZoneTool
export const cloudflareDnsAnalyticsTool = dnsAnalyticsTool
export const cloudflareGetAccessApplicationTool = getAccessApplicationTool
export const cloudflareGetR2BucketTool = getR2BucketTool
export const cloudflareGetRulesetTool = getRulesetTool
export const cloudflareGetRulesetEntrypointTool = getRulesetEntrypointTool
export const cloudflareGetTunnelTool = getTunnelTool
export const cloudflareGetTunnelConfigurationTool = getTunnelConfigurationTool
export const cloudflareGetWorkerScriptSettingsTool = getWorkerScriptSettingsTool
export const cloudflareGetZoneTool = getZoneTool
export const cloudflareGetZoneSettingsTool = getZoneSettingsTool
export const cloudflareListAccessApplicationsTool = listAccessApplicationsTool
export const cloudflareListAccessGroupsTool = listAccessGroupsTool
export const cloudflareListAccessIdentityProvidersTool = listAccessIdentityProvidersTool
export const cloudflareListAccessPoliciesTool = listAccessPoliciesTool
export const cloudflareListAccessServiceTokensTool = listAccessServiceTokensTool
export const cloudflareListCertificatesTool = listCertificatesTool
export const cloudflareListDnsRecordsTool = listDnsRecordsTool
export const cloudflareListManagedRulesetOverridesTool = listManagedRulesetOverridesTool
export const cloudflareListR2BucketsTool = listR2BucketsTool
export const cloudflareListRateLimitRulesTool = listRateLimitRulesTool
export const cloudflareListRulesetsTool = listRulesetsTool
export const cloudflareListTunnelsTool = listTunnelsTool
export const cloudflareListWorkerRoutesTool = listWorkerRoutesTool
export const cloudflareListWorkerScriptsTool = listWorkerScriptsTool
export const cloudflareListZonesTool = listZonesTool
export const cloudflarePurgeCacheTool = purgeCacheTool
export const cloudflareRevokeAccessServiceTokenTool = revokeAccessServiceTokenTool
export const cloudflareUpdateAccessApplicationTool = updateAccessApplicationTool
export const cloudflareUpdateAccessPolicyTool = updateAccessPolicyTool
export const cloudflareUpdateDnsRecordTool = updateDnsRecordTool
export const cloudflareUpdateRateLimitRuleTool = updateRateLimitRuleTool
export const cloudflareUpdateRulesetRuleTool = updateRulesetRuleTool
export const cloudflareUpdateZoneSettingTool = updateZoneSettingTool
