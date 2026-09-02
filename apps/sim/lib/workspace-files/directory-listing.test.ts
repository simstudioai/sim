/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  type DirectoryFile,
  type DirectoryFolder,
  selectDirectoryEntries,
} from '@/lib/workspace-files/directory-listing'

function folder(id: string, parentId: string | null, path: string): DirectoryFolder {
  const name = path.split('/').pop() ?? path
  return {
    id,
    parentId,
    name,
    path: `/${path}`,
    parentPath: parentId ? `/${path.split('/').slice(0, -1).join('/')}` : '/',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function file(id: string, name: string, folderId: string | null): DirectoryFile {
  return { id, name, folderId, size: 10, type: 'text/plain', updatedAt: '2026-01-01T00:00:00.000Z' }
}

const folders = [
  folder('reports', null, 'Reports'),
  folder('q3', 'reports', 'Reports/Q3'),
  folder('week1', 'q3', 'Reports/Q3/Week1'),
  folder('archive', null, 'Archive'),
]

const files = [
  file('f-root', 'root.txt', null),
  file('f-reports', 'summary.txt', 'reports'),
  file('f-q3', 'q3.csv', 'q3'),
  file('f-week1', 'week1.md', 'week1'),
]

const ROOT = { rootId: null, rootPath: '/', maxDepth: 1, limit: 200 }

describe('selectDirectoryEntries', () => {
  /*
   * "What is in here" is one question, so folders and files come back together.
   * A file sits one level below the folder holding it, which is what makes a
   * non-recursive listing the direct subfolders plus the direct files.
   */
  it('lists direct children only by default', () => {
    const { entries } = selectDirectoryEntries(folders, files, ROOT)

    expect(entries.map((entry) => `${entry.kind}:${entry.name}`)).toEqual([
      'folder:Archive',
      'folder:Reports',
      'file:root.txt',
    ])
  })

  it('descends when the depth allows it', () => {
    const { entries } = selectDirectoryEntries(folders, files, {
      ...ROOT,
      maxDepth: Number.POSITIVE_INFINITY,
    })

    expect(entries.filter((entry) => entry.kind === 'file').map((entry) => entry.name)).toEqual([
      'root.txt',
      'summary.txt',
      'q3.csv',
      'week1.md',
    ])
  })

  /*
   * A file counts as one level below its folder, so the deepest folder a depth
   * admits arrives without its contents: at depth 2 the Q3 folder is listed but
   * q3.csv, which sits inside it, is depth 3. That boundary is the whole reason
   * depth is counted this way rather than over folders alone.
   */
  it('stops at the requested depth, listing the edge folder without its files', () => {
    const { entries } = selectDirectoryEntries(folders, files, { ...ROOT, maxDepth: 2 })
    const names = entries.map((entry) => entry.name)

    expect(names).toContain('Q3')
    expect(names).toContain('summary.txt')
    expect(names).not.toContain('q3.csv')
    expect(names).not.toContain('week1.md')
  })

  it('lists from a nested folder, counting depth from there', () => {
    const { entries } = selectDirectoryEntries(folders, files, {
      rootId: 'reports',
      rootPath: '/Reports',
      maxDepth: 1,
      limit: 200,
    })

    expect(entries.map((entry) => `${entry.kind}:${entry.name}:${entry.depth}`)).toEqual([
      'folder:Q3:1',
      'file:summary.txt:1',
    ])
  })

  it('shows folders before files at the same level, then by name', () => {
    const { entries } = selectDirectoryEntries(folders, files, {
      ...ROOT,
      maxDepth: Number.POSITIVE_INFINITY,
    })
    const level1 = entries.filter((entry) => entry.depth === 1)

    expect(level1.map((entry) => entry.kind)).toEqual(['folder', 'folder', 'file'])
  })

  /*
   * Search filters the result, not the traversal: a deep match still reports at
   * its real depth even though its parent folders do not match. Filtering the
   * walk instead would hide everything under an unmatched folder.
   */
  it('reports a deep match whose ancestors do not match', () => {
    const { entries } = selectDirectoryEntries(folders, files, {
      ...ROOT,
      maxDepth: Number.POSITIVE_INFINITY,
      search: 'week1',
    })

    expect(entries.map((entry) => `${entry.kind}:${entry.name}`)).toEqual([
      'folder:Week1',
      'file:week1.md',
    ])
  })

  it('matches case-insensitively', () => {
    const { entries } = selectDirectoryEntries(folders, files, { ...ROOT, search: 'ARCH' })

    expect(entries.map((entry) => entry.name)).toEqual(['Archive'])
  })

  it('tells a file its containing folder path', () => {
    const { entries } = selectDirectoryEntries(folders, files, {
      ...ROOT,
      maxDepth: Number.POSITIVE_INFINITY,
    })
    const nested = entries.find((entry) => entry.kind === 'file' && entry.name === 'q3.csv')

    expect(nested?.kind === 'file' && nested.folderPath).toBe('/Reports/Q3')
  })

  it('gives a root file the root path', () => {
    const { entries } = selectDirectoryEntries(folders, files, ROOT)
    const rootFile = entries.find((entry) => entry.kind === 'file')

    expect(rootFile?.kind === 'file' && rootFile.folderPath).toBe('/')
  })

  /*
   * A cut listing has to say so. Reporting the first N and looking complete is
   * the failure mode the flag exists to prevent.
   */
  it('reports truncation rather than looking complete', () => {
    const { entries, truncated } = selectDirectoryEntries(folders, files, { ...ROOT, limit: 2 })

    expect(entries).toHaveLength(2)
    expect(truncated).toBe(true)
  })

  it('is not truncated when everything fits', () => {
    expect(selectDirectoryEntries(folders, files, ROOT).truncated).toBe(false)
  })

  it('returns nothing for an empty workspace', () => {
    const { entries, truncated } = selectDirectoryEntries([], [], ROOT)

    expect(entries).toEqual([])
    expect(truncated).toBe(false)
  })

  it('leaves out a file whose folder is outside the listed subtree', () => {
    const { entries } = selectDirectoryEntries(folders, files, {
      rootId: 'archive',
      rootPath: '/Archive',
      maxDepth: Number.POSITIVE_INFINITY,
      limit: 200,
    })

    expect(entries).toEqual([])
  })
})
