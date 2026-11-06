import type { OutputProperty, ToolResponse } from '@/tools/types'

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

export interface FivetranGetConnectorTypeParams extends FivetranAuthParams {
  service: string
}

export interface FivetranGetConnectorTypeResponse extends ToolResponse {
  output: {
    connectorType: FivetranConnectorType
    config: Record<string, unknown> | null
    auth: Record<string, unknown> | null
  }
}

export interface FivetranUpdateSchemaConfigParams extends FivetranConnectionParams {
  schemaChangeHandling?: string
  schemas?: Record<string, unknown> | string
}

export interface FivetranUpdateConnectionSchemaParams extends FivetranConnectionParams {
  schemaName: string
  enabled: boolean
  tables?: Record<string, unknown> | string
}

export interface FivetranCreateGroupParams extends FivetranAuthParams {
  name: string
}

export interface FivetranCreateDestinationParams extends FivetranAuthParams {
  groupId: string
  service: string
  timeZoneOffset: string
  region?: string
  config?: Record<string, unknown> | string
  daylightSavingTimeEnabled?: boolean
  runSetupTests?: boolean
  trustCertificates?: boolean
  trustFingerprints?: boolean
}

export const NEXT_CURSOR_OUTPUT = {
  nextCursor: {
    type: 'string',
    description: 'Cursor for the next page; null on the last page',
    nullable: true,
  },
} as const satisfies Record<string, OutputProperty>

export const MESSAGE_OUTPUTS = {
  code: { type: 'string', description: 'Fivetran response code, e.g. Success', nullable: true },
  message: { type: 'string', description: 'Fivetran response message', nullable: true },
} as const satisfies Record<string, OutputProperty>

const CONDITION_ITEM = {
  type: 'object',
  properties: {
    code: { type: 'string', description: 'Machine-readable condition code', nullable: true },
    message: { type: 'string', description: 'Human-readable label', nullable: true },
    details: { type: 'string', description: 'Additional context', nullable: true },
  },
} as const satisfies OutputProperty['items']

const SETUP_TESTS_OUTPUT = {
  type: 'array',
  description: 'Setup test results',
  items: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Setup test step name', nullable: true },
      status: {
        type: 'string',
        description: 'Result (PASSED, SKIPPED, WARNING, FAILED, JOB_FAILED)',
        nullable: true,
      },
      message: { type: 'string', description: 'Result message', nullable: true },
      details: { type: 'json', description: 'Additional diagnostic details', nullable: true },
    },
  },
} as const satisfies OutputProperty

