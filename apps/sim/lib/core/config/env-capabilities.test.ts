import integrationsJson from '@sim/deployment-config/integrations.json'
import { describe, expect, it, vi } from 'vitest'
import {
  ASYNC_JOBS_CAPABILITY,
  CACHE_CAPABILITY,
  DEPLOYMENT_CONFIGURATION_KEYS,
  defineCapability,
  EMAIL_CAPABILITY,
  EnvCapabilityConfigurationError,
  envField,
  inspectCapability,
  inspectOAuthClientCapability,
  KNOWLEDGE_EMBEDDINGS_CAPABILITY,
  LLM_KEY_POOLS,
  OCR_CAPABILITY,
  requireCapability,
  requireOAuthClientCapability,
  resolveOAuthClientCapabilityId,
  SANDBOX_CAPABILITY,
  STORAGE_CAPABILITY,
  validateCapabilityFieldInput,
  wireFallback,
} from '@/lib/core/config/env-capabilities'
import type { Integration } from '@/lib/integrations/types'
import { getServiceConfigByServiceId } from '@/lib/oauth/utils'

const READY_STORAGE_VALUES = {
  azure: {
    AZURE_CONNECTION_STRING: 'UseDevelopmentStorage=true',
    AZURE_STORAGE_CONTAINER_NAME: 'azure-files',
  },
  s3: {
    AWS_REGION: 'us-east-1',
    S3_BUCKET_NAME: 's3-files',
  },
  gcs: {
    GCS_BUCKET_NAME: 'gcs-files',
  },
} as const

const STORAGE_COMBINATIONS = [
  { azure: false, s3: false, gcs: false, expected: 'local' },
  { azure: false, s3: false, gcs: true, expected: 'gcs' },
  { azure: false, s3: true, gcs: false, expected: 's3' },
  { azure: false, s3: true, gcs: true, expected: 's3' },
  { azure: true, s3: false, gcs: false, expected: 'azure' },
  { azure: true, s3: false, gcs: true, expected: 'azure' },
  { azure: true, s3: true, gcs: false, expected: 'azure' },
  { azure: true, s3: true, gcs: true, expected: 'azure' },
] as const

const READY_EMAIL_VALUES = {
  resend: { RESEND_API_KEY: 're_test' },
  ses: { AWS_SES_REGION: 'us-east-1' },
  smtp: { SMTP_HOST: 'localhost', SMTP_PORT: '1025' },
  azure: { AZURE_ACS_CONNECTION_STRING: 'endpoint=https://email.example.com' },
  gmail: {
    GMAIL_CREDENTIALS_JSON: JSON.stringify({
      client_email: 'mailer@example.com',
      private_key: 'private-key',
    }),
    GMAIL_SENDER: 'mailer@example.com',
  },
} as const

const EMAIL_PROVIDER_ORDER = ['resend', 'ses', 'smtp', 'azure', 'gmail'] as const
const E2B_FUNCTION_TEMPLATE_ID = 'sim-function:00000000-0000-4000-8000-000000000001'
const DAYTONA_FUNCTION_SNAPSHOT_ID = '00000000-0000-4000-8000-000000000002'

function storageValues({
  azure,
  s3,
  gcs,
}: Pick<(typeof STORAGE_COMBINATIONS)[number], 'azure' | 's3' | 'gcs'>): Record<string, string> {
  return Object.assign(
    {},
    azure ? READY_STORAGE_VALUES.azure : {},
    s3 ? READY_STORAGE_VALUES.s3 : {},
    gcs ? READY_STORAGE_VALUES.gcs : {}
  )
}

