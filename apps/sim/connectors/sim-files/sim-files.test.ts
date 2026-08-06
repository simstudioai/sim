/**
 * @vitest-environment node
 */
import { flattenMockConditions, type MockCondition } from '@sim/testing'
import { describe, expect, it } from 'vitest'
import {
  buildFileListingFilters,
  collectDescendantFolderIds,
  decodeCursor,
  encodeCursor,
  type FileRow,
  fileRowToStub,
  normalizeExt,
  parseOptionalPositiveInt,
} from '@/connectors/sim-files/sim-files'

const BASE_ROW: FileRow = {
  id: 'file-1',
  originalName: 'spec.md',
  contentType: 'text/markdown',
  size: 2048,
  folderId: 'folder-specs',
  userId: 'user-1',
  contentUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
}

function conditionsOf(args: Parameters<typeof buildFileListingFilters>[0]): MockCondition[] {
  return buildFileListingFilters(args).flatMap(flattenMockConditions)
}

/** The schema mock represents each column as its own camelCase name. */
function columnNames(nodes: MockCondition[]): string[] {
  return nodes.map((node) => String(node.left ?? node.column ?? ''))
}

/** `flattenMockConditions` unwraps `and` but not `or`, which the keyset clause uses. */
function orBranches(nodes: MockCondition[]): MockCondition[] {
  return nodes
    .filter((node) => node.type === 'or')
    .flatMap((node) => (node.conditions as MockCondition[]) ?? [])
    .flatMap(flattenMockConditions)
}

describe('collectDescendantFolderIds', () => {
  const FOLDERS = [
    { id: 'root', parentId: null },
    { id: 'docs', parentId: 'root' },
    { id: 'specs', parentId: 'docs' },
    { id: 'deep', parentId: 'specs' },
    { id: 'other', parentId: 'root' },
  ]

  it('collects the whole subtree including the root itself', () => {
    expect(collectDescendantFolderIds(FOLDERS, 'docs').sort()).toEqual(['deep', 'docs', 'specs'])
  })

  it('excludes siblings and ancestors', () => {
    const result = collectDescendantFolderIds(FOLDERS, 'specs')
    expect(result.sort()).toEqual(['deep', 'specs'])
    expect(result).not.toContain('other')
    expect(result).not.toContain('docs')
  })

  it('returns just the root when it has no children', () => {
    expect(collectDescendantFolderIds(FOLDERS, 'deep')).toEqual(['deep'])
  })

  it('returns the id itself when the folder is unknown', () => {
    expect(collectDescendantFolderIds(FOLDERS, 'missing')).toEqual(['missing'])
  })

  /** An unguarded breadth-first walk would spin forever on this input. */
  it('terminates on a parentId cycle', () => {
    const cyclic = [
      { id: 'a', parentId: 'b' },
      { id: 'b', parentId: 'a' },
    ]
    expect(collectDescendantFolderIds(cyclic, 'a').sort()).toEqual(['a', 'b'])
  })
})

