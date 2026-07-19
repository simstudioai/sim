/**
 * @vitest-environment node
 */
import { dbChainMock, dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it } from 'vitest'
import type { DbOrTx } from '@/lib/db/types'
import {
  listForkCopyableSourceResources,
  listForkResourceCandidates,
  loadForkCopyableResourceLabels,
} from '@/ee/workspace-forking/lib/mapping/resources'

const executor = dbChainMock.db as unknown as DbOrTx

describe('listForkResourceCandidates', () => {
  beforeEach(() => {
    resetDbChainMock()
  })

  it('populates file candidates keyed by storage key and leaves knowledge-document empty', async () => {
    // The grouped queries resolve in Promise.all array order, each ending in `.limit()`:
    // credentials, workspace env, tables, knowledge bases, MCP servers, custom tools, skills,
    // files. Queue the eight results in that exact order.
    dbChainMockFns.limit
      .mockResolvedValueOnce([
        { id: 'cred-1', displayName: 'Cred One', providerId: 'google-email' },
      ])
      .mockResolvedValueOnce([{ variables: { API_KEY: 'secret' } }])
      .mockResolvedValueOnce([{ id: 'tbl-1', label: 'Table One' }])
      .mockResolvedValueOnce([{ id: 'kb-1', label: 'KB One' }])
      .mockResolvedValueOnce([{ id: 'mcp-1', label: 'MCP One' }])
      .mockResolvedValueOnce([{ id: 'ct-1', label: 'Tool One' }])
      .mockResolvedValueOnce([{ id: 'sk-1', label: 'Skill One' }])
      .mockResolvedValueOnce([
        { id: 'workspace/WS/report.pdf', label: 'report.pdf' },
        { id: 'workspace/WS/notes.md', label: 'notes.md' },
      ])

    const result = await listForkResourceCandidates(executor, 'ws-1')

    // Files are mapping targets keyed by storage key (matching how `file-upload` references store
    // them) - never a `workspace_files.id`.
    expect(result.file).toEqual([
      { id: 'workspace/WS/report.pdf', label: 'report.pdf' },
      { id: 'workspace/WS/notes.md', label: 'notes.md' },
    ])
    // Documents are not a standalone mappable kind - they ride their KB via the reconfigure flow.
    expect(result['knowledge-document']).toEqual([])
    expect(result['env-var']).toEqual([{ id: 'API_KEY', label: 'API_KEY' }])
  })
})

describe('listForkCopyableSourceResources', () => {
  beforeEach(() => {
    resetDbChainMock()
  })

  it('lists every sync-copyable kind, files keyed by storage key with folder grouping', async () => {
    // The grouped queries resolve in Promise.all array order, each ending in `.limit()`:
    // files (with folder), tables, knowledge bases, custom tools, skills.
    dbChainMockFns.limit
      .mockResolvedValueOnce([
        {
          id: 'file-row-1',
          key: 'workspace/SRC/a.png',
          label: 'a.png',
          folderId: 'fld-1',
          folderName: 'Images',
        },
        {
          id: 'file-row-2',
          key: 'workspace/SRC/root.txt',
          label: 'root.txt',
          folderId: null,
          folderName: null,
        },
      ])
      .mockResolvedValueOnce([{ id: 'tbl-1', label: 'Table One' }])
      .mockResolvedValueOnce([{ id: 'kb-1', label: 'KB One' }])
      .mockResolvedValueOnce([{ id: 'ct-1', label: 'Tool One' }])
      .mockResolvedValueOnce([{ id: 'sk-1', label: 'Skill One' }])

    const result = await listForkCopyableSourceResources(executor, 'ws-src')

    expect(result).toEqual([
      // Files are addressed by STORAGE KEY (matching `file-upload` references + the promote copy
      // selection), never by `workspace_files.id`, and carry their folder grouping.
      {
        kind: 'file',
        sourceId: 'workspace/SRC/a.png',
        label: 'a.png',
        parentId: 'fld-1',
        parentLabel: 'Images',
      },
      {
        kind: 'file',
        sourceId: 'workspace/SRC/root.txt',
        label: 'root.txt',
        parentId: null,
        parentLabel: null,
      },
      { kind: 'table', sourceId: 'tbl-1', label: 'Table One', parentId: null, parentLabel: null },
      {
        kind: 'knowledge-base',
        sourceId: 'kb-1',
        label: 'KB One',
        parentId: null,
        parentLabel: null,
      },
      {
        kind: 'custom-tool',
        sourceId: 'ct-1',
        label: 'Tool One',
        parentId: null,
        parentLabel: null,
      },
      { kind: 'skill', sourceId: 'sk-1', label: 'Skill One', parentId: null, parentLabel: null },
    ])
  })
})

describe('loadForkCopyableResourceLabels', () => {
  beforeEach(() => {
    resetDbChainMock()
  })

  it('carries the folder grouping for file entries (id + name, null at the root)', async () => {
    // Only the file branch queries (no other kind has ids), so its terminal `.where()` is the
    // single chain call.
    dbChainMockFns.where.mockResolvedValueOnce([
      { key: 'workspace/SRC/a.png', label: 'a.png', folderId: 'fld-1', folderName: 'Images' },
      { key: 'workspace/SRC/root.txt', label: 'root.txt', folderId: null, folderName: null },
    ])

    const labels = await loadForkCopyableResourceLabels(executor, 'ws-src', {
      file: ['workspace/SRC/a.png', 'workspace/SRC/root.txt'],
    })

    expect(labels.get('file:workspace/SRC/a.png')).toEqual({
      label: 'a.png',
      parentId: 'fld-1',
      parentLabel: 'Images',
    })
    // A file at the workspace root (or whose folder was deleted) carries null folder grouping.
    expect(labels.get('file:workspace/SRC/root.txt')).toEqual({
      label: 'root.txt',
      parentId: null,
      parentLabel: null,
    })
  })

  it('returns null folder grouping for non-file kinds (they render flat)', async () => {
    dbChainMockFns.where.mockResolvedValueOnce([{ id: 'kb-1', label: 'KB One' }])

    const labels = await loadForkCopyableResourceLabels(executor, 'ws-src', {
      'knowledge-base': ['kb-1'],
    })

    expect(labels.get('knowledge-base:kb-1')).toEqual({
      label: 'KB One',
      parentId: null,
      parentLabel: null,
    })
  })
})
