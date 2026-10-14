import { FivetranIcon } from '@/components/icons'
import { AuthMode, type BlockConfig, type BlockMeta, IntegrationType } from '@/blocks/types'
import { getTrigger } from '@/triggers'

const CONNECTION_ID_OPS = [
  'get_connection',
  'update_connection',
  'pause_connection',
  'resume_connection',
  'delete_connection',
  'sync_connection',
  'resync_connection',
  'resync_tables',
  'run_connection_setup_tests',
  'get_sync_history',
  'get_connection_warnings',
  'get_connection_schema_config',
  'reload_connection_schema',
  'update_connection_table',
  'update_connection_schema',
  'update_schema_config',
  'create_connect_card',
] as const

const GROUP_ID_OPS = [
  'list_connections',
  'create_connection',
  'create_destination',
  'get_group',
  'list_transformations',
] as const

const GROUP_ID_REQUIRED_OPS = ['create_connection', 'create_destination', 'get_group'] as const

const DESTINATION_ID_OPS = ['get_destination', 'run_destination_setup_tests'] as const

const CONNECTION_SETTINGS_OPS = ['create_connection', 'update_connection'] as const

const SETUP_TEST_OPS = [
  'create_connection',
  'update_connection',
  'create_destination',
  'run_connection_setup_tests',
  'run_destination_setup_tests',
] as const

const PAGINATED_OPS = [
  'list_connections',
  'list_groups',
  'list_destinations',
  'list_transformations',
  'list_users',
  'list_connector_types',
  'get_sync_history',
] as const

const TRANSFORMATION_ID_OPS = [
  'get_transformation',
  'run_transformation',
  'cancel_transformation',
] as const

const SCHEMA_NAME_OPS = ['update_connection_table', 'update_connection_schema'] as const

/** Fivetran's data processing regions for a new destination. */
const REGION_OPTIONS = [
  { label: 'Account default', id: '' },
  { label: 'GCP_US_EAST4', id: 'GCP_US_EAST4' },
  { label: 'GCP_US_WEST1', id: 'GCP_US_WEST1' },
  { label: 'GCP_US_CENTRAL1', id: 'GCP_US_CENTRAL1' },
  { label: 'GCP_EUROPE_WEST3', id: 'GCP_EUROPE_WEST3' },
  { label: 'GCP_AUSTRALIA_SOUTHEAST1', id: 'GCP_AUSTRALIA_SOUTHEAST1' },
  { label: 'GCP_NORTHAMERICA_NORTHEAST1', id: 'GCP_NORTHAMERICA_NORTHEAST1' },
  { label: 'GCP_EUROPE_WEST2', id: 'GCP_EUROPE_WEST2' },
  { label: 'GCP_ASIA_SOUTHEAST1', id: 'GCP_ASIA_SOUTHEAST1' },
  { label: 'GCP_ASIA_SOUTHEAST2', id: 'GCP_ASIA_SOUTHEAST2' },
  { label: 'GCP_ASIA_SOUTH1', id: 'GCP_ASIA_SOUTH1' },
  { label: 'GCP_ASIA_NORTHEAST1', id: 'GCP_ASIA_NORTHEAST1' },
  { label: 'GCP_ASIA_NORTHEAST3', id: 'GCP_ASIA_NORTHEAST3' },
  { label: 'GCP_ME_CENTRAL2', id: 'GCP_ME_CENTRAL2' },
  { label: 'AWS_US_EAST_1', id: 'AWS_US_EAST_1' },
  { label: 'AWS_US_EAST_2', id: 'AWS_US_EAST_2' },
  { label: 'AWS_US_WEST_2', id: 'AWS_US_WEST_2' },
  { label: 'AWS_AP_NORTHEAST_1', id: 'AWS_AP_NORTHEAST_1' },
  { label: 'AWS_AP_NORTHEAST_2', id: 'AWS_AP_NORTHEAST_2' },
  { label: 'AWS_AP_SOUTHEAST_1', id: 'AWS_AP_SOUTHEAST_1' },
  { label: 'AWS_AP_SOUTHEAST_2', id: 'AWS_AP_SOUTHEAST_2' },
  { label: 'AWS_EU_CENTRAL_1', id: 'AWS_EU_CENTRAL_1' },
  { label: 'AWS_EU_NORTH_1', id: 'AWS_EU_NORTH_1' },
  { label: 'AWS_EU_WEST_1', id: 'AWS_EU_WEST_1' },
  { label: 'AWS_EU_WEST_2', id: 'AWS_EU_WEST_2' },
  { label: 'AWS_EU_WEST_3', id: 'AWS_EU_WEST_3' },
  { label: 'AWS_AP_SOUTH_1', id: 'AWS_AP_SOUTH_1' },
  { label: 'AWS_CA_CENTRAL_1', id: 'AWS_CA_CENTRAL_1' },
  { label: 'AWS_US_GOV_WEST_1', id: 'AWS_US_GOV_WEST_1' },
  { label: 'AZURE_EASTUS2', id: 'AZURE_EASTUS2' },
  { label: 'AZURE_AUSTRALIAEAST', id: 'AZURE_AUSTRALIAEAST' },
  { label: 'AZURE_UKSOUTH', id: 'AZURE_UKSOUTH' },
  { label: 'AZURE_WESTEUROPE', id: 'AZURE_WESTEUROPE' },
  { label: 'AZURE_CENTRALUS', id: 'AZURE_CENTRALUS' },
  { label: 'AZURE_CANADACENTRAL', id: 'AZURE_CANADACENTRAL' },
  { label: 'AZURE_UAENORTH', id: 'AZURE_UAENORTH' },
  { label: 'AZURE_SOUTHEASTASIA', id: 'AZURE_SOUTHEASTASIA' },
  { label: 'AZURE_EASTUS', id: 'AZURE_EASTUS' },
  { label: 'AZURE_JAPANEAST', id: 'AZURE_JAPANEAST' },
  { label: 'AZURE_CENTRALINDIA', id: 'AZURE_CENTRALINDIA' },
  { label: 'AZURE_GERMANYWESTCENTRAL', id: 'AZURE_GERMANYWESTCENTRAL' },
  { label: 'AZURE_WESTUS3', id: 'AZURE_WESTUS3' },
  { label: 'AZURE_SWITZERLANDNORTH', id: 'AZURE_SWITZERLANDNORTH' },
  { label: 'AZURE_KOREACENTRAL', id: 'AZURE_KOREACENTRAL' },
] as const

const TIME_ZONE_OFFSET_OPTIONS = Array.from({ length: 24 }, (_, index) => {
  const offset = index - 11
  const id = offset > 0 ? `+${offset}` : String(offset)
  return { label: `UTC${offset === 0 ? '' : id}`, id }
})

/**
 * Pause and resume reuse the update tool, so every other update setting is cleared: a value
 * left in a field from another operation must never be sent along with the paused state.
 */