describe('env capabilities', () => {
  it('fails fast on invalid runtime capability definitions', () => {
    const provider = {
      id: 'remote',
      label: 'Remote',
      activation: { mode: 'any-present', keys: ['REMOTE_KEY'] } as const,
      requires: envField('REMOTE_KEY'),
    }
    const base = {
      strategy: 'selected',
      id: 'sample',
      label: 'Sample',
      whenUnset: 'default',
    } as const

    expect(() =>
      defineCapability({
        ...base,
        defaultProvider: { id: 'remote', kind: 'provider' },
        providers: [provider, provider],
      })
    ).toThrow(/duplicate provider ids/)
    expect(() =>
      defineCapability({
        ...base,
        defaultProvider: { id: 'missing', kind: 'provider' },
        providers: [provider],
      })
    ).toThrow(/default provider missing is not declared/)
  })

  describe('fallback capabilities', () => {
    it('resolves configured knowledge embedding transports in fallback order', () => {
      expect(
        inspectCapability(KNOWLEDGE_EMBEDDINGS_CAPABILITY, {
          OPENROUTER_API_KEY: 'openrouter-key',
        }).providerIds
      ).toEqual(['openrouter'])

      expect(
        inspectCapability(KNOWLEDGE_EMBEDDINGS_CAPABILITY, {
          AZURE_OPENAI_API_KEY: 'azure-key',
          AZURE_OPENAI_ENDPOINT: 'https://azure.example.com',
          AZURE_OPENAI_API_VERSION: '2024-10-21',
          OPENAI_API_KEY_1: 'openai-key',
          OPENROUTER_API_KEY: 'openrouter-key',
        }).providerIds
      ).toEqual(['azure-openai', 'openai', 'openrouter'])
    })

    it('reports partially configured Azure knowledge embeddings', () => {
      const inspection = inspectCapability(KNOWLEDGE_EMBEDDINGS_CAPABILITY, {
        AZURE_OPENAI_API_KEY: 'azure-key',
      })

      expect(inspection).toMatchObject({
        configured: false,
        providerIds: [],
        error: expect.any(EnvCapabilityConfigurationError),
      })
      expect(inspection.providers[0]).toMatchObject({
        state: 'partial',
        missingFields: expect.arrayContaining([
          'AZURE_OPENAI_ENDPOINT',
          'AZURE_OPENAI_API_VERSION',
        ]),
      })
    })

    it('resolves every ready email provider subset in declaration order', () => {
      for (let mask = 0; mask < 1 << EMAIL_PROVIDER_ORDER.length; mask += 1) {
        const expected = EMAIL_PROVIDER_ORDER.filter((_, index) => (mask & (1 << index)) !== 0)
        const values = Object.assign(
          {},
          ...expected.map((providerId) => READY_EMAIL_VALUES[providerId])
        )

        expect(
          inspectCapability(EMAIL_CAPABILITY, values).providerIds,
          `provider mask ${mask}`
        ).toEqual(expected)
      }
    })

    it('reports a broken email provider only when no ready alternative exists', () => {
      const partialOnly = inspectCapability(EMAIL_CAPABILITY, { SMTP_HOST: 'localhost' })
      expect(partialOnly).toMatchObject({
        configured: false,
        providerIds: [],
        error: expect.any(EnvCapabilityConfigurationError),
      })
      expect(() => requireCapability(EMAIL_CAPABILITY, { SMTP_HOST: 'localhost' })).toThrow(
        /SMTP_PORT/
      )

      const withAlternative = inspectCapability(EMAIL_CAPABILITY, {
        RESEND_API_KEY: 're_test',
        SMTP_HOST: 'localhost',
      })
      expect(withAlternative).toMatchObject({
        configured: true,
        providerIds: ['resend'],
        error: null,
      })
      expect(withAlternative.providers.find((provider) => provider.id === 'smtp')).toMatchObject({
        state: 'partial',
        missingFields: ['SMTP_PORT'],
      })

      const withMalformedAlternative = inspectCapability(EMAIL_CAPABILITY, {
        RESEND_API_KEY: 're_test',
        GMAIL_CREDENTIALS_JSON: '{}',
        GMAIL_SENDER: 'mailer@example.com',
      })
      expect(withMalformedAlternative).toMatchObject({
        configured: true,
        providerIds: ['resend'],
        error: null,
      })
      expect(
        withMalformedAlternative.providers.find((provider) => provider.id === 'gmail')
      ).toMatchObject({ state: 'invalid', invalidFields: ['GMAIL_CREDENTIALS_JSON'] })
      expect(() =>
        requireCapability(EMAIL_CAPABILITY, {
          GMAIL_CREDENTIALS_JSON: '{}',
          GMAIL_SENDER: 'mailer@example.com',
        })
      ).toThrow(/GMAIL_CREDENTIALS_JSON/)
    })

    it('preserves anonymous SMTP when only one optional auth field is set', () => {
      expect(
        requireCapability(EMAIL_CAPABILITY, {
          SMTP_HOST: 'localhost',
          SMTP_PORT: '1025',
          SMTP_USER: 'unused-for-anonymous-relay',
        }).providerIds
      ).toEqual(['smtp'])
    })

    it('validates setup input with the canonical field rules', () => {
      expect(validateCapabilityFieldInput(EMAIL_CAPABILITY, 'SMTP_PORT', '')).toBe('required')
      expect(validateCapabilityFieldInput(EMAIL_CAPABILITY, 'SMTP_PORT', '1025')).toBeUndefined()
      expect(validateCapabilityFieldInput(EMAIL_CAPABILITY, 'SMTP_PORT', '99999')).toMatch(
        /valid port/i
      )
      expect(
        validateCapabilityFieldInput(EMAIL_CAPABILITY, 'GMAIL_CREDENTIALS_JSON', '{}')
      ).toMatch(/service account/i)
      expect(() =>
        validateCapabilityFieldInput(EMAIL_CAPABILITY, 'UNKNOWN_EMAIL_FIELD', 'value')
      ).toThrow(/no validation definition/i)
    })

    it('executes email providers in order and stops after the first success', async () => {
      const resend = { send: vi.fn().mockRejectedValue(new Error('resend down')) }
      const ses = { send: vi.fn().mockResolvedValue('sent') }
      const smtp = { send: vi.fn().mockResolvedValue('should not run') }
      const onFailure = vi.fn()
      const fallback = wireFallback({
        definition: EMAIL_CAPABILITY,
        values: {
          RESEND_API_KEY: 're_test',
          AWS_SES_REGION: 'us-east-1',
          SMTP_HOST: 'localhost',
          SMTP_PORT: '1025',
        },
        factories: {
          resend: () => resend,
          ses: () => ses,
          smtp: () => smtp,
          azure: () => null,
          gmail: () => null,
        },
        onFailure,
      })

      await expect(fallback.execute((provider) => provider.send())).resolves.toBe('sent')
      expect(resend.send).toHaveBeenCalledOnce()
      expect(ses.send).toHaveBeenCalledOnce()
      expect(smtp.send).not.toHaveBeenCalled()
      expect(onFailure).toHaveBeenCalledWith('resend', expect.any(Error))
    })

    it('aggregates failures after every ready email provider fails', async () => {
      const resendError = new Error('resend down')
      const sesError = new Error('ses down')
      const resend = { send: vi.fn().mockRejectedValue(resendError) }
      const ses = { send: vi.fn().mockRejectedValue(sesError) }
      const onFailure = vi.fn()
      const fallback = wireFallback({
        definition: EMAIL_CAPABILITY,
        values: { RESEND_API_KEY: 're_test', AWS_SES_REGION: 'us-east-1' },
        factories: {
          resend: () => resend,
          ses: () => ses,
          smtp: () => null,
          azure: () => null,
          gmail: () => null,
        },
        onFailure,
      })

      const rejection = fallback.execute((provider) => provider.send())
      await expect(rejection).rejects.toThrow(/All Email providers failed: resend, ses/)
      await expect(rejection).rejects.toMatchObject({ errors: [resendError, sesError] })
      expect(onFailure.mock.calls.map(([providerId]) => providerId)).toEqual(['resend', 'ses'])
    })

    it('stops fallback immediately when the error predicate rejects an error', async () => {
      const fatal = new Error('invalid credentials')
      const first = { send: vi.fn().mockRejectedValue(fatal) }
      const second = { send: vi.fn().mockResolvedValue('should not run') }
      const fallback = wireFallback({
        definition: EMAIL_CAPABILITY,
        values: { RESEND_API_KEY: 're_test', AWS_SES_REGION: 'us-east-1' },
        factories: {
          resend: () => first,
          ses: () => second,
          smtp: () => null,
          azure: () => null,
          gmail: () => null,
        },
        shouldFallback: () => false,
      })

      await expect(fallback.execute((provider) => provider.send())).rejects.toBe(fatal)
      expect(second.send).not.toHaveBeenCalled()
    })

    it('fails immediately when a ready provider has no runtime implementation', () => {
      expect(() =>
        wireFallback({
          definition: EMAIL_CAPABILITY,
          values: { RESEND_API_KEY: 're_test' },
          factories: {
            resend: () => null,
            ses: () => null,
            smtp: () => null,
            azure: () => null,
            gmail: () => null,
          },
        })
      ).toThrow(/factory returned null/)
    })
  })

  describe('storage selection', () => {
    it('preserves legacy Azure, S3, GCS, local precedence for unset and blank selectors', () => {
      for (const selector of [undefined, '', '   '] as const) {
        for (const combination of STORAGE_COMBINATIONS) {
          const values = {
            ...storageValues(combination),
            ...(selector === undefined ? {} : { STORAGE_PROVIDER: selector }),
          }
          expect(
            inspectCapability(STORAGE_CAPABILITY, values).providerId,
            `selector=${JSON.stringify(selector)} combination=${JSON.stringify(combination)}`
          ).toBe(combination.expected)
        }
      }
    })

    it.each([
      {
        name: 'partial Azure before ready S3',
        values: {
          AZURE_STORAGE_CONTAINER_NAME: 'azure-files',
          ...READY_STORAGE_VALUES.s3,
        },
        expected: 's3',
      },
      {
        name: 'partial Azure before ready GCS',
        values: {
          AZURE_STORAGE_CONTAINER_NAME: 'azure-files',
          ...READY_STORAGE_VALUES.gcs,
        },
        expected: 'gcs',
      },
      {
        name: 'partial S3 before ready GCS',
        values: {
          S3_BUCKET_NAME: 's3-files',
          ...READY_STORAGE_VALUES.gcs,
        },
        expected: 'gcs',
      },
      {
        name: 'partial Azure and S3 before ready GCS',
        values: {
          AZURE_STORAGE_CONTAINER_NAME: 'azure-files',
          S3_BUCKET_NAME: 's3-files',
          ...READY_STORAGE_VALUES.gcs,
        },
        expected: 'gcs',
      },
    ])('skips $name', ({ values, expected }) => {
      expect(requireCapability(STORAGE_CAPABILITY, values).providerId).toBe(expected)
    })

    it('accepts both legacy Azure credential forms and GCS application-default credentials', () => {
      expect(
        requireCapability(STORAGE_CAPABILITY, {
          AZURE_ACCOUNT_NAME: 'storage-account',
          AZURE_ACCOUNT_KEY: 'storage-key',
          AZURE_STORAGE_CONTAINER_NAME: 'azure-files',
        }).providerId
      ).toBe('azure')
      expect(
        requireCapability(STORAGE_CAPABILITY, { GCS_BUCKET_NAME: 'gcs-files' }).providerId
      ).toBe('gcs')
    })

    it('does not activate S3 from general AWS credentials alone', () => {
      expect(
        requireCapability(STORAGE_CAPABILITY, {
          AWS_REGION: 'us-east-1',
          AWS_ACCESS_KEY_ID: 'access',
          AWS_SECRET_ACCESS_KEY: 'secret',
        }).providerId
      ).toBe('local')
    })

    it('fails fast when legacy storage configuration is partial and no provider is ready', () => {
      expect(() =>
        requireCapability(STORAGE_CAPABILITY, {
          AZURE_STORAGE_CONTAINER_NAME: 'azure-files',
        })
      ).toThrow(/AZURE_CONNECTION_STRING/)
      expect(() =>
        requireCapability(STORAGE_CAPABILITY, {
          S3_BUCKET_NAME: 's3-files',
        })
      ).toThrow(/AWS_REGION/)
    })

    it('reports one sufficient Azure credential repair path', () => {
      const inspection = inspectCapability(STORAGE_CAPABILITY, {
        AZURE_ACCOUNT_NAME: 'storage-account',
        AZURE_STORAGE_CONTAINER_NAME: 'azure-files',
      })
      const azure = inspection.providers.find((provider) => provider.id === 'azure')
      expect(azure?.missingFields).toHaveLength(1)
      expect(azure?.missingFields[0]).toMatch(/AZURE_(CONNECTION_STRING|ACCOUNT_KEY)/)
    })

    it('requires paired S3 credentials when either static credential is present', () => {
      expect(
        requireCapability(STORAGE_CAPABILITY, {
          ...READY_STORAGE_VALUES.s3,
          AWS_ACCESS_KEY_ID: 'access',
          AWS_SECRET_ACCESS_KEY: 'secret',
        }).providerId
      ).toBe('s3')
      expect(() =>
        requireCapability(STORAGE_CAPABILITY, {
          STORAGE_PROVIDER: 's3',
          ...READY_STORAGE_VALUES.s3,
          AWS_ACCESS_KEY_ID: 'access',
        })
      ).toThrow(/AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY must be set together/)
    })

    it('validates only the explicitly selected storage provider', () => {
      expect(
        requireCapability(STORAGE_CAPABILITY, {
          STORAGE_PROVIDER: 'gcs',
          GCS_BUCKET_NAME: 'gcs-files',
          S3_ENDPOINT: 'ftp://storage.example.com',
        }).providerId
      ).toBe('gcs')
      expect(
        requireCapability(STORAGE_CAPABILITY, {
          STORAGE_PROVIDER: 'local',
          AZURE_STORAGE_CONTAINER_NAME: 'partial-azure',
        }).providerId
      ).toBe('local')
    })

    it('reports missing or invalid fields for an explicitly selected storage provider', () => {
      const missing = inspectCapability(STORAGE_CAPABILITY, {
        STORAGE_PROVIDER: 's3',
        S3_BUCKET_NAME: 's3-files',
      })
      expect(missing).toMatchObject({
        providerId: 's3',
        error: expect.any(EnvCapabilityConfigurationError),
      })
      expect(() =>
        requireCapability(STORAGE_CAPABILITY, {
          STORAGE_PROVIDER: 's3',
          S3_BUCKET_NAME: 's3-files',
        })
      ).toThrow(/AWS_REGION/)
      expect(() =>
        requireCapability(STORAGE_CAPABILITY, {
          STORAGE_PROVIDER: 's3',
          ...READY_STORAGE_VALUES.s3,
          S3_ENDPOINT: 'ftp://storage.example.com',
        })
      ).toThrow(/S3_ENDPOINT/)
      expect(inspectCapability(STORAGE_CAPABILITY, { STORAGE_PROVIDER: 'unknown' })).toMatchObject({
        providerId: null,
        error: expect.any(EnvCapabilityConfigurationError),
      })
    })

    it('fails fast on a complete invalid higher-priority legacy provider', () => {
      expect(() =>
        requireCapability(STORAGE_CAPABILITY, {
          ...READY_STORAGE_VALUES.s3,
          S3_ENDPOINT: 'ftp://storage.example.com',
          ...READY_STORAGE_VALUES.gcs,
        })
      ).toThrow(/S3_ENDPOINT/)
    })
  })

  describe('OCR selection', () => {
    it('preserves Azure, Mistral, local precedence for every unset-provider combination', () => {
      const azureFields = [
        ['OCR_AZURE_API_KEY', 'azure-key'],
        ['OCR_AZURE_ENDPOINT', 'https://ocr.example.com'],
        ['OCR_AZURE_MODEL_NAME', 'mistral-ocr'],
      ] as const

      for (const selector of [undefined, '', '   '] as const) {
        for (let mask = 0; mask < 1 << (azureFields.length + 1); mask += 1) {
          const values: Record<string, string> = {}
          azureFields.forEach(([key, value], index) => {
            if ((mask & (1 << index)) !== 0) values[key] = value
          })
          const hasMistral = (mask & (1 << azureFields.length)) !== 0
          if (hasMistral) values.MISTRAL_API_KEY = 'mistral-key'
          if (selector !== undefined) values.OCR_PROVIDER = selector

          const azureComplete = (mask & 0b111) === 0b111
          const azurePartial = (mask & 0b111) !== 0 && !azureComplete
          const inspection = inspectCapability(OCR_CAPABILITY, values)

          if (azureComplete) {
            expect(inspection.providerId, `selector=${JSON.stringify(selector)} mask=${mask}`).toBe(
              'azure-mistral'
            )
            expect(inspection.error).toBeNull()
          } else if (hasMistral) {
            expect(inspection.providerId, `selector=${JSON.stringify(selector)} mask=${mask}`).toBe(
              'mistral'
            )
            expect(inspection.error).toBeNull()
          } else if (azurePartial) {
            expect(inspection.error).toBeInstanceOf(EnvCapabilityConfigurationError)
            expect(() => requireCapability(OCR_CAPABILITY, values)).toThrow()
          } else {
            expect(inspection).toMatchObject({ providerId: 'local', error: null })
          }
        }
      }
    })

    it('validates only the explicitly selected OCR provider', () => {
      expect(
        requireCapability(OCR_CAPABILITY, {
          OCR_PROVIDER: 'local',
          MISTRAL_API_KEY: 'mistral-key',
        }).providerId
      ).toBe('local')
      expect(() => requireCapability(OCR_CAPABILITY, { OCR_PROVIDER: 'mistral' })).toThrow(
        /MISTRAL_API_KEY/
      )
      expect(() =>
        requireCapability(OCR_CAPABILITY, {
          OCR_PROVIDER: 'azure-mistral',
          OCR_AZURE_API_KEY: 'azure-key',
          OCR_AZURE_ENDPOINT: 'ftp://ocr.example.com',
          OCR_AZURE_MODEL_NAME: 'mistral-ocr',
        })
      ).toThrow(/OCR_AZURE_ENDPOINT/)
      expect(inspectCapability(OCR_CAPABILITY, { OCR_PROVIDER: 'unknown' })).toMatchObject({
        providerId: null,
        error: expect.any(EnvCapabilityConfigurationError),
      })
    })

    it('preserves legacy Azure validation precedence over Mistral', () => {
      expect(() =>
        requireCapability(OCR_CAPABILITY, {
          OCR_AZURE_API_KEY: 'azure-key',
          OCR_AZURE_ENDPOINT: 'ftp://ocr.example.com',
          OCR_AZURE_MODEL_NAME: 'mistral-ocr',
          MISTRAL_API_KEY: 'mistral-key',
        })
      ).toThrow(/OCR_AZURE_ENDPOINT/)
      expect(
        requireCapability(OCR_CAPABILITY, {
          OCR_AZURE_ENDPOINT: 'ftp://ocr.example.com',
          MISTRAL_API_KEY: 'mistral-key',
        }).providerId
      ).toBe('mistral')
    })
  })

  describe('sandbox selection', () => {
    it('inspects the legacy E2B default without throwing but requires runtime configuration', () => {
      const inspection = inspectCapability(SANDBOX_CAPABILITY, {})
      expect(inspection).toMatchObject({
        providerId: 'e2b',
        error: null,
      })
      expect(() => requireCapability(SANDBOX_CAPABILITY, {})).toThrow(/E2B_API_KEY/)
    })

    it('requires E2B credentials and an immutable Function base when E2B is selected', () => {
      expect(
        requireCapability(SANDBOX_CAPABILITY, {
          E2B_ENABLED: 'true',
          E2B_API_KEY: 'e2b-key',
          E2B_FUNCTION_TEMPLATE_ID,
          E2B_FUNCTION_TEMPLATE_GENERATION: '1',
        }).providerId
      ).toBe('e2b')
      expect(() =>
        requireCapability(SANDBOX_CAPABILITY, {
          SANDBOX_PROVIDER: 'e2b',
          E2B_ENABLED: 'false',
        })
      ).toThrow(/E2B_API_KEY/)
      expect(() =>
        requireCapability(SANDBOX_CAPABILITY, {
          SANDBOX_PROVIDER: 'e2b',
          E2B_ENABLED: 'false',
          E2B_API_KEY: 'e2b-key',
          E2B_FUNCTION_TEMPLATE_ID,
          E2B_FUNCTION_TEMPLATE_GENERATION: '1',
        })
      ).toThrow(/E2B_ENABLED must be enabled/)
      expect(() =>
        requireCapability(SANDBOX_CAPABILITY, {
          E2B_ENABLED: 'true',
          E2B_API_KEY: 'e2b-key',
          E2B_FUNCTION_TEMPLATE_ID: 'sim-function:latest',
          E2B_FUNCTION_TEMPLATE_GENERATION: '1',
        })
      ).toThrow(/immutable E2B build reference/)
      expect(() =>
        requireCapability(SANDBOX_CAPABILITY, {
          E2B_ENABLED: 'true',
          E2B_API_KEY: 'e2b-key',
          E2B_FUNCTION_TEMPLATE_ID,
          E2B_FUNCTION_TEMPLATE_GENERATION: '0',
        })
      ).toThrow(/positive safe integer release generation/)
      const disabled = inspectCapability(SANDBOX_CAPABILITY, {
        SANDBOX_PROVIDER: 'e2b',
        E2B_ENABLED: 'false',
      })
      expect(disabled).toMatchObject({ providerId: 'e2b', error: null })
      expect(disabled.providers.find((provider) => provider.id === 'e2b')).toMatchObject({
        active: false,
        state: 'absent',
      })
    })

    it('requires Daytona credentials and an immutable Function snapshot', () => {
      expect(
        requireCapability(SANDBOX_CAPABILITY, {
          SANDBOX_PROVIDER: 'daytona',
          DAYTONA_API_KEY: 'daytona-key',
          DAYTONA_FUNCTION_SNAPSHOT_ID,
        }).providerId
      ).toBe('daytona')
      expect(() =>
        requireCapability(SANDBOX_CAPABILITY, {
          SANDBOX_PROVIDER: 'daytona',
          DAYTONA_API_KEY: 'daytona-key',
        })
      ).toThrow(/DAYTONA_FUNCTION_SNAPSHOT_ID/)
      expect(() =>
        requireCapability(SANDBOX_CAPABILITY, {
          SANDBOX_PROVIDER: 'daytona',
          DAYTONA_API_KEY: 'daytona-key',
          DAYTONA_FUNCTION_SNAPSHOT_ID: 'mothership-shell:v1',
        })
      ).toThrow(/immutable Daytona snapshot ID/)
    })

    it('reports an unknown sandbox selector without throwing during inspection', () => {
      expect(inspectCapability(SANDBOX_CAPABILITY, { SANDBOX_PROVIDER: 'unknown' })).toMatchObject({
        providerId: null,
        error: expect.any(EnvCapabilityConfigurationError),
      })
      expect(() => requireCapability(SANDBOX_CAPABILITY, { SANDBOX_PROVIDER: 'unknown' })).toThrow(
        /Unknown SANDBOX_PROVIDER/
      )
    })
  })

  describe('jobs and cache selection', () => {
    it('uses database jobs unless Trigger.dev is enabled and configured', () => {
      expect(requireCapability(ASYNC_JOBS_CAPABILITY, {}).providerId).toBe('database')
      expect(
        requireCapability(ASYNC_JOBS_CAPABILITY, { TRIGGER_DEV_ENABLED: 'false' }).providerId
      ).toBe('database')
      expect(
        requireCapability(ASYNC_JOBS_CAPABILITY, {
          TRIGGER_DEV_ENABLED: 'true',
          TRIGGER_PROJECT_ID: 'project-id',
          TRIGGER_SECRET_KEY: 'secret-key',
        }).providerId
      ).toBe('trigger-dev')
      expect(() =>
        requireCapability(ASYNC_JOBS_CAPABILITY, {
          TRIGGER_DEV_ENABLED: 'true',
          TRIGGER_PROJECT_ID: 'project-id',
        })
      ).toThrow(/TRIGGER_SECRET_KEY/)
    })

    it('uses Redis only when REDIS_URL is present and valid', () => {
      expect(requireCapability(CACHE_CAPABILITY, {}).providerId).toBe('database')
      expect(
        requireCapability(CACHE_CAPABILITY, { REDIS_URL: 'redis://cache.example.com:6379' })
          .providerId
      ).toBe('redis')
      expect(() =>
        requireCapability(CACHE_CAPABILITY, { REDIS_URL: 'https://cache.example.com' })
      ).toThrow(/redis:\/\/ or rediss:\/\//)
    })

    it('requires a TLS server name for rediss IP addresses', () => {
      expect(() =>
        requireCapability(CACHE_CAPABILITY, { REDIS_URL: 'rediss://10.0.0.1:6379' })
      ).toThrow(/REDIS_TLS_SERVERNAME/)
      expect(
        requireCapability(CACHE_CAPABILITY, {
          REDIS_URL: 'rediss://10.0.0.1:6379',
          REDIS_TLS_SERVERNAME: 'cache.internal',
        }).providerId
      ).toBe('redis')
      expect(
        requireCapability(CACHE_CAPABILITY, {
          REDIS_URL: 'rediss://cache.example.com:6379',
        }).providerId
      ).toBe('redis')
    })
  })

  describe('OAuth and deployment metadata', () => {
    it('uses exact OAuth environment names and reports partial pairs', () => {
      expect(inspectOAuthClientCapability('zoho-desk', { ZOHO_CLIENT_ID: 'client' })).toMatchObject(
        {
          state: 'partial',
          missingFields: ['ZOHO_CLIENT_SECRET'],
        }
      )
    })

    it('fails fast when an OAuth client is partially configured', () => {
      expect(() => requireOAuthClientCapability('slack', { SLACK_CLIENT_ID: 'client' })).toThrow(
        /SLACK_CLIENT_SECRET/
      )
    })

    it('covers every OAuth integration', () => {
      const integrations = integrationsJson.integrations as readonly Integration[]
      const uncovered = integrations.flatMap((integration) => {
        if (integration.authType !== 'oauth' || !integration.oauthServiceId) return []
        if (resolveOAuthClientCapabilityId(integration.oauthServiceId)) return []
        return [integration.slug]
      })

      expect(uncovered).toEqual([])
      expect(getServiceConfigByServiceId('trello')?.serviceAccountProviderId).toBe(
        'trello-service-account'
      )
    })

    it('tracks setup-owned options as deployment configuration', () => {
      expect(DEPLOYMENT_CONFIGURATION_KEYS).toEqual(
        expect.arrayContaining([
          'DAYTONA_FUNCTION_SNAPSHOT_ID',
          'E2B_FUNCTION_TEMPLATE_ID',
          'E2B_FUNCTION_TEMPLATE_GENERATION',
          'NEXT_PUBLIC_SANDBOXES_ENABLED',
          'S3_FORCE_PATH_STYLE',
          'STORAGE_PROVIDER',
          'OCR_PROVIDER',
        ])
      )
    })

    it('tracks singular runtime LLM keys as pool fallbacks and deployment configuration', () => {
      expect(LLM_KEY_POOLS.openai.fallbackKey).toBe('OPENAI_API_KEY')
      expect(LLM_KEY_POOLS.gemini.fallbackKey).toBe('GEMINI_API_KEY')
      expect(LLM_KEY_POOLS.cohere.fallbackKey).toBe('COHERE_API_KEY')
      expect(DEPLOYMENT_CONFIGURATION_KEYS).toEqual(
        expect.arrayContaining(['OPENAI_API_KEY', 'GEMINI_API_KEY', 'COHERE_API_KEY'])
      )
    })
  })
})
