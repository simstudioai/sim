import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }))

vi.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: class SecretsManagerClient {
    send = mockSend
  },
  GetSecretValueCommand: class GetSecretValueCommand {
    constructor(public input: unknown) {}
  },
}))

vi.mock('@sim/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))

vi.mock('@sim/utils/helpers', () => ({
  sleep: vi.fn().mockResolvedValue(undefined),
}))

import { loadRuntimeSecrets } from './index'

const TOUCHED = ['SIM_ENV_SECRET_ID', 'FOO', 'BAZ'] as const

describe('loadRuntimeSecrets', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    for (const key of TOUCHED) delete process.env[key]
  })

  afterEach(() => {
    for (const key of TOUCHED) delete process.env[key]
  })

  it('no-ops when SIM_ENV_SECRET_ID is unset', async () => {
    await loadRuntimeSecrets()
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('hydrates process.env from the parsed secret JSON', async () => {
    process.env.SIM_ENV_SECRET_ID = '/test/sim/env-vars'
    mockSend.mockResolvedValue({ SecretString: JSON.stringify({ FOO: 'bar', BAZ: 'qux' }) })

    await loadRuntimeSecrets()

    expect(process.env.FOO).toBe('bar')
    expect(process.env.BAZ).toBe('qux')
  })

  it('never overwrites an already-set env var', async () => {
    process.env.SIM_ENV_SECRET_ID = '/test/sim/env-vars'
    process.env.FOO = 'existing'
    mockSend.mockResolvedValue({ SecretString: JSON.stringify({ FOO: 'new', BAZ: 'qux' }) })

    await loadRuntimeSecrets()

    expect(process.env.FOO).toBe('existing')
    expect(process.env.BAZ).toBe('qux')
  })

  it('throws when the secret is not valid JSON', async () => {
    process.env.SIM_ENV_SECRET_ID = '/test/sim/env-vars'
    mockSend.mockResolvedValue({ SecretString: 'not json' })

    await expect(loadRuntimeSecrets()).rejects.toThrow(/not valid JSON/)
  })

  it('throws when the secret JSON is not an object', async () => {
    process.env.SIM_ENV_SECRET_ID = '/test/sim/env-vars'
    mockSend.mockResolvedValue({ SecretString: JSON.stringify(['a', 'b']) })

    await expect(loadRuntimeSecrets()).rejects.toThrow(/must be a JSON object/)
  })

  it('retries then throws when the fetch keeps failing', async () => {
    process.env.SIM_ENV_SECRET_ID = '/test/sim/env-vars'
    mockSend.mockRejectedValue(new Error('boom'))

    await expect(loadRuntimeSecrets()).rejects.toThrow(/Failed to fetch runtime secrets/)
    expect(mockSend).toHaveBeenCalledTimes(3)
  })
})