const PAUSE_ONLY_UPDATE = {
  config: undefined,
  auth: undefined,
  syncFrequency: undefined,
  scheduleType: undefined,
  dailySyncTime: undefined,
  dataDelaySensitivity: undefined,
  dataDelayThreshold: undefined,
  pauseAfterTrial: undefined,
  isHistoricalSync: undefined,
  runSetupTests: undefined,
  trustCertificates: undefined,
  trustFingerprints: undefined,
} as const

const OPTIONAL_BOOLEAN_OPTIONS = [
  { label: 'Not set', id: '' },
  { label: 'Yes', id: 'true' },
  { label: 'No', id: 'false' },
] as const

const SYNC_FREQUENCY_OPTIONS = [
  { label: 'Not set', id: '' },
  { label: 'Every minute', id: '1' },
  { label: 'Every 5 minutes', id: '5' },
  { label: 'Every 15 minutes', id: '15' },
  { label: 'Every 30 minutes', id: '30' },
  { label: 'Every hour', id: '60' },
  { label: 'Every 2 hours', id: '120' },
  { label: 'Every 3 hours', id: '180' },
  { label: 'Every 6 hours', id: '360' },
  { label: 'Every 8 hours', id: '480' },
  { label: 'Every 12 hours', id: '720' },
  { label: 'Every 24 hours', id: '1440' },
] as const

const TIMESTAMP_WAND = {
  enabled: true,
  prompt:
    'Generate an ISO 8601 UTC timestamp such as 2026-01-01T00:00:00Z from the user description. Return ONLY the timestamp.',
  generationType: 'timestamp',
} as const

const SCHEMA_TABLE_MAP_WAND = {
  enabled: true,
  prompt:
    'Generate a JSON object that maps each Fivetran schema name to an array of table names, e.g. {"public": ["users", "orders"]}. Return ONLY the JSON object.',
  generationType: 'json-object',
} as const

function toOptionalBoolean(value: unknown): boolean | undefined {
  if (value === true || value === 'true') return true
  if (value === false || value === 'false') return false
  return undefined
}

function toOptionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || String(value).trim() === '') return undefined
  return Number(value)
}

