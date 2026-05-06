'use client'

import type { ComponentType } from 'react'
import { FormField, Input, SecretInput, Switch } from '@/components/emcn'
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
  isComplete: (s) => s.url.length > 0 && s.signingSecret.length >= 8,
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
  webhook: webhookFormSpec as DestinationFormSpec<unknown>,
}
