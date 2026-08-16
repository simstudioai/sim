import type { ToolResponse } from '@/tools/types'

export type CrowdStrikeCloud = 'us-1' | 'us-2' | 'us-3' | 'eu-1' | 'us-gov-1' | 'us-gov-2'

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

interface CrowdStrikeAggregateDateRangeSpec {
  from: string
  to: string
}

interface CrowdStrikeAggregateExtendedBoundsSpec {
  max: string
  min: string
}

/** CrowdStrike's `MsaRangeSpec` serializes its bounds capitalized, unlike every sibling spec. */
interface CrowdStrikeAggregateRangeSpec {
  From: number
  To: number
}

/** CrowdStrike's `MsaAPIFiltersSpec`: an FQL-per-bucket map plus the catch-all bucket controls. */
export interface CrowdStrikeAggregateFiltersSpec {
  filters: Record<string, string>
  other_bucket?: boolean
  other_bucket_key?: string
}

export interface CrowdStrikeAggregateQuery {
  date_ranges?: CrowdStrikeAggregateDateRangeSpec[]
  exclude?: string
  extended_bounds?: CrowdStrikeAggregateExtendedBoundsSpec
  field?: string
  filter?: string
  filters_spec?: CrowdStrikeAggregateFiltersSpec
  from?: number
  include?: string
  interval?: string
  max_doc_count?: number
  min_doc_count?: number
  missing?: string
  name?: string
  percents?: number[]
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

interface CrowdStrikePagination {
  limit: number | null
  offset: number | null
  total: number | null
}

interface CrowdStrikeSensor {
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
    errors: CrowdStrikeApiError[]
    pagination: CrowdStrikePagination | null
    sensors: CrowdStrikeSensor[]
  }
}

export interface CrowdStrikeGetSensorDetailsResponse extends ToolResponse {
  output: {
    count: number
    errors: CrowdStrikeApiError[]
    pagination: CrowdStrikePagination | null
    sensors: CrowdStrikeSensor[]
  }
}

export interface CrowdStrikeSensorAggregateBucket {
  count: number | null
  from: number | null
  keyAsString: string | null
  label: unknown
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
    errors: CrowdStrikeApiError[]
  }
}

export interface CrowdStrikeApiError {
  code: number | null
  id: string | null
  message: string | null
}

interface CrowdStrikeCursorPagination extends CrowdStrikePagination {
  after: string | null
}

interface CrowdStrikeSpotlightPagination {
  after: string | null
  limit: number | null
  total: number | null
}

export interface CrowdStrikeQueryAlertsParams extends CrowdStrikeBaseParams {
  filter?: string
  q?: string
  limit?: number
  offset?: number
  sort?: string
  includeHidden?: boolean
}

export interface CrowdStrikeGetAlertDetailsParams extends CrowdStrikeBaseParams {
  compositeIds: string[]
  includeHidden?: boolean
}

export interface CrowdStrikeUpdateAlertsParams extends CrowdStrikeBaseParams {
  compositeIds: string[]
  updateStatus?: string
  assignToUuid?: string
  assignToUserId?: string
  assignToName?: string
  unassign?: boolean
  appendComment?: string
  addTag?: string
  removeTag?: string
  removeTagsByPrefix?: string
  showInUi?: boolean
  actionParameters?: CrowdStrikeActionParameter[]
  includeHidden?: boolean
}

export interface CrowdStrikeActionParameter {
  name: string
  value: string
}

export interface CrowdStrikeAlert {
  compositeId: string | null
  id: string | null
  cid: string | null
  aggregateId: string | null
  agentId: string | null
  deviceId: string | null
  hostname: string | null
  name: string | null
  displayName: string | null
  description: string | null
  type: string | null
  product: string | null
  platform: string | null
  severity: number | null
  severityName: string | null
  confidence: number | null
  status: string | null
  assignedToName: string | null
  assignedToUid: string | null
  assignedToUuid: string | null
  tactic: string | null
  tacticId: string | null
  technique: string | null
  techniqueId: string | null
  scenario: string | null
  objective: string | null
  resolution: string | null
  showInUi: boolean | null
  tags: string[]
  filename: string | null
  filepath: string | null
  cmdline: string | null
  sha256: string | null
  sha1: string | null
  md5: string | null
  userName: string | null
  userId: string | null
  patternId: number | null
  falconHostLink: string | null
  controlGraphId: string | null
  external: boolean | null
  emailSent: boolean | null
  isAggregated: boolean | null
  isFalconPlatformIoa: boolean | null
  dataDomains: string[]
  iocValues: string[]
  linkedCaseIds: string[]
  linkedBehavioralDetections: string[]
  timestamp: string | null
  createdTimestamp: string | null
  updatedTimestamp: string | null
  crawledTimestamp: string | null
  contextTimestamp: string | null
}