export const CONNECTION_PROPERTIES = {
  id: { type: 'string', description: 'Connection ID' },
  groupId: { type: 'string', description: 'Destination group ID', nullable: true },
  service: { type: 'string', description: 'Connector type, e.g. okta', nullable: true },
  serviceVersion: { type: 'number', description: 'Connector type version', nullable: true },
  schema: {
    type: 'string',
    description: 'Connection name, also the destination schema name',
    nullable: true,
  },
  paused: { type: 'boolean', description: 'Whether the connection is paused', nullable: true },
  pauseAfterTrial: {
    type: 'boolean',
    description: 'Whether the connection pauses when the free trial ends',
    nullable: true,
  },
  connectedBy: {
    type: 'string',
    description: 'ID of the user who created the connection',
    nullable: true,
  },
  createdAt: { type: 'string', description: 'When the connection was created', nullable: true },
  succeededAt: { type: 'string', description: 'Last successful sync time', nullable: true },
  failedAt: { type: 'string', description: 'Last failed sync time', nullable: true },
  syncFrequency: { type: 'number', description: 'Sync frequency in minutes', nullable: true },
  scheduleType: { type: 'string', description: 'Scheduling mode (auto or manual)', nullable: true },
  dailySyncTime: {
    type: 'string',
    description: 'Daily sync start time (HH:MM) for 24-hour frequency',
    nullable: true,
  },
  dataDelaySensitivity: {
    type: 'string',
    description: 'Data delay notification level (LOW, NORMAL, HIGH, CUSTOM, SYNC_FREQUENCY)',
    nullable: true,
  },
  dataDelayThreshold: {
    type: 'number',
    description: 'Custom data delay threshold in minutes',
    nullable: true,
  },
  networkingMethod: {
    type: 'string',
    description: 'Networking method, e.g. Directly or SshTunnel',
    nullable: true,
  },
  privateLinkId: { type: 'string', description: 'Private link ID', nullable: true },
  proxyAgentId: { type: 'string', description: 'Proxy agent ID', nullable: true },
  hybridDeploymentAgentId: {
    type: 'string',
    description: 'Hybrid deployment agent ID',
    nullable: true,
  },
  dataChecks: {
    type: 'boolean',
    description: 'Whether automated data validation is enabled',
    nullable: true,
  },
  destinationSchemaNames: {
    type: 'string',
    description: 'Destination schema naming (FIVETRAN_NAMING or SOURCE_NAMING)',
    nullable: true,
  },
  status: {
    type: 'object',
    description: 'Current connection state',
    properties: {
      setupState: {
        type: 'string',
        description: 'Setup state (incomplete, connected, broken)',
        nullable: true,
      },
      syncState: {
        type: 'string',
        description: 'Sync state (scheduled, syncing, paused, rescheduled)',
        nullable: true,
      },
      updateState: {
        type: 'string',
        description: 'Data update state (on_schedule, delayed)',
        nullable: true,
      },
      isHistoricalSync: {
        type: 'boolean',
        description: 'Whether a historical re-sync is pending or running',
        nullable: true,
      },
      schemaStatus: { type: 'string', description: 'Schema status', nullable: true },
      rescheduledFor: {
        type: 'string',
        description: 'Next sync attempt when the sync is rescheduled',
        nullable: true,
      },
      tasks: { type: 'array', description: 'Tasks that need action', items: CONDITION_ITEM },
      warnings: { type: 'array', description: 'Active warnings', items: CONDITION_ITEM },
    },
  },
  schedule: {
    type: 'object',
    description: 'Sync schedule configuration',
    nullable: true,
    properties: {
      scheduleType: {
        type: 'string',
        description: 'Schedule type (TIME_OF_DAY, INTERVAL, CRON, MANUAL)',
        nullable: true,
      },
      interval: { type: 'number', description: 'Interval in minutes', nullable: true },
      cron: { type: 'string', description: 'Cron expression', nullable: true },
      daysOfWeek: {
        type: 'array',
        description: 'Days the connection can sync',
        items: { type: 'string' },
      },
      timeOfDay: { type: 'string', description: 'Time of day (HH:MM)', nullable: true },
    },
  },
  setupTests: SETUP_TESTS_OUTPUT,
  config: {
    type: 'json',
    description: 'Connector-specific setup configuration',
    nullable: true,
  },
} as const satisfies Record<string, OutputProperty>

export const GROUP_PROPERTIES = {
  id: { type: 'string', description: 'Group ID' },
  name: { type: 'string', description: 'Group name', nullable: true },
  createdAt: { type: 'string', description: 'When the group was created', nullable: true },
} as const satisfies Record<string, OutputProperty>

export const DESTINATION_PROPERTIES = {
  id: { type: 'string', description: 'Destination ID' },
  groupId: { type: 'string', description: 'Group ID', nullable: true },
  service: { type: 'string', description: 'Destination type, e.g. databricks', nullable: true },
  region: { type: 'string', description: 'Data processing region', nullable: true },
  timeZoneOffset: {
    type: 'string',
    description: 'UTC offset used for sync scheduling',
    nullable: true,
  },
  setupStatus: {
    type: 'string',
    description: 'Setup status (INCOMPLETE, CONNECTED, BROKEN)',
    nullable: true,
  },
  daylightSavingTimeEnabled: {
    type: 'boolean',
    description: 'Whether the offset shifts with daylight saving time',
    nullable: true,
  },
  networkingMethod: { type: 'string', description: 'Networking method', nullable: true },
  privateLinkId: { type: 'string', description: 'Private link ID', nullable: true },
  hybridDeploymentAgentId: {
    type: 'string',
    description: 'Hybrid deployment agent ID',
    nullable: true,
  },
  proxyAgentId: { type: 'string', description: 'Proxy agent ID', nullable: true },
  setupTests: SETUP_TESTS_OUTPUT,
} as const satisfies Record<string, OutputProperty>

