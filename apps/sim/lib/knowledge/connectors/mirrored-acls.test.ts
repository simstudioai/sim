import { describe, expect, it } from 'vitest'
import {
  hideUnlistedDocuments,
  mergeMirroredAcls,
  unansweredByListing,
} from '@/lib/knowledge/connectors/mirrored-acls'
import type { ExternalDocument } from '@/connectors/types'

function doc(externalId: string, acl?: readonly string[]): ExternalDocument {
  return {
    externalId,
    title: externalId,
    content: '',
    mimeType: 'text/plain',
    contentHash: 'h',
    acl,
  }
}

describe('unansweredByListing', () => {
  it('requests each unresolved ID once and honors inline answers from any duplicate', () => {
    expect(unansweredByListing([doc('a'), doc('a', []), doc('b'), doc('b')])).toEqual([doc('b')])
  })
})

describe('mergeMirroredAcls', () => {
  it.each([{ acl: [] }, { acl: ['invalid'] }])(
    'keeps an inline answer over fetched grants for an unresolved duplicate',
    ({ acl }) => {
      const result = mergeMirroredAcls([doc('a', acl), doc('a')], { a: ['pub'] })
      expect(result.acls.get('a')).toEqual(acl)
      expect(result.unresolvedExternalIds.size).toBe(0)
    }
  )

  it('treats an explicitly empty inline ACL as an answer, not a gap', () => {
    const { acls, unattributed } = mergeMirroredAcls([doc('a', [])], { a: ['pub'] })

    expect(acls.get('a')).toEqual([])
    expect(unattributed).toBe(0)
  })

  it.each([
    { docs: [doc('a', ['pub']), doc('a')], expected: ['pub'] },
    { docs: [doc('a'), doc('a', ['pub'])], expected: ['pub'] },
    { docs: [doc('a', ['pub']), doc('a', []), doc('a')], expected: [] },
    { docs: [doc('a', ['pub']), doc('a', ['invalid']), doc('a')], expected: ['invalid'] },
  ])(
    'retains the latest explicit same-page answer when a duplicate is unresolved',
    ({ docs, expected }) => {
      const result = mergeMirroredAcls(docs, {})
      expect(result.acls.get('a')).toEqual(expected)
      expect(result.unresolvedExternalIds.size).toBe(0)
    }
  )

  it('distinguishes unresolved files from explicit empty responses', () => {
    const result = mergeMirroredAcls(
      [doc('unknown'), doc('inline-empty', []), doc('fetched-empty')],
      { 'fetched-empty': [] }
    )
    expect([...result.unresolvedExternalIds]).toEqual(['unknown'])
    expect(result.unattributed).toBe(1)
  })
})

describe('hideUnlistedDocuments', () => {
  it('hides every owned document the listing did not name and leaves the listed ones alone', () => {
    const acls = new Map<string, readonly string[]>([['a', ['u:alice@corp.com']]])

    const hidden = hideUnlistedDocuments(acls, ['a', 'b', null, 'c'])

    expect(hidden).toBe(2)
    expect(acls.get('a')).toEqual(['u:alice@corp.com'])
    expect(acls.get('b')).toEqual([])
    expect(acls.get('c')).toEqual([])
  })
})