export interface CrowdStrikeQueryAlertsResponse extends ToolResponse {
  output: {
    alertIds: string[]
    count: number
    pagination: CrowdStrikePagination | null
  }
}

export interface CrowdStrikeGetAlertDetailsResponse extends ToolResponse {
  output: {
    alerts: CrowdStrikeAlert[]
    count: number
    errors: CrowdStrikeApiError[]
  }
}

export interface CrowdStrikeUpdateAlertsResponse extends ToolResponse {
  output: {
    updatedIds: string[]
    count: number
    errors: CrowdStrikeApiError[]
  }
}

export interface CrowdStrikePerformHostActionParams extends CrowdStrikeBaseParams {
  actionName: string
  deviceIds: string[]
}

export interface CrowdStrikeAffectedEntity {
  id: string | null
  path: string | null
}

export interface CrowdStrikePerformHostActionResponse extends ToolResponse {
  output: {
    affected: CrowdStrikeAffectedEntity[]
    count: number
    errors: CrowdStrikeApiError[]
  }
}

export interface CrowdStrikeQueryHostGroupsParams extends CrowdStrikeBaseParams {
  filter?: string
  limit?: number
  offset?: number
  sort?: string
}

export interface CrowdStrikeGetHostGroupDetailsParams extends CrowdStrikeBaseParams {
  hostGroupIds: string[]
}

export interface CrowdStrikePerformHostGroupActionParams extends CrowdStrikeBaseParams {
  actionName: string
  hostGroupId: string
  deviceIds: string[]
}

export interface CrowdStrikeHostGroup {
  id: string | null
  name: string | null
  description: string | null
  groupType: string | null
  assignmentRule: string | null
  createdBy: string | null
  createdTimestamp: string | null
  modifiedBy: string | null
  modifiedTimestamp: string | null
}

export interface CrowdStrikeQueryHostGroupsResponse extends ToolResponse {
  output: {
    hostGroupIds: string[]
    count: number
    pagination: CrowdStrikePagination | null
  }
}

export interface CrowdStrikeGetHostGroupDetailsResponse extends ToolResponse {
  output: {
    hostGroups: CrowdStrikeHostGroup[]
    count: number
    errors: CrowdStrikeApiError[]
  }
}

export interface CrowdStrikePerformHostGroupActionResponse extends ToolResponse {
  output: {
    hostGroups: CrowdStrikeHostGroup[]
    count: number
    errors: CrowdStrikeApiError[]
  }
}

export interface CrowdStrikeQueryIndicatorsParams extends CrowdStrikeBaseParams {
  filter?: string
  limit?: number
  offset?: number
  after?: string
  sort?: string
}

export interface CrowdStrikeGetIndicatorDetailsParams extends CrowdStrikeBaseParams {
  indicatorIds: string[]
}

export interface CrowdStrikeCreateIndicatorsParams extends CrowdStrikeBaseParams {
  indicators: Record<string, unknown>[]
  comment?: string
  retrodetects?: boolean
  ignoreWarnings?: boolean
}

export interface CrowdStrikeUpdateIndicatorsParams extends CrowdStrikeBaseParams {
  indicators: Record<string, unknown>[]
  comment?: string
  retrodetects?: boolean
  ignoreWarnings?: boolean
}

export interface CrowdStrikeDeleteIndicatorsParams extends CrowdStrikeBaseParams {
  indicatorIds?: string[]
  filter?: string
  comment?: string
}

export interface CrowdStrikeIndicatorMetadata {
  avHits: number | null
  companyName: string | null
  fileDescription: string | null
  fileVersion: string | null
  filename: string | null
  originalFilename: string | null
  productName: string | null
  productVersion: string | null
  signed: boolean | null
}

