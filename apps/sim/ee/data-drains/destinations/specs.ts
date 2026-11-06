import type { CreateDataDrainBody } from '@/lib/api/contracts/data-drains'
import type { DestinationType } from '@/lib/data-drains/types'

type DestinationBranch = Pick<
  CreateDataDrainBody,
  'destinationType' | 'destinationConfig' | 'destinationCredentials'
>

/**
 * One input of a destination form, as data so each surface renders it with its own controls.
 * `secret` and `secretText` hold a credential: write-only, sent once and never returned by the API.
 */
export type DestinationField<TState> =
  | {
      kind: 'text' | 'secret' | 'textarea' | 'secretText'
      key: Extract<keyof TState, string>
      id: string
      label: string
      placeholder: string
    }
  | { kind: 'switch'; key: Extract<keyof TState, string>; id: string; label: string }
  | {
      kind: 'select'
      key: Extract<keyof TState, string>
      label: string
      options: ReadonlyArray<{ value: string; label: string }>
    }
  | { kind: 'note'; text: string }

export interface DestinationFormSpec<TState> {
  readonly displayName: string
  readonly initialState: TState
  readonly fields: ReadonlyArray<DestinationField<TState>>
  readonly isComplete: (state: TState) => boolean
  readonly toDestinationBranch: (state: TState) => DestinationBranch
}

interface S3State {
  bucket: string
  region: string
  prefix: string
  endpoint: string
  forcePathStyle: boolean
  accessKeyId: string
  secretAccessKey: string
}

const s3FormSpec: DestinationFormSpec<S3State> = {
  displayName: 'Amazon S3',
  initialState: {
    bucket: '',
    region: 'us-east-1',
    prefix: '',
    endpoint: '',
    forcePathStyle: false,
    accessKeyId: '',
    secretAccessKey: '',
  },
  fields: [
    {
      kind: 'text',
      key: 'bucket',
      id: 'drain-s3-bucket',
      label: 'Bucket',
      placeholder: 'my-logs-bucket',
    },
    {
      kind: 'text',
      key: 'region',
      id: 'drain-s3-region',
      label: 'Region',
      placeholder: 'us-east-1',
    },
    {
      kind: 'text',
      key: 'prefix',
      id: 'drain-s3-prefix-optional',
      label: 'Prefix (optional)',
      placeholder: 'exports/sim',
    },
    {
      kind: 'text',
      key: 'endpoint',
      id: 'drain-s3-endpoint-optional-s3-compatible-stores',
      label: 'Endpoint (optional, S3-compatible stores)',
      placeholder: 'https://s3.example.com',
    },
    {
      kind: 'switch',
      key: 'forcePathStyle',
      id: 'drain-s3-force-path-style-minio-ceph',
      label: 'Force path style (MinIO, Ceph)',
    },
    {
      kind: 'secret',
      key: 'accessKeyId',
      id: 'drain-s3-access-key-id',
      label: 'Access key ID',
      placeholder: 'AKIA...',
    },
    {
      kind: 'secret',
      key: 'secretAccessKey',
      id: 'drain-s3-secret-access-key',
      label: 'Secret access key',
      placeholder: 'Paste your secret access key',
    },
  ],
  isComplete: (s) =>
    s.bucket.length > 0 &&
    s.region.length > 0 &&
    s.accessKeyId.length > 0 &&
    s.secretAccessKey.length > 0,
  toDestinationBranch: (s) => ({
    destinationType: 's3',
    destinationConfig: {
      bucket: s.bucket,
      region: s.region,
      prefix: s.prefix || undefined,
      endpoint: s.endpoint || undefined,
      forcePathStyle: s.forcePathStyle,
    },
    destinationCredentials: {
      accessKeyId: s.accessKeyId,
      secretAccessKey: s.secretAccessKey,
    },
  }),
}

interface GCSState {
  bucket: string
  prefix: string
  serviceAccountJson: string
}

const gcsFormSpec: DestinationFormSpec<GCSState> = {
  displayName: 'Google Cloud Storage',
  initialState: { bucket: '', prefix: '', serviceAccountJson: '' },
  fields: [
    {
      kind: 'text',
      key: 'bucket',
      id: 'drain-gcs-bucket',
      label: 'Bucket',
      placeholder: 'my-logs-bucket',
    },
    {
      kind: 'text',
      key: 'prefix',
      id: 'drain-gcs-prefix-optional',
      label: 'Prefix (optional)',
      placeholder: 'exports/sim',
    },
    {
      kind: 'secretText',
      key: 'serviceAccountJson',
      id: 'drain-gcs-service-account-json-key',
      label: 'Service account JSON key',
      placeholder: '{ "type": "service_account", ... }',
    },
  ],
  isComplete: (s) => s.bucket.length >= 3 && s.serviceAccountJson.length > 0,
  toDestinationBranch: (s) => ({
    destinationType: 'gcs',
    destinationConfig: { bucket: s.bucket, prefix: s.prefix || undefined },
    destinationCredentials: { serviceAccountJson: s.serviceAccountJson },
  }),
}

