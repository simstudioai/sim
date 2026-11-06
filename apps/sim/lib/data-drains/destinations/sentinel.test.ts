import { jsonResponse } from '@sim/testing/helpers/http'
import {
  inputValidationMock,
  inputValidationMockFns,
} from '@sim/testing/mocks/input-validation.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)

import { sentinelDestination } from '@/lib/data-drains/destinations/sentinel'
import { SOURCE_TYPES } from '@/lib/data-drains/types'

const config = {
  endpoint: 'https://sim-logs.eastus-1.ingest.monitor.azure.com',
  ruleId: 'dcr-0123456789abcdef0123456789abcdef',
  streamName: 'Custom-SimLogs',
  tenantId: '11111111-1111-4111-8111-111111111111',
  clientId: '22222222-2222-4222-8222-222222222222',
}
const credentials = { clientSecret: 'private-client-secret&+' }
const metadata = {
  drainId: 'drain-1',
  runId: 'run-1',
  source: 'audit_logs' as const,
  sequence: 0,
  rowCount: 1,
  runStartedAt: new Date('2026-10-16T12:00:00Z'),
}
const row = { id: 'event-1', createdAt: '2026-10-15T12:00:00Z', action: 'workflow.updated' }
const network = inputValidationMockFns.mockSecureFetchWithPinnedIP

function delivery(rows: Record<string, unknown>[] = [row]) {
  return {
    body: Buffer.from(`${rows.map((value) => JSON.stringify(value)).join('\n')}\n`),
    contentType: 'application/x-ndjson' as const,
    metadata: { ...metadata, rowCount: rows.length },
    signal: new AbortController().signal,
  }
}

beforeEach(() => {
  inputValidationMockFns.mockValidateUrlWithDNS.mockReset()
  inputValidationMockFns.mockValidateUrlWithDNS.mockResolvedValue({
    isValid: true,
    resolvedIP: '20.1.2.3',
  })
  network.mockReset()
  network.mockResolvedValue(new Response(null, { status: 204 }))
  network.mockResolvedValueOnce(jsonResponse({ access_token: 'access-token', expires_in: 3600 }))
})

