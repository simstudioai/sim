/** @vitest-environment node */
import { createLogger } from '@sim/logger'
import { syncEnvVars } from '@trigger.dev/build/extensions/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  readWorkerConfiguration,
  selectWorkerConfiguration,
  syncWorkerEnvironment,
} from '@/scripts/trigger-env-sync'

const aws = vi.hoisted(() => ({
  send: vi.fn(),
  client: vi.fn(),
  command: vi.fn(),
  destroy: vi.fn(),
}))
vi.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: class {
    constructor(options: unknown) {
      aws.client(options)
    }
    send = aws.send
    destroy = aws.destroy
  },
  GetSecretValueCommand: class {
    constructor(input: unknown) {
      aws.command(input)
    }
  },
}))

const deployment = { expectedProjectRef: 'proj_test', region: 'us-east-1' }
const context = {
  projectRef: 'proj_test',
  environment: 'preview',
  branch: 'dev-sim',
  env: { DATABASE_URL: 'postgresql://worker.invalid/sim', SIM_DB_ROLE: 'web' },
}
const core = {
  BETTER_AUTH_SECRET: 'test-auth-key-'.repeat(3),
  ENCRYPTION_KEY: 'a'.repeat(64),
  INTERNAL_API_SECRET: 'test-internal-key-'.repeat(3),
  BETTER_AUTH_URL: 'https://dev.sim.ai',
  NEXT_PUBLIC_APP_URL: 'https://dev.sim.ai',
  BILLING_ENABLED: false,
  ENTERPRISE_ENABLED: false,
}
const sentinel = 'FAKE_SECRET_MUST_NOT_APPEAR_IN_ERRORS'
const syncLogger =
  vi.mocked(createLogger).mock.results[
    vi.mocked(createLogger).mock.calls.findIndex(([name]) => name === 'TriggerEnvSync')
  ].value

beforeEach(() => {
  vi.clearAllMocks()
  aws.send.mockReset().mockResolvedValue({ SecretString: JSON.stringify(core) })
})
afterEach(() => vi.restoreAllMocks())

describe('target mapping', () => {
  it.each([
    ['preview', 'dev-sim', '/dev/sim/env-vars'],
    ['staging', undefined, '/staging/sim/env-vars'],
    ['prod', undefined, '/production/sim/env-vars'],
  ])('maps %s without inheriting a preview parent', async (environment, branch, SecretId) => {
    await readWorkerConfiguration({ ...context, environment: environment!, branch }, deployment)
    expect(aws.command).toHaveBeenCalledWith({ SecretId, VersionStage: 'AWSCURRENT' })
  })

  it.each([
    { projectRef: 'wrong-project' },
    { environment: 'production', branch: undefined },
    { environment: 'dev', branch: undefined },
    { branch: 'unknown' },
    { branch: undefined },
    { environment: 'staging', branch: 'dev-sim' },
    { environment: 'prod', branch: 'dev-sim' },
  ])('rejects mismatched target before AWS access: %j', async (overrides) => {
    await expect(
      readWorkerConfiguration({ ...context, ...overrides }, deployment)
    ).rejects.toThrow()
    expect(aws.client).not.toHaveBeenCalled()
  })

  it.each([{ region: undefined }, { region: 'invalid' }, { expectedProjectRef: undefined }])(
    'requires explicit deployment configuration: %j',
    async (overrides) => {
      await expect(
        readWorkerConfiguration(context, { ...deployment, ...overrides })
      ).rejects.toThrow()
      expect(aws.client).not.toHaveBeenCalled()
    }
  )
})

