import { describe, expect, it } from 'bun:test'
import {
  EMAIL_CAPABILITY,
  resolveFallbackCapability,
  resolveSelectedCapability,
  STORAGE_CAPABILITY,
} from '../../apps/sim/lib/core/config/env-capabilities.ts'
import {
  reconcileEmailSetupValues,
  reconcileStorageSetupValues,
  validateS3EndpointInput,
  validateServiceAccountJsonInput,
  validateSmtpPortInput,
} from './steps.ts'

function applyResult(
  initial: Record<string, string>,
  result: { values: Record<string, string>; remove: readonly string[] }
): Record<string, string> {
  const reconciled = { ...initial }
  for (const key of result.remove) Reflect.deleteProperty(reconciled, key)
  return Object.assign(reconciled, result.values)
}

describe('setup provider reconciliation', () => {
  it('removes stale email fallbacks when one provider is selected', () => {
    const result = reconcileEmailSetupValues({ RESEND_API_KEY: 'new-resend-key' })
    const reconciled = applyResult(
      {
        SMTP_HOST: 'smtp.example.com',
        SMTP_PORT: '587',
        SMTP_USER: 'old-user',
        SMTP_PASS: 'old-pass',
      },
      result
    )

    expect(result.remove).toEqual(
      expect.arrayContaining(['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS'])
    )
    expect(resolveFallbackCapability(EMAIL_CAPABILITY, reconciled).providerIds).toEqual(['resend'])
  })

  it('clears stale SMTP auth for an unauthenticated relay', () => {
    const result = reconcileEmailSetupValues({ SMTP_HOST: 'localhost', SMTP_PORT: '1025' })
    const reconciled = applyResult({ SMTP_USER: 'old-user', SMTP_PASS: 'old-pass' }, result)

    expect(reconciled).not.toHaveProperty('SMTP_USER')
    expect(reconciled).not.toHaveProperty('SMTP_PASS')
    expect(resolveFallbackCapability(EMAIL_CAPABILITY, reconciled).providerIds).toEqual(['smtp'])
  })

  it('clears stale static S3 credentials when IAM is selected', () => {
    const result = reconcileStorageSetupValues({
      STORAGE_PROVIDER: 's3',
      AWS_REGION: 'us-east-1',
      S3_BUCKET_NAME: 'files',
      S3_FORCE_PATH_STYLE: 'false',
    })
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
    expect(resolveSelectedCapability(STORAGE_CAPABILITY, reconciled).providerId).toBe('s3')
  })

  it('clears stale inline GCS credentials when ADC is selected', () => {
    const result = reconcileStorageSetupValues({
      STORAGE_PROVIDER: 'gcs',
      GCS_BUCKET_NAME: 'files',
    })
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
    expect(resolveSelectedCapability(STORAGE_CAPABILITY, reconciled).providerId).toBe('gcs')
  })
})

describe('setup input validation', () => {
  it('validates SMTP ports with the runtime capability rule', () => {
    expect(validateSmtpPortInput('587')).toBeUndefined()
    expect(validateSmtpPortInput('0')).toContain('between 1 and 65535')
    expect(validateSmtpPortInput('587.5')).toContain('between 1 and 65535')
  })

  it('accepts only HTTP(S) S3 endpoints', () => {
    expect(validateS3EndpointInput('https://account.r2.cloudflarestorage.com')).toBeUndefined()
    expect(validateS3EndpointInput('http://minio:9000')).toBeUndefined()
    expect(validateS3EndpointInput('ftp://storage.example.com')).toContain('http:// or https://')
    expect(validateS3EndpointInput('not-a-url')).toContain('http:// or https://')
  })

  it('requires complete inline service-account JSON', () => {
    expect(
      validateServiceAccountJsonInput(
        JSON.stringify({ client_email: 'service@example.com', private_key: 'secret' })
      )
    ).toBeUndefined()
    expect(validateServiceAccountJsonInput('{"client_email":"service@example.com"}')).toContain(
      'client_email and private_key'
    )
  })
})
