/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClickHouseConnectionConfig } from '@/tools/clickhouse/types'

const { mockValidateDatabaseHost, mockSecureFetchWithPinnedIP, mockValidateSqlWhereClause } =
  vi.hoisted(() => ({
    mockValidateDatabaseHost: vi.fn(),
    mockSecureFetchWithPinnedIP: vi.fn(),
    mockValidateSqlWhereClause: vi.fn(),
  }))

vi.mock('@/lib/core/security/input-validation.server', () => ({
  validateDatabaseHost: mockValidateDatabaseHost,
  secureFetchWithPinnedIP: mockSecureFetchWithPinnedIP,
  validateSqlWhereClause: mockValidateSqlWhereClause,
}))

import { executeClickHouseInsert, executeClickHouseQuery } from '@/app/api/tools/clickhouse/utils'

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
    vi.clearAllMocks()
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
    // The actual TCP target is the validated IP — re-resolution of the hostname can never happen.
    expect(pinnedIP).toBe('93.184.216.34')
    // The hostname is preserved only in the URL (for Host header / TLS SNI), never used to connect.
    expect(url).toContain('rebind.attacker.example')
    expect(options.method).toBe('POST')
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
    expect(options.allowHttp).toBe(false)
  })

  it('allows http for the initial request when secure is false', async () => {
    await executeClickHouseQuery(makeConfig({ secure: false }), 'SELECT 1')

    const [url, , options] = mockSecureFetchWithPinnedIP.mock.calls[0]
    expect(url).toMatch(/^http:\/\//)
    expect(options.allowHttp).toBe(true)
  })

  it('sends the statement as the body with a matching Content-Length and auth headers', async () => {
    await executeClickHouseInsert(makeConfig(), 'events', { id: 1 })

    const [, , options] = mockSecureFetchWithPinnedIP.mock.calls[0]
    expect(options.body).toContain('INSERT INTO `events` FORMAT JSONEachRow')
    expect(options.headers['Content-Length']).toBe(String(Buffer.byteLength(options.body, 'utf-8')))
    expect(options.headers['X-ClickHouse-User']).toBe('default')
    expect(options.headers['X-ClickHouse-Key']).toBe('secret')
  })

  it('propagates non-ok responses as errors with the body text', async () => {
    mockSecureFetchWithPinnedIP.mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      text: async () => 'Code: 62. DB::Exception: Syntax error',
      headers: { get: () => null },
    })

    await expect(executeClickHouseQuery(makeConfig(), 'SELECT 1')).rejects.toThrow(
      'Code: 62. DB::Exception: Syntax error'
    )
  })
})
