/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetAccessToken, JWTCtor } = vi.hoisted(() => {
  const mockGetAccessToken = vi.fn(async () => ({ token: 'fake-access-token' }))
  return {
    mockGetAccessToken,
    JWTCtor: vi.fn(() => ({ getAccessToken: mockGetAccessToken })),
  }
})

vi.mock('google-auth-library', () => ({ JWT: JWTCtor }))

const fetchMock = vi.fn(async () => new Response(null, { status: 200 }))
vi.stubGlobal('fetch', fetchMock)

import { gcsDestination } from '@/lib/data-drains/destinations/gcs'

const config = { bucket: 'my-bucket', prefix: 'sim/' }
const credentials = {
  serviceAccountJson: JSON.stringify({
    client_email: 'sa@project.iam.gserviceaccount.com',
    private_key: '-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n',
  }),
}

beforeEach(() => {
  vi.clearAllMocks()
  fetchMock.mockResolvedValue(new Response(null, { status: 200 }))
})

describe('gcsDestination openSession', () => {
  it('uploads via the JSON API and returns a gs:// locator', async () => {
    const session = gcsDestination.openSession({ config, credentials })
    const body = Buffer.from('row\n', 'utf8')
    const result = await session.deliver({
      body,
      contentType: 'application/x-ndjson',
      metadata: {
        drainId: 'd1',
        runId: 'r1',
        source: 'workflow_logs',
        sequence: 0,
        rowCount: 1,
        runStartedAt: new Date('2025-06-15T12:00:00Z'),
      },
      signal: new AbortController().signal,
    })

    expect(result.locator).toMatch(
      /^gs:\/\/my-bucket\/sim\/workflow_logs\/d1\/\d{4}\/\d{2}\/\d{2}\/r1-00000\.ndjson$/
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/upload/storage/v1/b/my-bucket/o')
    expect(url).toContain('uploadType=media')
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer fake-access-token')
    expect(headers['Content-Type']).toBe('application/x-ndjson')
    expect(headers['x-goog-meta-sim-drain-id']).toBe('d1')
    expect(headers['x-goog-meta-sim-sequence']).toBe('0')

    await session.close()
  })

  it('surfaces non-2xx responses as errors', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('Permission denied', { status: 403, statusText: 'Forbidden' })
    )
    const session = gcsDestination.openSession({ config, credentials })
    await expect(
      session.deliver({
        body: Buffer.from('x'),
        contentType: 'application/x-ndjson',
        metadata: {
          drainId: 'd',
          runId: 'r',
          source: 'audit_logs',
          sequence: 0,
          rowCount: 1,
          runStartedAt: new Date('2025-06-15T12:00:00Z'),
        },
        signal: new AbortController().signal,
      })
    ).rejects.toThrow(/HTTP 403/)
    await session.close()
  })
})

describe('gcsDestination test()', () => {
  it('writes a probe object then attempts cleanup', async () => {
    await gcsDestination.test!({
      config,
      credentials,
      signal: new AbortController().signal,
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [, deleteCall] = fetchMock.mock.calls
    expect((deleteCall[1] as RequestInit).method).toBe('DELETE')
  })
})

describe('gcsDestination credentials schema', () => {
  it('rejects invalid JSON', () => {
    const result = gcsDestination.credentialsSchema.safeParse({ serviceAccountJson: 'not-json' })
    expect(result.success).toBe(false)
  })

  it('rejects JSON missing client_email', () => {
    const result = gcsDestination.credentialsSchema.safeParse({
      serviceAccountJson: JSON.stringify({ private_key: 'k' }),
    })
    expect(result.success).toBe(false)
  })
})

describe('gcsDestination config schema', () => {
  it('accepts a 3-character bucket name', () => {
    const result = gcsDestination.configSchema.safeParse({ bucket: 'abc' })
    expect(result.success).toBe(true)
  })

  it('rejects bucket names beginning with goog or containing google', () => {
    expect(gcsDestination.configSchema.safeParse({ bucket: 'goog-prefixed' }).success).toBe(false)
    expect(gcsDestination.configSchema.safeParse({ bucket: 'my-google-bucket' }).success).toBe(
      false
    )
    expect(gcsDestination.configSchema.safeParse({ bucket: 'g00gle-bucket' }).success).toBe(false)
  })
})

describe('gcsDestination upload headers', () => {
  it('does not set a Content-Length header on uploads', async () => {
    const session = gcsDestination.openSession({ config, credentials })
    await session.deliver({
      body: Buffer.from('row\n', 'utf8'),
      contentType: 'application/x-ndjson',
      metadata: {
        drainId: 'd1',
        runId: 'r1',
        source: 'workflow_logs',
        sequence: 0,
        rowCount: 1,
        runStartedAt: new Date('2025-06-15T12:00:00Z'),
      },
      signal: new AbortController().signal,
    })
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    const headerKeys = Object.keys(headers).map((k) => k.toLowerCase())
    expect(headerKeys).not.toContain('content-length')
    expect(headers['User-Agent']).toBe('sim-data-drain/1.0')
    await session.close()
  })
})

describe('gcsDestination deleteObject behavior', () => {
  it('treats 404 as success on delete during test() cleanup', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 })) // upload probe
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 })) // delete probe
    await expect(
      gcsDestination.test!({
        config,
        credentials,
        signal: new AbortController().signal,
      })
    ).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('retries DELETE on 503 then succeeds on 200', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 })) // upload probe
    fetchMock.mockResolvedValueOnce(new Response('busy', { status: 503 })) // first delete attempt
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 })) // retry succeeds
    await gcsDestination.test!({
      config,
      credentials,
      signal: new AbortController().signal,
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    const [, deleteCall1] = fetchMock.mock.calls[1] as [string, RequestInit]
    const [, deleteCall2] = fetchMock.mock.calls[2] as [string, RequestInit]
    expect(deleteCall1.method).toBe('DELETE')
    expect(deleteCall2.method).toBe('DELETE')
  })
})
