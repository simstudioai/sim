'use client'

import type { ComponentType } from 'react'
import { Combobox, FormField, Input, SecretInput, Switch, Textarea } from '@/components/emcn'
import type { CreateDataDrainBody } from '@/lib/api/contracts/data-drains'
import type { DestinationType } from '@/lib/data-drains/types'

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
      <FormField label='Bucket'>
        <Input
          value={state.bucket}
          onChange={(e) => setState({ ...state, bucket: e.target.value })}
        />
      </FormField>
      <FormField label='Region'>
        <Input
          value={state.region}
          onChange={(e) => setState({ ...state, region: e.target.value })}
        />
      </FormField>
      <FormField label='Prefix (optional)'>
        <Input
          value={state.prefix}
          onChange={(e) => setState({ ...state, prefix: e.target.value })}
          placeholder='exports/sim'
        />
      </FormField>
      <FormField label='Endpoint (optional, S3-compatible stores)'>
        <Input
          value={state.endpoint}
          onChange={(e) => setState({ ...state, endpoint: e.target.value })}
          placeholder='https://s3.example.com'
        />
      </FormField>
      <FormField label='Force path style (MinIO, Ceph)'>
        <Switch
          checked={state.forcePathStyle}
          onCheckedChange={(v) => setState({ ...state, forcePathStyle: v })}
        />
      </FormField>
      <FormField label='Access key ID'>
        <SecretInput
          value={state.accessKeyId}
          onChange={(v) => setState({ ...state, accessKeyId: v })}
        />
      </FormField>
      <FormField label='Secret access key'>
        <SecretInput
          value={state.secretAccessKey}
          onChange={(v) => setState({ ...state, secretAccessKey: v })}
        />
      </FormField>
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
      <FormField label='Bucket'>
        <Input
          value={state.bucket}
          onChange={(e) => setState({ ...state, bucket: e.target.value })}
        />
      </FormField>
      <FormField label='Prefix (optional)'>
        <Input
          value={state.prefix}
          onChange={(e) => setState({ ...state, prefix: e.target.value })}
          placeholder='exports/sim'
        />
      </FormField>
      <FormField label='Service account JSON key'>
        <Textarea
          value={state.serviceAccountJson}
          onChange={(e) => setState({ ...state, serviceAccountJson: e.target.value })}
          placeholder='{ "type": "service_account", ... }'
          rows={6}
        />
      </FormField>
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
      <FormField label='Account name'>
        <Input
          value={state.accountName}
          onChange={(e) => setState({ ...state, accountName: e.target.value })}
        />
      </FormField>
      <FormField label='Container'>
        <Input
          value={state.containerName}
          onChange={(e) => setState({ ...state, containerName: e.target.value })}
        />
      </FormField>
      <FormField label='Prefix (optional)'>
        <Input
          value={state.prefix}
          onChange={(e) => setState({ ...state, prefix: e.target.value })}
          placeholder='exports/sim'
        />
      </FormField>
      <FormField label='Endpoint suffix (optional)'>
        <Input
          value={state.endpointSuffix}
          onChange={(e) => setState({ ...state, endpointSuffix: e.target.value })}
          placeholder='blob.core.windows.net'
        />
      </FormField>
      <FormField label='Account key'>
        <SecretInput
          value={state.accountKey}
          onChange={(v) => setState({ ...state, accountKey: v })}
        />
      </FormField>
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
      <FormField label='Site'>
        <Combobox
          value={state.site}
          onChange={(v) => setState({ ...state, site: v as DatadogState['site'] })}
          options={DATADOG_SITE_OPTIONS}
          dropdownWidth='trigger'
        />
      </FormField>
      <FormField label='Service (optional)'>
        <Input
          value={state.service}
          onChange={(e) => setState({ ...state, service: e.target.value })}
          placeholder='sim'
        />
      </FormField>
      <FormField label='Tags (optional, comma-separated)'>
        <Input
          value={state.tags}
          onChange={(e) => setState({ ...state, tags: e.target.value })}
          placeholder='env:prod,team:platform'
        />
      </FormField>
      <FormField label='API key'>
        <SecretInput value={state.apiKey} onChange={(v) => setState({ ...state, apiKey: v })} />
      </FormField>
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
      <FormField label='Project ID'>
        <Input
          value={state.projectId}
          onChange={(e) => setState({ ...state, projectId: e.target.value })}
          placeholder='my-gcp-project'
        />
      </FormField>
      <FormField label='Dataset'>
        <Input
          value={state.datasetId}
          onChange={(e) => setState({ ...state, datasetId: e.target.value })}
          placeholder='sim_drains'
        />
      </FormField>
      <FormField label='Table'>
        <Input
          value={state.tableId}
          onChange={(e) => setState({ ...state, tableId: e.target.value })}
          placeholder='workflow_logs'
        />
      </FormField>
      <FormField label='Service account JSON key'>
        <Textarea
          value={state.serviceAccountJson}
          onChange={(e) => setState({ ...state, serviceAccountJson: e.target.value })}
          placeholder='{ "type": "service_account", ... }'
          rows={6}
        />
      </FormField>
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
      <FormField label='Account identifier'>
        <Input
          value={state.account}
          onChange={(e) => setState({ ...state, account: e.target.value })}
          placeholder='orgname-accountname'
        />
      </FormField>
      <FormField label='User'>
        <Input
          value={state.user}
          onChange={(e) => setState({ ...state, user: e.target.value })}
          placeholder='SIM_DRAIN_USER'
        />
      </FormField>
      <FormField label='Warehouse'>
        <Input
          value={state.warehouse}
          onChange={(e) => setState({ ...state, warehouse: e.target.value })}
        />
      </FormField>
      <FormField label='Database'>
        <Input
          value={state.database}
          onChange={(e) => setState({ ...state, database: e.target.value })}
        />
      </FormField>
      <FormField label='Schema'>
        <Input
          value={state.schema}
          onChange={(e) => setState({ ...state, schema: e.target.value })}
        />
      </FormField>
      <FormField label='Table'>
        <Input
          value={state.table}
          onChange={(e) => setState({ ...state, table: e.target.value })}
        />
      </FormField>
      <FormField label='Column (optional, defaults to "DATA")'>
        <Input
          value={state.column}
          onChange={(e) => setState({ ...state, column: e.target.value })}
          placeholder='DATA'
        />
      </FormField>
      <FormField label='Role (optional)'>
        <Input value={state.role} onChange={(e) => setState({ ...state, role: e.target.value })} />
      </FormField>
      <FormField label='Private key (PEM, PKCS8)'>
        <Textarea
          value={state.privateKey}
          onChange={(e) => setState({ ...state, privateKey: e.target.value })}
          placeholder='-----BEGIN PRIVATE KEY-----'
          rows={6}
        />
      </FormField>
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
      <FormField label='URL'>
        <Input
          value={state.url}
          onChange={(e) => setState({ ...state, url: e.target.value })}
          placeholder='https://example.com/sim-drain'
        />
      </FormField>
      <FormField label='Signature header (optional)'>
        <Input
          value={state.signatureHeader}
          onChange={(e) => setState({ ...state, signatureHeader: e.target.value })}
          placeholder='X-Sim-Signature'
        />
      </FormField>
      <FormField label='Signing secret'>
        <SecretInput
          value={state.signingSecret}
          onChange={(v) => setState({ ...state, signingSecret: v })}
        />
      </FormField>
      <FormField label='Bearer token (optional)'>
        <SecretInput
          value={state.bearerToken}
          onChange={(v) => setState({ ...state, bearerToken: v })}
        />
      </FormField>
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