describe('Sentinel ingestion', () => {
  it.each(SOURCE_TYPES)(
    'preserves %s data in the DCR envelope and authenticates to Azure',
    async (source) => {
      const session = sentinelDestination.openSession({ config, credentials })
      await session.deliver({ ...delivery(), metadata: { ...metadata, source } })
      const [tokenUrl, tokenIP, tokenInit] = network.mock.calls[0]
      expect(tokenUrl).toBe(
        `https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`
      )
      expect(tokenIP).toBe('20.1.2.3')
      const tokenBody = new URLSearchParams(tokenInit.body)
      expect(tokenBody.get('scope')).toBe('https://monitor.azure.com//.default')
      expect(tokenBody.get('client_secret')).toBe(credentials.clientSecret)
      expect(tokenBody.get('grant_type')).toBe('client_credentials')
      const [url, ip, init] = network.mock.calls[1]
      expect(url).toBe(
        `${config.endpoint}/dataCollectionRules/${config.ruleId}/streams/Custom-SimLogs?api-version=2023-01-01`
      )
      expect(ip).toBe('20.1.2.3')
      expect(init.maxRedirects).toBe(0)
      expect(init.headers.Authorization).toBe('Bearer access-token')
      expect(JSON.parse(init.body)).toEqual([
        {
          TimeGenerated: metadata.runStartedAt.toISOString(),
          Source: source,
          RecordId: row.id,
          DrainId: metadata.drainId,
          RunId: metadata.runId,
          Data: row,
        },
      ])
      await session.close()
    }
  )

  it('splits UTF-8 payloads under 1 MB and checkpoints each accepted batch before continuing', async () => {
    const rows = Array.from({ length: 40 }, (_, index) => ({
      ...row,
      id: `event-${index}`,
      text: '🙂'.repeat(14_000),
    }))
    const acknowledged: number[] = []
    network.mockReset()
    network.mockResolvedValueOnce(jsonResponse({ access_token: 'access-token', expires_in: 3600 }))
    network.mockImplementation(async (_url, _ip, init) => {
      expect(Buffer.byteLength(init.body)).toBeLessThanOrEqual(1_000_000)
      const events = JSON.parse(init.body) as { RecordId: string }[]
      const firstIndex = Number(events[0]?.RecordId.split('-')[1])
      expect(firstIndex).toBe(acknowledged.reduce((total, count) => total + count, 0))
      return new Response(null, { status: 204 })
    })
    await sentinelDestination.openSession({ config, credentials }).deliver({
      ...delivery(rows),
      acknowledge: async ({ rowCount }) => {
        acknowledged.push(rowCount)
      },
    })
    expect(acknowledged.length).toBeGreaterThan(1)
    expect(acknowledged.reduce((total, count) => total + count, 0)).toBe(rows.length)
    const received = network.mock.calls
      .slice(1)
      .flatMap((call) => JSON.parse(call[2].body) as { RecordId: string }[])
    expect(received.map((entry) => entry.RecordId)).toEqual(rows.map((entry) => entry.id))
  })

  it('retains the accepted prefix when a later batch is rejected and hides provider bodies', async () => {
    network.mockResolvedValueOnce(new Response(null, { status: 204 }))
    network.mockResolvedValueOnce(
      new Response(`access-token ${credentials.clientSecret}`, { status: 403 })
    )
    const rows = Array.from({ length: 20 }, (_, index) => ({
      ...row,
      id: `event-${index}`,
      text: 'x'.repeat(60_000),
    }))
    const acknowledgements: number[] = []
    const result = await sentinelDestination
      .openSession({ config, credentials })
      .deliver({
        ...delivery(rows),
        acknowledge: async ({ rowCount }) => {
          acknowledgements.push(rowCount)
        },
      })
      .catch((error: unknown) => error)
    expect(result).toBeInstanceOf(Error)
    if (!(result instanceof Error)) throw new Error('Expected a failed delivery')
    expect(result.message).toContain('HTTP 403')
    expect(result.message).not.toContain('access-token')
    expect(result.message).not.toContain(credentials.clientSecret)
    expect(acknowledgements).toHaveLength(1)
    expect(acknowledgements[0]).toBeGreaterThan(0)
    expect(acknowledgements[0]).toBeLessThan(rows.length)
    expect(network).toHaveBeenCalledTimes(3)
  })

  it('rejects records that Azure would truncate before sending any data', async () => {
    await expect(
      sentinelDestination
        .openSession({ config, credentials })
        .deliver(delivery([row, { ...row, text: '🙂'.repeat(16_000) }]))
    ).rejects.toThrow(/64000-byte.*Data/)
    expect(network).not.toHaveBeenCalled()
  })

  it.each([
    'http://sim.eastus-1.ingest.monitor.azure.com',
    'https://sim.eastus-1.ingest.monitor.azure.com.attacker.example',
    'https://user:password@sim.eastus-1.ingest.monitor.azure.com',
    'https://sim.eastus-1.ingest.monitor.azure.com/path',
    'https://sim.eastus-1.ingest.monitor.azure.com?token=secret',
    'https://sim.eastus-1.ingest.monitor.azure.com:8443',
    'https://169.254.169.254',
  ])('rejects credential-bearing or non-Azure endpoint %s', (endpoint) => {
    expect(() =>
      sentinelDestination.openSession({ config: { ...config, endpoint }, credentials })
    ).toThrow()
  })

  it('fails closed when DNS policy denies the ingestion endpoint', async () => {
    inputValidationMockFns.mockValidateUrlWithDNS.mockResolvedValueOnce({
      isValid: true,
      resolvedIP: '20.1.2.3',
    })
    inputValidationMockFns.mockValidateUrlWithDNS.mockResolvedValue({
      isValid: false,
      error: 'blocked',
    })
    await expect(
      sentinelDestination.openSession({ config, credentials }).deliver(delivery())
    ).rejects.toThrow(/blocked/)
    expect(network).toHaveBeenCalledTimes(1)
    expect(network.mock.calls[0]?.[0]).toBe(
      `https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`
    )
  })

  it('honors Retry-After without duplicating acknowledged rows', async () => {
    vi.useFakeTimers()
    try {
      network.mockResolvedValueOnce(
        new Response(null, { status: 429, headers: { 'Retry-After': '2' } })
      )
      network.mockResolvedValueOnce(new Response(null, { status: 204 }))
      const acknowledged = vi.fn()
      const promise = sentinelDestination
        .openSession({ config, credentials })
        .deliver({ ...delivery(), acknowledge: acknowledged })
      await vi.advanceTimersByTimeAsync(1_999)
      expect(network).toHaveBeenCalledTimes(2)
      expect(acknowledged).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      await promise
      expect(network).toHaveBeenCalledTimes(3)
      expect(acknowledged).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('fails the run instead of retrying before an excessive Retry-After', async () => {
    network.mockResolvedValueOnce(
      new Response(null, { status: 429, headers: { 'Retry-After': '120' } })
    )
    await expect(
      sentinelDestination.openSession({ config, credentials }).deliver(delivery())
    ).rejects.toThrow(/Retry-After/)
    expect(network).toHaveBeenCalledTimes(2)
  })

  it('refreshes an expired session token before another chunk', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const session = sentinelDestination.openSession({ config, credentials })
      await session.deliver(delivery())
      vi.setSystemTime(Date.now() + 3_600_000)
      network.mockResolvedValueOnce(jsonResponse({ access_token: 'fresh-token', expires_in: 3600 }))
      await session.deliver(delivery())
      expect(network.mock.calls[3]?.[2].headers.Authorization).toBe('Bearer fresh-token')
    } finally {
      vi.useRealTimers()
    }
  })

  it('connection testing writes a probe using the same DCR schema', async () => {
    await sentinelDestination.test?.({ config, credentials, signal: new AbortController().signal })
    const payload = JSON.parse(network.mock.calls[1]?.[2].body)
    expect(payload).toHaveLength(1)
    expect(payload[0].Source).toBe('connection_test')
    expect(payload[0].Data).toEqual({ sim: 'connection-test' })
    expect(Object.keys(payload[0]).sort()).toEqual([
      'Data',
      'DrainId',
      'RecordId',
      'RunId',
      'Source',
      'TimeGenerated',
    ])
  })
})
