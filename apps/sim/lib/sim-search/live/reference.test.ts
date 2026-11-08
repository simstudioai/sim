import { describe, expect, it } from 'vitest'
import {
  encodeLiveReference,
  type LiveReference,
  liveReferenceOwner,
  readLiveReference,
} from '@/lib/sim-search/live/reference'

const owner = liveReferenceOwner('reader', 'workspace:w')

const thread: LiveReference = {
  provider: 'slack',
  account: 'account',
  id: '1730912345.123456',
  container: 'C1',
  threadId: '1730900000.000100',
}

const earlierForm = (reference: LiveReference) =>
  `live:${Buffer.from(
    JSON.stringify({ v: 1, user: 'reader', scope: 'workspace:w', ...reference })
  ).toString('base64url')}`

describe('live document IDs', () => {
  it.each([
    ['dropping its last character', (id: string) => id.slice(0, -1)],
    ['dropping the thread it names', (id: string) => id.replace(/~1730900000\.000100(?=~)/, '')],
    ['changing the message it names', (id: string) => id.replace('123456', '123457')],
  ])('asks for a new search after %s rather than naming another document', (_case, damage) => {
    expect(() => readLiveReference(damage(encodeLiveReference(thread, owner)), owner)).toThrow(
      'Search again'
    )
  })

  it.each([
    ['another member', liveReferenceOwner('someone-else', 'workspace:w')],
    ['another scope', liveReferenceOwner('reader', 'workspace:other')],
  ])('refuses an ID read by %s as not found in this scope', (_case, reader) => {
    expect(() => readLiveReference(encodeLiveReference(thread, owner), reader)).toThrow(
      'Document not found in this search scope'
    )
    expect(() => readLiveReference(earlierForm(thread), reader)).toThrow(
      'Document not found in this search scope'
    )
  })

  it.each([
    ['the separator and escape character', 'a~b%c%41'],
    ['control characters', 'line\none\ttab'],
    ['Unicode text', 'docs/設計/仕様書.md'],
    ['an unpaired surrogate', 'name\ud800end'],
  ])('reads back an ID holding %s', (_case, id) => {
    const reference = { provider: 'gitlab', account: 'account', id } as const
    expect(readLiveReference(encodeLiveReference(reference, owner), owner)).toEqual(reference)
  })

  it('reads an earlier-form ID minted for the same reader and scope', () => {
    expect(readLiveReference(earlierForm(thread), owner)).toEqual(thread)
  })

  it('is never longer than the earlier form for the same document', () => {
    const reference = {
      provider: 'gitlab',
      account: 'account',
      id: `src/${'設計書'.repeat(150)}.md`,
    } as const
    expect(encodeLiveReference(reference, owner).length).toBeLessThan(earlierForm(reference).length)
  })
})
