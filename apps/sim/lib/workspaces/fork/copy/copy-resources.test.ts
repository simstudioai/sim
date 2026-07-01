/**
 * @vitest-environment node
 */
import {
  dbChainMock,
  dbChainMockFns,
  resetDbChainMock,
  storageServiceMock,
  storageServiceMockFns,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/db', () => dbChainMock)
vi.mock('@/lib/uploads/core/storage-service', () => storageServiceMock)

import type { DbOrTx } from '@/lib/db/types'
import {
  copyForkResourceContainers,
  copyForkResourceContent,
  type ForkContentPlan,
  planForkMappedKbDocumentCopies,
} from '@/lib/workspaces/fork/copy/copy-resources'
import type { ForkReferenceResolver } from '@/lib/workspaces/fork/remap/remap-references'

function basePlan(overrides: Partial<ForkContentPlan> = {}): ForkContentPlan {
  return {
    sourceWorkspaceId: 'src-ws',
    childWorkspaceId: 'child-ws',
    userId: 'user-1',
    tables: [],
    knowledgeBases: [],
    skills: [],
    documents: [],
    ...overrides,
  }
}

const sourceDoc = {
  id: 'doc-1',
  knowledgeBaseId: 'src-kb',
  storageKey: 'kb/source-key',
  fileUrl: '/api/files/serve/kb%2Fsource-key',
  filename: 'report.pdf',
  mimeType: 'application/pdf',
}

describe('copyForkResourceContent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    storageServiceMockFns.mockDownloadFile.mockResolvedValue(Buffer.from('blob-bytes'))
    storageServiceMockFns.mockUploadFile.mockResolvedValue({
      key: 'kb/child-key',
      path: '/api/files/serve/kb/child-key',
    })
  })

  it('rewrites in-workspace resource URLs nested in copied table cell data', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        id: 'r1',
        tableId: 'src-tbl',
        workspaceId: 'src-ws',
        data: {
          kb: '/workspace/src-ws/knowledge/kb-1',
          nested: { wf: '/workspace/src-ws/w/wf-1' },
          plain: 'no url here',
        },
      },
    ])

    const result = await copyForkResourceContent({
      contentPlan: basePlan({ tables: [{ sourceId: 'src-tbl', childId: 'child-tbl' }] }),
      contentRefMaps: {
        workspaceId: { from: 'src-ws', to: 'child-ws' },
        knowledgeBases: new Map([['kb-1', 'kb-2']]),
        workflows: new Map([['wf-1', 'wf-2']]),
      },
      requestId: 'test',
    })

    expect(result.failed).toBe(0)
    // The first insert is the table-rows copy (no KBs/docs/skills in this plan).
    const inserted = dbChainMockFns.values.mock.calls[0][0] as Array<{
      data: { kb: string; nested: { wf: string }; plain: string }
    }>
    expect(inserted[0].data.kb).toBe('/workspace/child-ws/knowledge/kb-2')
    expect(inserted[0].data.nested.wf).toBe('/workspace/child-ws/w/wf-2')
    expect(inserted[0].data.plain).toBe('no url here')
  })

  it('#1 binds a copied KB document blob to the CHILD workspace + initiating user', async () => {
    // One live document page, then the embeddings page resolves empty (default).
    dbChainMockFns.limit.mockResolvedValueOnce([sourceDoc])

    const result = await copyForkResourceContent({
      contentPlan: basePlan({
        knowledgeBases: [{ sourceId: 'src-kb', childId: 'child-kb', documentIdMap: {} }],
      }),
      requestId: 'test',
    })

    expect(result.failed).toBe(0)
    expect(result.copied).toBe(1)
    expect(storageServiceMockFns.mockUploadFile).toHaveBeenCalledTimes(1)
    const uploadArg = storageServiceMockFns.mockUploadFile.mock.calls[0][0]
    expect(uploadArg.context).toBe('knowledge-base')
    expect(uploadArg.preserveKey).toBe(true)
    // The ownership binding is what verifyKBFileAccess resolves the owning workspace from;
    // it must name the CHILD workspace and the initiating user, or the copy is download-denied.
    expect(uploadArg.metadata).toEqual({
      userId: 'user-1',
      workspaceId: 'child-ws',
      originalName: 'report.pdf',
    })
  })

  it('#4 re-reads a copied skill body post-commit and rewrites it via db.update (never from payload)', async () => {
    // The body is no longer carried in the plan - the content phase keyset-re-reads the child row.
    dbChainMockFns.limit.mockResolvedValueOnce([
      { id: 'child-skill-1', content: 'see [K](sim:knowledge/src-kb)' },
    ])

    const result = await copyForkResourceContent({
      contentPlan: basePlan({ skills: [{ childId: 'child-skill-1' }] }),
      contentRefMaps: { knowledgeBases: new Map([['src-kb', 'child-kb']]) },
      requestId: 'test',
    })

    expect(result.failed).toBe(0)
    expect(dbChainMockFns.update).toHaveBeenCalledTimes(1)
    expect(dbChainMockFns.set).toHaveBeenCalledWith({
      content: 'see [K](sim:knowledge/child-kb)',
    })
  })

  it('#4 leaves a skill untouched when nothing in its re-read body remaps', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      { id: 'child-skill-1', content: 'no references here' },
    ])

    const result = await copyForkResourceContent({
      contentPlan: basePlan({ skills: [{ childId: 'child-skill-1' }] }),
      contentRefMaps: { knowledgeBases: new Map([['src-kb', 'child-kb']]) },
      requestId: 'test',
    })

    expect(result.failed).toBe(0)
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('#4 skips the skill re-read + rewrite entirely when no content maps are supplied', async () => {
    await copyForkResourceContent({
      contentPlan: basePlan({ skills: [{ childId: 'child-skill-1' }] }),
      requestId: 'test',
    })

    // No maps -> the body is neither re-read from the DB nor updated.
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('#3 fails the whole KB (all-or-nothing) when one document copy throws', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([sourceDoc])
    // The document row insert throws; the blob copy is best-effort (never throws) so the
    // failure must come from the persisted copy, marking the entire KB failed for cleanup.
    dbChainMockFns.values.mockImplementationOnce(() => {
      throw new Error('insert failed')
    })

    const result = await copyForkResourceContent({
      contentPlan: basePlan({
        knowledgeBases: [{ sourceId: 'src-kb', childId: 'child-kb', documentIdMap: {} }],
      }),
      requestId: 'test',
    })

    expect(result.copied).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.failures).toEqual([
      { kind: 'knowledge-base', childId: 'child-kb', documentChildIds: [] },
    ])
  })

  it('U-docs: fills a document copied into an existing target KB (blob re-key + placeholder update)', async () => {
    const result = await copyForkResourceContent({
      contentPlan: basePlan({
        documents: [
          {
            sourceDocId: 'doc-1',
            childDocId: 'child-doc-1',
            childKnowledgeBaseId: 'existing-target-kb',
            storageKey: 'kb/source-key',
            filename: 'report.pdf',
            mimeType: 'application/pdf',
          },
        ],
      }),
      requestId: 'test',
    })

    expect(result.failed).toBe(0)
    expect(result.copied).toBe(1)
    // The blob is re-keyed and the pre-created placeholder row's blob fields are updated.
    expect(storageServiceMockFns.mockUploadFile).toHaveBeenCalledTimes(1)
    expect(dbChainMockFns.update).toHaveBeenCalledTimes(1)
  })

  it('U-docs: a failed document fill is reported as a knowledge-document failure (for cleanup)', async () => {
    // The placeholder blob update throws; the doc fails on its own without touching its KB.
    dbChainMockFns.set.mockImplementationOnce(() => {
      throw new Error('update failed')
    })

    const result = await copyForkResourceContent({
      contentPlan: basePlan({
        documents: [
          {
            sourceDocId: 'doc-1',
            childDocId: 'child-doc-1',
            childKnowledgeBaseId: 'existing-target-kb',
            storageKey: 'kb/source-key',
            filename: 'report.pdf',
            mimeType: 'application/pdf',
          },
        ],
      }),
      requestId: 'test',
    })

    expect(result.copied).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.failures).toEqual([{ kind: 'knowledge-document', childId: 'child-doc-1' }])
  })
})

