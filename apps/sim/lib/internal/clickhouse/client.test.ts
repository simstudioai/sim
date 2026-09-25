import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClickHouseConnectionConfig } from '@/lib/internal/clickhouse/client'

const { mockValidateDatabaseHost, mockSecureFetchWithPinnedIP, mockValidateSqlWhereClause } =
  vi.hoisted(() => ({
    mockValidateDatabaseHost: vi.fn(),
    mockSecureFetchWithPinnedIP: vi.fn(),
    mockValidateSqlWhereClause: vi.fn(),
  }))

vi.mock('@/lib/core/security/input-validation.server', () => ({
  MAX_JSON_API_RESPONSE_BYTES: 10 * 1024 * 1024,
  validateDatabaseHost: mockValidateDatabaseHost,
  secureFetchWithPinnedIP: mockSecureFetchWithPinnedIP,
  validateSqlWhereClause: mockValidateSqlWhereClause,
}))

import { executeClickHouseQuery } from '@/lib/internal/clickhouse/sql'

function makeConfig(
  overrides: Partial<ClickHouseConnectionConfig> = {}
): ClickHouseConnectionConfig {
  return {
    host: 'clickhouse.example.com',
    port: 8123,
    database: 'default',
    username: 'default',
    password: 'secret',
    secure: false,
    ...overrides,
  }
}

function okResponse(body: string, summary?: string) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    text: async () => body,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'x-clickhouse-summary' ? (summary ?? null) : null,
    },
  }
}

describe('clickhouseRequest DNS pinning', () => {
  beforeEach(() => {
    mockValidateDatabaseHost.mockResolvedValue({
      isValid: true,
      resolvedIP: '93.184.216.34',
      originalHostname: 'clickhouse.example.com',
    })
    mockValidateSqlWhereClause.mockReturnValue({ isValid: true })
    mockSecureFetchWithPinnedIP.mockResolvedValue(okResponse('{"data":[{"x":1}],"rows":1}'))
  })

  it('pins the connection to the validated IP, not the attacker-controlled hostname', async () => {
    await executeClickHouseQuery(makeConfig({ host: 'rebind.attacker.example' }), 'SELECT 1')

    expect(mockValidateDatabaseHost).toHaveBeenCalledWith('rebind.attacker.example', 'host')
    expect(mockSecureFetchWithPinnedIP).toHaveBeenCalledTimes(1)

    const [url, pinnedIP, options] = mockSecureFetchWithPinnedIP.mock.calls[0]
    expect(pinnedIP).toBe('93.184.216.34')
    expect(url).toContain('rebind.attacker.example')
    expect(options.method).toBe('POST')
    expect(options.maxResponseBytes).toBe(10 * 1024 * 1024)
    expect(options.timeout).toBe(30_000)
    expect(options.redirectPolicy).toEqual({
      mode: 'standard',
      sendCredentialsOnCrossOriginRedirect: false,
      sensitiveHeaders: ['X-ClickHouse-User', 'X-ClickHouse-Key'],
    })
  })

  it('never issues the request when host validation fails (no SSRF window)', async () => {
    mockValidateDatabaseHost.mockResolvedValue({
      isValid: false,
      error: 'host resolves to a blocked IP address',
    })

    await expect(executeClickHouseQuery(makeConfig(), 'SELECT 1')).rejects.toThrow(
      'host resolves to a blocked IP address'
    )
    expect(mockSecureFetchWithPinnedIP).not.toHaveBeenCalled()
  })

  it('uses https and disallows http redirects when secure is true', async () => {
    await executeClickHouseQuery(makeConfig({ secure: true, port: 8443 }), 'SELECT 1')

    const [url, , options] = mockSecureFetchWithPinnedIP.mock.calls[0]
    expect(url).toMatch(/^https:\/\//)
    expect(options.profile).toBe('selfHostedService')
  })

  it('brackets an unbracketed IPv6 literal when constructing the request URL', async () => {
    mockValidateDatabaseHost.mockResolvedValue({
      isValid: true,
      resolvedIP: '2001:4860:4860::8888',
      originalHostname: '2001:4860:4860::8888',
    })

    await executeClickHouseQuery(makeConfig({ host: '2001:4860:4860::8888' }), 'SELECT 1')

    const [url, pinnedIP] = mockSecureFetchWithPinnedIP.mock.calls[0]
    expect(url).toMatch(/^http:\/\/\[2001:4860:4860::8888\]:8123\//)
    expect(pinnedIP).toBe('2001:4860:4860::8888')
  })
})
