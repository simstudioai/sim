/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PostgresConnectionConfig } from '@/tools/postgresql/types'

const { mockValidateDatabaseHost, mockPostgres } = vi.hoisted(() => ({
  mockValidateDatabaseHost: vi.fn(),
  mockPostgres: vi.fn(() => ({})),
}))

vi.mock('postgres', () => ({ default: mockPostgres }))

vi.mock('@/lib/core/security/input-validation.server', () => ({
  validateDatabaseHost: mockValidateDatabaseHost,
}))

import { createPostgresConnection } from '@/app/api/tools/postgresql/utils'

function makeConfig(overrides: Partial<PostgresConnectionConfig> = {}): PostgresConnectionConfig {
  return {
    host: 'db.example.com',
    port: 5432,
    database: 'app',
    username: 'app',
    password: 'secret',
    ssl: 'required',
    ...overrides,
  }
}

describe('createPostgresConnection DNS pinning', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockValidateDatabaseHost.mockResolvedValue({
      isValid: true,
      resolvedIP: '93.184.216.34',
      originalHostname: 'db.example.com',
    })
  })

  it('never opens a connection when host validation fails (no SSRF window)', async () => {
    mockValidateDatabaseHost.mockResolvedValue({
      isValid: false,
      error: 'host resolves to a blocked IP address',
    })

    await expect(
      createPostgresConnection(makeConfig({ host: 'rebind.attacker.example' }))
    ).rejects.toThrow('host resolves to a blocked IP address')
    expect(mockPostgres).not.toHaveBeenCalled()
  })

  it.each(['disabled', 'required', 'preferred'] as const)(
    'connects to the validated IP for ssl=%s (hostname never re-resolved)',
    async (ssl) => {
      await createPostgresConnection(makeConfig({ host: 'rebind.attacker.example', ssl }))

      expect(mockValidateDatabaseHost).toHaveBeenCalledWith('rebind.attacker.example', 'host')
      const options = mockPostgres.mock.calls[0][0]
      // The TCP target is always the validated IP — re-resolution can never happen.
      expect(options.host).toBe('93.184.216.34')
    }
  )

  it('preserves the hostname as the TLS servername for verifying ssl modes', async () => {
    await createPostgresConnection(makeConfig({ host: 'db.example.com', ssl: 'required' }))

    const options = mockPostgres.mock.calls[0][0]
    expect(options.host).toBe('93.184.216.34')
    expect(options.ssl).toMatchObject({ servername: 'db.example.com' })
  })
})