export interface CrowdStrikeIndicator {
  id: string | null
  type: string | null
  value: string | null
  action: string | null
  mobileAction: string | null
  severity: string | null
  description: string | null
  source: string | null
  appliedGlobally: boolean | null
  platforms: string[]
  hostGroups: string[]
  tags: string[]
  expiration: string | null
  expired: boolean | null
  deleted: boolean | null
  fromParent: boolean | null
  parentCidName: string | null
  createdBy: string | null
  createdOn: string | null
  modifiedBy: string | null
  modifiedOn: string | null
  metadata: CrowdStrikeIndicatorMetadata | null
}

export interface CrowdStrikeQueryIndicatorsResponse extends ToolResponse {
  output: {
    indicatorIds: string[]
    count: number
    pagination: CrowdStrikeCursorPagination | null
  }
}

export interface CrowdStrikeIndicatorListResponse extends ToolResponse {
  output: {
    indicators: CrowdStrikeIndicator[]
    count: number
    errors: CrowdStrikeApiError[]
  }
}

export type CrowdStrikeGetIndicatorDetailsResponse = CrowdStrikeIndicatorListResponse
export type CrowdStrikeCreateIndicatorsResponse = CrowdStrikeIndicatorListResponse
export type CrowdStrikeUpdateIndicatorsResponse = CrowdStrikeIndicatorListResponse

export interface CrowdStrikeDeleteIndicatorsResponse extends ToolResponse {
  output: {
    deletedIds: string[]
    count: number
    errors: CrowdStrikeApiError[]
  }
}

export interface CrowdStrikeQueryVulnerabilitiesParams extends CrowdStrikeBaseParams {
  filter: string
  limit?: number
  after?: string
  sort?: string
}

export interface CrowdStrikeGetVulnerabilityDetailsParams extends CrowdStrikeBaseParams {
  vulnerabilityIds: string[]
}

export interface CrowdStrikeVulnerabilityCve {
  id: string | null
  baseScore: number | null
  severity: string | null
  exprtRating: string | null
  exploitStatus: number | null
  exploitabilityScore: number | null
  impactScore: number | null
  remediationLevel: string | null
  description: string | null
  publishedDate: string | null
  vector: string | null
  types: string[]
  isCisaKev: boolean | null
  cisaDueDate: string | null
}

export interface CrowdStrikeVulnerabilityApp {
  productNameNormalized: string | null
  productNameVersion: string | null
  vendorNormalized: string | null
}

export interface CrowdStrikeVulnerabilityHostInfo {
  hostname: string | null
  localIp: string | null
  machineDomain: string | null
  osVersion: string | null
  platform: string | null
  productTypeDesc: string | null
  assetCriticality: string | null
  internetExposure: string | null
  tags: string[]
  groups: string[]
}

export interface CrowdStrikeVulnerabilityRemediation {
  id: string | null
  title: string | null
  action: string | null
  type: string | null
  link: string | null
  reference: string | null
  vendorUrl: string | null
}

export interface CrowdStrikeVulnerability {
  id: string | null
  aid: string | null
  cid: string | null
  status: string | null
  confidence: string | null
  vulnerabilityId: string | null
  createdTimestamp: string | null
  updatedTimestamp: string | null
  closedTimestamp: string | null
  cve: CrowdStrikeVulnerabilityCve | null
  app: CrowdStrikeVulnerabilityApp | null
  hostInfo: CrowdStrikeVulnerabilityHostInfo | null
  remediationIds: string[]
  remediations: CrowdStrikeVulnerabilityRemediation[]
  suppressionInfo: { isSuppressed: boolean | null; reason: string | null } | null
}

export interface CrowdStrikeQueryVulnerabilitiesResponse extends ToolResponse {
  output: {
    vulnerabilityIds: string[]
    count: number
    pagination: CrowdStrikeSpotlightPagination | null
  }
}

export interface CrowdStrikeGetVulnerabilityDetailsResponse extends ToolResponse {
  output: {
    vulnerabilities: CrowdStrikeVulnerability[]
    count: number
    errors: CrowdStrikeApiError[]
  }
}

export interface CrowdStrikeInitRtrSessionParams extends CrowdStrikeBaseParams {
  deviceId: string
  queueOffline?: boolean
  origin?: string
}