export const FivetranBlock: BlockConfig = {
  type: 'fivetran',
  name: 'Fivetran',
  description: 'Manage Fivetran connections, syncs, and transformations',
  longDescription:
    'List, create, update, pause, resume, and delete connections, trigger syncs and historical re-syncs, read sync history, warnings, and schema configs, enable or disable schemas and tables, run setup tests, generate Connect Card links, look up connector setup fields, create and inspect groups and destinations, run and cancel transformations, review users, and react to sync, connection, and transformation webhooks.',
  docsLink: 'https://docs.sim.ai/integrations/fivetran',
  category: 'tools',
  integrationType: IntegrationType.Databases,
  bgColor: '#FFFFFF',
  icon: FivetranIcon,
  authMode: AuthMode.OAuth,
  canvasPresentation: {
    defaultTitle: 'Fivetran',
    sentences: {
      byOperation: {
        list_connections: [
          'List connections',
          { text: 'in group', field: ['groupSelector', 'manualGroupId'] },
          { text: 'named', field: 'schema' },
        ],
        get_connection: [
          {
            text: 'Read connection',
            field: ['connectionSelector', 'manualConnectionId'],
            core: true,
          },
        ],
        create_connection: [
          { text: 'Create', field: 'service', core: true },
          { text: 'connection in group', field: ['groupSelector', 'manualGroupId'], core: true },
        ],
        update_connection: [
          {
            text: 'Update connection',
            field: ['connectionSelector', 'manualConnectionId'],
            core: true,
          },
        ],
        pause_connection: [
          {
            text: 'Pause connection',
            field: ['connectionSelector', 'manualConnectionId'],
            core: true,
          },
        ],
        resume_connection: [
          {
            text: 'Resume connection',
            field: ['connectionSelector', 'manualConnectionId'],
            core: true,
          },
        ],
        delete_connection: [
          {
            text: 'Delete connection',
            field: ['connectionSelector', 'manualConnectionId'],
            core: true,
          },
        ],
        sync_connection: [
          {
            text: 'Sync connection',
            field: ['connectionSelector', 'manualConnectionId'],
            core: true,
          },
        ],
        resync_connection: [
          {
            text: 'Re-sync historical data of connection',
            field: ['connectionSelector', 'manualConnectionId'],
            core: true,
          },
        ],
        resync_tables: [
          { text: 'Re-sync tables', field: 'tables', core: true },
          {
            text: 'of connection',
            field: ['connectionSelector', 'manualConnectionId'],
            core: true,
          },
        ],
        run_connection_setup_tests: [
          {
            text: 'Run setup tests of connection',
            field: ['connectionSelector', 'manualConnectionId'],
            core: true,
          },
        ],
        get_sync_history: [
          {
            text: 'Read sync history of connection',
            field: ['connectionSelector', 'manualConnectionId'],
            core: true,
          },
          { text: 'since', field: 'startTime' },
        ],
        get_connection_warnings: [
          {
            text: 'Read warnings of connection',
            field: ['connectionSelector', 'manualConnectionId'],
            core: true,
          },
        ],
        get_connection_schema_config: [
          {
            text: 'Read schema config of connection',
            field: ['connectionSelector', 'manualConnectionId'],
            core: true,
          },
        ],
        reload_connection_schema: [
          {
            text: 'Reload schema of connection',
            field: ['connectionSelector', 'manualConnectionId'],
            core: true,
          },
        ],
        update_connection_table: [
          { text: 'Set sync of table', field: 'tableName', core: true },
          { text: 'in schema', field: 'schemaName' },
          { text: 'of connection', field: ['connectionSelector', 'manualConnectionId'] },
          { text: 'to', field: 'tableEnabled' },
        ],
        create_connect_card: [
          {
            text: 'Create Connect Card for connection',
            field: ['connectionSelector', 'manualConnectionId'],
            core: true,
          },
        ],
        list_groups: ['List groups'],
        get_group: [{ text: 'Read group', field: ['groupSelector', 'manualGroupId'], core: true }],
        list_destinations: ['List destinations'],
        get_destination: [
          {
            text: 'Read destination',
            field: ['destinationSelector', 'manualDestinationId'],
            core: true,
          },
        ],
        run_destination_setup_tests: [
          {
            text: 'Run setup tests of destination',
            field: ['destinationSelector', 'manualDestinationId'],
            core: true,
          },
        ],
        list_transformations: [
          'List transformations',
          { text: 'in group', field: ['groupSelector', 'manualGroupId'] },
        ],
        get_transformation: [
          { text: 'Read transformation', field: 'transformationId', core: true },
        ],
        run_transformation: [{ text: 'Run transformation', field: 'transformationId', core: true }],
        cancel_transformation: [
          { text: 'Cancel transformation', field: 'transformationId', core: true },
        ],
        get_account_info: ['Read account details'],
        list_users: ['List account users'],
        list_connector_types: ['List connector types'],
        get_connector_type: [
          { text: 'Read setup fields of connector type', field: 'service', core: true },
        ],
        update_schema_config: [
          {
            text: 'Update schema config of connection',
            field: ['connectionSelector', 'manualConnectionId'],
            core: true,
          },
          { text: ', handling new objects as', field: 'schemaChangeHandling' },
        ],
        update_connection_schema: [
          { text: 'Set sync of schema', field: 'schemaName', core: true },
          { text: 'of connection', field: ['connectionSelector', 'manualConnectionId'] },
          { text: 'to', field: 'schemaEnabled' },
        ],
        create_group: [{ text: 'Create group', field: 'groupName', core: true }],
        create_destination: [
          { text: 'Create', field: 'destinationService', core: true },
          { text: 'destination in group', field: ['groupSelector', 'manualGroupId'], core: true },
        ],
      },
    },
  },

  triggers: {
    enabled: true,
    available: [
      'fivetran_sync_end',
      'fivetran_sync_start',
      'fivetran_connection_failure',
      'fivetran_connection_successful',
      'fivetran_create_connector',
      'fivetran_edit_connector',
      'fivetran_pause_connector',
      'fivetran_resume_connector',
      'fivetran_delete_connector',
      'fivetran_force_update_connector',
      'fivetran_resync_connector',
      'fivetran_resync_table',
      'fivetran_transformation_start',
      'fivetran_transformation_succeeded',
      'fivetran_transformation_failed',
      'fivetran_webhook',
    ],
  },

  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'List Connections', id: 'list_connections' },
        { label: 'Get Connection', id: 'get_connection' },
        { label: 'Create Connection', id: 'create_connection' },
        { label: 'Update Connection', id: 'update_connection' },
        { label: 'Pause Connection', id: 'pause_connection' },
        { label: 'Resume Connection', id: 'resume_connection' },
        { label: 'Delete Connection', id: 'delete_connection' },
        { label: 'Sync Connection', id: 'sync_connection' },
        { label: 'Re-sync Connection', id: 'resync_connection' },
        { label: 'Re-sync Tables', id: 'resync_tables' },
        { label: 'Run Connection Setup Tests', id: 'run_connection_setup_tests' },
        { label: 'Get Sync History', id: 'get_sync_history' },
        { label: 'Get Connection Warnings', id: 'get_connection_warnings' },
        { label: 'Get Schema Config', id: 'get_connection_schema_config' },
        { label: 'Reload Schema', id: 'reload_connection_schema' },
        { label: 'Update Table Sync', id: 'update_connection_table' },
        { label: 'Update Schema Sync', id: 'update_connection_schema' },
        { label: 'Update Schema Config', id: 'update_schema_config' },
        { label: 'Create Connect Card', id: 'create_connect_card' },
        { label: 'List Groups', id: 'list_groups' },
        { label: 'Get Group', id: 'get_group' },
        { label: 'Create Group', id: 'create_group' },
        { label: 'List Destinations', id: 'list_destinations' },
        { label: 'Get Destination', id: 'get_destination' },
        { label: 'Create Destination', id: 'create_destination' },
        { label: 'Run Destination Setup Tests', id: 'run_destination_setup_tests' },
        { label: 'List Transformations', id: 'list_transformations' },
        { label: 'Get Transformation', id: 'get_transformation' },
        { label: 'Run Transformation', id: 'run_transformation' },
        { label: 'Cancel Transformation', id: 'cancel_transformation' },
        { label: 'Get Account Info', id: 'get_account_info' },
        { label: 'List Users', id: 'list_users' },
        { label: 'List Connector Types', id: 'list_connector_types' },
        { label: 'Get Connector Type', id: 'get_connector_type' },
      ],
      value: () => 'list_connections',
    },
    {
      id: 'credential',
      title: 'Fivetran Account',
      type: 'oauth-input',
      serviceId: 'fivetran',
      credentialKind: 'service-account',
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      placeholder: 'Select Fivetran credential',
      required: true,
    },
    {
      id: 'manualCredential',
      title: 'Fivetran Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      placeholder: 'Enter credential ID',
      required: true,
    },
    {
      id: 'connectionSelector',
      title: 'Connection',
      type: 'project-selector',
      canonicalParamId: 'connectionId',
      serviceId: 'fivetran',
      selectorKey: 'fivetran.connections',
      placeholder: 'Select connection',
      dependsOn: ['credential'],
      mode: 'basic',
      condition: { field: 'operation', value: [...CONNECTION_ID_OPS] },
      required: { field: 'operation', value: [...CONNECTION_ID_OPS] },
    },
    {
      id: 'manualConnectionId',
      title: 'Connection ID',
      type: 'short-input',
      canonicalParamId: 'connectionId',
      placeholder: 'Enter the connection ID',
      mode: 'advanced',
      condition: { field: 'operation', value: [...CONNECTION_ID_OPS] },
      required: { field: 'operation', value: [...CONNECTION_ID_OPS] },
    },
    {
      id: 'groupSelector',
      title: 'Group',
      type: 'project-selector',
      canonicalParamId: 'groupId',
      serviceId: 'fivetran',
      selectorKey: 'fivetran.groups',
      placeholder: 'Select group',
      dependsOn: ['credential'],
      mode: 'basic',
      condition: { field: 'operation', value: [...GROUP_ID_OPS] },
      required: { field: 'operation', value: [...GROUP_ID_REQUIRED_OPS] },
    },
    {
      id: 'manualGroupId',
      title: 'Group ID',
      type: 'short-input',
      canonicalParamId: 'groupId',
      placeholder: 'Enter the group ID',
      mode: 'advanced',
      condition: { field: 'operation', value: [...GROUP_ID_OPS] },
      required: { field: 'operation', value: [...GROUP_ID_REQUIRED_OPS] },
    },
    {
      id: 'destinationSelector',
      title: 'Destination',
      type: 'project-selector',
      canonicalParamId: 'destinationId',
      serviceId: 'fivetran',
      selectorKey: 'fivetran.groups',
      placeholder: 'Select destination',
      dependsOn: ['credential'],
      mode: 'basic',
      condition: { field: 'operation', value: [...DESTINATION_ID_OPS] },
      required: { field: 'operation', value: [...DESTINATION_ID_OPS] },
    },
    {
      id: 'manualDestinationId',
      title: 'Destination ID',
      type: 'short-input',
      canonicalParamId: 'destinationId',
      placeholder: 'Enter the destination ID (same as its group ID)',
      mode: 'advanced',
      condition: { field: 'operation', value: [...DESTINATION_ID_OPS] },
      required: { field: 'operation', value: [...DESTINATION_ID_OPS] },
    },
    {
      id: 'transformationId',
      title: 'Transformation ID',
      type: 'short-input',
      placeholder: 'Enter the transformation ID',
      condition: { field: 'operation', value: [...TRANSFORMATION_ID_OPS] },
      required: { field: 'operation', value: [...TRANSFORMATION_ID_OPS] },
    },
    {
      id: 'schema',
      title: 'Schema Name',
      type: 'short-input',
      placeholder: 'Exact connection schema name',
      condition: { field: 'operation', value: 'list_connections' },
      mode: 'advanced',
    },
    {
      id: 'service',
      title: 'Connector Type',
      type: 'short-input',
      placeholder: 'e.g. okta, google_sheets, postgres',
      condition: { field: 'operation', value: ['create_connection', 'get_connector_type'] },
      required: { field: 'operation', value: ['create_connection', 'get_connector_type'] },
    },
    {
      id: 'groupName',
      title: 'Group Name',
      type: 'short-input',
      placeholder: 'Enter the group name',
      condition: { field: 'operation', value: 'create_group' },
      required: { field: 'operation', value: 'create_group' },
    },
    {
      id: 'destinationService',
      title: 'Destination Type',
      type: 'short-input',
      placeholder: 'e.g. databricks, snowflake, big_query',
      condition: { field: 'operation', value: 'create_destination' },
      required: { field: 'operation', value: 'create_destination' },
    },
    {
      id: 'timeZoneOffset',
      title: 'Time Zone',
      type: 'dropdown',
      options: TIME_ZONE_OFFSET_OPTIONS,
      value: () => '0',
      condition: { field: 'operation', value: 'create_destination' },
      required: { field: 'operation', value: 'create_destination' },
    },
    {
      id: 'destinationConfig',
      title: 'Destination Configuration',
      type: 'code',
      language: 'json',
      placeholder:
        '{"server_host_name": "...", "http_path": "...", "catalog": "...", "auth_type": "PERSONAL_ACCESS_TOKEN", "personal_access_token": "..."}',
      condition: { field: 'operation', value: 'create_destination' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a Fivetran destination config JSON object from the user description, with the destination-specific connection fields (for Databricks: server_host_name, http_path, catalog, auth_type, and personal_access_token or oauth2_client_id and oauth2_secret). Return ONLY the JSON object.',
        generationType: 'json-object',
      },
    },
    {
      id: 'region',
      title: 'Processing Region',
      type: 'dropdown',
      options: [...REGION_OPTIONS],
      value: () => '',
      condition: { field: 'operation', value: 'create_destination' },
      mode: 'advanced',
    },
    {
      id: 'daylightSavingTimeEnabled',
      title: 'Daylight Saving Time',
      type: 'switch',
      condition: { field: 'operation', value: 'create_destination' },
      mode: 'advanced',
    },
    {
      id: 'schemaChangeHandling',
      title: 'New Schema Handling',
      type: 'dropdown',
      options: [
        { label: 'Not set', id: '' },
        { label: 'Allow all new schemas, tables, and columns', id: 'ALLOW_ALL' },
        { label: 'Allow new columns only', id: 'ALLOW_COLUMNS' },
        { label: 'Block all new objects', id: 'BLOCK_ALL' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'update_schema_config' },
    },
    {
      id: 'schemasConfig',
      title: 'Schemas',
      type: 'code',
      language: 'json',
      placeholder: '{"public": {"enabled": true, "tables": {"orders": {"enabled": false}}}}',
      condition: { field: 'operation', value: 'update_schema_config' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a Fivetran schema config JSON object keyed by schema name, where each schema has "enabled" and optionally "tables" keyed by table name with "enabled". Return ONLY the JSON object.',
        generationType: 'json-object',
      },
    },
    {
      id: 'config',
      title: 'Configuration',
      type: 'code',
      language: 'json',
      placeholder: '{"schema": "okta", "domain": "acme", "api_token": "..."}',
      condition: { field: 'operation', value: [...CONNECTION_SETTINGS_OPS] },
      required: { field: 'operation', value: 'create_connection' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a Fivetran connection config JSON object from the user description, with the connector-specific fields. When creating a connection, include the destination name: "schema" for most connectors, "schema_prefix" for database connectors, or "schema" and "table" for file connectors. Return ONLY the JSON object.',
        generationType: 'json-object',
      },
    },
    {
      id: 'auth',
      title: 'Authorization',
      type: 'code',
      language: 'json',
      placeholder: '{"client_access": {"client_id": "...", "client_secret": "..."}}',
      condition: { field: 'operation', value: [...CONNECTION_SETTINGS_OPS] },
      mode: 'advanced',
    },
    {
      id: 'syncFrequency',
      title: 'Sync Frequency',
      type: 'dropdown',
      options: [...SYNC_FREQUENCY_OPTIONS],
      value: () => '',
      condition: { field: 'operation', value: [...CONNECTION_SETTINGS_OPS] },
    },
    {
      id: 'scheduleType',
      title: 'Schedule Type',
      type: 'dropdown',
      options: [
        { label: 'Not set', id: '' },
        { label: 'Automatic', id: 'auto' },
        { label: 'Manual', id: 'manual' },
      ],
      value: () => '',
      condition: { field: 'operation', value: [...CONNECTION_SETTINGS_OPS] },
      mode: 'advanced',
    },
    {
      id: 'dailySyncTime',
      title: 'Daily Sync Time',
      type: 'short-input',
      placeholder: 'HH:MM, used with a 24-hour frequency',
      condition: { field: 'operation', value: [...CONNECTION_SETTINGS_OPS] },
      mode: 'advanced',
    },
    {
      id: 'paused',
      title: 'Paused',
      type: 'dropdown',
      options: [...OPTIONAL_BOOLEAN_OPTIONS],
      value: () => '',
      condition: { field: 'operation', value: [...CONNECTION_SETTINGS_OPS] },
      mode: 'advanced',
    },
    {
      id: 'destinationSchemaNames',
      title: 'Destination Schema Naming',
      type: 'dropdown',
      options: [
        { label: 'Not set', id: '' },
        { label: 'Fivetran naming', id: 'FIVETRAN_NAMING' },
        { label: 'Source naming', id: 'SOURCE_NAMING' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'create_connection' },
      mode: 'advanced',
    },
    {
      id: 'dataDelaySensitivity',
      title: 'Data Delay Sensitivity',
      type: 'dropdown',
      options: [
        { label: 'Not set', id: '' },
        { label: 'Low', id: 'LOW' },
        { label: 'Normal', id: 'NORMAL' },
        { label: 'High', id: 'HIGH' },
        { label: 'Custom', id: 'CUSTOM' },
        { label: 'Sync frequency', id: 'SYNC_FREQUENCY' },
      ],
      value: () => '',
      condition: { field: 'operation', value: [...CONNECTION_SETTINGS_OPS] },
      mode: 'advanced',
    },
    {
      id: 'dataDelayThreshold',
      title: 'Data Delay Threshold',
      type: 'short-input',
      placeholder: 'Minutes, used with Custom sensitivity',
      condition: { field: 'operation', value: [...CONNECTION_SETTINGS_OPS] },
      mode: 'advanced',
    },
    {
      id: 'pauseAfterTrial',
      title: 'Pause After Trial',
      type: 'dropdown',
      options: [...OPTIONAL_BOOLEAN_OPTIONS],
      value: () => '',
      condition: { field: 'operation', value: [...CONNECTION_SETTINGS_OPS] },
      mode: 'advanced',
    },
    {
      id: 'isHistoricalSync',
      title: 'Re-sync Historical Data',
      type: 'dropdown',
      options: [...OPTIONAL_BOOLEAN_OPTIONS],
      value: () => '',
      condition: { field: 'operation', value: 'update_connection' },
      mode: 'advanced',
    },
    {
      id: 'runSetupTests',
      title: 'Run Setup Tests',
      type: 'dropdown',
      options: [...OPTIONAL_BOOLEAN_OPTIONS],
      value: () => '',
      condition: { field: 'operation', value: [...CONNECTION_SETTINGS_OPS, 'create_destination'] },
      mode: 'advanced',
    },
    {
      id: 'trustCertificates',
      title: 'Trust Certificates',
      type: 'switch',
      condition: { field: 'operation', value: [...SETUP_TEST_OPS] },
      mode: 'advanced',
    },
    {
      id: 'trustFingerprints',
      title: 'Trust SSH Fingerprints',
      type: 'switch',
      condition: { field: 'operation', value: [...SETUP_TEST_OPS] },
      mode: 'advanced',
    },
    {
      id: 'force',
      title: 'Restart Running Sync',
      type: 'switch',
      condition: { field: 'operation', value: 'sync_connection' },
    },
    {
      id: 'scope',
      title: 'Tables',
      type: 'code',
      language: 'json',
      placeholder: 'Leave empty to re-sync every table, or {"public": ["users"]}',
      condition: { field: 'operation', value: 'resync_connection' },
      mode: 'advanced',
      wandConfig: SCHEMA_TABLE_MAP_WAND,
    },
    {
      id: 'tables',
      title: 'Tables',
      type: 'code',
      language: 'json',
      placeholder: '{"okta": ["system_log", "user"]}',
      condition: { field: 'operation', value: 'resync_tables' },
      required: { field: 'operation', value: 'resync_tables' },
      wandConfig: SCHEMA_TABLE_MAP_WAND,
    },
    {
      id: 'excludeMode',
      title: 'Selection Mode',
      type: 'dropdown',
      options: [
        { label: 'Preserve current selections', id: 'PRESERVE' },
        { label: 'Exclude unselected', id: 'EXCLUDE' },
      ],
      value: () => 'PRESERVE',
      condition: { field: 'operation', value: 'reload_connection_schema' },
      mode: 'advanced',
    },
    {
      id: 'schemaName',
      title: 'Schema Name',
      type: 'short-input',
      placeholder: 'Schema name as stored in the schema config',
      condition: { field: 'operation', value: [...SCHEMA_NAME_OPS] },
      required: { field: 'operation', value: [...SCHEMA_NAME_OPS] },
    },
    {
      id: 'tableName',
      title: 'Table Name',
      type: 'short-input',
      placeholder: 'Table name as stored in the schema config',
      condition: { field: 'operation', value: 'update_connection_table' },
      required: { field: 'operation', value: 'update_connection_table' },
    },
    {
      id: 'schemaEnabled',
      title: 'Sync Schema',
      canvasNoun: 'enabled or disabled',
      type: 'dropdown',
      options: [
        { label: 'Enabled', id: 'true' },
        { label: 'Disabled', id: 'false' },
      ],
      value: () => 'true',
      condition: { field: 'operation', value: 'update_connection_schema' },
      required: { field: 'operation', value: 'update_connection_schema' },
    },
    {
      id: 'schemaTables',
      title: 'Tables',
      type: 'code',
      language: 'json',
      placeholder: '{"orders": {"enabled": false}}',
      condition: { field: 'operation', value: 'update_connection_schema' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a Fivetran table config JSON object keyed by table name, where each table has "enabled" (true or false). Return ONLY the JSON object.',
        generationType: 'json-object',
      },
    },
    {
      id: 'tableEnabled',
      title: 'Sync Table',
      canvasNoun: 'enabled or disabled',
      type: 'dropdown',
      options: [
        { label: 'Enabled', id: 'true' },
        { label: 'Disabled', id: 'false' },
      ],
      value: () => 'true',
      condition: { field: 'operation', value: 'update_connection_table' },
      required: { field: 'operation', value: 'update_connection_table' },
    },
    {
      id: 'syncMode',
      title: 'Sync Mode',
      type: 'dropdown',
      options: [
        { label: 'Not set', id: '' },
        { label: 'Soft delete', id: 'SOFT_DELETE' },
        { label: 'History', id: 'HISTORY' },
        { label: 'Live', id: 'LIVE' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'update_connection_table' },
      mode: 'advanced',
    },
    {
      id: 'startTime',
      title: 'Start Time',
      type: 'short-input',
      placeholder: '2026-01-01T00:00:00Z (defaults to one hour ago)',
      condition: { field: 'operation', value: 'get_sync_history' },
      wandConfig: TIMESTAMP_WAND,
    },
    {
      id: 'endTime',
      title: 'End Time',
      type: 'short-input',
      placeholder: '2026-01-01T01:00:00Z (defaults to now)',
      condition: { field: 'operation', value: 'get_sync_history' },
      wandConfig: TIMESTAMP_WAND,
    },
    {
      id: 'redirectUri',
      title: 'Redirect URL',
      type: 'short-input',
      placeholder: 'https://example.com/fivetran/done',
      condition: { field: 'operation', value: 'create_connect_card' },
      required: { field: 'operation', value: 'create_connect_card' },
    },
    {
      id: 'hideSetupGuide',
      title: 'Hide Setup Guide',
      type: 'switch',
      condition: { field: 'operation', value: 'create_connect_card' },
      mode: 'advanced',
    },
    {
      id: 'allFields',
      title: 'Show All Fields',
      type: 'switch',
      condition: { field: 'operation', value: 'create_connect_card' },
      mode: 'advanced',
    },
    {
      id: 'projectId',
      title: 'Project ID',
      type: 'short-input',
      placeholder: 'Only transformations in this dbt project',
      condition: { field: 'operation', value: 'list_transformations' },
      mode: 'advanced',
    },
    {
      id: 'transformationType',
      title: 'Transformation Type',
      type: 'dropdown',
      options: [
        { label: 'All', id: '' },
        { label: 'dbt Core', id: 'DBT_CORE' },
        { label: 'Quickstart', id: 'QUICKSTART' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'list_transformations' },
      mode: 'advanced',
    },
    {
      id: 'fullRefresh',
      title: 'Full Refresh',
      type: 'switch',
      condition: { field: 'operation', value: 'run_transformation' },
    },
    {
      id: 'active',
      title: 'User Status',
      type: 'dropdown',
      options: [
        { label: 'All', id: '' },
        { label: 'Active', id: 'true' },
        { label: 'Suspended', id: 'false' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'list_users' },
      mode: 'advanced',
    },
    {
      id: 'userType',
      title: 'User Type',
      type: 'dropdown',
      options: [
        { label: 'All', id: '' },
        { label: 'Regular user', id: 'REGULAR_USER' },
        { label: 'Service account', id: 'SERVICE_ACCOUNT' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'list_users' },
      mode: 'advanced',
    },
    {
      id: 'hasApiKey',
      title: 'Has API Key',
      type: 'dropdown',
      options: [
        { label: 'All', id: '' },
        { label: 'With an API key', id: 'true' },
        { label: 'Without an API key', id: 'false' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'list_users' },
      mode: 'advanced',
    },
    {
      id: 'limit',
      title: 'Page Size',
      type: 'short-input',
      placeholder: '1 to 1000 (defaults to 100)',
      condition: { field: 'operation', value: [...PAGINATED_OPS] },
      mode: 'advanced',
    },
    {
      id: 'cursor',
      title: 'Cursor',
      type: 'short-input',
      placeholder: 'nextCursor from the previous page',
      condition: { field: 'operation', value: [...PAGINATED_OPS] },
      mode: 'advanced',
    },
    ...getTrigger('fivetran_sync_end').subBlocks,
    ...getTrigger('fivetran_sync_start').subBlocks,
    ...getTrigger('fivetran_connection_failure').subBlocks,
    ...getTrigger('fivetran_connection_successful').subBlocks,
    ...getTrigger('fivetran_create_connector').subBlocks,
    ...getTrigger('fivetran_edit_connector').subBlocks,
    ...getTrigger('fivetran_pause_connector').subBlocks,
    ...getTrigger('fivetran_resume_connector').subBlocks,
    ...getTrigger('fivetran_delete_connector').subBlocks,
    ...getTrigger('fivetran_force_update_connector').subBlocks,
    ...getTrigger('fivetran_resync_connector').subBlocks,
    ...getTrigger('fivetran_resync_table').subBlocks,
    ...getTrigger('fivetran_transformation_start').subBlocks,
    ...getTrigger('fivetran_transformation_succeeded').subBlocks,
    ...getTrigger('fivetran_transformation_failed').subBlocks,
    ...getTrigger('fivetran_webhook').subBlocks,
  ],

  tools: {
    access: [
      'fivetran_list_connections',
      'fivetran_get_connection',
      'fivetran_create_connection',
      'fivetran_update_connection',
      'fivetran_delete_connection',
      'fivetran_sync_connection',
      'fivetran_resync_connection',
      'fivetran_resync_tables',
      'fivetran_run_connection_setup_tests',
      'fivetran_get_sync_history',
      'fivetran_get_connection_warnings',
      'fivetran_get_connection_schema_config',
      'fivetran_reload_connection_schema',
      'fivetran_update_connection_table',
      'fivetran_create_connect_card',
      'fivetran_list_groups',
      'fivetran_get_group',
      'fivetran_list_destinations',
      'fivetran_get_destination',
      'fivetran_run_destination_setup_tests',
      'fivetran_list_transformations',
      'fivetran_get_transformation',
      'fivetran_run_transformation',
      'fivetran_cancel_transformation',
      'fivetran_get_account_info',
      'fivetran_list_users',
      'fivetran_list_connector_types',
      'fivetran_get_connector_type',
      'fivetran_update_schema_config',
      'fivetran_update_connection_schema',
      'fivetran_create_group',
      'fivetran_create_destination',
    ],
    config: {
      tool: (params) => {
        if (params.operation === 'pause_connection' || params.operation === 'resume_connection') {
          return 'fivetran_update_connection'
        }
        return `fivetran_${params.operation}`
      },
      params: (params) => {
        const result: Record<string, unknown> = {}
        const isConnectionSettings = (CONNECTION_SETTINGS_OPS as readonly string[]).includes(
          params.operation
        )

        if (params.operation === 'pause_connection' || params.operation === 'resume_connection') {
          return {
            ...PAUSE_ONLY_UPDATE,
            paused: params.operation === 'pause_connection',
          }
        }

        if (isConnectionSettings) {
          result.syncFrequency = toOptionalNumber(params.syncFrequency)
          result.paused = toOptionalBoolean(params.paused)
          result.pauseAfterTrial = toOptionalBoolean(params.pauseAfterTrial)
          result.dataDelayThreshold = toOptionalNumber(params.dataDelayThreshold)
        }
        if (isConnectionSettings || params.operation === 'create_destination') {
          result.runSetupTests = toOptionalBoolean(params.runSetupTests)
        }
        if (params.operation === 'create_destination') {
          result.service = params.destinationService
          result.config = params.destinationConfig
          result.daylightSavingTimeEnabled = toOptionalBoolean(params.daylightSavingTimeEnabled)
        }
        if (params.operation === 'create_group') result.name = params.groupName
        if (params.operation === 'update_schema_config') result.schemas = params.schemasConfig
        if (params.operation === 'update_connection_schema') {
          result.enabled = toOptionalBoolean(params.schemaEnabled)
          result.tables = params.schemaTables
        }
        if (params.operation === 'update_connection') {
          result.isHistoricalSync = toOptionalBoolean(params.isHistoricalSync)
        }
        if ((SETUP_TEST_OPS as readonly string[]).includes(params.operation)) {
          result.trustCertificates = toOptionalBoolean(params.trustCertificates)
          result.trustFingerprints = toOptionalBoolean(params.trustFingerprints)
        }
        if (params.operation === 'sync_connection') result.force = toOptionalBoolean(params.force)
        if (params.operation === 'update_connection_table') {
          result.enabled = toOptionalBoolean(params.tableEnabled)
        }
        if (params.operation === 'create_connect_card') {
          result.hideSetupGuide = toOptionalBoolean(params.hideSetupGuide)
          result.allFields = toOptionalBoolean(params.allFields)
        }
        if (params.operation === 'run_transformation') {
          result.fullRefresh = toOptionalBoolean(params.fullRefresh)
        }
        if (params.operation === 'list_users') {
          result.active = toOptionalBoolean(params.active)
          result.hasApiKey = toOptionalBoolean(params.hasApiKey)
        }
        if ((PAGINATED_OPS as readonly string[]).includes(params.operation)) {
          result.limit = toOptionalNumber(params.limit)
        }
        return result
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    oauthCredential: { type: 'string', description: 'Fivetran credential ID' },
    connectionId: { type: 'string', description: 'Connection ID' },
    groupId: { type: 'string', description: 'Group ID' },
    destinationId: { type: 'string', description: 'Destination ID' },
    transformationId: { type: 'string', description: 'Transformation ID' },
    schema: { type: 'string', description: 'Connection schema name filter' },
    service: { type: 'string', description: 'Connector type for a new connection' },
    config: { type: 'json', description: 'Connector-specific configuration' },
    auth: { type: 'json', description: 'Connector-specific authorization settings' },
    syncFrequency: { type: 'number', description: 'Sync frequency in minutes' },
    scheduleType: { type: 'string', description: 'Schedule type (auto or manual)' },
    dailySyncTime: { type: 'string', description: 'Daily sync start time (HH:MM)' },
    paused: { type: 'boolean', description: 'Whether the connection is paused' },
    destinationSchemaNames: { type: 'string', description: 'Destination schema naming' },
    dataDelaySensitivity: { type: 'string', description: 'Data delay notification level' },
    dataDelayThreshold: { type: 'number', description: 'Custom data delay threshold in minutes' },
    pauseAfterTrial: { type: 'boolean', description: 'Pause the connection after its trial' },
    isHistoricalSync: { type: 'boolean', description: 'Trigger a historical re-sync' },
    runSetupTests: { type: 'boolean', description: 'Run setup tests after the change' },
    trustCertificates: { type: 'boolean', description: 'Trust certificates during setup tests' },
    trustFingerprints: {
      type: 'boolean',
      description: 'Trust SSH fingerprints during setup tests',
    },
    force: { type: 'boolean', description: 'Restart a sync that is already running' },
    scope: { type: 'json', description: 'Tables to re-sync, by schema' },
    tables: { type: 'json', description: 'Tables to re-sync, by schema' },
    excludeMode: { type: 'string', description: 'Schema reload selection mode' },
    schemaName: { type: 'string', description: 'Schema name in the schema config' },
    tableName: { type: 'string', description: 'Table name in the schema config' },
    tableEnabled: { type: 'boolean', description: 'Whether the table syncs' },
    schemaEnabled: { type: 'boolean', description: 'Whether the schema syncs' },
    schemaTables: { type: 'json', description: 'Tables to change in the schema' },
    schemaChangeHandling: { type: 'string', description: 'How new source objects are handled' },
    schemasConfig: { type: 'json', description: 'Schemas to change, keyed by schema name' },
    groupName: { type: 'string', description: 'Name of the new group' },
    destinationService: { type: 'string', description: 'Destination type for a new destination' },
    destinationConfig: { type: 'json', description: 'Destination-specific settings' },
    timeZoneOffset: { type: 'string', description: 'UTC offset for sync scheduling' },
    region: { type: 'string', description: 'Data processing region' },
    daylightSavingTimeEnabled: {
      type: 'boolean',
      description: 'Shift the UTC offset with daylight saving time',
    },
    syncMode: { type: 'string', description: 'Table sync mode' },
    startTime: { type: 'string', description: 'Sync history window start (ISO 8601)' },
    endTime: { type: 'string', description: 'Sync history window end (ISO 8601)' },
    redirectUri: { type: 'string', description: 'Connect Card redirect URL' },
    hideSetupGuide: { type: 'boolean', description: 'Hide the Connect Card setup guide' },
    allFields: { type: 'boolean', description: 'Show all Connect Card fields' },
    projectId: { type: 'string', description: 'dbt project ID filter' },
    transformationType: { type: 'string', description: 'Transformation type filter' },
    fullRefresh: { type: 'boolean', description: 'Run the transformation with a full refresh' },
    active: { type: 'boolean', description: 'User status filter' },
    userType: { type: 'string', description: 'User type filter' },
    hasApiKey: { type: 'boolean', description: 'API key filter' },
    limit: { type: 'number', description: 'Records per page' },
    cursor: { type: 'string', description: 'Paging cursor' },
  },

  outputs: {
    connection: {
      type: 'json',
      description:
        'Connection (id, groupId, service, schema, paused, status with setupState, syncState, updateState, tasks, and warnings, schedule, syncFrequency, scheduleType, succeededAt, failedAt, setupTests, config)',
    },
    connections: {
      type: 'json',
      description:
        'Connections [{id, groupId, service, schema, paused, status, syncFrequency, succeededAt, failedAt}]',
    },
    syncs: {
      type: 'json',
      description:
        'Syncs [{syncId, status, start, end, reason, extractVolumeMb, processVolumeMb, loadVolumeMb}]',
    },
    warningGroups: {
      type: 'json',
      description:
        'Warnings grouped by table [{schema, table, warnings: [{code, message, errorMessage, createdAt}]}]',
    },
    schemas: {
      type: 'json',
      description: 'Schema config keyed by schema name, with tables and their enabled state',
    },
    enableNewByDefault: {
      type: 'boolean',
      description: 'Whether new schemas, tables, and columns are enabled by default',
    },
    schemaChangeHandling: {
      type: 'string',
      description: 'Schema change handling (ALLOW_ALL, ALLOW_COLUMNS, BLOCK_ALL)',
    },
    rowFilteringSupported: {
      type: 'boolean',
      description: 'Whether row filtering is available for the connection',
    },
    result: {
      type: 'string',
      description: 'Sync start result (STARTED, PAUSED, INCOMPLETE, ALREADY_RUNNING, NOT_STARTED)',
    },
    connectionId: { type: 'string', description: 'Connection ID of the Connect Card' },
    uri: { type: 'string', description: 'Connect Card URL' },
    token: { type: 'string', description: 'Connect Card token' },
    redirectUri: { type: 'string', description: 'Connect Card redirect URL' },
    group: { type: 'json', description: 'Group (id, name, createdAt)' },
    groups: { type: 'json', description: 'Groups [{id, name, createdAt}]' },
    destination: {
      type: 'json',
      description:
        'Destination (id, groupId, service, region, timeZoneOffset, setupStatus, networkingMethod, setupTests)',
    },
    destinations: {
      type: 'json',
      description: 'Destinations [{id, groupId, service, region, setupStatus}]',
    },
    transformation: {
      type: 'json',
      description:
        'Transformation (id, type, status, paused, schedule, lastStartedAt, lastEndedAt, outputModelNames)',
    },
    transformations: {
      type: 'json',
      description: 'Transformations [{id, type, status, paused, lastStartedAt, lastEndedAt}]',
    },
    accountId: { type: 'string', description: 'Fivetran account ID' },
    accountName: { type: 'string', description: 'Account name' },
    userId: { type: 'string', description: 'User ID behind the API key' },
    systemKeyId: { type: 'string', description: 'System key ID behind the API key' },
    users: {
      type: 'json',
      description:
        'Users [{id, email, givenName, familyName, role, active, userType, hasApiKey, loggedInAt}]',
    },
    connectorType: {
      type: 'json',
      description:
        'Connector type (id, name, type, description, serviceStatus, linkToDocs, supportedFeatures)',
    },
    config: {
      type: 'json',
      description: 'JSON Schema of the configuration fields a connector type takes',
    },
    auth: {
      type: 'json',
      description: 'JSON Schema of the authorization fields a connector type takes',
    },
    connectorTypes: {
      type: 'json',
      description:
        'Connector types [{id, name, type, description, serviceStatus, supportedFeatures}]',
    },
    code: { type: 'string', description: 'Fivetran response code' },
    message: { type: 'string', description: 'Fivetran response message' },
    nextCursor: { type: 'string', description: 'Cursor for the next page' },
  },
}

export const FivetranBlockMeta = {
  tags: ['data-warehouse', 'data-analytics', 'webhooks', 'automation'],
  url: 'https://www.fivetran.com',
  templates: [
    {
      icon: FivetranIcon,
      title: 'Failed sync triage',
      prompt:
        'Build a workflow triggered when a Fivetran sync ends with a failure that reads the connection, its active warnings, and the last day of sync history, has an agent explain the likely cause and fix, and posts the summary to the data team in Slack.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['data', 'monitoring', 'incident-response'],
      alsoIntegrations: ['slack'],
      featured: true,
    },
    {
      icon: FivetranIcon,
      title: 'Security log ingestion monitor',
      prompt:
        'Create a scheduled workflow that lists the Fivetran connections feeding security logs from sources like Okta into Databricks, flags any that are paused, broken, or delayed, and opens a Jira ticket for each one so the SIEM pipeline never silently goes stale.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['security', 'data', 'monitoring'],
      alsoIntegrations: ['jira'],
    },
    {
      icon: FivetranIcon,
      title: 'Run dbt after a sync',
      prompt:
        'Build a workflow that runs when a Fivetran sync finishes successfully and starts the matching Fivetran transformation, then reports when the transformation succeeds or fails.',
      modules: ['workflows'],
      category: 'engineering',
      tags: ['data', 'automation'],
    },
    {
      icon: FivetranIcon,
      title: 'Daily pipeline health digest',
      prompt:
        'Create a scheduled daily workflow that lists every Fivetran connection, collects its sync history and data volumes for the last day, and emails the data team a digest of failures, delays, and the largest loads.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['data', 'reporting'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: FivetranIcon,
      title: 'Connection change audit log',
      prompt:
        'Build a workflow triggered by Fivetran connection created, edited, paused, resumed, and deleted events that records who changed what and when in a table, for a change-management audit trail.',
      modules: ['tables', 'workflows'],
      category: 'operations',
      tags: ['security', 'compliance', 'data'],
    },
    {
      icon: FivetranIcon,
      title: 'Fivetran access review',
      prompt:
        'Create a scheduled monthly workflow that lists Fivetran users and service accounts, flags suspended accounts that still have API keys and users who have not logged in for 90 days, and writes the review to a table for the security team.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['security', 'compliance'],
    },
    {
      icon: FivetranIcon,
      title: 'Self-serve source onboarding',
      prompt:
        'Build a workflow that takes a requested source type and team, creates a paused Fivetran connection in the right group, generates a Connect Card link, and sends it to the requester in Slack so they can authorize the source themselves.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['data', 'automation'],
      alsoIntegrations: ['slack'],
    },
  ],
  skills: [
    {
      name: 'diagnose-failed-fivetran-sync',
      description:
        'Explain why a Fivetran connection is failing and what to do about it. Use when a sync_end event reports a failure or someone asks why data is stale.',
      content:
        '# Diagnose a Failed Fivetran Sync\n\nFind the cause of a failing or delayed Fivetran connection.\n\n## Steps\n1. Get the connection and read its status: setupState, syncState, updateState, and any tasks or warnings.\n2. Get the sync history for the last 24 hours and note failed syncs and their reasons.\n3. Get the connection warnings to see table-level problems.\n4. If setupState is broken, run the connection setup tests and report the failing test.\n\n## Output\nThe connection, when it last succeeded, the failure reason, and the concrete fix (for example reconnect credentials, grant permissions, or re-sync a table).',
    },
    {
      name: 'pipeline-health-report',
      description:
        'Summarize the health of every Fivetran connection in an account or group. Use for daily data-platform reviews.',
      content:
        '# Pipeline Health Report\n\nReport which Fivetran pipelines are healthy and which need attention.\n\n## Steps\n1. List connections, following nextCursor until every page is read, optionally filtered by group.\n2. For each connection, note paused, setupState, syncState, updateState, succeededAt, and failedAt.\n3. For connections that are broken, delayed, or failed after their last success, read their warnings.\n\n## Output\nA table of connections needing attention with the reason, followed by a count of healthy connections.',
    },
    {
      name: 'resync-fivetran-tables',
      description:
        'Re-sync specific tables or a whole Fivetran connection after a data issue. Use when data in the destination is missing or wrong.',
      content:
        '# Re-sync Fivetran Tables\n\nReload historical data for the affected tables only.\n\n## Steps\n1. Read the connection schema config and confirm the schema and table names exactly as stored (they are case-sensitive).\n2. Re-sync just those tables with Re-sync Tables, passing a map of schema to table names.\n3. Only re-sync the whole connection when the issue spans most tables, since a full re-sync can take a long time.\n\n## Output\nWhat was re-synced, and a note to check sync history once the historical sync finishes.',
    },
    {
      name: 'onboard-fivetran-source',
      description:
        'Create a new Fivetran connection and hand the owner a Connect Card link to authorize it. Use when a team requests a new data source.',
      content:
        '# Onboard a Fivetran Source\n\nSet up a new source without sharing source credentials with the data team.\n\n## Steps\n1. Find the connector type ID with List Connector Types.\n2. Find the destination group with List Groups.\n3. Create the connection paused, with a config that sets the destination schema name.\n4. Create a Connect Card for the connection with a redirect URL, and send the link to the source owner.\n\n## Output\nThe connection ID, schema name, and Connect Card link.',
    },
    {
      name: 'audit-fivetran-access',
      description:
        'Review who can use the Fivetran account and which identities hold API keys. Use for periodic security access reviews.',
      content:
        '# Audit Fivetran Access\n\nCheck Fivetran users and service accounts for stale or risky access.\n\n## Steps\n1. List users, following nextCursor through every page.\n2. Flag suspended users that still have API keys, service accounts with API keys, and users whose last login is more than 90 days old.\n3. Note each flagged identity’s role.\n\n## Output\nA list of flagged identities with the reason and suggested action, and a count of identities reviewed.',
    },
  ],
} as const satisfies BlockMeta
