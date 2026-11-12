import { jsonResponse } from '@sim/testing/helpers/http'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  chunkIdsByUrlBudget,
  executeCrowdStrikeOperation,
  executeCrowdStrikeRequest,
} from '@/lib/internal/crowdstrike/operations'

const fetchMock = vi.fn()

describe('CrowdStrike operations', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  it('maps a resource-less 200 error envelope to its Falcon error status', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token-1' }))
      .mockResolvedValueOnce(
        jsonResponse({ resources: [], errors: [{ code: 503, message: 'Falcon unavailable' }] })
      )

    await expect(
      executeCrowdStrikeRequest({
        operation: 'crowdstrike_query_sensors',
        clientId: 'client-id',
        clientSecret: 'client-secret',
        cloud: 'us-1',
      })
    ).resolves.toEqual({ ok: false, status: 503, error: 'Falcon unavailable' })
  })

  it('keeps by-ID requests within the URL budget and executes batches sequentially', async () => {
    const controller = new AbortController()
    const indicatorIds = [`sha256:${'a'.repeat(4050)}`, `sha256:${'b'.repeat(4050)}`]
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ resources: [{ id: indicatorIds[0] }] }))
      .mockResolvedValueOnce(jsonResponse({ resources: [{ id: indicatorIds[1] }] }))

    const result = await executeCrowdStrikeOperation(
      {
        operation: 'crowdstrike_get_indicator_details',
        clientId: 'client-id',
        clientSecret: 'client-secret',
        cloud: 'us-1',
        indicatorIds,
      },
      'https://api.crowdstrike.com',
      'token-1',
      controller.signal
    )

    expect(result).toMatchObject({ ok: true, output: { count: 2 } })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.invocationCallOrder[0]).toBeLessThan(
      fetchMock.mock.invocationCallOrder[1]
    )
    expect(chunkIdsByUrlBudget(indicatorIds, 4096)).toHaveLength(2)
    for (const call of fetchMock.mock.calls) {
      expect(call[1]).toMatchObject({ signal: controller.signal })
    }
  })

  it("sends a saved credential's token to its own cloud without minting one", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ resources: [] }))

    const result = await executeCrowdStrikeRequest({
      operation: 'crowdstrike_query_sensors',
      accessToken: 'minted-token',
      cloud: 'eu-1',
    })

    expect(result).toMatchObject({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(new URL(url).origin).toBe('https://api.eu-1.crowdstrike.com')
    expect(new URL(url).pathname).not.toBe('/oauth2/token')
    expect(init.headers).toMatchObject({ Authorization: 'Bearer minted-token' })
  })

  it('refuses a request carrying neither inline credentials nor a token, before any call', async () => {
    await expect(
      executeCrowdStrikeRequest({ operation: 'crowdstrike_query_sensors', cloud: 'us-1' })
    ).rejects.toMatchObject({ status: 400 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('never sends an inline request a token Falcon has since stopped accepting', async () => {
    const body = {
      operation: 'crowdstrike_query_sensors' as const,
      clientId: 'scoped-client',
      clientSecret: 'scoped-secret',
      cloud: 'us-2' as const,
    }
    let minted = 0
    const refusedTokens = new Set<string>()
    fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
      if (url.endsWith('/oauth2/token')) {
        minted += 1
        return jsonResponse({ access_token: `token-${minted}`, expires_in: 1799 })
      }
      const auth = (init.headers as Record<string, string>).Authorization
      return refusedTokens.has(auth)
        ? jsonResponse({ errors: [{ code: 403, message: 'access denied' }] }, 403)
        : jsonResponse({ resources: [] })
    })

    await expect(executeCrowdStrikeRequest(body)).resolves.toMatchObject({ ok: true })
    refusedTokens.add('Bearer token-1')
    await expect(executeCrowdStrikeRequest(body)).resolves.toMatchObject({ ok: true })
    const tokenCalls = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/oauth2/token'))
    expect(tokenCalls.map(([url]) => url)).toEqual([
      'https://api.us-2.crowdstrike.com/oauth2/token',
      'https://api.us-2.crowdstrike.com/oauth2/token',
    ])
  })
})
