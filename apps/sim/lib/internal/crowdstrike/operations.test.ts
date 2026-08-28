/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  chunkIdsByUrlBudget,
  executeCrowdStrikeOperation,
  executeCrowdStrikeRequest,
} from '@/lib/internal/crowdstrike/operations'

const fetchMock = vi.fn()

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('CrowdStrike operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
  })

  it('hydrates sensor queries with the same pagination envelope and signal', async () => {
    const controller = new AbortController()
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token-1' }))
      .mockResolvedValueOnce(
        jsonResponse({
          meta: { pagination: { limit: 1, offset: 0, total: 1 } },
          resources: ['sensor-1'],
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          resources: [
            {
              device_id: 'sensor-1',
              hostname: 'host-1',
              status: 'protected',
              status_causes: ['healthy'],
            },
          ],
        })
      )

    const result = await executeCrowdStrikeRequest(
      {
        operation: 'crowdstrike_query_sensors',
        clientId: 'client-id',
        clientSecret: 'client-secret',
        cloud: 'us-1',
        limit: 1,
      },
      controller.signal
    )

    expect(result).toMatchObject({
      ok: true,
      output: {
        count: 1,
        pagination: { limit: 1, offset: 0, total: 1 },
        sensors: [{ deviceId: 'sensor-1', hostname: 'host-1', status: 'protected' }],
      },
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    for (const call of fetchMock.mock.calls) {
      expect(call[1]).toMatchObject({ signal: controller.signal })
    }
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
})
