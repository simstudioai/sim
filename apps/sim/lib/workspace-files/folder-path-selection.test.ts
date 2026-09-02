/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  isFileInFolderScope,
  resolveFolderIdsForPaths,
} from '@/lib/workspace-files/folder-path-selection'

/*
 * `Q3/Q4` is a folder whose NAME contains a slash: stored display paths escape
 * it, canonical paths percent-encode it. It is here because comparing the two
 * spellings as raw strings is the mistake this resolution exists to avoid.
 */
const folders = [
  { id: 'reports', parentId: null, path: 'Reports' },
  { id: 'q3', parentId: 'reports', path: 'Reports/Q3' },
  { id: 'week1', parentId: 'q3', path: 'Reports/Q3/Week 1' },
  { id: 'slashy', parentId: 'reports', path: 'Reports/Q3\\/Q4' },
  { id: 'archive', parentId: null, path: 'Archive' },
]

describe('resolveFolderIdsForPaths', () => {
  /*
   * A per-user memory tree makes the scope an isolation boundary rather than a
   * filter, so the sibling cases below are the ones that matter: `user-a` and
   * `user-a-2` share a prefix, and a resolver comparing raw strings instead of
   * decoded segments would hand one user the other's notes.
   */
  const memory = [
    { id: 'memory', parentId: null, path: 'memory' },
    { id: 'a', parentId: 'memory', path: 'memory/user-a' },
    { id: 'a-people', parentId: 'a', path: 'memory/user-a/people' },
    { id: 'a-commitments', parentId: 'a', path: 'memory/user-a/commitments' },
    { id: 'a2', parentId: 'memory', path: 'memory/user-a-2' },
    { id: 'a2-people', parentId: 'a2', path: 'memory/user-a-2/people' },
    { id: 'b', parentId: 'memory', path: 'memory/user-b' },
    { id: 'b-people', parentId: 'b', path: 'memory/user-b/people' },
  ]

  it("keeps one user's subtree out of another's scope", () => {
    const result = resolveFolderIdsForPaths(memory, ['/memory/user-a'])

    expect([...(result.folderIds ?? [])].sort()).toEqual(['a', 'a-commitments', 'a-people'])
  })

  it('does not let a shared name prefix widen the scope', () => {
    const result = resolveFolderIdsForPaths(memory, ['/memory/user-a'])

    expect(result.folderIds?.has('a2')).toBe(false)
    expect(result.folderIds?.has('a2-people')).toBe(false)
  })

  it('never climbs to a parent of the requested folder', () => {
    const result = resolveFolderIdsForPaths(memory, ['/memory/user-a/people'])

    expect([...(result.folderIds ?? [])]).toEqual(['a-people'])
  })

  it('takes the whole subtree by default', () => {
    const result = resolveFolderIdsForPaths(folders, ['/Reports'])

    expect([...(result.folderIds ?? [])].sort()).toEqual(['q3', 'reports', 'slashy', 'week1'])
  })

  it('takes only the folder itself when subfolders are excluded', () => {
    const result = resolveFolderIdsForPaths(folders, ['/Reports'], { includeSubfolders: false })

    expect([...(result.folderIds ?? [])]).toEqual(['reports'])
  })

  it('descends from a nested folder, not from the root', () => {
    const result = resolveFolderIdsForPaths(folders, ['/Reports/Q3'])

    expect([...(result.folderIds ?? [])].sort()).toEqual(['q3', 'week1'])
  })

  it('unions several paths', () => {
    const result = resolveFolderIdsForPaths(folders, ['/Reports/Q3', '/Archive'], {
      includeSubfolders: false,
    })

    expect([...(result.folderIds ?? [])].sort()).toEqual(['archive', 'q3'])
  })

  it('matches a folder whose name contains a slash', () => {
    const result = resolveFolderIdsForPaths(folders, ['/Reports/Q3%2FQ4'])

    expect([...(result.folderIds ?? [])]).toEqual(['slashy'])
  })

  it('reports a path that matches nothing rather than reading less', () => {
    const result = resolveFolderIdsForPaths(folders, ['/Reports', '/Nope'])

    expect(result.missingPath).toBe('/Nope')
    expect(result.folderIds).toBeUndefined()
  })

  it('selects nothing for no paths', () => {
    expect(resolveFolderIdsForPaths(folders, []).folderIds?.size).toBe(0)
  })
})