describe('copyForkResourceContainers custom-tool code env rewrite', () => {
  function makeContainerTx(rows: Array<Record<string, unknown>>) {
    const inserted: Array<Record<string, unknown>> = []
    const tx = {
      select: () => ({ from: () => ({ where: () => Promise.resolve(rows) }) }),
      insert: () => ({
        values: (values: Array<Record<string, unknown>>) => {
          inserted.push(...values)
          return Promise.resolve()
        },
      }),
    }
    return { tx: tx as unknown as DbOrTx, inserted }
  }

  const customToolSelection = {
    customTools: ['ct-1'],
    skills: [],
    workflowMcpServers: [],
    tables: [],
    knowledgeBases: [],
  }

  it('rewrites {{ENV}} refs in copied custom-tool code when a sync renames the env var', async () => {
    const { tx, inserted } = makeContainerTx([
      { id: 'ct-1', title: 'Tool', code: 'fetch("{{SLACK_API_KEY}}", "{{KEEP}}")' },
    ])
    await copyForkResourceContainers({
      tx,
      sourceWorkspaceId: 'src-ws',
      childWorkspaceId: 'child-ws',
      userId: 'user-1',
      now: new Date(),
      selection: customToolSelection,
      workflowIdMap: new Map(),
      resolveEnvName: (key) => (key === 'SLACK_API_KEY' ? 'SLACK_API_KEY_TEST' : key),
    })
    expect(inserted).toHaveLength(1)
    // The renamed key is rewritten; the same-name key is left verbatim.
    expect(inserted[0].code).toBe('fetch("{{SLACK_API_KEY_TEST}}", "{{KEEP}}")')
    expect(inserted[0].workspaceId).toBe('child-ws')
  })

  it('preserves custom-tool code verbatim when no env resolver is provided (fork-create)', async () => {
    const { tx, inserted } = makeContainerTx([
      { id: 'ct-1', title: 'Tool', code: 'fetch("{{SLACK_API_KEY}}")' },
    ])
    await copyForkResourceContainers({
      tx,
      sourceWorkspaceId: 'src-ws',
      childWorkspaceId: 'child-ws',
      userId: 'user-1',
      now: new Date(),
      selection: customToolSelection,
      workflowIdMap: new Map(),
    })
    expect(inserted[0].code).toBe('fetch("{{SLACK_API_KEY}}")')
  })
})

