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
  it('names exactly the documents the listing left without an ACL', () => {
    expect(
      unansweredByListing([doc('a', ['u:alice@corp.com']), doc('b'), doc('c', []), doc('d')]).map(
        (d) => d.externalId
      )
    ).toEqual(['b', 'd'])
  })
})

describe('mergeMirroredAcls', () => {
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

  /**
   * A document nobody answered for is hidden and counted — never skipped,
   * because skipping would leave it under an ACL this run did not verify.
   */
  it('hides and counts a document neither source answered for', () => {
    const { acls, unattributed } = mergeMirroredAcls([doc('a'), doc('b')], { a: ['pub'] })

    expect(acls.get('b')).toEqual([])
    expect(unattributed).toBe(1)
  })

  it('treats an explicitly empty inline ACL as an answer, not a gap', () => {
    const { acls, unattributed } = mergeMirroredAcls([doc('a', [])], { a: ['pub'] })

    expect(acls.get('a')).toEqual([])
    expect(unattributed).toBe(0)
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
