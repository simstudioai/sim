/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { grainHandler } from '@/lib/webhooks/providers/grain'

const WEBHOOK_ID = 'webhook-uuid-1234'

const fetchMock = vi.fn()

function makeWebhook(providerConfig: Record<string, unknown>) {
  return {
    id: WEBHOOK_ID,
    path: 'grain-path',
    providerConfig,
  } as unknown as Parameters<typeof grainHandler.deleteSubscription>[0]['webhook']
}

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function createContext(providerConfig: Record<string, unknown>) {
  return {
    webhook: makeWebhook(providerConfig),
    workflow: {},
    userId: 'user-1',
    requestId: 'req-1',
  } as never
}

describe('grainHandler createSubscription', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com'
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    process.env.NEXT_PUBLIC_APP_URL = undefined
  })

  it('creates the hook for a single-event v2 trigger', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: 'hook-1' }))

    const result = await grainHandler.createSubscription!(
      createContext({
        apiKey: 'grain-key',
        triggerId: 'grain_recording_added_v2',
      })
    )

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.grain.com/_/public-api/v2/hooks/create')
    expect(init.headers['Public-Api-Version']).toBe('2025-10-31')
    expect(JSON.parse(init.body)).toMatchObject({ hook_type: 'recording_added' })

    expect(result?.providerConfigUpdates).toMatchObject({
      externalIds: ['hook-1'],
      externalId: 'hook-1',
      eventTypes: ['recording_added'],
    })
  })

  it('creates one hook per event type for the All Events trigger', async () => {
    for (let i = 1; i <= 10; i++) {
      fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: `hook-${i}` }))
    }

    const result = await grainHandler.createSubscription!(
      createContext({
        apiKey: 'grain-key',
        triggerId: 'grain_all_events_v2',
      })
    )

    expect(fetchMock).toHaveBeenCalledTimes(10)
    const hookTypes = fetchMock.mock.calls.map((call) => JSON.parse(call[1].body).hook_type)
    expect(hookTypes).toEqual([
      'recording_added',
      'recording_updated',
      'recording_deleted',
      'highlight_added',
      'highlight_updated',
      'highlight_deleted',
      'story_added',
      'story_updated',
      'story_deleted',
      'upload_status',
    ])
    expect(result?.providerConfigUpdates).toMatchObject({
      externalIds: hookTypes.map((_, i) => `hook-${i + 1}`),
      externalId: 'hook-1',
    })
  })

  it('keeps legacy view-scoped triggers on the v1 API without remapping', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: 'legacy-hook-1' }))

    const result = await grainHandler.createSubscription!(
      createContext({
        apiKey: 'grain-key',
        triggerId: 'grain_recording_created',
        viewId: 'legacy-view',
      })
    )

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.grain.com/_/public-api/hooks')
    expect(init.headers['Public-Api-Version']).toBeUndefined()
    expect(JSON.parse(init.body)).toMatchObject({
      version: 2,
      view_id: 'legacy-view',
      actions: ['added'],
    })
    expect(result?.providerConfigUpdates).toEqual({
      externalId: 'legacy-hook-1',
      eventTypes: ['recording_added'],
    })
  })

  it('still requires a view id for legacy triggers', async () => {
    await expect(
      grainHandler.createSubscription!(
        createContext({ apiKey: 'grain-key', triggerId: 'grain_recording_created' })
      )
    ).rejects.toThrow('Grain view ID is required')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rolls back already-created hooks when a later create fails', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { id: 'hook-1' }))
      .mockResolvedValueOnce(jsonResponse(400, { error: 'bad_request' }))
      .mockResolvedValueOnce(jsonResponse(200, { success: true }))

    await expect(
      grainHandler.createSubscription!(
        createContext({
          apiKey: 'grain-key',
          triggerId: 'grain_all_events_v2',
        })
      )
    ).rejects.toThrow('Grain error: bad_request')

    const deleteCall = fetchMock.mock.calls[2]
    expect(deleteCall[0]).toBe('https://api.grain.com/_/public-api/v2/hooks/hook-1')
    expect(deleteCall[1].method).toBe('DELETE')
  })

  it('rejects when the api key is missing', async () => {
    await expect(
      grainHandler.createSubscription!(createContext({ triggerId: 'grain_recording_added_v2' }))
    ).rejects.toThrow('Grain API Key is required')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('grainHandler deleteSubscription', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('deletes every hook recorded in externalIds', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { success: true }))
      .mockResolvedValueOnce(jsonResponse(404, {}))

    await grainHandler.deleteSubscription!({
      webhook: makeWebhook({
        apiKey: 'grain-key',
        externalIds: ['hook-1', 'hook-2'],
        externalId: 'hook-1',
      }),
      workflow: {},
      requestId: 'req-1',
      strict: true,
    } as never)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.grain.com/_/public-api/v2/hooks/hook-1')
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.grain.com/_/public-api/v2/hooks/hook-2')
  })

  it('deletes legacy single-externalId rows through the v1 endpoint', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { success: true }))

    await grainHandler.deleteSubscription!({
      webhook: makeWebhook({ apiKey: 'grain-key', externalId: 'legacy-hook' }),
      workflow: {},
      requestId: 'req-1',
      strict: true,
    } as never)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.grain.com/_/public-api/hooks/legacy-hook')
    expect(init.headers['Public-Api-Version']).toBeUndefined()
  })

  it('throws in strict mode when a delete fails with a server error', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(500, {}))

    await expect(
      grainHandler.deleteSubscription!({
        webhook: makeWebhook({ apiKey: 'grain-key', externalIds: ['hook-1'] }),
        workflow: {},
        requestId: 'req-1',
        strict: true,
      } as never)
    ).rejects.toThrow('Failed to delete 1 Grain webhook(s)')
  })

  it('is a strict no-op failure when cleanup config is missing', async () => {
    await expect(
      grainHandler.deleteSubscription!({
        webhook: makeWebhook({ apiKey: 'grain-key' }),
        workflow: {},
        requestId: 'req-1',
        strict: true,
      } as never)
    ).rejects.toThrow('Missing Grain externalId for webhook deletion')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
