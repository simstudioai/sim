import type { ToolResponse } from '@/tools/types'

/** Basic credential resolved from the saved Fivetran API key. */
export interface FivetranAuthParams {
  accessToken: string
}

interface FivetranPaginationParams {
  cursor?: string
  limit?: number
}

export interface FivetranCondition {
  code: string | null
  message: string | null
  details: string | null
}

interface FivetranConnectionStatus {
  setupState: string | null
  syncState: string | null
  updateState: string | null
  isHistoricalSync: boolean | null
  schemaStatus: string | null
  rescheduledFor: string | null
  tasks: FivetranCondition[]
  warnings: FivetranCondition[]
}

export interface FivetranSetupTest {
  title: string | null
  status: string | null
  message: string | null
  details: Record<string, unknown> | null
}

interface FivetranConnectionSchedule {
  scheduleType: string | null
  interval: number | null
  cron: string | null
  daysOfWeek: string[]
  timeOfDay: string | null
}

export interface FivetranConnection {
  id: string
  groupId: string | null
  service: string | null
  serviceVersion: number | null
  schema: string | null
  paused: boolean | null
  pauseAfterTrial: boolean | null
  connectedBy: string | null
  createdAt: string | null
  succeededAt: string | null
  failedAt: string | null
  syncFrequency: number | null
  scheduleType: string | null
  dailySyncTime: string | null
  dataDelaySensitivity: string | null
  dataDelayThreshold: number | null
  networkingMethod: string | null
  privateLinkId: string | null
  proxyAgentId: string | null
  hybridDeploymentAgentId: string | null
  dataChecks: boolean | null
  destinationSchemaNames: string | null
  status: FivetranConnectionStatus
  schedule: FivetranConnectionSchedule | null
  setupTests: FivetranSetupTest[]
  config: Record<string, unknown> | null
}

export interface FivetranGroup {
  id: string
  name: string | null
  createdAt: string | null
}

export interface FivetranDestination {
  id: string
  groupId: string | null
  service: string | null
  region: string | null
  timeZoneOffset: string | null
  setupStatus: string | null
  daylightSavingTimeEnabled: boolean | null
  networkingMethod: string | null
  privateLinkId: string | null
  hybridDeploymentAgentId: string | null
  proxyAgentId: string | null
  setupTests: FivetranSetupTest[]
}

interface FivetranTransformationSchedule {
  scheduleType: string | null
  interval: number | null
  cron: string[]
  daysOfWeek: string[]
  timeOfDay: string | null
  connectionIds: string[]
  transformationIds: string[]
  smartSyncing: boolean | null
}

export interface FivetranTransformation {
  id: string
  type: string | null
  status: string | null
  paused: boolean | null
  createdAt: string | null
  createdById: string | null
  lastStartedAt: string | null
  lastEndedAt: string | null
  outputModelNames: string[]
  schedule: FivetranTransformationSchedule | null
}

export interface FivetranUser {
  id: string
  email: string | null
  givenName: string | null
  familyName: string | null
  role: string | null
  active: boolean | null
  verified: boolean | null
  invited: boolean | null
  userType: string | null
  hasApiKey: boolean | null
  phone: string | null
  loggedInAt: string | null
  createdAt: string | null
}

export interface FivetranConnectorType {
  id: string
  name: string | null
  type: string | null
  description: string | null
  connectorClass: string | null
  serviceStatus: string | null
  iconUrl: string | null
  linkToDocs: string | null
  linkToErd: string | null
  supportsSchemaReload: boolean | null
  supportedFeatures: string[]
}

interface FivetranSyncHistoryEntry {
  syncId: string
  status: string | null
  start: string | null
  end: string | null
  reason: string | null
  extractVolumeMb: number | null
  processVolumeMb: number | null
  loadVolumeMb: number | null
}

interface FivetranTableWarning {
  code: string | null
  message: string | null
  errorMessage: string | null
  createdAt: string | null
}

interface FivetranWarningGroup {
  schema: string | null
  table: string | null
  warnings: FivetranTableWarning[]
}

export interface FivetranSchemaConfig {
  schemas: Record<string, unknown>
  enableNewByDefault: boolean | null
  schemaChangeHandling: string | null
  rowFilteringSupported: boolean | null
}

export interface FivetranGetAccountInfoResponse extends ToolResponse {
  output: {
    accountId: string | null
    accountName: string | null
    userId: string | null
    systemKeyId: string | null
  }
}

export type FivetranListGroupsParams = FivetranAuthParams & FivetranPaginationParams

export interface FivetranListGroupsResponse extends ToolResponse {
  output: { groups: FivetranGroup[]; nextCursor: string | null }
}

export interface FivetranGroupParams extends FivetranAuthParams {
  groupId: string
}

export interface FivetranGetGroupResponse extends ToolResponse {
  output: { group: FivetranGroup }
}

export interface FivetranListConnectionsParams
  extends FivetranAuthParams,
    FivetranPaginationParams {
  groupId?: string
  schema?: string
}

export interface FivetranListConnectionsResponse extends ToolResponse {
  output: { connections: FivetranConnection[]; nextCursor: string | null }
}

