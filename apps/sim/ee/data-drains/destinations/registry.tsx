'use client'

import type { ComponentType } from 'react'
import { ChipInput, ChipSelect, ChipTextarea, SecretInput, Switch } from '@sim/emcn'
import type { CreateDataDrainBody } from '@/lib/api/contracts/data-drains'
import type { DestinationType } from '@/lib/data-drains/types'
import { SettingRow } from '@/ee/components/setting-row'

type DestinationBranch = Pick<
  CreateDataDrainBody,
  'destinationType' | 'destinationConfig' | 'destinationCredentials'
>

interface DestinationFormSpec<TState> {
  readonly displayName: string
  readonly initialState: TState
  readonly FormFields: ComponentType<{
    state: TState
    setState: (state: TState) => void
  }>
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
  FormFields: ({ state, setState }) => (
    <>
      <SettingRow label='Bucket' htmlFor='drain-s3-bucket'>
        <ChipInput
          id='drain-s3-bucket'
          value={state.bucket}
          onChange={(e) => setState({ ...state, bucket: e.target.value })}
          placeholder='my-logs-bucket'
        />
      </SettingRow>
      <SettingRow label='Region' htmlFor='drain-s3-region'>
        <ChipInput
          id='drain-s3-region'
          value={state.region}
          onChange={(e) => setState({ ...state, region: e.target.value })}
          placeholder='us-east-1'
        />
      </SettingRow>
      <SettingRow label='Prefix (optional)' htmlFor='drain-s3-prefix-optional'>
        <ChipInput
          id='drain-s3-prefix-optional'
          value={state.prefix}
          onChange={(e) => setState({ ...state, prefix: e.target.value })}
          placeholder='exports/sim'
        />
      </SettingRow>
      <SettingRow
        label='Endpoint (optional, S3-compatible stores)'
        htmlFor='drain-s3-endpoint-optional-s3-compatible-stores'
      >
        <ChipInput
          id='drain-s3-endpoint-optional-s3-compatible-stores'
          value={state.endpoint}
          onChange={(e) => setState({ ...state, endpoint: e.target.value })}
          placeholder='https://s3.example.com'
        />
      </SettingRow>
      <SettingRow
        label='Force path style (MinIO, Ceph)'
        htmlFor='drain-s3-force-path-style-minio-ceph'
      >
        <Switch
          id='drain-s3-force-path-style-minio-ceph'
          checked={state.forcePathStyle}
          onCheckedChange={(v) => setState({ ...state, forcePathStyle: v })}
        />
      </SettingRow>
      <SettingRow label='Access key ID' htmlFor='drain-s3-access-key-id'>
        <SecretInput
          id='drain-s3-access-key-id'
          value={state.accessKeyId}
          onChange={(v) => setState({ ...state, accessKeyId: v })}
          placeholder='AKIA...'
        />
      </SettingRow>
      <SettingRow label='Secret access key' htmlFor='drain-s3-secret-access-key'>
        <SecretInput
          id='drain-s3-secret-access-key'
          value={state.secretAccessKey}
          onChange={(v) => setState({ ...state, secretAccessKey: v })}
          placeholder='Paste your secret access key'
        />
      </SettingRow>
    </>
  ),
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
  FormFields: ({ state, setState }) => (
    <>
      <SettingRow label='Bucket' htmlFor='drain-gcs-bucket'>
        <ChipInput
          id='drain-gcs-bucket'
          value={state.bucket}
          onChange={(e) => setState({ ...state, bucket: e.target.value })}
          placeholder='my-logs-bucket'
        />
      </SettingRow>
      <SettingRow label='Prefix (optional)' htmlFor='drain-gcs-prefix-optional'>
        <ChipInput
          id='drain-gcs-prefix-optional'
          value={state.prefix}
          onChange={(e) => setState({ ...state, prefix: e.target.value })}
          placeholder='exports/sim'
        />
      </SettingRow>
      <SettingRow label='Service account JSON key' htmlFor='drain-gcs-service-account-json-key'>
        <ChipTextarea
          id='drain-gcs-service-account-json-key'
          value={state.serviceAccountJson}
          onChange={(e) => setState({ ...state, serviceAccountJson: e.target.value })}
          placeholder='{ "type": "service_account", ... }'
          rows={6}
        />
      </SettingRow>
    </>
  ),
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
  FormFields: ({ state, setState }) => (
    <>
      <SettingRow label='Account name' htmlFor='drain-azure-blob-account-name'>
        <ChipInput
          id='drain-azure-blob-account-name'
          value={state.accountName}
          onChange={(e) => setState({ ...state, accountName: e.target.value })}
          placeholder='mystorageaccount'
        />
      </SettingRow>
      <SettingRow label='Container' htmlFor='drain-azure-blob-container'>
        <ChipInput
          id='drain-azure-blob-container'
          value={state.containerName}
          onChange={(e) => setState({ ...state, containerName: e.target.value })}
          placeholder='sim-exports'
        />
      </SettingRow>
      <SettingRow label='Prefix (optional)' htmlFor='drain-azure-blob-prefix-optional'>
        <ChipInput
          id='drain-azure-blob-prefix-optional'
          value={state.prefix}
          onChange={(e) => setState({ ...state, prefix: e.target.value })}
          placeholder='exports/sim'
        />
      </SettingRow>
      <SettingRow
        label='Endpoint suffix (optional)'
        htmlFor='drain-azure-blob-endpoint-suffix-optional'
      >
        <ChipInput
          id='drain-azure-blob-endpoint-suffix-optional'
          value={state.endpointSuffix}
          onChange={(e) => setState({ ...state, endpointSuffix: e.target.value })}
          placeholder='blob.core.windows.net'
        />
      </SettingRow>
      <SettingRow label='Account key' htmlFor='drain-azure-blob-account-key'>
        <SecretInput
          id='drain-azure-blob-account-key'
          value={state.accountKey}
          onChange={(v) => setState({ ...state, accountKey: v })}
          placeholder='Paste your storage account key'
        />
      </SettingRow>
    </>
  ),
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

const datadogFormSpec: DestinationFormSpec<DatadogState> = {
  displayName: 'Datadog',
  initialState: { site: 'us1', service: '', tags: '', apiKey: '' },
  FormFields: ({ state, setState }) => (
    <>
      <SettingRow label='Site'>
        <ChipSelect
          value={state.site}
          onChange={(v) => setState({ ...state, site: v as DatadogState['site'] })}
          options={DATADOG_SITE_OPTIONS}
          align='start'
        />
      </SettingRow>
      <SettingRow label='Service (optional)' htmlFor='drain-datadog-service-optional'>
        <ChipInput
          id='drain-datadog-service-optional'
          value={state.service}
          onChange={(e) => setState({ ...state, service: e.target.value })}
          placeholder='sim'
        />
      </SettingRow>
      <SettingRow
        label='Tags (optional, comma-separated)'
        htmlFor='drain-datadog-tags-optional-comma-separated'
      >
        <ChipInput
          id='drain-datadog-tags-optional-comma-separated'
          value={state.tags}
          onChange={(e) => setState({ ...state, tags: e.target.value })}
          placeholder='env:prod,team:platform'
        />
      </SettingRow>
      <SettingRow label='API key' htmlFor='drain-datadog-api-key'>
        <SecretInput
          id='drain-datadog-api-key'
          value={state.apiKey}
          onChange={(v) => setState({ ...state, apiKey: v })}
          placeholder='Paste your Datadog API key'
        />
      </SettingRow>
    </>
  ),
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
  FormFields: ({ state, setState }) => (
    <>
      <SettingRow label='Project ID' htmlFor='drain-bigquery-project-id'>
        <ChipInput
          id='drain-bigquery-project-id'
          value={state.projectId}
          onChange={(e) => setState({ ...state, projectId: e.target.value })}
          placeholder='my-gcp-project'
        />
      </SettingRow>
      <SettingRow label='Dataset' htmlFor='drain-bigquery-dataset'>
        <ChipInput
          id='drain-bigquery-dataset'
          value={state.datasetId}
          onChange={(e) => setState({ ...state, datasetId: e.target.value })}
          placeholder='sim_drains'
        />
      </SettingRow>
      <SettingRow label='Table' htmlFor='drain-bigquery-table'>
        <ChipInput
          id='drain-bigquery-table'
          value={state.tableId}
          onChange={(e) => setState({ ...state, tableId: e.target.value })}
          placeholder='workflow_logs'
        />
      </SettingRow>
      <SettingRow
        label='Service account JSON key'
        htmlFor='drain-bigquery-service-account-json-key'
      >
        <ChipTextarea
          id='drain-bigquery-service-account-json-key'
          value={state.serviceAccountJson}
          onChange={(e) => setState({ ...state, serviceAccountJson: e.target.value })}
          placeholder='{ "type": "service_account", ... }'
          rows={6}
        />
      </SettingRow>
    </>
  ),
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
  FormFields: ({ state, setState }) => (
    <>
      <SettingRow label='Account identifier' htmlFor='drain-snowflake-account-identifier'>
        <ChipInput
          id='drain-snowflake-account-identifier'
          value={state.account}
          onChange={(e) => setState({ ...state, account: e.target.value })}
          placeholder='orgname-accountname'
        />
      </SettingRow>
      <SettingRow label='User' htmlFor='drain-snowflake-user'>
        <ChipInput
          id='drain-snowflake-user'
          value={state.user}
          onChange={(e) => setState({ ...state, user: e.target.value })}
          placeholder='SIM_DRAIN_USER'
        />
      </SettingRow>
      <SettingRow label='Warehouse' htmlFor='drain-snowflake-warehouse'>
        <ChipInput
          id='drain-snowflake-warehouse'
          value={state.warehouse}
          onChange={(e) => setState({ ...state, warehouse: e.target.value })}
          placeholder='COMPUTE_WH'
        />
      </SettingRow>
      <SettingRow label='Database' htmlFor='drain-snowflake-database'>
        <ChipInput
          id='drain-snowflake-database'
          value={state.database}
          onChange={(e) => setState({ ...state, database: e.target.value })}
          placeholder='SIM'
        />
      </SettingRow>
      <SettingRow label='Schema' htmlFor='drain-snowflake-schema'>
        <ChipInput
          id='drain-snowflake-schema'
          value={state.schema}
          onChange={(e) => setState({ ...state, schema: e.target.value })}
          placeholder='PUBLIC'
        />
      </SettingRow>
      <SettingRow label='Table' htmlFor='drain-snowflake-table'>
        <ChipInput
          id='drain-snowflake-table'
          value={state.table}
          onChange={(e) => setState({ ...state, table: e.target.value })}
          placeholder='WORKFLOW_LOGS'
        />
      </SettingRow>
      <SettingRow
        label='Column (optional, defaults to "DATA")'
        htmlFor='drain-snowflake-column-optional-defaults-to-data'
      >
        <ChipInput
          id='drain-snowflake-column-optional-defaults-to-data'
          value={state.column}
          onChange={(e) => setState({ ...state, column: e.target.value })}
          placeholder='DATA'
        />
      </SettingRow>
      <SettingRow label='Role (optional)' htmlFor='drain-snowflake-role-optional'>
        <ChipInput
          id='drain-snowflake-role-optional'
          value={state.role}
          onChange={(e) => setState({ ...state, role: e.target.value })}
          placeholder='SIM_DRAIN_ROLE'
        />
      </SettingRow>
      <SettingRow label='Private key (PEM, PKCS8)' htmlFor='drain-snowflake-private-key-pem-pkcs8'>
        <ChipTextarea
          id='drain-snowflake-private-key-pem-pkcs8'
          value={state.privateKey}
          onChange={(e) => setState({ ...state, privateKey: e.target.value })}
          placeholder='-----BEGIN PRIVATE KEY-----'
          rows={6}
        />
      </SettingRow>
    </>
  ),
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
  FormFields: ({ state, setState }) => (
    <>
      <SettingRow label='URL' htmlFor='drain-webhook-url'>
        <ChipInput
          id='drain-webhook-url'
          value={state.url}
          onChange={(e) => setState({ ...state, url: e.target.value })}
          placeholder='https://example.com/sim-drain'
        />
      </SettingRow>
      <SettingRow
        label='Signature header (optional)'
        htmlFor='drain-webhook-signature-header-optional'
      >
        <ChipInput
          id='drain-webhook-signature-header-optional'
          value={state.signatureHeader}
          onChange={(e) => setState({ ...state, signatureHeader: e.target.value })}
          placeholder='X-Sim-Signature'
        />
      </SettingRow>
      <SettingRow label='Signing secret' htmlFor='drain-webhook-signing-secret'>
        <SecretInput
          id='drain-webhook-signing-secret'
          value={state.signingSecret}
          onChange={(v) => setState({ ...state, signingSecret: v })}
          placeholder='At least 32 characters'
        />
      </SettingRow>
      <SettingRow label='Bearer token (optional)' htmlFor='drain-webhook-bearer-token-optional'>
        <SecretInput
          id='drain-webhook-bearer-token-optional'
          value={state.bearerToken}
          onChange={(v) => setState({ ...state, bearerToken: v })}
          placeholder='Paste your bearer token'
        />
      </SettingRow>
    </>
  ),
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

/**
 * Client-side mirror of `DESTINATION_REGISTRY`. The settings page selects a
 * spec by `destinationType` and never branches on the literal — adding a new
 * destination is one entry here plus one in the server-side registry.
 */
export const DESTINATION_FORM_REGISTRY: Record<DestinationType, DestinationFormSpec<unknown>> = {
  s3: s3FormSpec as DestinationFormSpec<unknown>,
  gcs: gcsFormSpec as DestinationFormSpec<unknown>,
  azure_blob: azureBlobFormSpec as DestinationFormSpec<unknown>,
  datadog: datadogFormSpec as DestinationFormSpec<unknown>,
  bigquery: bigqueryFormSpec as DestinationFormSpec<unknown>,
  snowflake: snowflakeFormSpec as DestinationFormSpec<unknown>,
  webhook: webhookFormSpec as DestinationFormSpec<unknown>,
}