describe('fileRowToStub', () => {
  it('defers content and reports size for the engine byte budget', () => {
    const stub = fileRowToStub(BASE_ROW, 'ws-1', 'Docs/Specs')

    expect(stub.externalId).toBe('file-1')
    expect(stub.title).toBe('spec.md')
    expect(stub.contentDeferred).toBe(true)
    expect(stub.content).toBe('')
    expect(stub.metadata?.fileSize).toBe(2048)
    expect(stub.metadata?.folderPath).toBe('Docs/Specs')
  })

  /**
   * A rename or a move changes what gets indexed (title, folder tag) without touching
   * `contentUpdatedAt`, so the hash must move or the knowledge base keeps stale values.
   */
  it('changes the hash on rename, move, and content write', () => {
    const base = fileRowToStub(BASE_ROW, 'ws-1', 'Docs/Specs').contentHash

    const renamed = fileRowToStub({ ...BASE_ROW, originalName: 'spec-v2.md' }, 'ws-1', 'Docs/Specs')
    const moved = fileRowToStub({ ...BASE_ROW, folderId: 'folder-other' }, 'ws-1', 'Docs/Other')
    const rewritten = fileRowToStub(
      { ...BASE_ROW, contentUpdatedAt: new Date('2026-02-02T00:00:00.000Z') },
      'ws-1',
      'Docs/Specs'
    )

    expect(renamed.contentHash).not.toBe(base)
    expect(moved.contentHash).not.toBe(base)
    expect(rewritten.contentHash).not.toBe(base)
  })

  /**
   * `updatedAt` moves on metadata-only writes. Re-hashing on those would re-download
   * and re-embed every file for no reason.
   */
  it('keeps the hash stable when only updatedAt moves', () => {
    const before = fileRowToStub(BASE_ROW, 'ws-1', 'Docs/Specs').contentHash
    const after = fileRowToStub(
      { ...BASE_ROW, updatedAt: new Date('2026-03-03T00:00:00.000Z') },
      'ws-1',
      'Docs/Specs'
    ).contentHash

    expect(after).toBe(before)
  })

  /**
   * Renaming an ancestor folder rewrites the stored path tag but writes only the
   * `folder` table — `contentUpdatedAt`, `originalName` and `folderId` all stay put,
   * so without the path in the hash the document keeps the old folder tag forever.
   */
  it('changes the hash when an ancestor folder rename moves the path', () => {
    expect(fileRowToStub(BASE_ROW, 'ws-1', 'Documentation/Specs').contentHash).not.toBe(
      fileRowToStub(BASE_ROW, 'ws-1', 'Docs/Specs').contentHash
    )
  })

  /** listDocuments and getDocument must produce byte-identical hashes for one row. */
  it('is deterministic for the same row', () => {
    expect(fileRowToStub(BASE_ROW, 'ws-1', 'Docs/Specs').contentHash).toBe(
      fileRowToStub({ ...BASE_ROW }, 'ws-1', 'Docs/Specs').contentHash
    )
  })
})

describe('buildFileListingFilters', () => {
  /**
   * The builder takes no `sourceConfig`, so this proves only that the supplied
   * workspace is bound. That the connector never READS `sourceConfig.workspaceId`
   * is proven end to end by the sync harness, not here.
   */
  it('binds the supplied workspace', () => {
    const nodes = conditionsOf({ workspaceId: 'ws-real', folderIds: null, rootOnly: false })
    const workspaceClause = nodes.find((node) => node.left === 'workspaceId')

    expect(workspaceClause).toMatchObject({ type: 'eq', right: 'ws-real' })
  })

  /**
   * Without the `context` clause a knowledge base would ingest every member's private
   * copilot and chat attachments, which live in the same table under the same workspace.
   */
  it('always restricts to workspace-context files and excludes deleted rows', () => {
    const nodes = conditionsOf({ workspaceId: 'ws-1', folderIds: null, rootOnly: false })

    expect(nodes).toContainEqual(expect.objectContaining({ type: 'eq', right: 'workspace' }))
    expect(columnNames(nodes)).toContain('deletedAt')
  })

  it('scopes to a folder subtree when one is given', () => {
    const nodes = conditionsOf({
      workspaceId: 'ws-1',
      folderIds: ['folder-a', 'folder-b'],
      rootOnly: false,
    })

    expect(nodes).toContainEqual(
      expect.objectContaining({ type: 'inArray', values: ['folder-a', 'folder-b'] })
    )
  })

  /** `inArray(col, [])` is invalid SQL, so an empty scope needs its own match-nothing clause. */
  it('matches nothing rather than everything for an empty folder scope', () => {
    const nodes = conditionsOf({ workspaceId: 'ws-1', folderIds: [], rootOnly: false })

    expect(nodes).toContainEqual(expect.objectContaining({ type: 'eq', right: '' }))
    expect(nodes.some((node) => node.type === 'inArray')).toBe(false)
  })

  it('restricts to unfoldered files when subfolders are excluded at the root', () => {
    const nodes = conditionsOf({ workspaceId: 'ws-1', folderIds: null, rootOnly: true })
    expect(columnNames(nodes.filter((n) => n.type === 'isNull'))).toContain('folderId')
  })

  /**
   * The keyset direction must match ORDER BY. Ascending walks forward with `gt`;
   * descending (used when a cap is set, so the cap means "most recently active N"
   * rather than "oldest N") must walk with `lt` or the second page repeats page one.
   */
  it('flips the keyset comparison when the listing is descending', () => {
    const cursor = { updatedAt: new Date('2026-01-01T00:00:00.000Z'), id: 'file-1' }
    const ascending = orBranches(
      conditionsOf({ workspaceId: 'ws-1', folderIds: null, rootOnly: false, cursor })
    )
    const descending = orBranches(
      conditionsOf({
        workspaceId: 'ws-1',
        folderIds: null,
        rootOnly: false,
        cursor,
        descending: true,
      })
    )

    expect(ascending.some((node) => node.type === 'gt')).toBe(true)
    expect(ascending.some((node) => node.type === 'lt')).toBe(false)
    expect(descending.some((node) => node.type === 'lt')).toBe(true)
    expect(descending.some((node) => node.type === 'gt')).toBe(false)
  })

  it('adds a keyset clause only when paginating', () => {
    const first = conditionsOf({ workspaceId: 'ws-1', folderIds: null, rootOnly: false })
    const next = conditionsOf({
      workspaceId: 'ws-1',
      folderIds: null,
      rootOnly: false,
      cursor: { updatedAt: new Date('2026-01-01T00:00:00.000Z'), id: 'file-1' },
    })

    expect(first.some((node) => node.type === 'or')).toBe(false)
    expect(orBranches(next).some((node) => node.type === 'gt')).toBe(true)
    expect(columnNames(orBranches(next))).toContain('updatedAt')
  })
})