interface AzureBlobState {
  accountName: string
  containerName: string
  prefix: string
  endpointSuffix: string
  accountKey: string
}

const azureBlobFormSpec: DestinationFormSpec<AzureBlobState> = {
  displayName: 'Azure Blob Storage',
  initialState: {
    accountName: '',
    containerName: '',
    prefix: '',
    endpointSuffix: '',
    accountKey: '',
  },
  fields: [
    {
      kind: 'text',
      key: 'accountName',
      id: 'drain-azure-blob-account-name',
      label: 'Account name',
      placeholder: 'mystorageaccount',
    },
    {
      kind: 'text',
      key: 'containerName',
      id: 'drain-azure-blob-container',
      label: 'Container',
      placeholder: 'sim-exports',
    },
    {
      kind: 'text',
      key: 'prefix',
      id: 'drain-azure-blob-prefix-optional',
      label: 'Prefix (optional)',
      placeholder: 'exports/sim',
    },
    {
      kind: 'text',
      key: 'endpointSuffix',
      id: 'drain-azure-blob-endpoint-suffix-optional',
      label: 'Endpoint suffix (optional)',
      placeholder: 'blob.core.windows.net',
    },
    {
      kind: 'secret',
      key: 'accountKey',
      id: 'drain-azure-blob-account-key',
      label: 'Account key',
      placeholder: 'Paste your storage account key',
    },
  ],
  isComplete: (s) =>
    s.accountName.length >= 3 && s.containerName.length >= 3 && s.accountKey.length === 88,
  toDestinationBranch: (s) => ({
    destinationType: 'azure_blob',
    destinationConfig: {
      accountName: s.accountName,
      containerName: s.containerName,
      prefix: s.prefix || undefined,
      endpointSuffix: s.endpointSuffix || undefined,
    },
    destinationCredentials: { accountKey: s.accountKey },
  }),
}

const DATADOG_SITE_OPTIONS = [
  { value: 'us1', label: 'US1 (datadoghq.com)' },
  { value: 'us3', label: 'US3 (us3.datadoghq.com)' },
  { value: 'us5', label: 'US5 (us5.datadoghq.com)' },
  { value: 'eu1', label: 'EU1 (datadoghq.eu)' },
  { value: 'ap1', label: 'AP1 (ap1.datadoghq.com)' },
  { value: 'ap2', label: 'AP2 (ap2.datadoghq.com)' },
  { value: 'gov', label: 'Gov (ddog-gov.com)' },
]

interface DatadogState {
  site: 'us1' | 'us3' | 'us5' | 'eu1' | 'ap1' | 'ap2' | 'gov'
  service: string
  tags: string
  apiKey: string
}

interface SentinelState {
  endpoint: string
  ruleId: string
  streamName: string
  tenantId: string
  clientId: string
  clientSecret: string
}

const SENTINEL_FIELDS = [
  {
    key: 'endpoint',
    label: 'Logs ingestion endpoint',
    placeholder: 'https://my-dcr.eastus-1.ingest.monitor.azure.com',
  },
  { key: 'ruleId', label: 'DCR immutable ID', placeholder: 'dcr-0123456789abcdef0123456789abcdef' },
  { key: 'streamName', label: 'Stream name', placeholder: 'Custom-SimLogs' },
  { key: 'tenantId', label: 'Tenant ID', placeholder: 'Microsoft Entra tenant ID' },
  { key: 'clientId', label: 'Client ID', placeholder: 'Application client ID' },
] as const