describe('selection and ownership', () => {
  it('selects only approved platform names and preserves worker-owned and unrelated configuration', () => {
    const current = {
      ...context.env,
      DATABASE_URL_TRIGGER: 'postgresql://private.invalid/sim',
      REDIS_URL: 'rediss://cache.invalid:6379',
      REDIS_TLS_SERVERNAME: 'cache.invalid',
      PII_URL: 'https://pii.worker.invalid',
      GRAFANA_OTLP_HEADERS: 'worker-only',
      OPENAI_API_KEY: 'existing-optional',
      UNRELATED_SETTING: 'unrelated',
    }
    const before = { ...current }
    const result = selectWorkerConfiguration(
      {
        ...core,
        DATABASE_URL: sentinel,
        REDIS_URL: sentinel,
        PII_URL: sentinel,
        SIM_DB_ROLE: 'trigger',
        GRAFANA_OTLP_HEADERS: sentinel,
        TRIGGER_SECRET_KEY: sentinel,
        TRIGGER_DEV_ENABLED: true,
        TRIGGER_ACCESS_TOKEN: sentinel,
        GITHUB_TOKEN: sentinel,
        CUSTOMER_API_KEY: sentinel,
        WORKSPACE_ENVIRONMENT: sentinel,
        SIM_ENV_SECRET_ID: sentinel,
        AWS_SESSION_TOKEN: sentinel,
        UNRELATED_SETTING: sentinel,
        GOOGLE_CLIENT_ID: 'client-id',
        GOOGLE_CLIENT_SECRET: 'client-secret',
        RESEND_API_KEY: '  exact-value  ',
      },
      current,
      'preview/dev-sim'
    )
    expect(result.variables).toEqual(
      expect.arrayContaining([
        { name: 'DB_APP_NAME', value: 'sim-trigger', isSecret: false },
        { name: 'GOOGLE_CLIENT_ID', value: 'client-id', isSecret: false },
        { name: 'GOOGLE_CLIENT_SECRET', value: 'client-secret', isSecret: true },
        { name: 'RESEND_API_KEY', value: '  exact-value  ', isSecret: true },
      ])
    )
    expect(JSON.stringify(result.variables)).not.toContain(sentinel)
    expect(result.variables.some(({ name }) => Object.hasOwn(current, name))).toBe(false)
    expect(result.omitted).toEqual(['OPENAI_API_KEY'])
    expect(current).toEqual(before)
  })
})

describe('requiredness', () => {
  it.each([
    'BETTER_AUTH_SECRET',
    'ENCRYPTION_KEY',
    'INTERNAL_API_SECRET',
    'BETTER_AUTH_URL',
    'NEXT_PUBLIC_APP_URL',
    'BILLING_ENABLED',
    'ENTERPRISE_ENABLED',
  ] as const)('rejects absent or blank core %s even when Trigger already has it', (name) => {
    for (const value of [undefined, '   ']) {
      expect(() =>
        selectWorkerConfiguration(
          { ...core, [name]: value },
          { ...context.env, [name]: String(core[name]) },
          'staging'
        )
      ).toThrow(name)
    }
  })

  it('requires a usable effective database without changing the existing pool role', () => {
    expect(() => selectWorkerConfiguration(core, {}, 'prod')).toThrow('database')
    expect(() =>
      selectWorkerConfiguration(
        core,
        {
          DATABASE_URL: 'postgresql://base.invalid/db',
          SIM_DB_ROLE: 'trigger',
          DATABASE_URL_TRIGGER: '',
        },
        'prod'
      )
    ).toThrow('database')
    expect(() =>
      selectWorkerConfiguration(
        core,
        { SIM_DB_ROLE: 'trigger', DATABASE_URL_TRIGGER: 'postgresql://private.invalid/db' },
        'prod'
      )
    ).not.toThrow()
  })

  it('rejects incomplete active capabilities even if existing values could mask the missing source', () => {
    expect(() =>
      selectWorkerConfiguration(
        { ...core, SMTP_HOST: 'smtp.invalid' },
        { ...context.env, SMTP_PORT: '587' },
        'staging'
      )
    ).toThrow('capability')
  })

  it('rejects preserved settings that would silently select a different backend', () => {
    expect(() =>
      selectWorkerConfiguration(
        { ...core, S3_BUCKET_NAME: 'files', AWS_REGION: 'us-east-1' },
        { ...context.env, STORAGE_PROVIDER: 'local' },
        'staging'
      )
    ).toThrow('preserved-provider-conflict')
  })

  it('allows absent optional capabilities, preserves false/zero, and serializes JSON credentials', () => {
    const result = selectWorkerConfiguration(
      {
        ...core,
        FREE_TIER_COST_LIMIT: 0,
        GMAIL_CREDENTIALS_JSON: { client_email: 'test@example.invalid', private_key: 'fake' },
        GMAIL_SENDER: 'test@example.invalid',
      },
      context.env,
      'staging'
    )
    expect(result.variables).toEqual(
      expect.arrayContaining([
        { name: 'BILLING_ENABLED', value: 'false', isSecret: false },
        { name: 'FREE_TIER_COST_LIMIT', value: '0', isSecret: false },
        {
          name: 'GMAIL_CREDENTIALS_JSON',
          value: JSON.stringify({ client_email: 'test@example.invalid', private_key: 'fake' }),
          isSecret: true,
        },
      ])
    )
  })
})