export const TRANSFORMATION_PROPERTIES = {
  id: { type: 'string', description: 'Transformation ID' },
  type: { type: 'string', description: 'Type (DBT_CORE, QUICKSTART)', nullable: true },
  status: {
    type: 'string',
    description:
      'Status (NEW, SCHEDULING, RUNNING, TERMINATING, SUCCEEDED, FAILED, BLOCKED, CANCELED, PARTIALLY_SUCCEEDED)',
    nullable: true,
  },
  paused: { type: 'boolean', description: 'Whether the transformation is paused', nullable: true },
  createdAt: { type: 'string', description: 'When it was created', nullable: true },
  createdById: { type: 'string', description: 'ID of the creating user or key', nullable: true },
  lastStartedAt: { type: 'string', description: 'Last run start time', nullable: true },
  lastEndedAt: { type: 'string', description: 'Last run end time', nullable: true },
  outputModelNames: {
    type: 'array',
    description: 'Output model names',
    items: { type: 'string' },
  },
  schedule: {
    type: 'object',
    description: 'Transformation schedule',
    nullable: true,
    properties: {
      scheduleType: {
        type: 'string',
        description: 'Schedule type (INTEGRATED, TIME_OF_DAY, INTERVAL, CRON)',
        nullable: true,
      },
      interval: { type: 'number', description: 'Interval in minutes', nullable: true },
      cron: { type: 'array', description: 'Cron expressions', items: { type: 'string' } },
      daysOfWeek: { type: 'array', description: 'Days of the week', items: { type: 'string' } },
      timeOfDay: { type: 'string', description: 'Time of day (HH:MM)', nullable: true },
      connectionIds: {
        type: 'array',
        description: 'Connections an integrated schedule depends on',
        items: { type: 'string' },
      },
      transformationIds: {
        type: 'array',
        description: 'Transformations used for integrated scheduling',
        items: { type: 'string' },
      },
      smartSyncing: {
        type: 'boolean',
        description: 'Whether Smart Syncing is enabled',
        nullable: true,
      },
    },
  },
} as const satisfies Record<string, OutputProperty>

export const CONNECTOR_TYPE_PROPERTIES = {
  id: { type: 'string', description: 'Service ID used when creating a connection' },
  name: { type: 'string', description: 'Display name', nullable: true },
  type: {
    type: 'string',
    description: 'Category, e.g. Security or Database',
    nullable: true,
  },
  description: { type: 'string', description: 'What the connector does', nullable: true },
  connectorClass: {
    type: 'string',
    description: 'Connector class (standard or lite)',
    nullable: true,
  },
  serviceStatus: {
    type: 'string',
    description: 'Availability (general_availability, beta, private_preview, sunset, development)',
    nullable: true,
  },
  iconUrl: { type: 'string', description: 'Icon URL', nullable: true },
  linkToDocs: { type: 'string', description: 'Documentation URL', nullable: true },
  linkToErd: { type: 'string', description: 'ERD URL', nullable: true },
  supportsSchemaReload: {
    type: 'boolean',
    description: 'Whether schema reload is supported',
    nullable: true,
  },
  supportedFeatures: {
    type: 'array',
    description: 'Supported feature IDs, e.g. RE_SYNC or HISTORY',
    items: { type: 'string' },
  },
} as const satisfies Record<string, OutputProperty>

export const SCHEMA_CONFIG_OUTPUTS = {
  schemas: {
    type: 'json',
    description:
      'Schemas keyed by source schema name, each with name_in_destination, enabled, and tables keyed by table name (name_in_destination, enabled, sync_mode, columns)',
  },
  enableNewByDefault: {
    type: 'boolean',
    description: 'Whether new schemas, tables, and columns are enabled by default',
    nullable: true,
  },
  schemaChangeHandling: {
    type: 'string',
    description: 'Schema change handling (ALLOW_ALL, ALLOW_COLUMNS, BLOCK_ALL)',
    nullable: true,
  },
  rowFilteringSupported: {
    type: 'boolean',
    description: 'Whether row filtering is available for the connection',
    nullable: true,
  },
} as const satisfies Record<string, OutputProperty>
