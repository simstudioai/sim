/**
 * @vitest-environment node
 */
import { createHmac } from 'node:crypto'
import { inputValidationMock, inputValidationMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)

import { webhookDestination } from '@/lib/data-drains/destinations/webhook'

const config = { url: 'https://example.com/hook' }
const credentials = { signingSecret: 'super-secret-key' }
const metadata = {
  drainId: 'd1',
  runId: 'r1',
  source: 'workflow_logs' as const,
  sequence: 3,
  rowCount: 5,
}

function mockPinnedFetchOnce(response: { ok: boolean; status: number; headers?: Headers }) {
  inputValidationMockFns.mockSecureFetchWithPinnedIP.mockResolvedValueOnce({
    ok: response.ok,
    status: response.status,
    statusText: '',
    headers: response.headers ?? new Headers(),
    text: async () => '',
    json: async () => ({}),
    arrayBuffer: async () => new ArrayBuffer(0),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  inputValidationMockFns.mockValidateUrlWithDNS.mockResolvedValue({
    isValid: true,
    resolvedIP: '93.184.216.34',
    originalHostname: 'example.com',
  })
})

describe('webhookDestination openSession', () => {
  it('signs the body with HMAC-SHA256 over `<ts>.<body>`', async () => {
    mockPinnedFetchOnce({ ok: true, status: 200 })
    const session = webhookDestination.openSession({ config, credentials })
    const body = Buffer.from('{"id":1}\n', 'utf8')

    await session.deliver({
      body,
      contentType: 'application/x-ndjson',
      metadata,
      signal: new AbortController().signal,
    })

    const call = inputValidationMockFns.mockSecureFetchWithPinnedIP.mock.calls[0]
    const [calledUrl, pinnedIP, init] = call
    expect(calledUrl).toBe('https://example.com/hook')
    expect(pinnedIP).toBe('93.184.216.34')
    const headers = init.headers as Record<string, string>
    expect(headers['Content-Type']).toBe('application/x-ndjson')
    expect(headers['X-Sim-Drain-Id']).toBe('d1')
    expect(headers['X-Sim-Run-Id']).toBe('r1')
    expect(headers['X-Sim-Sequence']).toBe('3')
    expect(headers['Idempotency-Key']).toBe('r1-3')

    const sig = headers['X-Sim-Signature']
    const tsPart = sig.match(/t=(\d+)/)![1]
    const v1Part = sig.match(/v1=([0-9a-f]+)/)![1]
    const expected = createHmac('sha256', credentials.signingSecret)
      .update(`${tsPart}.`)
      .update(body)
      .digest('hex')
    expect(v1Part).toBe(expected)

    await session.close()
  })

  it('retries on 5xx and succeeds', async () => {
    mockPinnedFetchOnce({ ok: false, status: 503 })
    mockPinnedFetchOnce({ ok: true, status: 200 })
    vi.spyOn(global, 'setTimeout').mockImplementation(((fn: () => void) => {
      fn()
      return 0 as unknown as NodeJS.Timeout
    }) as never)

    const session = webhookDestination.openSession({ config, credentials })
    const result = await session.deliver({
      body: Buffer.from('x'),
      contentType: 'application/x-ndjson',
      metadata,
      signal: new AbortController().signal,
    })
    expect(result.locator).toContain('https://example.com/hook')
    expect(inputValidationMockFns.mockSecureFetchWithPinnedIP).toHaveBeenCalledTimes(2)
  })

  it('does not retry on 4xx (other than 408/429)', async () => {
    mockPinnedFetchOnce({ ok: false, status: 401 })
    const session = webhookDestination.openSession({ config, credentials })
    await expect(
      session.deliver({
        body: Buffer.from('x'),
        contentType: 'application/x-ndjson',
        metadata,
        signal: new AbortController().signal,
      })
    ).rejects.toThrow(/HTTP 401/)
    expect(inputValidationMockFns.mockSecureFetchWithPinnedIP).toHaveBeenCalledTimes(1)
  })

  it('rejects when DNS resolves to a blocked IP', async () => {
    inputValidationMockFns.mockValidateUrlWithDNS.mockResolvedValueOnce({
      isValid: false,
      error: 'url resolves to a blocked IP address',
    })
    const session = webhookDestination.openSession({ config, credentials })
    await expect(
      session.deliver({
        body: Buffer.from('x'),
        contentType: 'application/x-ndjson',
        metadata,
        signal: new AbortController().signal,
      })
    ).rejects.toThrow(/blocked IP/)
    expect(inputValidationMockFns.mockSecureFetchWithPinnedIP).not.toHaveBeenCalled()
  })

  it('reuses the same pinned IP across deliveries (no DNS rebinding window)', async () => {
    mockPinnedFetchOnce({ ok: true, status: 200 })
    mockPinnedFetchOnce({ ok: true, status: 200 })
    const session = webhookDestination.openSession({ config, credentials })
    const signal = new AbortController().signal
    await session.deliver({
      body: Buffer.from('x'),
      contentType: 'application/x-ndjson',
      metadata,
      signal,
    })
    await session.deliver({
      body: Buffer.from('y'),
      contentType: 'application/x-ndjson',
      metadata: { ...metadata, sequence: 4 },
      signal,
    })
    expect(inputValidationMockFns.mockValidateUrlWithDNS).toHaveBeenCalledTimes(1)
    const calls = inputValidationMockFns.mockSecureFetchWithPinnedIP.mock.calls
    expect(calls[0][1]).toBe('93.184.216.34')
    expect(calls[1][1]).toBe('93.184.216.34')
  })

  it('rejects every header buildHeaders writes when reused as signatureHeader (drift guard)', async () => {
    mockPinnedFetchOnce({ ok: true, status: 200 })
    const session = webhookDestination.openSession({ config, credentials })
    await session.deliver({
      body: Buffer.from('x'),
      contentType: 'application/x-ndjson',
      metadata,
      signal: new AbortController().signal,
    })

    const init = inputValidationMockFns.mockSecureFetchWithPinnedIP.mock.calls[0][2]
    const writtenHeaders = Object.keys(init.headers as Record<string, string>)

    for (const name of writtenHeaders) {
      const result = webhookDestination.configSchema.safeParse({
        url: 'https://example.com/hook',
        signatureHeader: name,
      })
      expect(
        result.success,
        `expected signatureHeader="${name}" to be rejected (it is written by buildHeaders)`
      ).toBe(false)
    }
  })
})
