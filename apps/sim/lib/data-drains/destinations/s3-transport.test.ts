import dns from 'node:dns/promises'
import type { ClientRequest, IncomingMessage, RequestOptions } from 'node:http'
import https from 'node:https'
import { Readable, Writable } from 'node:stream'
import { setEnvFlags } from '@sim/testing/mocks/env-flags.mock'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { secureFetchWithPinnedIP } from '@/lib/core/security/input-validation.server'
import { s3Destination } from '@/lib/data-drains/destinations/s3'

const config = {
  bucket: 'audit-bucket',
  region: 'us-east-1',
  endpoint: 'https://storage.example.com',
}
const credentials = { accessKeyId: 'AKID', secretAccessKey: 'SECRET' }
const metadata = {
  drainId: 'drain',
  runId: 'run',
  source: 'audit_logs' as const,
  sequence: 0,
  rowCount: 1,
  runStartedAt: new Date('2025-06-15T12:00:00Z'),
}

const requests: RequestOptions[] = []

beforeEach(() => {
  vi.useFakeTimers()
  setEnvFlags({ isHosted: true })
  requests.length = 0
  vi.spyOn(https, 'request').mockImplementation(((
    options: RequestOptions,
    onResponse: (response: IncomingMessage) => void
  ) => {
    requests.push(options)
    const request = new Writable({
      write(_chunk, _encoding, callback) {
        callback()
      },
    })
    request.on('finish', () => {
      const response = Object.assign(Readable.from([]), { statusCode: 200, headers: {} })
      onResponse(response as IncomingMessage)
    })
    return request as ClientRequest
  }) as typeof https.request)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('S3 drain transport security', () => {
  it('preserves the signed object request target through the shared egress guard', async () => {
    const target = '/exports/../raw/audit_logs/event.ndjson?x-id=PutObject'
    const response = await secureFetchWithPinnedIP(
      `https://audit-bucket.storage.example.com${target}`,
      '1.1.1.1',
      {
        profile: 'configuredEndpoint',
        requestTarget: target,
        method: 'PUT',
        headers: { authorization: 'AWS4-HMAC-SHA256 signed-request' },
        body: '{"id":"event"}\n',
      }
    )
    await response.text()
    expect(requests[0].path).toBe(target)
    expect(requests[0].hostname).toBe('audit-bucket.storage.example.com')
    expect(requests[0].headers).toMatchObject({
      authorization: 'AWS4-HMAC-SHA256 signed-request',
    })
  })

  it.each(['https://other.example.com/object', '/object#fragment', '/object\r\nX-Injected: yes'])(
    'rejects an unsafe signed request target %j before making a connection',
    async (requestTarget) => {
      await expect(
        secureFetchWithPinnedIP('https://storage.example.com', '1.1.1.1', {
          profile: 'configuredEndpoint',
          requestTarget,
        })
      ).rejects.toThrow(/request target/i)
      expect(requests).toHaveLength(0)
    }
  )

  it('rejects a private bucket host even when the configured endpoint resolves publicly', async () => {
    vi.spyOn(dns, 'lookup').mockImplementation(async (host) => [
      { address: host.startsWith('audit-bucket.') ? '10.0.0.5' : '1.1.1.1', family: 4 },
    ])
    const session = s3Destination.openSession({ config, credentials })
    try {
      await expect(
        session.deliver({
          body: Buffer.from('{"id":"event"}\n'),
          contentType: 'application/x-ndjson',
          metadata,
          signal: new AbortController().signal,
        })
      ).rejects.toThrow(/private|reserved/)
      expect(requests).toHaveLength(0)
    } finally {
      await session.close()
    }
  })

  it('pins the checked address on the signed SDK request', async () => {
    const lookup = vi.spyOn(dns, 'lookup').mockResolvedValue([{ address: '1.1.1.1', family: 4 }])
    const session = s3Destination.openSession({ config, credentials })
    try {
      await session.deliver({
        body: Buffer.from('{"id":"event"}\n'),
        contentType: 'application/x-ndjson',
        metadata,
        signal: new AbortController().signal,
      })
      const [request] = requests
      expect(request.hostname ?? request.host).toBe('audit-bucket.storage.example.com')
      expect(request.headers).toMatchObject({
        host: 'audit-bucket.storage.example.com',
        authorization: expect.stringContaining('AWS4-HMAC-SHA256'),
      })
      lookup.mockResolvedValue([{ address: '10.0.0.5', family: 4 }])
      const connectionLookup = request.lookup
      expect(connectionLookup).toBeTypeOf('function')
      if (!connectionLookup) throw new Error('SDK transport did not pin its DNS lookup')
      const pinnedAddress = await new Promise<string>((resolve, reject) => {
        connectionLookup('audit-bucket.storage.example.com', { all: false }, (error, address) => {
          if (error) reject(error)
          else if (typeof address === 'string') resolve(address)
          else reject(new Error('Expected one pinned address'))
        })
      })
      expect(pinnedAddress).toBe('1.1.1.1')
    } finally {
      await session.close()
    }
  })
})
