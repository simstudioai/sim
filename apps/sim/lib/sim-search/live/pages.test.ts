import { describe, expect, it } from 'vitest'
import { NativeSearchError } from '@/lib/sim-search/live/http'
import { collectNativePages } from '@/lib/sim-search/live/pages'

const doc = (id: string) => ({ id, title: id, url: '', content: '' })

describe('native page merging', () => {
  it('reports collection cursors as more results rather than degraded coverage', async () => {
    const page = await collectNativePages(
      [
        Promise.resolve({ documents: [doc('a')], nextCursor: '2', message: 'Searched.' }),
        Promise.resolve({ documents: [doc('b')], message: 'Searched.' }),
      ],
      'Guidance.'
    )
    expect(page).toMatchObject({ partial: false, hasMore: true, message: 'Guidance.' })
    expect(page.documents.map((item) => item.id)).toEqual(['a', 'b'])
  })
  it('reports a failed collection once, keeping successful evidence', async () => {
    const failure = new NativeSearchError('unavailable', 'Code search failed.')
    const page = await collectNativePages(
      [
        Promise.resolve({ documents: [doc('a')] }),
        Promise.reject(failure),
        Promise.reject(failure),
      ],
      'Guidance.'
    )
    expect(page).toMatchObject({ partial: true, message: 'Guidance. Code search failed.' })
  })
})
