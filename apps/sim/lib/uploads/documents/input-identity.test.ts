import { describe, expect, it } from 'vitest'
import { fileDocumentInputIdentity } from '@/lib/uploads/documents/input-identity'

describe('compiled document input identity', () => {
  it('is independent of dependency query order and still changes with a revision', () => {
    const owner = { entityType: 'project', entityId: 'project-1' } as const
    const files = ['b', 'a'].map((id) => ({
      id,
      key: `project/project-1/${id}`,
      contentUpdatedAt: new Date(1),
      sizeBytes: 1,
    }))
    const identity = fileDocumentInputIdentity(owner, files)
    expect(fileDocumentInputIdentity(owner, [...files].reverse())).toBe(identity)
    expect(
      fileDocumentInputIdentity(owner, [{ ...files[0], contentUpdatedAt: new Date(2) }, files[1]])
    ).not.toBe(identity)
    expect(files.map((file) => file.id)).toEqual(['b', 'a'])
  })
})
