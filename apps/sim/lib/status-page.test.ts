/**
 * @vitest-environment node
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchStatusPageSummary } from '@/lib/status-page'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchStatusPageSummary', () => {
  it('returns a validated public status summary and forwards cancellation', async () => {
    const signal = new AbortController().signal
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          page: { name: 'Sim' },
          status: { description: 'Minor Service Outage', indicator: 'minor' },
        }),
        { status: 200 }
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchStatusPageSummary(signal)).resolves.toEqual({
      status: { description: 'Minor Service Outage', indicator: 'minor' },
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://status.sim.ai/api/v2/status.json',
      expect.objectContaining({ signal })
    )
  })

  it('throws when the status endpoint fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 503 })))

    await expect(fetchStatusPageSummary()).rejects.toThrow('Status page request failed with 503')
  })

  it('throws when the provider returns an unknown indicator', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            status: { description: 'Unexpected status', indicator: 'unknown' },
          }),
          { status: 200 }
        )
      )
    )

    await expect(fetchStatusPageSummary()).rejects.toThrow()
  })
})