/*
 * Two path spellings circulate — the stored display form and the canonical form
 * anything projected carries. The list route resolves against already-projected
 * folders, and reading a canonical "/Reports" as a display path made an empty
 * first segment: "Workspace file folder path contains an empty name", thrown on
 * a folder the user had picked correctly.
 */
describe('either path spelling resolves', () => {
  const canonical = [
    { id: 'reports', parentId: null, path: '/Reports' },
    { id: 'q3', parentId: 'reports', path: '/Reports/Q3' },
    { id: 'slashy', parentId: 'reports', path: '/Reports/Q3%2FQ4' },
  ]

  it('resolves folders whose paths are already canonical', () => {
    const result = resolveFolderIdsForPaths(canonical, ['/Reports'])

    expect([...(result.folderIds ?? [])].sort()).toEqual(['q3', 'reports', 'slashy'])
  })

  it('still tells a slash in a name from a level separator', () => {
    expect([
      ...(resolveFolderIdsForPaths(canonical, ['/Reports/Q3%2FQ4']).folderIds ?? []),
    ]).toEqual(['slashy'])
  })

  it('scopes a file whose folder path is canonical', () => {
    expect(isFileInFolderScope('/Reports/Q3', '/Reports')).toBe(true)
    expect(isFileInFolderScope('/Reporting', '/Reports')).toBe(false)
  })
})

describe('isFileInFolderScope', () => {
  it('takes a file directly inside the scope', () => {
    expect(isFileInFolderScope('Reports', '/Reports')).toBe(true)
  })

  it('takes a file further down by default', () => {
    expect(isFileInFolderScope('Reports/Q3', '/Reports')).toBe(true)
  })

  it('leaves out a file further down when subfolders are excluded', () => {
    expect(isFileInFolderScope('Reports/Q3', '/Reports', { includeSubfolders: false })).toBe(false)
    expect(isFileInFolderScope('Reports', '/Reports', { includeSubfolders: false })).toBe(true)
  })

  it('leaves out a file in a sibling whose name merely starts the same', () => {
    expect(isFileInFolderScope('Reporting', '/Reports')).toBe(false)
  })

  it('leaves out a file at the workspace root', () => {
    expect(isFileInFolderScope(null, '/Reports')).toBe(false)
  })

  it('matches a folder whose name contains a slash', () => {
    expect(isFileInFolderScope('Reports/Q3\\/Q4', '/Reports/Q3%2FQ4')).toBe(true)
  })

  it('takes everything when the scope is the workspace root', () => {
    expect(isFileInFolderScope(null, '/')).toBe(true)
    expect(isFileInFolderScope('Reports', '/')).toBe(true)
  })
})

/*
 * The root decodes to no segments and no folder row has an empty segment list,
 * so before this it resolved as a missing path and every root-scoped read
 * failed with "Folder not found: /".
 */
describe('the workspace root', () => {
  it('selects files that carry no folder id', () => {
    const result = resolveFolderIdsForPaths(folders, ['/'])

    expect(result.missingPath).toBeUndefined()
    expect(result.includeRootItems).toBe(true)
  })

  it('takes every folder with it by default', () => {
    const result = resolveFolderIdsForPaths(folders, ['/'])

    expect([...(result.folderIds ?? [])].sort()).toEqual(folders.map((f) => f.id).sort())
  })

  it('takes only the loose files when subfolders are excluded', () => {
    const result = resolveFolderIdsForPaths(folders, ['/'], { includeSubfolders: false })

    expect([...(result.folderIds ?? [])]).toEqual([])
    expect(result.includeRootItems).toBe(true)
  })

  it('is not implied by an ordinary folder scope', () => {
    const result = resolveFolderIdsForPaths(folders, ['/Reports'])

    expect(result.includeRootItems).toBe(false)
  })
})
