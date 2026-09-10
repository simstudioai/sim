/**
 * @vitest-environment node
 */
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

  it('names exactly the documents the listing left without an ACL', () => {
    expect(
      unansweredByListing([doc('a', ['u:alice@corp.com']), doc('b'), doc('c', []), doc('d')]).map(
        (d) => d.externalId
      )
    ).toEqual(['b', 'd'])
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

  it("keeps the listing's answer where it gave one", () => {
    const { acls, unattributed } = mergeMirroredAcls([doc('a', ['u:alice@corp.com'])], {
      a: ['u:bob@corp.com'],
    })

    expect(acls.get('a')).toEqual(['u:alice@corp.com'])
    expect(unattributed).toBe(0)
  })

  it('fills what the listing could not from the fetch', () => {
    const { acls, unattributed } = mergeMirroredAcls([doc('a'), doc('b', ['pub'])], {
      a: ['u:alice@corp.com'],
    })

    expect(acls.get('a')).toEqual(['u:alice@corp.com'])
    expect(acls.get('b')).toEqual(['pub'])
    expect(unattributed).toBe(0)
  })

  it('marks a document neither source answered for as unresolved', () => {
    const { acls, unattributed } = mergeMirroredAcls([doc('a'), doc('b')], { a: ['pub'] })

    expect(acls.get('b')).toEqual([])
    expect(unattributed).toBe(1)
  })

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

  it('answers for every listed document, in listing order', () => {
    const { acls } = mergeMirroredAcls([doc('z', ['pub']), doc('a')], {})

    expect([...acls.keys()]).toEqual(['z', 'a'])
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
