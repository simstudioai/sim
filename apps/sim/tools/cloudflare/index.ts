import { createDnsRecordTool } from '@/tools/cloudflare/create_dns_record'
import { createZoneTool } from '@/tools/cloudflare/create_zone'
import { deleteDnsRecordTool } from '@/tools/cloudflare/delete_dns_record'
import { deleteZoneTool } from '@/tools/cloudflare/delete_zone'
import { dnsAnalyticsTool } from '@/tools/cloudflare/dns_analytics'
import { getZoneTool } from '@/tools/cloudflare/get_zone'
import { getZoneSettingsTool } from '@/tools/cloudflare/get_zone_settings'
import { listCertificatesTool } from '@/tools/cloudflare/list_certificates'
import { listDnsRecordsTool } from '@/tools/cloudflare/list_dns_records'
import { listZonesTool } from '@/tools/cloudflare/list_zones'
import { purgeCacheTool } from '@/tools/cloudflare/purge_cache'
import { updateDnsRecordTool } from '@/tools/cloudflare/update_dns_record'
import { updateZoneSettingTool } from '@/tools/cloudflare/update_zone_setting'

export const cloudflareCreateDnsRecordTool = createDnsRecordTool
export const cloudflareCreateZoneTool = createZoneTool
export const cloudflareDeleteDnsRecordTool = deleteDnsRecordTool
export const cloudflareDeleteZoneTool = deleteZoneTool
export const cloudflareDnsAnalyticsTool = dnsAnalyticsTool
export const cloudflareGetZoneTool = getZoneTool
export const cloudflareGetZoneSettingsTool = getZoneSettingsTool
export const cloudflareListCertificatesTool = listCertificatesTool
export const cloudflareListDnsRecordsTool = listDnsRecordsTool
export const cloudflareListZonesTool = listZonesTool
export const cloudflarePurgeCacheTool = purgeCacheTool
export const cloudflareUpdateDnsRecordTool = updateDnsRecordTool
export const cloudflareUpdateZoneSettingTool = updateZoneSettingTool
