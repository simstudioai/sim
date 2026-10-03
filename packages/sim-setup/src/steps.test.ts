import {
  EMAIL_CAPABILITY,
  inspectCapability,
  requireCapability,
  STORAGE_CAPABILITY,
  validateCapabilityFieldInput,
} from '@sim/deployment-config/env-capabilities'
import { describe, expect, it } from 'vitest'
import { EMAIL_SETUP, STORAGE_SETUP } from './capability-config'
import { buildCapabilitySetupTransition } from './capability-setup'

function applyResult(
  initial: Record<string, string>,
  result: { values: Record<string, string>; remove: readonly string[] }
): Record<string, string> {
  const reconciled = { ...initial }
  for (const key of result.remove) Reflect.deleteProperty(reconciled, key)
  return Object.assign(reconciled, result.values)
}

describe('setup provider reconciliation', () => {
  it('clears stale SMTP auth for an unauthenticated relay', () => {
    const result = buildCapabilitySetupTransition(
      EMAIL_SETUP,
      'smtp',
      { SMTP_HOST: 'localhost', SMTP_PORT: '1025' },
      {}
    )
    const reconciled = applyResult({ SMTP_USER: 'old-user', SMTP_PASS: 'old-pass' }, result)

    expect(reconciled).not.toHaveProperty('SMTP_USER')
    expect(reconciled).not.toHaveProperty('SMTP_PASS')
    expect(inspectCapability(EMAIL_CAPABILITY, reconciled).providerIds).toEqual(['smtp'])
  })

  it('clears stale static S3 credentials when IAM is selected', () => {
    const result = buildCapabilitySetupTransition(
      STORAGE_SETUP,
      's3',
      {
        AWS_REGION: 'us-east-1',
        S3_BUCKET_NAME: 'files',
      },
      {}
    )
    const reconciled = applyResult(
      {
        AWS_ACCESS_KEY_ID: 'old-access-key',
        AWS_SECRET_ACCESS_KEY: 'old-secret-key',
        S3_ENDPOINT: 'https://old-endpoint.example.com',
      },
      result
    )

    expect(reconciled).not.toHaveProperty('AWS_ACCESS_KEY_ID')
    expect(reconciled).not.toHaveProperty('AWS_SECRET_ACCESS_KEY')
    expect(reconciled).not.toHaveProperty('S3_ENDPOINT')
    expect(requireCapability(STORAGE_CAPABILITY, reconciled).providerId).toBe('s3')
  })

  it('clears stale inline GCS credentials when ADC is selected', () => {
    const result = buildCapabilitySetupTransition(
      STORAGE_SETUP,
      'gcs',
      { GCS_BUCKET_NAME: 'files' },
      {}
    )
    const reconciled = applyResult(
      {
        GCS_PROJECT_ID: 'old-project',
        GCS_CREDENTIALS_JSON: JSON.stringify({
          client_email: 'old@example.com',
          private_key: 'old-key',
        }),
      },
      result
    )

    expect(reconciled).not.toHaveProperty('GCS_PROJECT_ID')
    expect(reconciled).not.toHaveProperty('GCS_CREDENTIALS_JSON')
    expect(requireCapability(STORAGE_CAPABILITY, reconciled).providerId).toBe('gcs')
  })
})

describe('setup input validation', () => {
  it('accepts only HTTP(S) S3 endpoints', () => {
    const validate = (value: string) =>
      validateCapabilityFieldInput(STORAGE_CAPABILITY, 'S3_ENDPOINT', value)
    expect(validate('https://account.r2.cloudflarestorage.com')).toBeUndefined()
    expect(validate('http://minio:9000')).toBeUndefined()
    expect(validate('ftp://storage.example.com')).toContain('http:// or https://')
    expect(validate('not-a-url')).toContain('http:// or https://')
  })
})
