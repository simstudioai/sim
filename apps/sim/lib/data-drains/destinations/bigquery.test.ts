/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetAccessToken, JWTCtor, loggerInstance } = vi.hoisted(() => {
  const mockGetAccessToken = vi.fn(async () => ({ token: 'bq-token' }))
  const loggerInstance = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
    withMetadata: vi.fn(),
  }
  return {
    mockGetAccessToken,
    JWTCtor: vi.fn(() => ({ getAccessToken: mockGetAccessToken })),
    loggerInstance,
  }
})

vi.mock('google-auth-library', () => ({ JWT: JWTCtor }))
vi.mock('@sim/logger', () => ({
  createLogger: () => loggerInstance,
  logger: loggerInstance,
  runWithRequestContext: <T>(_ctx: unknown, fn: () => T): T => fn(),
  getRequestContext: () => undefined,
}))
vi.mock('@sim/utils/helpers', () => ({
  sleep: vi.fn(async () => {}),
}))

const fetchMock = vi.fn(
  async () =>
    new Response(JSON.stringify({}), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
)
vi.stubGlobal('fetch', fetchMock)

import { bigqueryDestination } from '@/lib/data-drains/destinations/bigquery'

const config = { projectId: 'my-proj', datasetId: 'logs', tableId: 'workflow' }
const credentials = {
  serviceAccountJson: JSON.stringify({
    client_email: 'sa@p.iam.gserviceaccount.com',
    private_key: '-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n',
  }),
}

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
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({}), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  )
  mockGetAccessToken.mockResolvedValue({ token: 'bq-token' })
})

describe('bigqueryDestination', () => {
  it('posts rows with stable insertIds for dedup', async () => {
    const session = bigqueryDestination.openSession({ config, credentials })
    const body = Buffer.from(
      `${JSON.stringify({ id: 'a' })}\n${JSON.stringify({ id: 'b' })}\n`,
      'utf8'
    )
    const result = await session.deliver({
      body,
      contentType: 'application/x-ndjson',
      metadata: meta,
      signal: new AbortController().signal,
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/projects/my-proj/datasets/logs/tables/workflow/insertAll')
    const payload = JSON.parse(init.body as string)
    expect(payload.rows).toHaveLength(2)
    expect(payload.rows[0].insertId).toBe('d-r-0-0')
    expect(payload.rows[0].json).toEqual({ id: 'a' })
    expect(payload.rows[1].insertId).toBe('d-r-0-1')
    expect(result.locator).toBe('bigquery://my-proj/logs/workflow#r-0')
    await session.close()
  })

  it('throws with row indices and warns on partial-failure insertErrors', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          insertErrors: [
            { index: 1, errors: [{ message: 'invalid', reason: 'invalid' }] },
            { index: 2, errors: [{ message: 'bad', reason: 'invalid' }] },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    )
    const session = bigqueryDestination.openSession({ config, credentials })
    const body = Buffer.from(
      `${JSON.stringify({ x: 1 })}\n${JSON.stringify({ x: 2 })}\n${JSON.stringify({ x: 3 })}\n`
    )
    await expect(
      session.deliver({
        body,
        contentType: 'application/x-ndjson',
        metadata: meta,
        signal: new AbortController().signal,
      })
    ).rejects.toThrow(/partial failure.*1,2.*dedup-keyed by insertId/s)
    expect(loggerInstance.warn).toHaveBeenCalledWith(
      expect.stringContaining('partial failure'),
      expect.objectContaining({
        partialFailure: true,
        succeededRows: 1,
        failedRows: 2,
      })
    )
    await session.close()
  })

  it('test() probes table existence with a GET', async () => {
    await bigqueryDestination.test!({
      config,
      credentials,
      signal: new AbortController().signal,
    })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('?fields=id')
    expect(init.method).toBeUndefined()
  })

  it('throws a clear error when an NDJSON line is malformed', async () => {
    const session = bigqueryDestination.openSession({ config, credentials })
    const body = Buffer.from(`${JSON.stringify({ id: 'a' })}\n{not json}\n`, 'utf8')
    await expect(
      session.deliver({
        body,
        contentType: 'application/x-ndjson',
        metadata: meta,
        signal: new AbortController().signal,
      })
    ).rejects.toThrow(/NDJSON parse failed at line 2/)
    expect(fetchMock).not.toHaveBeenCalled()
    await session.close()
  })

  it('throws when an NDJSON row is not a JSON object', async () => {
    const session = bigqueryDestination.openSession({ config, credentials })
    const body = Buffer.from(`${JSON.stringify({ id: 'a' })}\n42\n`, 'utf8')
    await expect(
      session.deliver({
        body,
        contentType: 'application/x-ndjson',
        metadata: meta,
        signal: new AbortController().signal,
      })
    ).rejects.toThrow(/NDJSON row at line 2 is not an object/)
    await session.close()
  })

  it('parses NDJSON with CRLF line endings', async () => {
    const session = bigqueryDestination.openSession({ config, credentials })
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
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const payload = JSON.parse(init.body as string)
    expect(payload.rows).toHaveLength(2)
    expect(payload.rows[0].json).toEqual({ id: 'a' })
    expect(payload.rows[1].json).toEqual({ id: 'b' })
    await session.close()
  })

  it('insertId includes drainId prefix to avoid cross-drain collisions', async () => {
    const session = bigqueryDestination.openSession({ config, credentials })
    const body = Buffer.from(`${JSON.stringify({ id: 'a' })}\n`, 'utf8')
    await session.deliver({
      body,
      contentType: 'application/x-ndjson',
      metadata: { ...meta, drainId: 'drain-xyz', runId: 'run-1', sequence: 7 },
      signal: new AbortController().signal,
    })
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const payload = JSON.parse(init.body as string)
    expect(payload.rows[0].insertId).toBe('drain-xyz-run-1-7-0')
    await session.close()
  })

  it('retries 5xx responses with backoff, then succeeds', async () => {
    fetchMock.mockResolvedValueOnce(new Response('boom', { status: 503 })).mockResolvedValueOnce(
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )
    const session = bigqueryDestination.openSession({ config, credentials })
    await session.deliver({
      body: Buffer.from(`${JSON.stringify({ id: 'a' })}\n`),
      contentType: 'application/x-ndjson',
      metadata: meta,
      signal: new AbortController().signal,
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(loggerInstance.warn).toHaveBeenCalledWith(
      expect.stringContaining('transient error'),
      expect.objectContaining({ status: 503, attempt: 1 })
    )
    await session.close()
  })

  it('accepts domain-scoped project IDs', () => {
    const result = bigqueryDestination.configSchema.safeParse({
      projectId: 'example.com:my-project',
      datasetId: 'logs',
      tableId: 'workflow',
    })
    expect(result.success).toBe(true)
    const standard = bigqueryDestination.configSchema.safeParse({
      projectId: 'my-proj',
      datasetId: 'logs',
      tableId: 'workflow',
    })
    expect(standard.success).toBe(true)
  })

  it('test() throws when serviceAccountJson is missing required fields', async () => {
    await expect(
      bigqueryDestination.test!({
        config,
        credentials: {
          serviceAccountJson: JSON.stringify({
            client_email: 'sa@p.iam.gserviceaccount.com',
          }),
        },
        signal: new AbortController().signal,
      })
    ).rejects.toThrow(/missing private_key/)
    await expect(
      bigqueryDestination.test!({
        config,
        credentials: {
          serviceAccountJson: JSON.stringify({
            private_key: '-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n',
          }),
        },
        signal: new AbortController().signal,
      })
    ).rejects.toThrow(/missing client_email/)
  })
})
