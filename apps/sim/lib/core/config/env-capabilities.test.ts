import { describe, expect, it, vi } from 'vitest'
import {
  DEPLOYMENT_CONFIGURATION_KEYS,
  EMAIL_CAPABILITY,
  EnvCapabilityConfigurationError,
  inspectOAuthClientCapability,
  inspectProvider,
  LLM_KEY_POOLS,
  requireOAuthClientCapability,
  resolveCacheProvider,
  resolveFallbackCapability,
  resolveOAuthClientCapabilityId,
  resolveOcrProvider,
  resolveSandboxProviderId,
  resolveSelectedCapability,
  STORAGE_CAPABILITY,
  selectSandboxProviderId,
  wireFallback,
} from '@/lib/core/config/env-capabilities'
import integrationsJson from '@/lib/integrations/integrations.json'
import type { Integration } from '@/lib/integrations/types'
import { getServiceConfigByServiceId } from '@/lib/oauth/utils'

describe('env capabilities', () => {
  it('resolves ready fallback providers in declaration order', () => {
    const resolution = resolveFallbackCapability(
      EMAIL_CAPABILITY,
      new Map([
        ['SMTP_HOST', 'localhost'],
        ['SMTP_PORT', '1025'],
        ['RESEND_API_KEY', 're_test'],
      ])
    )

    expect(resolution.providerIds).toEqual(['resend', 'smtp'])
  })

  it('fails fast on partial provider configuration', () => {
    expect(() =>
      resolveFallbackCapability(EMAIL_CAPABILITY, new Map([['SMTP_HOST', 'localhost']]))
    ).toThrow(EnvCapabilityConfigurationError)
  })

  it('fails fast on invalid provider configuration', () => {
    expect(() =>
      resolveFallbackCapability(
        EMAIL_CAPABILITY,
        new Map([
          ['SMTP_HOST', 'localhost'],
          ['SMTP_PORT', '99999'],
        ])
      )
    ).toThrow(/invalid SMTP_PORT/)
  })

  it('ignores an incomplete fallback provider when another provider is ready', () => {
    const resolution = resolveFallbackCapability(EMAIL_CAPABILITY, {
      RESEND_API_KEY: 're_test',
      SMTP_HOST: 'localhost',
    })

    expect(resolution.providerIds).toEqual(['resend'])
    expect(resolution.providers.find((provider) => provider.id === 'smtp')).toMatchObject({
      state: 'partial',
    })
  })

  it('preserves anonymous SMTP when only one optional auth field is set', () => {
    expect(
      resolveFallbackCapability(EMAIL_CAPABILITY, {
        SMTP_HOST: 'localhost',
        SMTP_PORT: '1025',
        SMTP_USER: 'unused-for-anonymous-relay',
      }).providerIds
    ).toEqual(['smtp'])
  })

  it('executes fallback providers in resolved order', async () => {
    const resend = { send: vi.fn().mockRejectedValue(new Error('resend down')) }
    const ses = { send: vi.fn().mockResolvedValue('sent') }
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

    await expect(fallback.execute((provider) => provider.send())).resolves.toBe('sent')
    expect(resend.send).toHaveBeenCalledOnce()
    expect(ses.send).toHaveBeenCalledOnce()
    expect(onFailure).toHaveBeenCalledWith('resend', expect.any(Error))
  })

  it('uses exact OAuth environment names and reports partial pairs', () => {
    expect(inspectOAuthClientCapability('zoho-desk', { ZOHO_CLIENT_ID: 'client' })).toMatchObject({
      state: 'partial',
      missingFields: ['ZOHO_CLIENT_SECRET'],
    })
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

  it('selects a single configured storage backend', () => {
    expect(
      resolveSelectedCapability(STORAGE_CAPABILITY, {
        AWS_REGION: 'us-east-1',
        S3_BUCKET_NAME: 'files',
      }).providerId
    ).toBe('s3')
  })

  it('does not treat general AWS credentials as an active storage provider', () => {
    expect(
      resolveSelectedCapability(STORAGE_CAPABILITY, {
        AWS_REGION: 'us-east-1',
        AWS_ACCESS_KEY_ID: 'access',
        AWS_SECRET_ACCESS_KEY: 'secret',
      }).providerId
    ).toBe('local')
  })

  it('validates the selected storage provider without rejecting inactive alternatives', () => {
    expect(
      resolveSelectedCapability(STORAGE_CAPABILITY, {
        STORAGE_PROVIDER: 'gcs',
        GCS_BUCKET_NAME: 'gcs-files',
        S3_ENDPOINT: 'https://s3.example.com',
      }).providerId
    ).toBe('gcs')
  })

  it('preserves legacy storage precedence when multiple backends are configured', () => {
    const values = {
      AZURE_CONNECTION_STRING: 'UseDevelopmentStorage=true',
      AZURE_STORAGE_CONTAINER_NAME: 'azure-files',
      AWS_REGION: 'us-east-1',
      S3_BUCKET_NAME: 'files',
      GCS_BUCKET_NAME: 'gcs-files',
    }
    expect(resolveSelectedCapability(STORAGE_CAPABILITY, values).providerId).toBe('azure')
    expect(
      resolveSelectedCapability(STORAGE_CAPABILITY, {
        ...values,
        STORAGE_PROVIDER: 'gcs',
      }).providerId
    ).toBe('gcs')
  })

  it('uses the first ready legacy storage provider despite an incomplete higher priority one', () => {
    expect(
      resolveSelectedCapability(STORAGE_CAPABILITY, {
        AZURE_STORAGE_CONTAINER_NAME: 'incomplete-azure',
        AWS_REGION: 'us-east-1',
        S3_BUCKET_NAME: 'files',
        GCS_BUCKET_NAME: 'gcs-files',
      }).providerId
    ).toBe('s3')
  })

  it('validates an optional S3-compatible endpoint', () => {
    const values = {
      STORAGE_PROVIDER: 's3',
      AWS_REGION: 'auto',
      S3_BUCKET_NAME: 'files',
      S3_ENDPOINT: 'ftp://storage.example.com',
    }
    const s3 = STORAGE_CAPABILITY.providers.find((provider) => provider.id === 's3')
    if (!s3) throw new Error('Missing S3 capability definition')

    expect(inspectProvider(s3, values)).toMatchObject({
      state: 'invalid',
      invalidFields: ['S3_ENDPOINT'],
    })
    expect(() => resolveSelectedCapability(STORAGE_CAPABILITY, values)).toThrow(
      EnvCapabilityConfigurationError
    )
  })

  it('requires the default Daytona shell snapshot before selecting Daytona', () => {
    expect(() =>
      resolveSandboxProviderId({
        SANDBOX_PROVIDER: 'daytona',
        DAYTONA_API_KEY: 'daytona-secret',
      })
    ).toThrow(/DAYTONA_SHELL_SNAPSHOT_ID/)

    expect(
      resolveSandboxProviderId({
        SANDBOX_PROVIDER: 'daytona',
        DAYTONA_API_KEY: 'daytona-secret',
        DAYTONA_SHELL_SNAPSHOT_ID: 'mothership-shell:v1',
      })
    ).toBe('daytona')
    expect(() =>
      resolveSandboxProviderId({
        SANDBOX_PROVIDER: 'daytona',
        DAYTONA_API_KEY: 'daytona-secret',
        DAYTONA_SHELL_SNAPSHOT_ID: 'mothership-shell',
      })
    ).toThrow(/explicit, non-floating name:tag/)
    expect(() =>
      resolveSandboxProviderId({
        SANDBOX_PROVIDER: 'daytona',
        DAYTONA_API_KEY: 'daytona-secret',
        DAYTONA_SHELL_SNAPSHOT_ID: 'mothership-shell:latest',
      })
    ).toThrow(/explicit, non-floating name:tag/)
  })

  it('preserves legacy sandbox selection before strict backend validation', () => {
    expect(selectSandboxProviderId({ SANDBOX_PROVIDER: 'daytona' })).toBe('daytona')
    expect(selectSandboxProviderId({ E2B_ENABLED: 'true' })).toBe('e2b')
    expect(() => selectSandboxProviderId({ SANDBOX_PROVIDER: 'unknown' })).toThrow(
      /Unknown SANDBOX_PROVIDER/
    )
  })

  it('tracks setup-owned Daytona and S3 options as deployment configuration', () => {
    expect(DEPLOYMENT_CONFIGURATION_KEYS).toContain('DAYTONA_SHELL_SNAPSHOT_ID')
    expect(DEPLOYMENT_CONFIGURATION_KEYS).toContain('S3_FORCE_PATH_STYLE')
  })

  it('tracks singular runtime LLM keys as pool fallbacks and deployment configuration', () => {
    expect(LLM_KEY_POOLS.openai.fallbackKey).toBe('OPENAI_API_KEY')
    expect(LLM_KEY_POOLS.gemini.fallbackKey).toBe('GEMINI_API_KEY')
    expect(LLM_KEY_POOLS.cohere.fallbackKey).toBe('COHERE_API_KEY')
    expect(DEPLOYMENT_CONFIGURATION_KEYS).toEqual(
      expect.arrayContaining(['OPENAI_API_KEY', 'GEMINI_API_KEY', 'COHERE_API_KEY'])
    )
  })

  it('rejects non-Redis cache URL protocols', () => {
    expect(() => resolveCacheProvider({ REDIS_URL: 'https://cache.example.com' })).toThrow(
      /redis:\/\/ or rediss:\/\//
    )
    expect(resolveCacheProvider({ REDIS_URL: 'redis://cache.example.com:6379' })).toBe('redis')
  })

  it('allows local OCR even when a general Mistral key is configured', () => {
    expect(resolveOcrProvider({ OCR_PROVIDER: 'local', MISTRAL_API_KEY: 'mistral-key' })).toBe(
      'local'
    )
  })

  it('preserves legacy Mistral inference when Azure OCR is incomplete', () => {
    expect(
      resolveOcrProvider({
        OCR_AZURE_ENDPOINT: 'https://ocr.example.com',
        MISTRAL_API_KEY: 'mistral-key',
      })
    ).toBe('mistral')
  })

  it('rejects a non-HTTP Azure OCR endpoint', () => {
    expect(() =>
      resolveOcrProvider({
        OCR_PROVIDER: 'azure-mistral',
        OCR_AZURE_API_KEY: 'azure-key',
        OCR_AZURE_ENDPOINT: 'ftp://ocr.example.com',
        OCR_AZURE_MODEL_NAME: 'mistral-ocr',
      })
    ).toThrow(/OCR_AZURE_ENDPOINT must be a valid HTTP\(S\) URL/)
  })
})