describe('cursor', () => {
  it('round-trips a keyset position', () => {
    const row = { updatedAt: new Date('2026-01-02T03:04:05.678Z'), id: 'file-9' }
    const decoded = decodeCursor(encodeCursor(row))

    expect(decoded.id).toBe('file-9')
    expect(decoded.updatedAt.toISOString()).toBe(row.updatedAt.toISOString())
  })

  it('preserves ids containing the separator', () => {
    const row = { updatedAt: new Date('2026-01-02T03:04:05.678Z'), id: 'weird|id' }
    expect(decodeCursor(encodeCursor(row)).id).toBe('weird|id')
  })

  /** Rewinding instead would silently re-emit page one until MAX_PAGES. */
  it('throws on a malformed cursor rather than restarting the listing', () => {
    expect(() => decodeCursor('nonsense')).toThrow(/Malformed/)
    expect(() => decodeCursor('not-a-date|file-1')).toThrow(/Malformed/)
    expect(() => decodeCursor('2026-01-01T00:00:00.000Z|')).toThrow(/Malformed/)
  })
})

describe('normalizeExt', () => {
  it.each([
    ['spec.md', 'md'],
    ['REPORT.PDF', 'pdf'],
    ['archive.tar.gz', 'gz'],
    ['  notes.TXT  ', 'txt'],
    ['pdf', 'pdf'],
    ['.pdf', 'pdf'],
    ['Makefile', 'makefile'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizeExt(input)).toBe(expected)
  })
})

describe('parseOptionalPositiveInt', () => {
  it('treats blank values as unset', () => {
    expect(parseOptionalPositiveInt(undefined)).toBeUndefined()
    expect(parseOptionalPositiveInt('')).toBeUndefined()
    expect(parseOptionalPositiveInt(null)).toBeUndefined()
  })

  it('accepts positive integers', () => {
    expect(parseOptionalPositiveInt('1000')).toBe(1000)
    expect(parseOptionalPositiveInt(5)).toBe(5)
  })

  it('rejects zero, negatives, fractions, and non-numbers', () => {
    expect(parseOptionalPositiveInt('0')).toBeNull()
    expect(parseOptionalPositiveInt('-3')).toBeNull()
    expect(parseOptionalPositiveInt('1.5')).toBeNull()
    expect(parseOptionalPositiveInt('lots')).toBeNull()
  })
})
