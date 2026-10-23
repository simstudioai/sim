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
})
