/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { knowledgeFolderPathForId } from '@/lib/knowledge/application/folder-paths'

type ActiveFolderIndex = Parameters<typeof knowledgeFolderPathForId>[0]

/** Minimal active-folder index: only `pathById` is read by the projection. */
function indexWith(paths: Record<string, string>): ActiveFolderIndex {
  return {
    rowById: new Map(),
    pathById: new Map(Object.entries(paths)),
    idByPath: new Map(Object.entries(paths).map(([id, path]) => [path, id])),
  }
}

describe('knowledgeFolderPathForId', () => {
  it('renders the active folder path', () => {
    expect(knowledgeFolderPathForId(indexWith({ 'folder-1': '/Product' }), 'folder-1')).toBe(
      '/Product'
    )
  })

  it('reports the root for a knowledge base that sits at the workspace root', () => {
    expect(knowledgeFolderPathForId(indexWith({}), null)).toBe('/')
    expect(knowledgeFolderPathForId(indexWith({}), undefined)).toBe('/')
  })

  /**
   * The index holds active folders only, so an archived knowledge base whose
   * folder was archived alongside it — or one whose folder was deleted — has no
   * path to render. Falling back to the root keeps a well-formed read a 200; it
   * used to throw, which reached the v2 surface as a caller-reachable 500.
   */
  it('falls back to the root when the folder is archived or missing', () => {
    expect(knowledgeFolderPathForId(indexWith({ 'folder-1': '/Product' }), 'archived-folder')).toBe(
      '/'
    )
  })
})
