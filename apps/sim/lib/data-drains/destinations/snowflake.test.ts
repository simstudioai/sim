/**
 * @vitest-environment node
 */
import { generateKeyPairSync } from 'node:crypto'
import { decodeJwt } from 'jose'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fetchMock = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }))
vi.stubGlobal('fetch', fetchMock)

import { snowflakeDestination } from '@/lib/data-drains/destinations/snowflake'

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
})

const config = {
  account: 'orgname-acct',
  user: 'sim_user',
  warehouse: 'WH',
  database: 'DB',
  schema: 'PUBLIC',
  table: 'DRAINS',
}
const credentials = { privateKey }

const meta = {
  drainId: 'd',
  runId: 'r',
  source: 'workflow_logs' as const,
  sequence: 0,
  rowCount: 2,
  runStartedAt: new Date('2025-06-15T12:00:00Z'),
}

beforeEach(() => {
  vi.clearAllMocks()
  fetchMock.mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }))
})

describe('snowflakeDestination', () => {
  it('posts a multi-row INSERT with TEXT bindings and a Bearer JWT', async () => {
    const session = snowflakeDestination.openSession({ config, credentials })
    const body = Buffer.from(
      `${JSON.stringify({ id: 'a' })}\n${JSON.stringify({ id: 'b' })}\n`,
      'utf8'
    )
    await session.deliver({
      body,
      contentType: 'application/x-ndjson',
      metadata: meta,
      signal: new AbortController().signal,
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toMatch(
      /^https:\/\/orgname-acct\.snowflakecomputing\.com\/api\/v2\/statements\?requestId=[0-9a-f-]+$/
    )
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toMatch(/^Bearer ey/)
    expect(headers['X-Snowflake-Authorization-Token-Type']).toBe('KEYPAIR_JWT')

    const payload = JSON.parse(init.body as string)
    expect(payload.statement).toContain('INSERT INTO "DB"."PUBLIC"."DRAINS"')
    expect(payload.statement).toContain('VALUES (PARSE_JSON(?)), (PARSE_JSON(?))')
    expect(payload.statement.match(/PARSE_JSON\(\?\)/g)).toHaveLength(2)
    expect(payload.bindings['1']).toEqual({ type: 'TEXT', value: JSON.stringify({ id: 'a' }) })
    expect(payload.bindings['2']).toEqual({ type: 'TEXT', value: JSON.stringify({ id: 'b' }) })
    expect(payload.warehouse).toBe('WH')
    await session.close()
  })

  it('uses the configured column when provided', async () => {
    const session = snowflakeDestination.openSession({
      config: { ...config, column: 'payload' },
      credentials,
    })
    await session.deliver({
      body: Buffer.from(`${JSON.stringify({ x: 1 })}\n`),
      contentType: 'application/x-ndjson',
      metadata: meta,
      signal: new AbortController().signal,
    })
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    const payload = JSON.parse(init.body as string)
    expect(payload.statement).toContain('("payload")')
    await session.close()
  })

  it('strips region/cloud suffix from the JWT iss/sub', async () => {
    const session = snowflakeDestination.openSession({
      config: { ...config, account: 'orgname-acct.us-east-1.aws' },
      credentials,
    })
    await session.deliver({
      body: Buffer.from(`${JSON.stringify({ x: 1 })}\n`),
      contentType: 'application/x-ndjson',
      metadata: meta,
      signal: new AbortController().signal,
    })
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    const headers = init.headers as Record<string, string>
    const token = headers.Authorization.replace(/^Bearer /, '')
    const claims = decodeJwt(token)
    expect(claims.sub).toBe('ORGNAME-ACCT.SIM_USER')
    expect(claims.iss).toMatch(/^ORGNAME-ACCT\.SIM_USER\.SHA256:/)
    await session.close()
  })

  it('polls /statements/{handle} when Snowflake returns 202', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ statementHandle: 'h-1' }), { status: 202 })
    )
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 202 }))
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }))
    const session = snowflakeDestination.openSession({ config, credentials })
    await session.deliver({
      body: Buffer.from(`${JSON.stringify({ x: 1 })}\n`),
      contentType: 'application/x-ndjson',
      metadata: meta,
      signal: new AbortController().signal,
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    const pollUrl = fetchMock.mock.calls[1]?.[0]
    expect(pollUrl).toBe('https://orgname-acct.snowflakecomputing.com/api/v2/statements/h-1')
    await session.close()
  })

  it('parses CRLF NDJSON bodies correctly', async () => {
    const session = snowflakeDestination.openSession({ config, credentials })
    const body = Buffer.from(
      `${JSON.stringify({ id: 'a' })}\r\n${JSON.stringify({ id: 'b' })}\r\n`,
      'utf8'
    )
    await session.deliver({
      body,
      contentType: 'application/x-ndjson',
      metadata: meta,
      signal: new AbortController().signal,
    })
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    const payload = JSON.parse(init.body as string)
    expect(payload.bindings['1']).toEqual({ type: 'TEXT', value: JSON.stringify({ id: 'a' }) })
    expect(payload.bindings['2']).toEqual({ type: 'TEXT', value: JSON.stringify({ id: 'b' }) })
    await session.close()
  })

  it('retries the POST on 5xx and succeeds on the next attempt', async () => {
    fetchMock.mockResolvedValueOnce(new Response('boom', { status: 503 }))
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }))
    const session = snowflakeDestination.openSession({ config, credentials })
    await session.deliver({
      body: Buffer.from(`${JSON.stringify({ x: 1 })}\n`),
      contentType: 'application/x-ndjson',
      metadata: meta,
      signal: new AbortController().signal,
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await session.close()
  })

  it('honors Retry-After (delta seconds) on 429 before retrying', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('slow down', { status: 429, headers: { 'Retry-After': '1' } })
    )
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }))
    const session = snowflakeDestination.openSession({ config, credentials })
    const start = Date.now()
    await session.deliver({
      body: Buffer.from(`${JSON.stringify({ x: 1 })}\n`),
      contentType: 'application/x-ndjson',
      metadata: meta,
      signal: new AbortController().signal,
    })
    const elapsed = Date.now() - start
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(elapsed).toBeGreaterThanOrEqual(900)
    await session.close()
  })

  it('throws a clear error when a binding exceeds the 16 MiB VARIANT limit', async () => {
    const session = snowflakeDestination.openSession({ config, credentials })
    const huge = `"${'a'.repeat(16 * 1024 * 1024 + 1)}"`
    const body = Buffer.from(`${huge}\n`, 'utf8')
    await expect(
      session.deliver({
        body,
        contentType: 'application/x-ndjson',
        metadata: meta,
        signal: new AbortController().signal,
      })
    ).rejects.toThrow(/16 MB/)
    expect(fetchMock).not.toHaveBeenCalled()
    await session.close()
  })

  it('test() runs SELECT 1', async () => {
    await snowflakeDestination.test!({
      config,
      credentials,
      signal: new AbortController().signal,
    })
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    const payload = JSON.parse(init.body as string)
    expect(payload.statement).toBe('SELECT 1')
  })
})
