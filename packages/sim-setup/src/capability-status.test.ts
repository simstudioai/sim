import { OAUTH_CLIENT_CAPABILITIES } from '@sim/deployment-config/env-capabilities'
import { describe, expect, it } from 'vitest'
import { buildEnvCapabilityStatus } from './capability-status'

const DAYTONA_FUNCTION_SNAPSHOT_ID = '00000000-0000-4000-8000-000000000002'

describe('env capability status', () => {
  it('reports built-in defaults without treating them as configured services', () => {
    const status = buildEnvCapabilityStatus({})

    expect(status.features.email).toMatchObject({ state: 'missing', providerIds: [] })
    expect(status.features.storage).toMatchObject({ state: 'default', providerId: 'local' })
    expect(status.features.sandbox).toMatchObject({ state: 'default', providerId: 'disabled' })
    expect(status.features.jobs).toMatchObject({ state: 'default', providerId: 'database' })
    expect(status.features.cache).toMatchObject({ state: 'default', providerId: 'database' })
    expect(status.features.knowledge).toMatchObject({ state: 'default', providerId: 'local' })
    expect(status.features['knowledge-embeddings']).toMatchObject({
      state: 'missing',
      providerIds: [],
    })
    expect(status.features.llm).toMatchObject({
      state: 'missing',
      configuredPoolCount: 0,
      configuredKeyCount: 0,
      effectiveKeyCount: 0,
    })
    expect(status.oauthClients.absentCount).toBe(Object.keys(OAUTH_CLIENT_CAPABILITIES).length)
  })

  it('reports an explicitly selected but disabled E2B provider as the default', () => {
    const status = buildEnvCapabilityStatus({
      SANDBOX_PROVIDER: 'e2b',
      E2B_ENABLED: 'false',
      NEXT_PUBLIC_E2B_ENABLED: 'false',
      NEXT_PUBLIC_SANDBOXES_ENABLED: 'false',
    })

    expect(status.features.sandbox).toEqual({
      id: 'sandbox',
      label: 'Function sandboxes',
      setupCommand: 'npx sim-setup add sandbox',
      state: 'default',
      providerId: 'disabled',
    })
  })

  it('preserves declared email fallback order', () => {
    const status = buildEnvCapabilityStatus({
      SMTP_HOST: 'localhost',
      SMTP_PORT: '1025',
      RESEND_API_KEY: 'secret-resend-key',
      GMAIL_CREDENTIALS_JSON: JSON.stringify({
        client_email: 'mailer@example.com',
        private_key: 'secret-private-key',
      }),
      GMAIL_SENDER: 'mailer@example.com',
    })

    expect(status.features.email).toMatchObject({
      state: 'configured',
      providerIds: ['resend', 'smtp', 'gmail'],
    })
    expect(JSON.stringify(status)).not.toContain('secret-resend-key')
    expect(JSON.stringify(status)).not.toContain('secret-private-key')
  })

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

  /**
   * `KB_EMBEDDING_MODEL` names a model, and the model picks the family. A key
   * for a family the model does not name is not a fallback for the one it does,
   * so it must not read as a configured knowledge-embedding provider.
   */
  it('reports only the family the configured embedding model names', () => {
    const withOpenAI = {
      OPENAI_API_KEY: 'secret-openai-key',
      GEMINI_API_KEY: 'secret-gemini-key',
      OLLAMA_URL: 'http://localhost:11434',
    }

    expect(buildEnvCapabilityStatus(withOpenAI).features['knowledge-embeddings']).toMatchObject({
      state: 'configured',
      providerIds: ['openai'],
    })

    expect(
      buildEnvCapabilityStatus({ ...withOpenAI, KB_EMBEDDING_MODEL: 'gemini-embedding-001' })
        .features['knowledge-embeddings']
    ).toMatchObject({ state: 'configured', providerIds: ['gemini'] })

    expect(
      buildEnvCapabilityStatus({ ...withOpenAI, KB_EMBEDDING_MODEL: 'ollama/nomic-embed-text' })
        .features['knowledge-embeddings']
    ).toMatchObject({ state: 'configured', providerIds: ['ollama'] })
  })

  it('names the field an Ollama embedding model is missing, not the whole capability', () => {
    const status = buildEnvCapabilityStatus({
      OPENAI_API_KEY: 'secret-openai-key',
      KB_EMBEDDING_MODEL: 'ollama/nomic-embed-text',
    })

    expect(status.features['knowledge-embeddings'].state).toBe('partial')
    expect(status.features['knowledge-embeddings'].issue?.message).toContain('OLLAMA_URL')
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

  /**
   * A width the selected family cannot emit falls back at runtime with only a
   * log line, so the accepted set is per family rather than the storage set.
   */
  it('accepts a width only for the family that can emit it', () => {
    const openaiAt384 = buildEnvCapabilityStatus({
      OPENAI_API_KEY: 'secret-openai-key',
      EMBEDDING_OUTPUT_DIMS: '384',
    })
    expect(openaiAt384.features['knowledge-embeddings'].issue?.message).toContain(
      'EMBEDDING_OUTPUT_DIMS'
    )

    const ollamaAt384 = buildEnvCapabilityStatus({
      OLLAMA_URL: 'http://localhost:11434',
      KB_EMBEDDING_MODEL: 'ollama/all-minilm',
      EMBEDDING_OUTPUT_DIMS: '384',
    })
    expect(ollamaAt384.features['knowledge-embeddings']).toMatchObject({
      state: 'configured',
      providerIds: ['ollama'],
    })

    const geminiAt1024 = buildEnvCapabilityStatus({
      GEMINI_API_KEY: 'secret-gemini-key',
      KB_EMBEDDING_MODEL: 'gemini-embedding-001',
      EMBEDDING_OUTPUT_DIMS: '1024',
    })
    expect(geminiAt1024.features['knowledge-embeddings'].issue?.message).toContain(
      'EMBEDDING_OUTPUT_DIMS'
    )
  })

  it('reports selected Daytona and cloud storage providers', () => {
    const status = buildEnvCapabilityStatus({
      SANDBOX_PROVIDER: 'daytona',
      DAYTONA_API_KEY: 'daytona-secret',
      DAYTONA_FUNCTION_SNAPSHOT_ID,
      NEXT_PUBLIC_SANDBOXES_ENABLED: 'true',
      STORAGE_PROVIDER: 's3',
      AWS_REGION: 'us-east-1',
      S3_BUCKET_NAME: 'files',
    })

    expect(status.features.sandbox).toMatchObject({
      state: 'configured',
      providerId: 'daytona',
    })
    expect(status.features.storage).toMatchObject({
      state: 'configured',
      providerId: 's3',
    })
  })

  it('reports Daytona as missing when its Function snapshot is absent', () => {
    const status = buildEnvCapabilityStatus({
      SANDBOX_PROVIDER: 'daytona',
      DAYTONA_API_KEY: 'daytona-secret',
      NEXT_PUBLIC_SANDBOXES_ENABLED: 'true',
    })

    expect(status.features.sandbox).toMatchObject({
      state: 'missing',
      providerId: 'daytona',
      issue: { state: 'missing' },
    })
    expect(status.features.sandbox.issue?.message).toContain('DAYTONA_FUNCTION_SNAPSHOT_ID')
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

  it('reports remote sandbox server/browser drift as partial', () => {
    const status = buildEnvCapabilityStatus({
      SANDBOX_PROVIDER: 'daytona',
      DAYTONA_API_KEY: 'daytona-secret',
      DAYTONA_FUNCTION_SNAPSHOT_ID,
    })

    expect(status.features.sandbox).toMatchObject({
      state: 'partial',
      providerId: 'daytona',
      issue: { state: 'partial' },
    })
    expect(status.features.sandbox.issue?.message).toContain('NEXT_PUBLIC_SANDBOXES_ENABLED')
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

  it('reports every OAuth client group as ready, partial, or absent', () => {
    const status = buildEnvCapabilityStatus({
      GOOGLE_CLIENT_ID: 'google-id',
      GOOGLE_CLIENT_SECRET: 'google-secret',
      MICROSOFT_CLIENT_ID: 'microsoft-id',
    })

    expect(status.oauthClients.clients.google).toMatchObject({
      state: 'ready',
      configuredFieldCount: 2,
      requiredFieldCount: 2,
    })
    expect(status.oauthClients.clients.microsoft).toMatchObject({
      state: 'partial',
      configuredFieldCount: 1,
      missingFields: ['MICROSOFT_CLIENT_SECRET'],
    })
    expect(status.oauthClients.clients.slack).toMatchObject({
      state: 'absent',
      configuredFieldCount: 0,
    })
    expect(status.oauthClients.readyCount).toBe(1)
    expect(status.oauthClients.partialCount).toBe(1)
    expect(status.oauthClients.absentCount).toBe(Object.keys(OAUTH_CLIENT_CAPABILITIES).length - 2)
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

  it('counts singular runtime LLM keys as effective pool fallbacks', () => {
    const status = buildEnvCapabilityStatus({
      OPENAI_API_KEY: 'openai-fallback',
      GEMINI_API_KEY: 'gemini-fallback',
      COHERE_API_KEY: 'cohere-fallback',
    })

    expect(status.features.llm).toMatchObject({
      state: 'configured',
      configuredPoolCount: 3,
      configuredKeyCount: 3,
      effectiveKeyCount: 3,
    })
    expect(status.features.llm.pools.openai).toMatchObject({
      state: 'configured',
      fallbackKeyConfigured: true,
    })
    expect(status.features.llm.pools.gemini).toMatchObject({
      state: 'configured',
      fallbackKeyConfigured: true,
    })
    expect(status.features.llm.pools.cohere).toMatchObject({
      state: 'configured',
      fallbackKeyConfigured: true,
    })
    expect(JSON.stringify(status)).not.toContain('openai-fallback')
    expect(JSON.stringify(status)).not.toContain('gemini-fallback')
    expect(JSON.stringify(status)).not.toContain('cohere-fallback')
  })

  it('reports non-Redis cache URLs and non-HTTP Azure OCR endpoints as invalid', () => {
    const status = buildEnvCapabilityStatus({
      REDIS_URL: 'https://cache.example.com',
      OCR_PROVIDER: 'azure-mistral',
      OCR_AZURE_API_KEY: 'azure-key',
      OCR_AZURE_ENDPOINT: 'ftp://ocr.example.com',
      OCR_AZURE_MODEL_NAME: 'mistral-ocr',
    })

    expect(status.features.cache).toMatchObject({ state: 'invalid', providerId: 'redis' })
    expect(status.features.cache.issue?.message).toContain('redis:// or rediss://')
    expect(status.features.knowledge).toMatchObject({
      state: 'invalid',
      providerId: 'azure-mistral',
    })
    expect(status.features.knowledge.issue?.message).toContain(
      'OCR_AZURE_ENDPOINT must be a valid HTTP(S) URL'
    )
  })
})
