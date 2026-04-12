import type { ToolResponse } from '@/tools/types'

export type CrowdStrikeCloud = 'us-1' | 'us-2' | 'eu-1' | 'us-gov-1' | 'us-gov-2'

export interface CrowdStrikeBaseParams {
  clientId: string
  clientSecret: string
  cloud: CrowdStrikeCloud
}

export interface CrowdStrikeQuerySensorsParams extends CrowdStrikeBaseParams {
  filter?: string
  limit?: number
  offset?: number
  sort?: string
}

export interface CrowdStrikeGetSensorDetailsParams extends CrowdStrikeBaseParams {
  ids: string[]
}

export interface CrowdStrikeAggregateDateRangeSpec {
  from: string
  to: string
}

export interface CrowdStrikeAggregateExtendedBoundsSpec {
  max: string
  min: string
}

export interface CrowdStrikeAggregateRangeSpec {
  from: number
  to: number
}

export interface CrowdStrikeAggregateQuery {
  date_ranges?: CrowdStrikeAggregateDateRangeSpec[]
  exclude?: string
  extended_bounds?: CrowdStrikeAggregateExtendedBoundsSpec
  field?: string
  filter?: string
  from?: number
  include?: string
  interval?: string
  max_doc_count?: number
  min_doc_count?: number
  missing?: string
  name?: string
  q?: string
  ranges?: CrowdStrikeAggregateRangeSpec[]
  size?: number
  sort?: string
  sub_aggregates?: CrowdStrikeAggregateQuery[]
  time_zone?: string
  type?: string
}

export interface CrowdStrikeGetSensorAggregatesParams extends CrowdStrikeBaseParams {
  aggregateQuery: CrowdStrikeAggregateQuery
}

export interface CrowdStrikePagination {
  limit: number | null
  offset: number | null
  total: number | null
}

export interface CrowdStrikeSensor {
  agentVersion: string | null
  cid: string | null
  deviceId: string | null
  heartbeatTime: number | null
  hostname: string | null
  idpPolicyId: string | null
  idpPolicyName: string | null
  ipAddress: string | null
  kerberosConfig: string | null
  ldapConfig: string | null
  ldapsConfig: string | null
  machineDomain: string | null
  ntlmConfig: string | null
  osVersion: string | null
  rdpToDcConfig: string | null
  smbToDcConfig: string | null
  status: string | null
  statusCauses: string[]
  tiEnabled: string | null
}

export interface CrowdStrikeQuerySensorsResponse extends ToolResponse {
  output: {
    count: number
    pagination: CrowdStrikePagination | null
    sensors: CrowdStrikeSensor[]
  }
}

export interface CrowdStrikeGetSensorDetailsResponse extends ToolResponse {
  output: {
    count: number
    pagination: CrowdStrikePagination | null
    sensors: CrowdStrikeSensor[]
  }
}

export interface CrowdStrikeSensorAggregateBucket {
  count: number | null
  from: number | null
  keyAsString: string | null
  label: Record<string, unknown> | null
  stringFrom: string | null
  stringTo: string | null
  subAggregates: CrowdStrikeSensorAggregateResult[]
  to: number | null
  value: number | null
  valueAsString: string | null
}

export interface CrowdStrikeSensorAggregateResult {
  buckets: CrowdStrikeSensorAggregateBucket[]
  docCountErrorUpperBound: number | null
  name: string | null
  sumOtherDocCount: number | null
}

export interface CrowdStrikeGetSensorAggregatesResponse extends ToolResponse {
  output: {
    aggregates: CrowdStrikeSensorAggregateResult[]
    count: number
  }
}

export type CrowdStrikeResponse =
  | CrowdStrikeQuerySensorsResponse
  | CrowdStrikeGetSensorDetailsResponse
  | CrowdStrikeGetSensorAggregatesResponse
