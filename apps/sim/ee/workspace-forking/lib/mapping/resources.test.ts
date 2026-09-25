import {
  dbChainMock,
  dbChainMockFns,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it } from 'vitest'
import type { DbOrTx } from '@/lib/db/types'
import {
  listForkCopyableSourceResources,
  listForkResourceCandidates,
} from '@/lib/workflows/references/resources'

const executor = dbChainMock.db as unknown as DbOrTx

describe('listForkResourceCandidates', () => {
  beforeEach(() => {
    resetDbChainMock()
  })

  it('populates file candidates keyed by storage key and leaves knowledge-document empty', async () => {
    // The grouped queries resolve in Promise.all array order, each ending in `.limit()`:
    // credentials, workspace env, tables, knowledge bases, MCP servers, custom tools, skills,
    // files, custom blocks. Queue the first eight in that exact order; the custom-block query
    // resolves its workspace's organization first, finds nothing queued, and returns [].
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
      .mockResolvedValueOnce([
        { id: 'folder-reports', name: 'Reports', parentId: null },
        { id: 'folder-q3', name: 'Q3 Results', parentId: 'folder-reports' },
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
    expect(result['file-folder']).toEqual([
      { id: '/', label: 'Workspace root' },
      { id: '/Reports', label: 'Reports' },
      { id: '/Reports/Q3%20Results', label: 'Reports / Q3 Results' },
    ])
    expect(result['env-var']).toEqual([{ id: 'API_KEY', label: 'API_KEY' }])
  })
})

describe('custom-block mapping candidates', () => {
  beforeEach(() => {
    resetDbChainMock()
  })

  it('keys candidates by BLOCK TYPE and labels them with the source workspace', async () => {
    // A placed block references `custom_block_<slug>`, not `custom_block.id`, so the mapping
    // must key by type — the same rule `file` follows with storage keys. Both environments'
    // blocks usually share a name, so the workspace suffix is what makes the pick legible.
    queueTableRows(schemaMock.workspace, [{ organizationId: 'org-1' }])
    queueTableRows(schemaMock.customBlock, [
      { id: 'custom_block_prod01', name: 'Invoice Parser', sourceWorkspaceName: 'Impl (prod)' },
      { id: 'custom_block_uat001', name: 'Invoice Parser', sourceWorkspaceName: 'Impl (uat)' },
    ])

    const result = await listForkResourceCandidates(executor, 'ws-1')

    expect(result['custom-block']).toEqual([
      { id: 'custom_block_prod01', label: 'Invoice Parser (Impl (prod))' },
      { id: 'custom_block_uat001', label: 'Invoice Parser (Impl (uat))' },
    ])
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
