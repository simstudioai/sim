import { describe, expect, it } from 'vitest'
import {
  decodeLiveReference,
  encodeLiveReference,
  type LiveReference,
} from '@/lib/sim-search/live/reference'

const owner = 'a1b2c3d4'

const thread: LiveReference = {
  provider: 'slack',
  owner,
  account: 'account',
  id: '1730912345.123456',
  container: 'C1',
  threadId: '1730900000.000100',
}

const earlierForm = ({ owner: _owner, ...reference }: LiveReference) =>
  `live:${Buffer.from(
    JSON.stringify({ v: 1, user: 'reader', scope: 'workspace:w', ...reference })
  ).toString('base64url')}`

describe('live document IDs', () => {
  it.each([
    ['dropping its last character', (id: string) => id.slice(0, -1)],
    ['dropping the thread it names', (id: string) => id.replace(/~1730900000\.000100(?=~)/, '')],
    ['changing the message it names', (id: string) => id.replace('123456', '123457')],
  ])('asks for a new search after %s rather than naming another document', (_case, damage) => {
    expect(() => decodeLiveReference(damage(encodeLiveReference(thread)))).toThrow('Search again')
  })

  it.each([
    ['the separator and escape character', 'a~b%c%41'],
    ['control characters', 'line\none\ttab'],
    ['Unicode text', 'docs/設計/仕様書.md'],
    ['an unpaired surrogate', 'name\ud800end'],
  ])('reads back an ID holding %s', (_case, id) => {
    const reference = { provider: 'gitlab', owner, account: 'account', id } as const
    expect(decodeLiveReference(encodeLiveReference(reference))).toEqual(reference)
  })

  it('is never longer than the earlier form for the same document', () => {
    const reference = {
      provider: 'gitlab',
      owner,
      account: 'account',
      id: `src/${'設計書'.repeat(150)}.md`,
    } as const
    expect(encodeLiveReference(reference).length).toBeLessThan(earlierForm(reference).length)
  })
})
