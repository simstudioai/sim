/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CompletionReportError,
  reportClientToolCompletionOnPageExit,
} from '@/lib/copilot/tools/client/completion'

describe('reportClientToolCompletionOnPageExit', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('uses a keepalive request with the exact terminal payload', async () => {
    await reportClientToolCompletionOnPageExit('tool-1', 'success', 'Browser action completed', {
      url: 'https://example.com',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/copilot/confirm',
      expect.objectContaining({
        method: 'POST',
        keepalive: true,
        body: JSON.stringify({
          toolCallId: 'tool-1',
          status: 'success',
          message: 'Browser action completed',
          data: { url: 'https://example.com' },
        }),
      })
    )
  })

  it('rejects a non-success response', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 503 }))

    await expect(
      reportClientToolCompletionOnPageExit('tool-1', 'error', 'Browser failed')
    ).rejects.toBeInstanceOf(CompletionReportError)
  })
})
