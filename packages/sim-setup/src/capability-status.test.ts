import { describe, expect, it } from 'vitest'
import { buildEnvCapabilityStatus } from './capability-status'

const _DAYTONA_FUNCTION_SNAPSHOT_ID = '00000000-0000-4000-8000-000000000002'

describe('env capability status', () => {
  it('reports configured knowledge embedding transports without exposing keys', () => {
    const status = buildEnvCapabilityStatus({
      OPENAI_API_KEY: 'secret-openai-key',
      OPENROUTER_API_KEY: 'secret-openrouter-key',
    })

    expect(status.features['knowledge-embeddings']).toMatchObject({
      state: 'configured',
      providerIds: ['openai', 'openrouter'],
    })
    expect(JSON.stringify(status)).not.toContain('secret-openai-key')
    expect(JSON.stringify(status)).not.toContain('secret-openrouter-key')
  })

  it('rejects a vector width no pgvector column can store', () => {
    const status = buildEnvCapabilityStatus({
      OPENAI_API_KEY: 'secret-openai-key',
      EMBEDDING_OUTPUT_DIMS: '999',
    })

    expect(status.features['knowledge-embeddings'].issue?.message).toContain(
      'EMBEDDING_OUTPUT_DIMS'
    )
  })

  it('reports a mutable Daytona Function snapshot name as invalid', () => {
    const status = buildEnvCapabilityStatus({
      SANDBOX_PROVIDER: 'daytona',
      DAYTONA_API_KEY: 'daytona-secret',
      DAYTONA_FUNCTION_SNAPSHOT_ID: 'mothership-shell:latest',
      NEXT_PUBLIC_SANDBOXES_ENABLED: 'true',
    })

    expect(status.features.sandbox).toMatchObject({
      state: 'invalid',
      providerId: 'daytona',
      issue: { state: 'invalid' },
    })
    expect(status.features.sandbox.issue?.message).toContain('immutable Daytona snapshot ID')
  })

  it('captures partial and invalid entries without aborting the snapshot', () => {
    const status = buildEnvCapabilityStatus({
      SMTP_HOST: 'localhost',
      TRIGGER_DEV_ENABLED: 'true',
      TRIGGER_PROJECT_ID: 'project',
      REDIS_URL: 'not-a-url',
      OCR_AZURE_ENDPOINT: 'https://ocr.example.com',
    })

    expect(status.features.email).toMatchObject({ state: 'partial' })
    expect(
      status.features.email.providers.find((provider) => provider.id === 'smtp')
    ).toMatchObject({
      state: 'partial',
      missingFields: ['SMTP_PORT'],
    })
    expect(status.features.jobs).toMatchObject({ state: 'partial', providerId: 'trigger-dev' })
    expect(status.features.cache).toMatchObject({ state: 'invalid', providerId: 'redis' })
    expect(status.features.knowledge).toMatchObject({
      state: 'partial',
      providerId: 'azure-mistral',
    })
    expect(status.features.storage).toMatchObject({ state: 'default', providerId: 'local' })
  })

  it('does not expose invalid selector values', () => {
    const sensitiveValue = 'sensitive-selector-value'
    const snapshots = [
      buildEnvCapabilityStatus({ STORAGE_PROVIDER: sensitiveValue }),
      buildEnvCapabilityStatus({ SANDBOX_PROVIDER: sensitiveValue }),
      buildEnvCapabilityStatus({ OCR_PROVIDER: sensitiveValue }),
    ]

    for (const snapshot of snapshots) {
      expect(JSON.stringify(snapshot)).not.toContain(sensitiveValue)
    }
  })

  it('counts configured and effective LLM pool keys without exposing them', () => {
    const status = buildEnvCapabilityStatus({
      OPENAI_API_KEY_1: 'openai-one',
      OPENAI_API_KEY_3: 'openai-three',
      FIREWORKS_API_KEY: 'fireworks-fallback',
      FIREWORKS_API_KEY_1: 'fireworks-one',
    })

    expect(status.features.llm).toMatchObject({
      state: 'configured',
      configuredPoolCount: 2,
      configuredKeyCount: 4,
      effectiveKeyCount: 3,
    })
    expect(status.features.llm.pools.openai).toMatchObject({
      state: 'configured',
      configuredKeyCount: 2,
      effectiveKeyCount: 2,
      fallbackKeyConfigured: false,
    })
    expect(status.features.llm.pools.fireworks).toMatchObject({
      state: 'configured',
      configuredKeyCount: 2,
      effectiveKeyCount: 1,
      fallbackKeyConfigured: true,
    })
    expect(JSON.stringify(status)).not.toContain('openai-one')
    expect(JSON.stringify(status)).not.toContain('fireworks-fallback')
  })
})
