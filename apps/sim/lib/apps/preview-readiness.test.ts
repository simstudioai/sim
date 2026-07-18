import { describe, expect, it, vi } from 'vitest'
import { waitForAppPreviewReady } from '@/lib/apps/preview-readiness'

describe('waitForAppPreviewReady', () => {
  it('retries transient failures until the exact preview document is ready', async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error('connection refused'))
      .mockResolvedValueOnce(new Response('starting', { status: 503 }))
      .mockResolvedValueOnce(
        new Response('<html>ready</html>', {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        })
      )
    const sleeper = vi.fn().mockResolvedValue(undefined)

    const result = await waitForAppPreviewReady({
      previewUrl: 'http://apps.localhost:3005/__sim/preview/session/nonce/',
      attempts: 4,
      initialDelayMs: 1,
      fetcher,
      sleeper,
    })

    expect(result).toEqual({ ok: true, attempts: 3 })
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(sleeper).toHaveBeenCalledTimes(2)
  })

  it('does not retry definitive capability/configuration failures', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('bad parent', { status: 400 }))
    const sleeper = vi.fn().mockResolvedValue(undefined)

    const result = await waitForAppPreviewReady({
      previewUrl: 'http://apps.localhost:3005/__sim/preview/session/nonce/',
      fetcher,
      sleeper,
    })

    expect(result).toEqual({ ok: false, attempts: 1, lastStatus: 400 })
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(sleeper).not.toHaveBeenCalled()
  })
})
