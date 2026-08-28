/**
 * @vitest-environment node
 */
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
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => vi.unstubAllGlobals())

  it('validates provider payloads while preserving the documented task output', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ id: 'task-1', sessionId: 'session-1' }))
      .mockResolvedValueOnce(
        jsonResponse({
          status: 'finished',
          sessionId: 'session-1',
          output: { result: 'complete' },
          steps: [
            {
              number: 1,
              memory: 'Opened the page',
              evaluationPreviousGoal: 'Succeeded',
              nextGoal: 'Finish',
              url: 'https://example.com',
              actions: ['{"click":{"index":1}}'],
              providerField: 'preserved',
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          liveUrl: 'https://live.browser-use.com/session-1',
          publicShareUrl: 'https://browser-use.com/share/session-1',
        })
      )

    const result = await executeRunTaskOperation({ task: 'Open the page', apiKey: 'api-key' })

    expect(result).toEqual({
      success: true,
      output: {
        id: 'task-1',
        success: true,
        output: { result: 'complete' },
        steps: [
          {
            number: 1,
            memory: 'Opened the page',
            evaluationPreviousGoal: 'Succeeded',
            nextGoal: 'Finish',
            url: 'https://example.com',
            actions: ['{"click":{"index":1}}'],
            providerField: 'preserved',
          },
        ],
        liveUrl: 'https://live.browser-use.com/session-1',
        shareUrl: 'https://browser-use.com/share/session-1',
        sessionId: 'session-1',
      },
      error: undefined,
    })
    expect(mockFetch).toHaveBeenCalledTimes(3)
  })

  it('rejects a malformed successful create-task response', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ sessionId: 'session-1' }))

    await expect(
      executeRunTaskOperation({ task: 'Open the page', apiKey: 'api-key' })
    ).resolves.toEqual({
      success: false,
      output: {
        id: '',
        success: false,
        output: null,
        steps: [],
        liveUrl: null,
        shareUrl: null,
        sessionId: null,
      },
      error: 'BrowserUse returned an invalid create-task response',
    })
  })

  it('normalizes non-Error provider failures', async () => {
    mockFetch.mockRejectedValueOnce('provider unavailable')

    await expect(
      executeRunTaskOperation({ task: 'Open the page', apiKey: 'api-key' })
    ).resolves.toEqual({
      success: false,
      output: {
        id: '',
        success: false,
        output: null,
        steps: [],
        liveUrl: null,
        shareUrl: null,
        sessionId: null,
      },
      error: 'Error creating task: provider unavailable',
    })
  })
})
