import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { executeRunTaskOperation } from '@/lib/internal/browser-use/operations/run-task'

const mockFetch = vi.fn<typeof fetch>()

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('executeRunTaskOperation', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => vi.unstubAllGlobals())

  it('uses the created profile session to fetch the live URL when task status omits it', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ id: 'profile-session' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'task-1' }))
      .mockResolvedValueOnce(jsonResponse({ status: 'finished', output: 'done' }))
      .mockResolvedValueOnce(
        jsonResponse({
          liveUrl: 'https://live.browser-use.com/profile-session',
          publicShareUrl: 'https://browser-use.com/share/profile-session',
        })
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))

    const result = await executeRunTaskOperation({
      task: 'Open the page',
      apiKey: 'api-key',
      profile_id: 'profile-1',
    })

    expect(result.output).toMatchObject({
      sessionId: 'profile-session',
      liveUrl: 'https://live.browser-use.com/profile-session',
      shareUrl: 'https://browser-use.com/share/profile-session',
    })
    expect(mockFetch).toHaveBeenNthCalledWith(
      4,
      'https://api.browser-use.com/api/v2/sessions/profile-session',
      expect.objectContaining({ method: 'GET' })
    )
  })

  it('propagates cancellation while still stopping a created profile session', async () => {
    const controller = new AbortController()
    const abortError = new DOMException('cancelled', 'AbortError')
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ id: 'profile-session' }))
      .mockImplementationOnce(async (_input, request) => {
        expect(request?.signal).toBe(controller.signal)
        controller.abort(abortError)
        throw abortError
      })
      .mockResolvedValueOnce(new Response(null, { status: 204 }))

    await expect(
      executeRunTaskOperation(
        { task: 'Open the page', apiKey: 'api-key', profile_id: 'profile-1' },
        controller.signal
      )
    ).rejects.toBe(abortError)

    expect(mockFetch).toHaveBeenNthCalledWith(
      3,
      'https://api.browser-use.com/api/v2/sessions/profile-session',
      expect.objectContaining({
        method: 'PATCH',
        redirect: 'error',
        signal: expect.any(AbortSignal),
      })
    )
    expect(mockFetch.mock.calls[2]?.[1]?.signal).not.toBe(controller.signal)
  })

  it('stops an automatically created task session when polling is cancelled', async () => {
    const controller = new AbortController()
    const abortError = new DOMException('cancelled', 'AbortError')
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ id: 'task-1', sessionId: 'task-session' }))
      .mockImplementationOnce(async () => {
        controller.abort(abortError)
        throw abortError
      })
      .mockResolvedValueOnce(new Response(null, { status: 204 }))

    await expect(
      executeRunTaskOperation({ task: 'Open the page', apiKey: 'api-key' }, controller.signal)
    ).rejects.toBe(abortError)

    expect(mockFetch).toHaveBeenNthCalledWith(
      3,
      'https://api.browser-use.com/api/v2/sessions/task-session',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ action: 'stop' }),
        signal: expect.any(AbortSignal),
      })
    )
  })

  it('stops an automatically created task session when polling times out', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValue(1_000_000_000_000_000)
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ id: 'task-1', sessionId: 'task-session' }))
      .mockResolvedValueOnce(jsonResponse({ status: 'running', sessionId: 'task-session' }))
      .mockResolvedValueOnce(
        jsonResponse({ shareUrl: 'https://browser-use.com/share/task-session' })
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))

    const result = await executeRunTaskOperation({ task: 'Open the page', apiKey: 'api-key' })
    now.mockRestore()

    expect(result).toMatchObject({
      success: false,
      error: expect.stringContaining('Task did not complete within the maximum polling time'),
    })
    expect(mockFetch).toHaveBeenNthCalledWith(
      4,
      'https://api.browser-use.com/api/v2/sessions/task-session',
      expect.objectContaining({ method: 'PATCH', signal: expect.any(AbortSignal) })
    )
  })
})