export interface CrowdStrikeExecuteRtrCommandParams extends CrowdStrikeBaseParams {
  sessionId: string
  baseCommand: string
  commandString: string
}

export interface CrowdStrikeGetRtrCommandStatusParams extends CrowdStrikeBaseParams {
  cloudRequestId: string
  sequenceId?: number
}

export interface CrowdStrikeDeleteRtrSessionParams extends CrowdStrikeBaseParams {
  sessionId: string
}

export interface CrowdStrikeInitRtrSessionResponse extends ToolResponse {
  output: {
    sessionId: string | null
    deviceId: string | null
    platform: string | null
    pwd: string | null
    offlineQueued: boolean | null
    existingAidSessions: number | null
    createdAt: string | null
    errors: CrowdStrikeApiError[]
  }
}

export interface CrowdStrikeExecuteRtrCommandResponse extends ToolResponse {
  output: {
    cloudRequestId: string | null
    sessionId: string | null
    queuedCommandOffline: boolean | null
    errors: CrowdStrikeApiError[]
  }
}

export interface CrowdStrikeGetRtrCommandStatusResponse extends ToolResponse {
  output: {
    complete: boolean | null
    stdout: string | null
    stderr: string | null
    baseCommand: string | null
    sessionId: string | null
    taskId: string | null
    sequenceId: number | null
    errors: CrowdStrikeApiError[]
  }
}

export interface CrowdStrikeDeleteRtrSessionResponse extends ToolResponse {
  output: {
    sessionId: string
    deleted: boolean
    errors: CrowdStrikeApiError[]
  }
}

export interface CrowdStrikeQueryCasesParams extends CrowdStrikeBaseParams {
  filter?: string
  q?: string
  limit?: number
  offset?: number
  sort?: string
}

export interface CrowdStrikeGetCaseDetailsParams extends CrowdStrikeBaseParams {
  caseIds: string[]
}

export interface CrowdStrikeFalconUser {
  uuid: string | null
  email: string | null
  fullName: string | null
}

export interface CrowdStrikeCase {
  id: string | null
  cid: string | null
  name: string | null
  description: string | null
  descriptionFormat: string | null
  status: string | null
  severity: number | null
  severityLevel: string | null
  referenceId: string | null
  version: number | null
  tags: string[]
  assignedTo: CrowdStrikeFalconUser | null
  createdBy: CrowdStrikeFalconUser | null
  lastUpdatedBy: CrowdStrikeFalconUser | null
  createdTimestamp: string | null
  updatedTimestamp: string | null
  startTimestamp: string | null
  endTimestamp: string | null
  templateId: string | null
  templateName: string | null
  slaId: string | null
  slaName: string | null
  isReadOnly: boolean | null
}

export interface CrowdStrikeQueryCasesResponse extends ToolResponse {
  output: {
    caseIds: string[]
    count: number
    pagination: CrowdStrikePagination | null
  }
}

export interface CrowdStrikeGetCaseDetailsResponse extends ToolResponse {
  output: {
    cases: CrowdStrikeCase[]
    count: number
    errors: CrowdStrikeApiError[]
  }
}

export type CrowdStrikeResponse =
  | CrowdStrikeQuerySensorsResponse
  | CrowdStrikeGetSensorDetailsResponse
  | CrowdStrikeGetSensorAggregatesResponse
  | CrowdStrikeQueryAlertsResponse
  | CrowdStrikeGetAlertDetailsResponse
  | CrowdStrikeUpdateAlertsResponse
  | CrowdStrikePerformHostActionResponse
  | CrowdStrikeQueryHostGroupsResponse
  | CrowdStrikeGetHostGroupDetailsResponse
  | CrowdStrikePerformHostGroupActionResponse
  | CrowdStrikeQueryIndicatorsResponse
  | CrowdStrikeIndicatorListResponse
  | CrowdStrikeDeleteIndicatorsResponse
  | CrowdStrikeQueryVulnerabilitiesResponse
  | CrowdStrikeGetVulnerabilityDetailsResponse
  | CrowdStrikeInitRtrSessionResponse
  | CrowdStrikeExecuteRtrCommandResponse
  | CrowdStrikeGetRtrCommandStatusResponse
  | CrowdStrikeDeleteRtrSessionResponse
  | CrowdStrikeQueryCasesResponse
  | CrowdStrikeGetCaseDetailsResponse
