/** @vitest-environment node */
import { describe, expect, it, vi } from 'vitest'
import { searchCoda } from '@/lib/sim-search/live/coda'

describe('Coda REST discovery', () => {
  it('sends only the provider page token on continuation because it encodes the original query', async () => {
    const json = vi.fn().mockResolvedValue({ items: [] })
    await searchCoda(
      { json, text: vi.fn() },
      {
        query: 'launch',
        limit: 10,
        scopes: [],
        native: { provider: 'coda', query: 'launch', cursor: 'next-page' },
      }
    )
    expect(json).toHaveBeenCalledExactlyOnceWith('/apis/v1/docs', {
      query: { pageToken: 'next-page' },
    })
  })
})