const sentinelFormSpec: DestinationFormSpec<SentinelState> = {
  displayName: 'Microsoft Sentinel',
  initialState: {
    endpoint: '',
    ruleId: '',
    streamName: 'Custom-SimLogs',
    tenantId: '',
    clientId: '',
    clientSecret: '',
  },
  fields: [
    ...SENTINEL_FIELDS.map(({ key, label, placeholder }) => ({
      kind: 'text' as const,
      key,
      id: `drain-sentinel-${key}`,
      label,
      placeholder,
    })),
    {
      kind: 'secret',
      key: 'clientSecret',
      id: 'drain-sentinel-client-secret',
      label: 'Client secret',
      placeholder: 'Paste the client secret value',
    },
    {
      kind: 'note',
      text: 'Use an Azure public-cloud DCR with the Sim log schema. Test connection writes a probe event to the configured table.',
    },
  ],
  isComplete: (state) => Object.values(state).every((value) => value.trim().length > 0),
  toDestinationBranch: ({ clientSecret, ...config }) => ({
    destinationType: 'sentinel',
    destinationConfig: {
      endpoint: config.endpoint.trim(),
      ruleId: config.ruleId.trim(),
      streamName: config.streamName.trim(),
      tenantId: config.tenantId.trim(),
      clientId: config.clientId.trim(),
    },
    destinationCredentials: { clientSecret: clientSecret.trim() },
  }),
}

const datadogFormSpec: DestinationFormSpec<DatadogState> = {
  displayName: 'Datadog',
  initialState: { site: 'us1', service: '', tags: '', apiKey: '' },
  fields: [
    { kind: 'select', key: 'site', label: 'Site', options: DATADOG_SITE_OPTIONS },
    {
      kind: 'text',
      key: 'service',
      id: 'drain-datadog-service-optional',
      label: 'Service (optional)',
      placeholder: 'sim',
    },
    {
      kind: 'text',
      key: 'tags',
      id: 'drain-datadog-tags-optional-comma-separated',
      label: 'Tags (optional, comma-separated)',
      placeholder: 'env:prod,team:platform',
    },
    {
      kind: 'secret',
      key: 'apiKey',
      id: 'drain-datadog-api-key',
      label: 'API key',
      placeholder: 'Paste your Datadog API key',
    },
  ],
  isComplete: (s) => s.apiKey.length > 0,
  toDestinationBranch: (s) => ({
    destinationType: 'datadog',
    destinationConfig: {
      site: s.site,
      service: s.service || undefined,
      tags: s.tags || undefined,
    },
    destinationCredentials: { apiKey: s.apiKey },
  }),
}

interface BigQueryState {
  projectId: string
  datasetId: string
  tableId: string
  serviceAccountJson: string
}

const bigqueryFormSpec: DestinationFormSpec<BigQueryState> = {
  displayName: 'Google BigQuery',
  initialState: { projectId: '', datasetId: '', tableId: '', serviceAccountJson: '' },
  fields: [
    {
      kind: 'text',
      key: 'projectId',
      id: 'drain-bigquery-project-id',
      label: 'Project ID',
      placeholder: 'my-gcp-project',
    },
    {
      kind: 'text',
      key: 'datasetId',
      id: 'drain-bigquery-dataset',
      label: 'Dataset',
      placeholder: 'sim_drains',
    },
    {
      kind: 'text',
      key: 'tableId',
      id: 'drain-bigquery-table',
      label: 'Table',
      placeholder: 'workflow_logs',
    },
    {
      kind: 'secretText',
      key: 'serviceAccountJson',
      id: 'drain-bigquery-service-account-json-key',
      label: 'Service account JSON key',
      placeholder: '{ "type": "service_account", ... }',
    },
  ],
  isComplete: (s) =>
    s.projectId.length >= 6 &&
    s.datasetId.length > 0 &&
    s.tableId.length > 0 &&
    s.serviceAccountJson.length > 0,
  toDestinationBranch: (s) => ({
    destinationType: 'bigquery',
    destinationConfig: { projectId: s.projectId, datasetId: s.datasetId, tableId: s.tableId },
    destinationCredentials: { serviceAccountJson: s.serviceAccountJson },
  }),
}

interface SnowflakeState {
  account: string
  user: string
  warehouse: string
  database: string
  schema: string
  table: string
  column: string
  role: string
  privateKey: string
}

