import {
  EMAIL_CAPABILITY,
  inspectCapability,
  KNOWLEDGE_EMBEDDINGS_CAPABILITY,
  requireCapability,
  STORAGE_CAPABILITY,
  validateCapabilityFieldInput,
} from '@sim/deployment-config/env-capabilities'
import { describe, expect, it } from 'vitest'
import { EMAIL_SETUP, KNOWLEDGE_EMBEDDINGS_SETUP, STORAGE_SETUP } from './capability-config'
import {
  buildCapabilitySetupTransition,
  resolveCurrentCapabilitySetupOptionId,
} from './capability-setup'

function applyResult(
  initial: Record<string, string>,
  result: { values: Record<string, string>; remove: readonly string[] }
): Record<string, string> {
  const reconciled = { ...initial }
  for (const key of result.remove) Reflect.deleteProperty(reconciled, key)
  return Object.assign(reconciled, result.values)
}

describe('setup provider reconciliation', () => {
  it('defaults email setup to the first runtime-ready fallback', () => {
    const vars = new Map([
      ['SMTP_HOST', 'smtp.example.com'],
      [
        'GMAIL_CREDENTIALS_JSON',
        JSON.stringify({ client_email: 'service@example.com', private_key: 'secret' }),
      ],
      ['GMAIL_SENDER', 'sender@example.com'],
    ])

    expect(resolveCurrentCapabilitySetupOptionId(EMAIL_SETUP, vars)).toBe('gmail')
    expect(
      resolveCurrentCapabilitySetupOptionId(
        EMAIL_SETUP,
        new Map([['SMTP_HOST', 'smtp.example.com']])
      )
    ).toBe('smtp')
  })

  it('allows setup when no knowledge embedding provider is configured', () => {
    expect(resolveCurrentCapabilitySetupOptionId(KNOWLEDGE_EMBEDDINGS_SETUP, {})).toBeUndefined()
    expect(
      resolveCurrentCapabilitySetupOptionId(KNOWLEDGE_EMBEDDINGS_SETUP, {
        OPENROUTER_API_KEY: 'openrouter-key',
      })
    ).toBe('openrouter')
  })

  it('uses canonical storage selection for setup defaults', () => {
    expect(
      resolveCurrentCapabilitySetupOptionId(STORAGE_SETUP, new Map([['AWS_REGION', 'us-east-1']]))
    ).toBe('local')
    expect(
      resolveCurrentCapabilitySetupOptionId(
        STORAGE_SETUP,
        new Map([
          ['STORAGE_PROVIDER', ' S3 '],
          ['AWS_REGION', 'us-east-1'],
          ['S3_BUCKET_NAME', 'files'],
          ['S3_ENDPOINT', 'https://storage.example.com'],
        ])
      )
    ).toBe('s3')
  })

  it('preserves other ready email providers when another fallback is configured', () => {
    const result = buildCapabilitySetupTransition(
      EMAIL_SETUP,
      'resend',
      { RESEND_API_KEY: 'new-resend-key' },
      {}
    )
    const reconciled = applyResult(
      {
        SMTP_HOST: 'smtp.example.com',
        SMTP_PORT: '587',
        SMTP_USER: 'old-user',
        SMTP_PASS: 'old-pass',
      },
      result
    )

    expect(result.remove).not.toEqual(expect.arrayContaining(['SMTP_HOST', 'SMTP_PORT']))
    expect(inspectCapability(EMAIL_CAPABILITY, reconciled).providerIds).toEqual(['resend', 'smtp'])
  })

  it('configures a knowledge embedding provider from an empty state', () => {
    const result = buildCapabilitySetupTransition(
      KNOWLEDGE_EMBEDDINGS_SETUP,
      'openrouter',
      { OPENROUTER_API_KEY: 'openrouter-key' },
      {}
    )
    const reconciled = applyResult({}, result)

    expect(inspectCapability(KNOWLEDGE_EMBEDDINGS_CAPABILITY, reconciled).providerIds).toEqual([
      'openrouter',
    ])
  })

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

  it('preserves specialized S3 bucket overrides that setup does not prompt for', () => {
    const result = buildCapabilitySetupTransition(
      STORAGE_SETUP,
      's3',
      {
        AWS_REGION: 'us-east-1',
        S3_BUCKET_NAME: 'files',
      },
      {
        S3_KB_BUCKET_NAME: 'knowledge',
        S3_CHAT_BUCKET_NAME: 'chat',
      }
    )
    const reconciled = applyResult(
      {
        S3_KB_BUCKET_NAME: 'knowledge',
        S3_CHAT_BUCKET_NAME: 'chat',
      },
      result
    )

    expect(result.remove).not.toEqual(
      expect.arrayContaining(['S3_KB_BUCKET_NAME', 'S3_CHAT_BUCKET_NAME'])
    )
    expect(reconciled.S3_KB_BUCKET_NAME).toBe('knowledge')
    expect(reconciled.S3_CHAT_BUCKET_NAME).toBe('chat')
    expect(requireCapability(STORAGE_CAPABILITY, reconciled).providerId).toBe('s3')
  })

  it('clears specialized S3 bucket overrides when switching to local storage', () => {
    const result = buildCapabilitySetupTransition(
      STORAGE_SETUP,
      'local',
      {},
      {
        AWS_REGION: 'us-east-1',
        S3_BUCKET_NAME: 'files',
        S3_KB_BUCKET_NAME: 'knowledge',
        S3_CHAT_BUCKET_NAME: 'chat',
      }
    )
    const reconciled = applyResult(
      {
        AWS_REGION: 'us-east-1',
        S3_BUCKET_NAME: 'files',
        S3_KB_BUCKET_NAME: 'knowledge',
        S3_CHAT_BUCKET_NAME: 'chat',
      },
      result
    )

    expect(result.remove).toEqual(
      expect.arrayContaining(['S3_KB_BUCKET_NAME', 'S3_CHAT_BUCKET_NAME'])
    )
    expect(reconciled).not.toHaveProperty('S3_KB_BUCKET_NAME')
    expect(reconciled).not.toHaveProperty('S3_CHAT_BUCKET_NAME')
    expect(requireCapability(STORAGE_CAPABILITY, reconciled).providerId).toBe('local')
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
  it('validates SMTP ports with the runtime capability rule', () => {
    const validate = (value: string) =>
      validateCapabilityFieldInput(EMAIL_CAPABILITY, 'SMTP_PORT', value)
    expect(validate('587')).toBeUndefined()
    expect(validate('0')).toContain('between 1 and 65535')
    expect(validate('587.5')).toContain('between 1 and 65535')
  })

  it('accepts only HTTP(S) S3 endpoints', () => {
    const validate = (value: string) =>
      validateCapabilityFieldInput(STORAGE_CAPABILITY, 'S3_ENDPOINT', value)
    expect(validate('https://account.r2.cloudflarestorage.com')).toBeUndefined()
    expect(validate('http://minio:9000')).toBeUndefined()
    expect(validate('ftp://storage.example.com')).toContain('http:// or https://')
    expect(validate('not-a-url')).toContain('http:// or https://')
  })

  it('requires complete inline service-account JSON', () => {
    const validate = (value: string) =>
      validateCapabilityFieldInput(EMAIL_CAPABILITY, 'GMAIL_CREDENTIALS_JSON', value)
    expect(
      validate(JSON.stringify({ client_email: 'service@example.com', private_key: 'secret' }))
    ).toBeUndefined()
    expect(validate('{"client_email":"service@example.com"}')).toContain(
      'client_email and private_key'
    )
  })
})
