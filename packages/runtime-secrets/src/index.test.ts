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
    for (const key of TOUCHED) delete process.env[key]
  })

  afterEach(() => {
    for (const key of TOUCHED) delete process.env[key]
  })

  it('never overwrites an already-set env var', async () => {
    process.env.SIM_ENV_SECRET_ID = '/test/sim/env-vars'
    process.env.FOO = 'existing'
    mockSend.mockResolvedValue({ SecretString: JSON.stringify({ FOO: 'new', BAZ: 'qux' }) })

    await loadRuntimeSecrets()

    expect(process.env.FOO).toBe('existing')
    expect(process.env.BAZ).toBe('qux')
  })

  it('throws immediately on a binary secret (no SecretString), without retrying', async () => {
    process.env.SIM_ENV_SECRET_ID = '/test/sim/env-vars'
    mockSend.mockResolvedValue({})

    await expect(loadRuntimeSecrets()).rejects.toThrow(/binary secrets/)
    expect(mockSend).toHaveBeenCalledTimes(1)
  })
})