const snowflakeFormSpec: DestinationFormSpec<SnowflakeState> = {
  displayName: 'Snowflake',
  initialState: {
    account: '',
    user: '',
    warehouse: '',
    database: '',
    schema: '',
    table: '',
    column: '',
    role: '',
    privateKey: '',
  },
  fields: [
    {
      kind: 'text',
      key: 'account',
      id: 'drain-snowflake-account-identifier',
      label: 'Account identifier',
      placeholder: 'orgname-accountname',
    },
    {
      kind: 'text',
      key: 'user',
      id: 'drain-snowflake-user',
      label: 'User',
      placeholder: 'SIM_DRAIN_USER',
    },
    {
      kind: 'text',
      key: 'warehouse',
      id: 'drain-snowflake-warehouse',
      label: 'Warehouse',
      placeholder: 'COMPUTE_WH',
    },
    {
      kind: 'text',
      key: 'database',
      id: 'drain-snowflake-database',
      label: 'Database',
      placeholder: 'SIM',
    },
    {
      kind: 'text',
      key: 'schema',
      id: 'drain-snowflake-schema',
      label: 'Schema',
      placeholder: 'PUBLIC',
    },
    {
      kind: 'text',
      key: 'table',
      id: 'drain-snowflake-table',
      label: 'Table',
      placeholder: 'WORKFLOW_LOGS',
    },
    {
      kind: 'text',
      key: 'column',
      id: 'drain-snowflake-column-optional-defaults-to-data',
      label: 'Column (optional, defaults to "DATA")',
      placeholder: 'DATA',
    },
    {
      kind: 'text',
      key: 'role',
      id: 'drain-snowflake-role-optional',
      label: 'Role (optional)',
      placeholder: 'SIM_DRAIN_ROLE',
    },
    {
      kind: 'secretText',
      key: 'privateKey',
      id: 'drain-snowflake-private-key-pem-pkcs8',
      label: 'Private key (PEM, PKCS8)',
      placeholder: '-----BEGIN PRIVATE KEY-----',
    },
  ],
  isComplete: (s) =>
    s.account.length >= 3 &&
    s.user.length > 0 &&
    s.warehouse.length > 0 &&
    s.database.length > 0 &&
    s.schema.length > 0 &&
    s.table.length > 0 &&
    s.privateKey.length > 0,
  toDestinationBranch: (s) => ({
    destinationType: 'snowflake',
    destinationConfig: {
      account: s.account,
      user: s.user,
      warehouse: s.warehouse,
      database: s.database,
      schema: s.schema,
      table: s.table,
      column: s.column || undefined,
      role: s.role || undefined,
    },
    destinationCredentials: { privateKey: s.privateKey },
  }),
}

interface WebhookState {
  url: string
  signatureHeader: string
  signingSecret: string
  bearerToken: string
}

const webhookFormSpec: DestinationFormSpec<WebhookState> = {
  displayName: 'HTTPS webhook',
  initialState: { url: '', signatureHeader: '', signingSecret: '', bearerToken: '' },
  fields: [
    {
      kind: 'text',
      key: 'url',
      id: 'drain-webhook-url',
      label: 'URL',
      placeholder: 'https://example.com/sim-drain',
    },
    {
      kind: 'text',
      key: 'signatureHeader',
      id: 'drain-webhook-signature-header-optional',
      label: 'Signature header (optional)',
      placeholder: 'X-Sim-Signature',
    },
    {
      kind: 'secret',
      key: 'signingSecret',
      id: 'drain-webhook-signing-secret',
      label: 'Signing secret',
      placeholder: 'At least 32 characters',
    },
    {
      kind: 'secret',
      key: 'bearerToken',
      id: 'drain-webhook-bearer-token-optional',
      label: 'Bearer token (optional)',
      placeholder: 'Paste your bearer token',
    },
  ],
  isComplete: (s) => s.url.length > 0 && s.signingSecret.length >= 32,
  toDestinationBranch: (s) => ({
    destinationType: 'webhook',
    destinationConfig: {
      url: s.url,
      signatureHeader: s.signatureHeader || undefined,
    },
    destinationCredentials: {
      signingSecret: s.signingSecret,
      bearerToken: s.bearerToken || undefined,
    },
  }),
}

/** The state of a destination form, once its spec is held beside the others. */
export type DestinationState = Record<string, string | boolean>

function eraseState<TState>(spec: DestinationFormSpec<TState>) {
  // double-cast-allowed: each spec's fields, reducers and initial state agree on its own state shape, which the registry cannot express for all eight at once
  return spec as unknown as DestinationFormSpec<DestinationState>
}

/**
 * Client-side mirror of `DESTINATION_REGISTRY`. A settings page selects a spec by
 * `destinationType` and never branches on the literal — adding a new destination is
 * one entry here plus one in the server-side registry.
 */
export const DESTINATION_SPECS: Record<DestinationType, DestinationFormSpec<DestinationState>> = {
  s3: eraseState(s3FormSpec),
  gcs: eraseState(gcsFormSpec),
  azure_blob: eraseState(azureBlobFormSpec),
  sentinel: eraseState(sentinelFormSpec),
  datadog: eraseState(datadogFormSpec),
  bigquery: eraseState(bigqueryFormSpec),
  snowflake: eraseState(snowflakeFormSpec),
  webhook: eraseState(webhookFormSpec),
}