describe('source failures', () => {
  it.each([
    { SecretString: `${sentinel}{` },
    { SecretString: '[]' },
    { SecretString: 'null' },
    { SecretString: JSON.stringify(sentinel) },
    { SecretBinary: new Uint8Array([1]) },
  ])('sanitizes unsupported responses', async (response) => {
    aws.send.mockResolvedValue(response)
    await expect(readWorkerConfiguration(context, deployment)).rejects.toThrow(
      /^Worker configuration sync failed: secret-/
    )
    expect(aws.destroy).toHaveBeenCalledOnce()
  })

  it('does not expose AWS rejection text or malformed selector values', async () => {
    aws.send.mockRejectedValue(new Error(sentinel))
    await expect(readWorkerConfiguration(context, deployment)).rejects.toThrow(
      'Worker configuration sync failed: aws-fetch'
    )
    expect(() =>
      selectWorkerConfiguration({ ...core, STORAGE_PROVIDER: sentinel }, context.env, 'prod')
    ).toThrow(/^Worker configuration sync failed: capability \([A-Z0-9_, ]+\)$/)
  })
})

describe('AWS request boundary', () => {
  it('uses explicit region and AWSCURRENT with bounded retries and leaves process.env alone', async () => {
    vi.stubEnv('AWS_REGION', 'eu-west-1')
    vi.stubEnv('RESEND_API_KEY', sentinel)
    const before = { ...process.env }
    const result = await readWorkerConfiguration(context, deployment)
    expect(aws.client).toHaveBeenCalledWith({ region: 'us-east-1', maxAttempts: 3 })
    expect(aws.command).toHaveBeenCalledWith({
      SecretId: '/dev/sim/env-vars',
      VersionStage: 'AWSCURRENT',
    })
    expect(aws.send.mock.calls[0][1].abortSignal).toBeInstanceOf(AbortSignal)
    expect(aws.destroy).toHaveBeenCalledOnce()
    expect(Object.keys(process.env)).toEqual(Object.keys(before))
    expect(Object.keys(before).every((name) => process.env[name] === before[name])).toBe(true)
    expect(result.variables.some(({ name }) => name === 'RESEND_API_KEY')).toBe(false)
  })
})

describe('fatal integration boundary', () => {
  it('requests exit(1) inside the pinned extension, which swallows thrown callback errors', async () => {
    vi.stubEnv('SIM_TRIGGER_ENV_SYNC_PROJECT_REF', deployment.expectedProjectRef)
    vi.stubEnv('SIM_TRIGGER_ENV_SYNC_REGION', deployment.region)
    aws.send.mockRejectedValue(new Error(sentinel))
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('intercepted exit')
    })
    const extension = syncEnvVars(syncWorkerEnvironment)
    const buildContext = {
      target: 'deploy',
      config: { project: context.projectRef },
      logger: { spinner: () => ({ stop: vi.fn() }), warn: vi.fn() },
      addLayer: vi.fn(),
    }
    const manifest = {
      deploy: { env: context.env },
      environment: context.environment,
      branch: context.branch,
    }
    await extension.onBuildComplete!(
      buildContext as Parameters<NonNullable<typeof extension.onBuildComplete>>[0],
      manifest as Parameters<NonNullable<typeof extension.onBuildComplete>>[1]
    )
    expect(exit).toHaveBeenCalledWith(1)
    expect(buildContext.addLayer).not.toHaveBeenCalled()
    expect(JSON.stringify(buildContext.logger.warn.mock.calls)).not.toContain(sentinel)
    expect(syncLogger.error).toHaveBeenCalledWith(
      'Worker configuration sync failed; deployment aborted',
      { category: 'aws-fetch', names: [] }
    )
    expect(JSON.stringify(vi.mocked(syncLogger.error).mock.calls)).not.toContain(sentinel)
  })
})
