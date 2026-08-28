/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CrowdStrikeAuthError,
  callCrowdStrike,
  getAccessToken,
} from '@/lib/internal/crowdstrike/client'

const fetchMock = vi.fn()

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('CrowdStrike client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
  })

  it('forwards cancellation through token and provider requests', async () => {
    const controller = new AbortController()
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token-1' }))
      .mockResolvedValueOnce(jsonResponse({ resources: ['alert-1'] }))

    await expect(
      getAccessToken(
        { clientId: 'client-id', clientSecret: 'client-secret', cloud: 'us-1' },
        controller.signal
      )
    ).resolves.toBe('token-1')
    await callCrowdStrike(
      'https://api.crowdstrike.com',
      'token-1',
      { method: 'GET', path: '/alerts/queries/alerts/v2' },
      controller.signal
    )

    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ signal: controller.signal })
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ signal: controller.signal })
  })

  it('maps Falcon authentication errors with the provider status', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ errors: [{ code: 401, message: 'invalid credentials' }] }, 401)
    )

    await expect(
      getAccessToken({ clientId: 'client-id', clientSecret: 'bad-secret', cloud: 'us-1' })
    ).rejects.toEqual(new CrowdStrikeAuthError('invalid credentials', 401))
  })

  it('caps provider response bodies and cancels an oversized stream', async () => {
    let cancelled = false
    const stream = new ReadableStream<Uint8Array>({
      cancel: () => {
        cancelled = true
      },
    })
    fetchMock.mockResolvedValueOnce(
      new Response(stream, {
        status: 200,
        headers: { 'Content-Length': String(10 * 1024 * 1024 + 1) },
      })
    )

    await expect(
      getAccessToken({ clientId: 'client-id', clientSecret: 'client-secret', cloud: 'us-1' })
    ).rejects.toMatchObject({ name: 'PayloadSizeLimitError' })
    expect(cancelled).toBe(true)
  })

  it('does not start network work after cancellation', async () => {
    const controller = new AbortController()
    controller.abort(new DOMException('cancelled', 'AbortError'))

    await expect(
      getAccessToken(
        { clientId: 'client-id', clientSecret: 'client-secret', cloud: 'us-1' },
        controller.signal
      )
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
