import type { ToolResponse } from '@/tools/types'

export interface CloudflareBaseParams {
  apiKey: string
}

export interface CloudflareListZonesParams extends CloudflareBaseParams {
  name?: string
  status?: string
  page?: number
  per_page?: number
}

export interface CloudflareZone {
  id: string
  name: string
  status: string
  paused: boolean
  type: string
  name_servers: string[]
  original_name_servers: string[]
  created_on: string
  modified_on: string
  plan: {
    id: string
    name: string
  }
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
    plan: {
      id: string
      name: string
    }
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
    plan: {
      id: string
      name: string
    }
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
}

export interface CloudflareDnsRecord {
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
}

export interface CloudflareCertificateGeoRestrictions {
  label: string
}

export interface CloudflareCertificate {
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

export interface CloudflareCertificatePack {
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
  created_on: string
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
  files?: string[]
  tags?: string[]
  hosts?: string[]
  prefixes?: string[]
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

export interface CloudflareDnsAnalyticsResponse extends ToolResponse {
  output: {
    totals: {
      queryCount: number
      uncachedCount: number
      staleCount: number
      responseTimeAvg?: number
      responseTimeMedian?: number
      responseTime90th?: number
      responseTime99th?: number
    }
    data: Array<{
      dimensions: string[]
      metrics: number[]
    }>
    data_lag: number
    rows: number
  }
}

export interface CloudflareGetZoneSettingsParams extends CloudflareBaseParams {
  zoneId: string
}

export interface CloudflareZoneSetting {
  id: string
  value: unknown
  editable: boolean
  modified_on: string
  time_remaining?: number
}

export interface CloudflareGetZoneSettingsResponse extends ToolResponse {
  output: {
    settings: CloudflareZoneSetting[]
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
    value: unknown
    editable: boolean
    modified_on: string
    time_remaining?: number
  }
}

export type CloudflareResponse =
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