describe('copyForkResourceContainers skill copy', () => {
  function makeSkillTx(rows: Array<Record<string, unknown>>) {
    const inserted: Array<Record<string, unknown>> = []
    const tx = {
      select: () => ({ from: () => ({ where: () => Promise.resolve(rows) }) }),
      insert: () => ({
        values: (values: Array<Record<string, unknown>>) => {
          inserted.push(...values)
          return Promise.resolve()
        },
      }),
    }
    return { tx: tx as unknown as DbOrTx, inserted }
  }

  const skillSelection = {
    customTools: [],
    skills: ['sk-1'],
    workflowMcpServers: [],
    tables: [],
    knowledgeBases: [],
  }

  it('copies the skill body IN-DB and carries only the child id in the content plan', async () => {
    // The source projection deliberately omits `content` (it is copied server-side), so the row
    // fed to the tx mock has none - the body must never be materialized in app memory here.
    const { tx, inserted } = makeSkillTx([
      {
        id: 'sk-1',
        name: 'My Skill',
        description: 'desc',
        workspaceId: 'src-ws',
        userId: 'src-user',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ])

    const result = await copyForkResourceContainers({
      tx,
      sourceWorkspaceId: 'src-ws',
      childWorkspaceId: 'child-ws',
      userId: 'user-1',
      now: new Date(),
      selection: skillSelection,
      workflowIdMap: new Map(),
    })

    expect(inserted).toHaveLength(1)
    const childId = inserted[0].id as string
    expect(childId).not.toBe('sk-1')
    expect(inserted[0].workspaceId).toBe('child-ws')
    expect(inserted[0].userId).toBe('user-1')
    // The body is deferred to a correlated subquery (in-DB copy), never a materialized string.
    expect(typeof inserted[0].content).not.toBe('string')
    // The content plan carries ONLY the child id - no skill body text crosses the job payload.
    expect(result.contentPlan.skills).toEqual([{ childId }])
    expect(result.names.skills).toEqual(['My Skill'])
  })
})

describe('planForkMappedKbDocumentCopies', () => {
  const sourceRow = (id: string, knowledgeBaseId: string) => ({
    id,
    knowledgeBaseId,
    storageKey: `kb/${id}`,
    filename: `${id}.pdf`,
    mimeType: 'application/pdf',
    connectorId: 'connector-1',
    deletedAt: null,
    archivedAt: null,
  })

  function makeTx(docs: ReturnType<typeof sourceRow>[]) {
    const inserted: Array<Record<string, unknown>> = []
    let selectCalled = false
    const tx = {
      select: () => {
        selectCalled = true
        return { from: () => ({ where: () => Promise.resolve(docs) }) }
      },
      insert: () => ({
        values: (rows: Array<Record<string, unknown>>) => {
          inserted.push(...rows)
          return Promise.resolve()
        },
      }),
    }
    return { tx: tx as unknown as DbOrTx, inserted, wasSelectCalled: () => selectCalled }
  }

  const mappedKbResolver: ForkReferenceResolver = (kind, id) =>
    kind === 'knowledge-base' && id === 'src-kb' ? 'target-kb' : null

  it('places a referenced doc into its already-mapped existing KB and returns the maps', async () => {
    const { tx, inserted } = makeTx([sourceRow('doc-1', 'src-kb')])
    const result = await planForkMappedKbDocumentCopies({
      tx,
      resolver: mappedKbResolver,
      referencedDocumentIds: ['doc-1'],
      alreadyCopiedSourceDocIds: new Set(),
    })

    const childId = result.docIdMap.get('doc-1')
    expect(childId).toBeTruthy()
    expect(inserted).toHaveLength(1)
    expect(inserted[0]).toMatchObject({
      id: childId,
      knowledgeBaseId: 'target-kb',
      connectorId: null,
      deletedAt: null,
      archivedAt: null,
    })
    expect(result.mappingEntries).toEqual([
      { resourceType: 'knowledge_document', parentResourceId: 'doc-1', childResourceId: childId },
    ])
    expect(result.documents).toEqual([
      {
        sourceDocId: 'doc-1',
        childDocId: childId,
        childKnowledgeBaseId: 'target-kb',
        storageKey: 'kb/doc-1',
        filename: 'doc-1.pdf',
        mimeType: 'application/pdf',
      },
    ])
  })

  it('skips a referenced doc whose parent KB is not mapped (reference is left to be cleared)', async () => {
    const { tx, inserted } = makeTx([sourceRow('doc-1', 'unmapped-kb')])
    const result = await planForkMappedKbDocumentCopies({
      tx,
      resolver: mappedKbResolver,
      referencedDocumentIds: ['doc-1'],
      alreadyCopiedSourceDocIds: new Set(),
    })
    expect(inserted).toHaveLength(0)
    expect(result.docIdMap.size).toBe(0)
    expect(result.documents).toHaveLength(0)
  })

  it('skips a doc already placed under a copied KB this sync (no duplicate query)', async () => {
    const { tx, wasSelectCalled } = makeTx([sourceRow('doc-1', 'src-kb')])
    const result = await planForkMappedKbDocumentCopies({
      tx,
      resolver: mappedKbResolver,
      referencedDocumentIds: ['doc-1'],
      alreadyCopiedSourceDocIds: new Set(['doc-1']),
    })
    expect(result.documents).toHaveLength(0)
    expect(wasSelectCalled()).toBe(false)
  })

  it('skips a doc that already resolves (mapped by a prior sync)', async () => {
    const { tx, wasSelectCalled } = makeTx([sourceRow('doc-1', 'src-kb')])
    const result = await planForkMappedKbDocumentCopies({
      tx,
      resolver: (kind, id) =>
        kind === 'knowledge-document' && id === 'doc-1' ? 'existing-child-doc' : null,
      referencedDocumentIds: ['doc-1'],
      alreadyCopiedSourceDocIds: new Set(),
    })
    expect(result.documents).toHaveLength(0)
    expect(wasSelectCalled()).toBe(false)
  })
})
