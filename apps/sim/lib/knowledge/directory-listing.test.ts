/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  type KnowledgeDirectoryBase,
  type KnowledgeDirectoryFolder,
  selectKnowledgeDirectoryEntries,
} from '@/lib/knowledge/directory-listing'

const TIMESTAMP = '2026-01-16T09:00:00.000Z'

function folder(
  id: string,
  name: string,
  path: string,
  parentPath: string,
  parentId: string | null
): KnowledgeDirectoryFolder {
  return { id, parentId, name, path, parentPath, createdAt: TIMESTAMP, updatedAt: TIMESTAMP }
}

function base(id: string, name: string, folderId: string | null): KnowledgeDirectoryBase {
  return {
    id,
    name,
    description: null,
    folderId,
    docCount: 1,
    tokenCount: 10,
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
  }
}

/*
 * `Reports/Q3\/Q4` is one folder whose NAME contains a slash. It is one level in
 * both path spellings and two if either is split on `/`, so it belongs in every
 * fixture that walks this tree.
 */
const FOLDERS: KnowledgeDirectoryFolder[] = [
  folder('reports', 'Reports', '/Reports', '/', null),
  folder('quarters', 'Q3/Q4', '/Reports/Q3%2FQ4', '/Reports', 'reports'),
  folder('archive', 'Archive', '/Archive', '/', null),
]

const BASES: KnowledgeDirectoryBase[] = [
  base('kb-root', 'Root Handbook', null),
  base('kb-reports', 'Reports FAQ', 'reports'),
  base('kb-quarters', 'Quarterly Notes', 'quarters'),
]

const UNLIMITED = Number.POSITIVE_INFINITY

describe('selectKnowledgeDirectoryEntries', () => {
  it('lists direct children only at depth 1', () => {
    const { entries, truncated } = selectKnowledgeDirectoryEntries(FOLDERS, BASES, {
      rootId: null,
      rootPath: '/',
      maxDepth: 1,
      limit: 100,
    })

    expect(truncated).toBe(false)
    expect(entries.map((entry) => [entry.kind, entry.name])).toEqual([
      ['folder', 'Archive'],
      ['folder', 'Reports'],
      ['knowledge_base', 'Root Handbook'],
    ])
  })

  it('treats a folder whose name contains a slash as one level', () => {
    const { entries } = selectKnowledgeDirectoryEntries(FOLDERS, BASES, {
      rootId: 'reports',
      rootPath: '/Reports',
      maxDepth: 1,
      limit: 100,
    })

    const quarters = entries.find((entry) => entry.kind === 'folder' && entry.name === 'Q3/Q4')
    expect(quarters).toMatchObject({ kind: 'folder', depth: 1, path: '/Reports/Q3%2FQ4' })
    /* Its knowledge base is a level deeper, so a depth-1 listing must not reach it. */
    expect(entries.map((entry) => entry.name)).not.toContain('Quarterly Notes')
  })

  it('reports a knowledge base under a slash-named folder at that folder path', () => {
    const { entries } = selectKnowledgeDirectoryEntries(FOLDERS, BASES, {
      rootId: 'reports',
      rootPath: '/Reports',
      maxDepth: UNLIMITED,
      limit: 100,
    })

    expect(entries.find((entry) => entry.name === 'Quarterly Notes')).toMatchObject({
      kind: 'knowledge_base',
      depth: 2,
      folderPath: '/Reports/Q3%2FQ4',
    })
  })

  it('walks the whole subtree when depth is unbounded', () => {
    const { entries } = selectKnowledgeDirectoryEntries(FOLDERS, BASES, {
      rootId: null,
      rootPath: '/',
      maxDepth: UNLIMITED,
      limit: 100,
    })

    expect(entries.map((entry) => entry.name)).toEqual([
      'Archive',
      'Reports',
      'Root Handbook',
      'Q3/Q4',
      'Reports FAQ',
      'Quarterly Notes',
    ])
  })

  it('reports a deep match at its real depth even when no ancestor matches', () => {
    const { entries } = selectKnowledgeDirectoryEntries(FOLDERS, BASES, {
      rootId: null,
      rootPath: '/',
      maxDepth: UNLIMITED,
      search: 'quarterly',
      limit: 100,
    })

    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ name: 'Quarterly Notes', depth: 3 })
  })

  it('matches case-insensitively on the entry name', () => {
    const { entries } = selectKnowledgeDirectoryEntries(FOLDERS, BASES, {
      rootId: null,
      rootPath: '/',
      maxDepth: UNLIMITED,
      search: 'ARCHIVE',
      limit: 100,
    })

    expect(entries.map((entry) => entry.name)).toEqual(['Archive'])
  })

  it('flags a listing the limit cut short', () => {
    const { entries, truncated } = selectKnowledgeDirectoryEntries(FOLDERS, BASES, {
      rootId: null,
      rootPath: '/',
      maxDepth: UNLIMITED,
      limit: 2,
    })

    expect(entries).toHaveLength(2)
    expect(truncated).toBe(true)
  })

  it('places a knowledge base sitting directly in the listed folder at the root path', () => {
    const { entries } = selectKnowledgeDirectoryEntries(FOLDERS, BASES, {
      rootId: 'reports',
      rootPath: '/Reports',
      maxDepth: 1,
      limit: 100,
    })

    expect(entries.find((entry) => entry.name === 'Reports FAQ')).toMatchObject({
      kind: 'knowledge_base',
      depth: 1,
      folderPath: '/Reports',
    })
  })

  it('excludes anything outside the listed folder', () => {
    const { entries } = selectKnowledgeDirectoryEntries(FOLDERS, BASES, {
      rootId: 'archive',
      rootPath: '/Archive',
      maxDepth: UNLIMITED,
      limit: 100,
    })

    expect(entries).toEqual([])
  })
})