export interface FivetranConnectionParams extends FivetranAuthParams {
  connectionId: string
}

export interface FivetranConnectionResponse extends ToolResponse {
  output: { connection: FivetranConnection }
}

export interface FivetranCreateConnectionParams extends FivetranAuthParams {
  groupId: string
  service: string
  config: Record<string, unknown> | string
  auth?: Record<string, unknown> | string
  paused?: boolean
  syncFrequency?: number
  scheduleType?: string
  dailySyncTime?: string
  dataDelaySensitivity?: string
  dataDelayThreshold?: number
  destinationSchemaNames?: string
  pauseAfterTrial?: boolean
  runSetupTests?: boolean
  trustCertificates?: boolean
  trustFingerprints?: boolean
}

export interface FivetranUpdateConnectionParams extends FivetranConnectionParams {
  config?: Record<string, unknown> | string
  auth?: Record<string, unknown> | string
  paused?: boolean
  syncFrequency?: number
  scheduleType?: string
  dailySyncTime?: string
  dataDelaySensitivity?: string
  dataDelayThreshold?: number
  pauseAfterTrial?: boolean
  isHistoricalSync?: boolean
  runSetupTests?: boolean
  trustCertificates?: boolean
  trustFingerprints?: boolean
}

/** Fivetran actions that return only `{ code, message }`. */
export interface FivetranMessageResponse extends ToolResponse {
  output: { code: string | null; message: string | null }
}

export interface FivetranSyncConnectionParams extends FivetranConnectionParams {
  force?: boolean
}

export interface FivetranSyncConnectionResponse extends ToolResponse {
  output: { result: string | null; message: string | null }
}

export interface FivetranResyncConnectionParams extends FivetranConnectionParams {
  scope?: Record<string, string[]> | string
}

export interface FivetranResyncTablesParams extends FivetranConnectionParams {
  tables: Record<string, string[]> | string
}

interface FivetranSetupTestParams extends FivetranAuthParams {
  trustCertificates?: boolean
  trustFingerprints?: boolean
}

export interface FivetranRunConnectionSetupTestsParams
  extends FivetranSetupTestParams,
    FivetranConnectionParams {}

export interface FivetranSchemaConfigResponse extends ToolResponse {
  output: FivetranSchemaConfig
}

export interface FivetranReloadConnectionSchemaParams extends FivetranConnectionParams {
  excludeMode?: string
}

export interface FivetranUpdateConnectionTableParams extends FivetranConnectionParams {
  schemaName: string
  tableName: string
  enabled: boolean
  syncMode?: string
}

export interface FivetranGetSyncHistoryParams
  extends FivetranConnectionParams,
    FivetranPaginationParams {
  startTime?: string
  endTime?: string
}

export interface FivetranGetSyncHistoryResponse extends ToolResponse {
  output: { syncs: FivetranSyncHistoryEntry[]; nextCursor: string | null }
}

export interface FivetranGetConnectionWarningsResponse extends ToolResponse {
  output: { warningGroups: FivetranWarningGroup[] }
}

export interface FivetranCreateConnectCardParams extends FivetranConnectionParams {
  redirectUri: string
  hideSetupGuide?: boolean
  allFields?: boolean
}

export interface FivetranCreateConnectCardResponse extends ToolResponse {
  output: {
    connectionId: string | null
    uri: string | null
    token: string | null
    redirectUri: string | null
  }
}

export type FivetranListDestinationsParams = FivetranAuthParams & FivetranPaginationParams

export interface FivetranListDestinationsResponse extends ToolResponse {
  output: { destinations: FivetranDestination[]; nextCursor: string | null }
}

export interface FivetranDestinationParams extends FivetranAuthParams {
  destinationId: string
}

export interface FivetranRunDestinationSetupTestsParams
  extends FivetranSetupTestParams,
    FivetranDestinationParams {}

export interface FivetranDestinationResponse extends ToolResponse {
  output: { destination: FivetranDestination }
}

export interface FivetranListTransformationsParams
  extends FivetranAuthParams,
    FivetranPaginationParams {
  groupId?: string
  projectId?: string
  transformationType?: string
}

export interface FivetranListTransformationsResponse extends ToolResponse {
  output: { transformations: FivetranTransformation[]; nextCursor: string | null }
}

export interface FivetranTransformationParams extends FivetranAuthParams {
  transformationId: string
}

export interface FivetranGetTransformationResponse extends ToolResponse {
  output: { transformation: FivetranTransformation }
}

export interface FivetranRunTransformationParams extends FivetranTransformationParams {
  fullRefresh?: boolean
}

export interface FivetranListUsersParams extends FivetranAuthParams, FivetranPaginationParams {
  active?: boolean
  userType?: string
  hasApiKey?: boolean
}

export interface FivetranListUsersResponse extends ToolResponse {
  output: { users: FivetranUser[]; nextCursor: string | null }
}

export type FivetranListConnectorTypesParams = FivetranAuthParams & FivetranPaginationParams

export interface FivetranListConnectorTypesResponse extends ToolResponse {
  output: { connectorTypes: FivetranConnectorType[]; nextCursor: string | null }
}
