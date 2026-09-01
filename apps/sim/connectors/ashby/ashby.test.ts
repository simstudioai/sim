/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ashbyConnector } from '@/connectors/ashby/ashby'
import { ashbyConnectorMeta } from '@/connectors/ashby/meta'

function ashbyResponse(results: unknown, extra: Record<string, unknown> = {}): Response {
  return Response.json({ success: true, results, moreDataAvailable: false, ...extra })
}

describe('ashbyConnector', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('rehydrates deferred candidate content on forced full sync', () => {
    expect(ashbyConnectorMeta.rehydrateOnFullSync).toBe(true)
  })

  it('rejects unsafe max-candidate values and invalid dates before network validation', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    await expect(
      ashbyConnector.validateConfig('key', { maxCandidates: '1.5' })
    ).resolves.toMatchObject({ valid: false })
    await expect(
      ashbyConnector.validateConfig('key', { maxCandidates: 'Infinity' })
    ).resolves.toMatchObject({ valid: false })
    await expect(
      ashbyConnector.validateConfig('key', { createdAfter: 'not-a-date' })
    ).resolves.toMatchObject({ valid: false })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('marks capped candidate listings so deletion reconciliation is skipped', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      ashbyResponse(
        [
          { id: 'c1', name: 'One' },
          { id: 'c2', name: 'Two' },
        ],
        { moreDataAvailable: true, nextCursor: 'next' }
      )
    )
    const syncContext: Record<string, unknown> = {}
    const result = await ashbyConnector.listDocuments(
      'key',
      { maxCandidates: '1' },
      undefined,
      syncContext
    )
    expect(result.documents).toHaveLength(1)
    expect(result.hasMore).toBe(false)
    expect(syncContext.listingCapped).toBe(true)
  })

  it('fails hydration when feedback is partial so the candidate can be retried', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(ashbyResponse({ id: 'c1', name: 'One', applicationIds: ['a1'] }))
      .mockResolvedValueOnce(ashbyResponse([]))
      .mockResolvedValueOnce(
        Response.json({ success: false, errors: [{ message: 'feedback unavailable' }] })
      )
    await expect(ashbyConnector.getDocument('key', {}, 'c1')).rejects.toThrow(
      'feedback unavailable'
    )
  })
})
