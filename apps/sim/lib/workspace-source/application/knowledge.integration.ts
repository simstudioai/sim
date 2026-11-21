/**
 * Real PostgreSQL (and local-disk storage) coverage for knowledge bases as workspace source: a
 * `knowledge/<key>/` folder creates, updates and deletes a knowledge base and its documents
 * through the knowledge use cases, with documents travelling as blobs in rounds. Every check runs
 * in its own workspace and reads the stored rows directly, so "nothing was written" means the rows
 * are unchanged. Writes a report to `WORKSPACE_SOURCE_KNOWLEDGE_REPORT_PATH`.
 */
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import {
  document,
  knowledgeBase,
  knowledgeConnector,
  member,
  organization,
  outboxEvent,
  permissionGroup,
  permissionGroupWorkspace,
  user,
  userStats,
  workspaceSourceStagedBlob,
} from '@sim/db/schema'
import { sha256Hex } from '@sim/security/hash'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { featureFlagsMock, featureFlagsMockFns } from '@sim/testing/mocks/feature-flags.mock'
import { posthogServerMock } from '@sim/testing/mocks/posthog-server.mock'
import { realtimeNotifyMock } from '@sim/testing/mocks/realtime-notify.mock'
import {
  resetUploadsSetupMock,
  setUploadDirServer,
  uploadsSetupMock,
} from '@sim/testing/mocks/uploads-setup.mock'
import { generateId } from '@sim/utils/id'
import { compareStrings } from '@sim/utils/string'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, vi } from 'vitest'

const embedding = vi.hoisted(() => ({ failure: null as Error | null }))
/**
 * The indexer stand-in at `processDocumentsWithQueue`, where every upload path's dispatch picks
 * its backend: it records each document handed to it and marks it indexed. While `gate` is set it
 * first waits for it, as the in-process backend waits for parsing and embedding.
 */
const indexer = vi.hoisted(() => ({
  gate: null as Promise<void> | null,
  release: () => {},
  dispatched: [] as Array<{ documentId: string; lane: string }>,
}))
/**
 * A write landing between two pages of a document listing: `afterPage` runs once, after the
 * first page of more than one document is admitted (the step every page of the document list
 * runs after it reads its rows), with that page's ids.
 */
const listing = vi.hoisted(() => ({
  afterPage: null as ((ids: string[]) => Promise<void>) | null,
}))
vi.mock('@/lib/knowledge/application/admit-knowledge-content', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/knowledge/application/admit-knowledge-content')>()
  return {
    ...actual,
    admitKnowledgeDocuments: async (...args: Parameters<typeof actual.admitKnowledgeDocuments>) => {
      const admitted = await actual.admitKnowledgeDocuments(...args)
      const afterPage = listing.afterPage
      const [, documents] = args
      if (afterPage && documents.length > 1) {
        listing.afterPage = null
        await afterPage(documents.map((doc) => doc.id))
      }
      return admitted
    },
  }
})
vi.mock('@/lib/uploads/core/setup.server', () => uploadsSetupMock)
vi.mock('@/lib/core/config/feature-flags', () => featureFlagsMock)
vi.mock('@/lib/realtime/notify', () => realtimeNotifyMock)
vi.mock('@/lib/posthog/server', () => posthogServerMock)
vi.mock('@/lib/knowledge/documents/service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/knowledge/documents/service')>()
  const { db: database } = await import('@sim/db')
  const { document: documentTable } = await import('@sim/db/schema')
  const { inArray: within } = await import('drizzle-orm')
  return {
    ...actual,
    processDocumentsWithQueue: async (
      documents: Array<{ documentId: string }>,
      _knowledgeBaseId: string,
      _options: unknown,
      _requestId: string,
      _billing: unknown,
      lane: string
    ) => {
      const ids = documents.map((doc) => doc.documentId)
      indexer.dispatched.push(...ids.map((documentId) => ({ documentId, lane })))
      if (indexer.gate) await indexer.gate
      await database
        .update(documentTable)
        .set({ processingStatus: 'completed' })
        .where(within(documentTable.id, ids))
      return { requested: ids.length, accepted: ids.length, failed: 0, failedDocumentIds: [] }
    },
  }
})
vi.mock('@/lib/knowledge/embeddings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/knowledge/embeddings')>()
  return {
    ...actual,
    getConfiguredKbEmbedding: async () => {
      if (embedding.failure) throw embedding.failure
      return actual.getConfiguredKbEmbedding()
    },
  }
})

import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  deleteKnowledgeDocument,
  listKnowledgeDocumentsAfter,
  updateKnowledgeDocument,
  uploadKnowledgeDocument,
} from '@/lib/knowledge/application/documents'
import { createKnowledgeFolder } from '@/lib/knowledge/application/folders'
import {
  createKnowledgeBase,
  deleteKnowledgeBaseOperation,
  updateKnowledgeBaseOperation,
} from '@/lib/knowledge/application/knowledge-bases'
import { readOriginalKnowledgeDocument } from '@/lib/knowledge/application/read-original-document'
import { KNOWLEDGE_DOCUMENT_PROCESSING_OUTBOX_EVENT } from '@/lib/knowledge/documents/processing-events'
import type {
  ApplyWorkspaceSourceInput,
  ApplyWorkspaceSourceResult,
} from '@/lib/workspace-source/application/apply-workspace-source'
import {
  blobManifest,
  codes,
  refusal,
  sourceChecks,
  sourceRunner,
  sourceWorkspaces,
} from '@/lib/workspace-source/application/workspace-source.test-helpers'

/** Local object storage the suite's uploads land in, under a temp directory. */
let storageRoot = ''
const ownerId = generateId()
const memberId = generateId()
const organizationId = generateId()
const owner = createSessionPrincipal({ userId: ownerId, sessionId: generateId() })
const { check, writeReport } = sourceChecks(
  'WORKSPACE_SOURCE_KNOWLEDGE_REPORT_PATH',
  'workspace-source-knowledge.json'
)
const workspaces = sourceWorkspaces()

function declaration(name: string, extra = ''): string {
  return `// @sim-sdk 1
import { defineKnowledgeBase } from '@sim/workflow-sdk/workspace'

export default defineKnowledgeBase({
  name: '${name}',${extra}
})
`
}

/** A source directory: text files, and documents by path. */
interface Directory {
  files: Record<string, string>
  docs: Record<string, Buffer>
}

const POLICIES: Directory = {
  files: { 'knowledge/policies/knowledge.ts': declaration('Policies') },
  docs: {
    'knowledge/policies/docs/refunds.md': Buffer.from('# Refunds\nWithin 30 days.\n'),
    'knowledge/policies/docs/shipping.txt': Buffer.from('Ships in two days.\n'),
  },
}

type Carry = 'all' | 'none' | readonly string[]

/** The blob manifest a directory sends, staging the bytes of the paths `carry` names. */
function blobs(dir: Directory, carry: Carry) {
  return blobManifest(
    dir.docs,
    (path) => carry === 'all' || (carry !== 'none' && carry.includes(path))
  )
}

type ApplyOptions = Partial<Omit<ApplyWorkspaceSourceInput, 'workspaceId' | 'files' | 'blobs'>> & {
  principal?: Principal
  carry?: Carry
  /** Return before the indexing the apply's uploads started has finished. */
  unsettled?: boolean
}

const runner = sourceRunner(['knowledge-base'], owner)

/**
 * Applies `dir`, then waits for the indexing its uploads started after answering, so the next
 * read sees settled documents and nothing runs on past the check.
 */
async function apply(workspaceId: string, dir: Directory, options: ApplyOptions = {}) {
  const { carry = 'all', unsettled = false, ...input } = options
  try {
    return await runner.apply(workspaceId, { files: dir.files, blobs: blobs(dir, carry), ...input })
  } finally {
    if (!unsettled) await indexed(workspaceId)
  }
}

/** Waits until no processing event for a knowledge base of the workspace is queued or running. */
async function indexed(workspaceId: string) {
  await vi.waitFor(
    async () => {
      const inFlight = await db
        .select({ id: outboxEvent.id })
        .from(outboxEvent)
        .innerJoin(
          knowledgeBase,
          eq(knowledgeBase.id, sql`${outboxEvent.payload}->>'knowledgeBaseId'`)
        )
        .where(
          and(
            eq(outboxEvent.eventType, KNOWLEDGE_DOCUMENT_PROCESSING_OUTBOX_EVENT),
            inArray(outboxEvent.status, ['pending', 'processing']),
            eq(knowledgeBase.workspaceId, workspaceId)
          )
        )
      expect(inFlight).toEqual([])
    },
    { timeout: 10_000, interval: 25 }
  )
}

function get(workspaceId: string) {
  return runner.get(workspaceId)
}

/** The directory an apply leaves behind: its reprinted files over the ones it sent. */
function reprinted(dir: Directory, result: ApplyWorkspaceSourceResult): Directory {
  return { files: { ...dir.files, ...result.files }, docs: dir.docs }
}

function actions(result: ApplyWorkspaceSourceResult, list: 'plan' | 'applied' = 'plan') {
  return result[list].map(({ kind, key, action }) => `${action} ${kind}:${key}`)
}

async function knowledgeBases(workspaceId: string) {
  return db
    .select()
    .from(knowledgeBase)
    .where(and(eq(knowledgeBase.workspaceId, workspaceId), isNull(knowledgeBase.deletedAt)))
    .orderBy(knowledgeBase.id)
}

async function knowledgeBaseNamed(workspaceId: string, name: string) {
  const found = (await knowledgeBases(workspaceId)).find((row) => row.name === name)
  if (!found) throw new Error(`No knowledge base named ${name}`)
  return found
}

/** Live documents of a knowledge base: what "nothing was written" compares. */
async function docs(knowledgeBaseId: string) {
  const rows = await db
    .select({
      id: document.id,
      filename: document.filename,
      fileSize: document.fileSize,
      connectorId: document.connectorId,
      processingStatus: document.processingStatus,
    })
    .from(document)
    .where(and(eq(document.knowledgeBaseId, knowledgeBaseId), isNull(document.deletedAt)))
  return rows.sort((a, b) => compareStrings(a.filename, b.filename))
}

/** Processing events for `documentIds` still waiting in the outbox for a drain. */
async function undrainedProcessing(documentIds: readonly string[]) {
  const documentId = sql<string>`${outboxEvent.payload}->>'documentId'`
  const pending = await db
    .select({ documentId })
    .from(outboxEvent)
    .where(
      and(
        eq(outboxEvent.eventType, KNOWLEDGE_DOCUMENT_PROCESSING_OUTBOX_EVENT),
        eq(outboxEvent.status, 'pending'),
        inArray(documentId, [...documentIds])
      )
    )
  return pending.map((row) => row.documentId)
}

/** `dir` with one file's text edited. */
function editText(dir: Directory, path: string, from: string, to: string): Directory {
  return { ...dir, files: { ...dir.files, [path]: dir.files[path].replace(from, to) } }
}

/** `dir` with one document's bytes replaced or added. */
function withDoc(dir: Directory, path: string, text: string): Directory {
  return { ...dir, docs: { ...dir.docs, [path]: Buffer.from(text) } }
}

const POLICIES_FILE = 'knowledge/policies/knowledge.ts'
const REFUNDS = 'knowledge/policies/docs/refunds.md'

/** Makes the `failOn`-th call of `uploadKnowledgeDocument` fail, as storage might. */
function failUpload(failOn: number) {
  const upload = uploadKnowledgeDocument.execute
  let calls = 0
  return vi.spyOn(uploadKnowledgeDocument, 'execute').mockImplementation(async (args) => {
    calls += 1
    if (calls === failOn) throw new Error('storage unavailable')
    return upload.call(uploadKnowledgeDocument, args)
  })
}

/** Tags the stored `refunds.md` of `knowledgeBaseId` in the UI, which a replace must carry over. */
async function tagRefunds(knowledgeBaseId: string) {
  await db
    .update(document)
    .set({ tag1: 'gold' })
    .where(and(eq(document.knowledgeBaseId, knowledgeBaseId), eq(document.filename, 'refunds.md')))
}

/** The live documents of `knowledgeBaseId` as name, content hash and first tag. */
async function contents(knowledgeBaseId: string) {
  const rows = await db
    .select({ filename: document.filename, sha256: document.fileSha256, tag1: document.tag1 })
    .from(document)
    .where(and(eq(document.knowledgeBaseId, knowledgeBaseId), isNull(document.deletedAt)))
  return rows.sort((a, b) => compareStrings(a.filename, b.filename))
}

/** Makes the `failOn`-th call of `updateKnowledgeDocument` fail. */
function failUpdate(failOn: number) {
  const update = updateKnowledgeDocument.execute
  let calls = 0
  return vi.spyOn(updateKnowledgeDocument, 'execute').mockImplementation(async (args) => {
    calls += 1
    if (calls === failOn) throw new Error('database unavailable')
    return update.call(updateKnowledgeDocument, args)
  })
}

async function filenames(knowledgeBaseId: string) {
  return (await docs(knowledgeBaseId)).map((doc) => doc.filename)
}

async function snapshot(workspaceId: string) {
  const rows = await knowledgeBases(workspaceId)
  return Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      chunkingConfig: row.chunkingConfig,
      docs: await docs(row.id),
    }))
  )
}

/** Makes a document read as one uploaded before its bytes' hash was recorded. */
async function forgetFileHash(documentId: string) {
  await db.update(document).set({ fileSha256: null }).where(eq(document.id, documentId))
}

async function newWorkspace(options: { organizationId?: string } = {}): Promise<string> {
  return workspaces.create({
    name: 'Knowledge source',
    ownerId,
    members: [{ userId: memberId, permission: 'write' }],
    ...(options.organizationId
      ? { organizationId: options.organizationId, organizationMode: true }
      : {}),
  })
}

/** Applies `dir` into a fresh workspace and reads it back, as `get` would. */
async function setUp(dir: Directory = POLICIES) {
  const workspaceId = await newWorkspace()
  const created = await apply(workspaceId, dir)
  expect(created.failed).toBeUndefined()
  const read = await get(workspaceId)
  return { workspaceId, read, dir: { files: read.files, docs: dir.docs } }
}

beforeAll(async () => {
  storageRoot = mkdtempSync(join(tmpdir(), 'knowledge-source-'))
  setUploadDirServer(storageRoot)
  featureFlagsMockFns.mockIsFeatureEnabled.mockImplementation(
    async (flag: string) => flag === 'workflow-code'
  )
  const now = new Date()
  await db.insert(user).values(
    [ownerId, memberId].map((id) => ({
      id,
      name: 'Knowledge source fixture',
      email: `${id}@knowledge-source.invalid`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    }))
  )
  await db
    .insert(userStats)
    .values([ownerId, memberId].map((userId) => ({ id: generateId(), userId })))
  await db.insert(organization).values({
    id: organizationId,
    name: 'Knowledge source',
    slug: organizationId,
    createdAt: now,
  })
  await db.insert(member).values([
    { id: generateId(), organizationId, userId: ownerId, role: 'owner', createdAt: now },
    { id: generateId(), organizationId, userId: memberId, role: 'member', createdAt: now },
  ])
})

afterEach(() => {
  indexer.release()
  indexer.gate = null
})

afterAll(async () => {
  await writeReport()
  resetUploadsSetupMock()
  await workspaces.cleanup()
  await db.delete(permissionGroup).where(eq(permissionGroup.organizationId, organizationId))
  await db.delete(organization).where(eq(organization.id, organizationId))
  await db.delete(user).where(inArray(user.id, [ownerId, memberId]))
  if (storageRoot) await rm(storageRoot, { recursive: true, force: true })
})

describe('knowledge bases as workspace source', () => {
  check('creates a knowledge base with its documents, which index in the background', async () => {
    const workspaceId = await newWorkspace()
    indexer.gate = new Promise((resolve) => {
      indexer.release = resolve
    })

    const dryRun = await apply(workspaceId, POLICIES, { dryRun: true, carry: 'none' })

    expect(codes(dryRun.diagnostics)).toEqual([])
    expect(actions(dryRun)).toEqual(['create knowledge-base:policies'])
    expect(dryRun.needBlobs.sort()).toEqual(Object.keys(POLICIES.docs).sort())
    expect(
      dryRun.diagnostics.find((finding) => finding.code === 'I_KB_REEMBED')?.message
    ).toContain('Indexes 2 document(s) (2 new, 0 replaced)')
    expect(await knowledgeBases(workspaceId)).toEqual([])

    // Indexing never finishes while the gate is shut, so an apply that waited for it never returns.
    const result = await Promise.race([
      apply(workspaceId, POLICIES, { unsettled: true }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('The apply waited for its documents to index')), 5_000)
      ),
    ])

    expect(result.failed).toBeUndefined()
    const stored = await knowledgeBaseNamed(workspaceId, 'Policies')
    const storedDocs = await docs(stored.id)
    expect(storedDocs.map((doc) => [doc.filename, doc.processingStatus])).toEqual([
      ['refunds.md', 'pending'],
      ['shipping.txt', 'pending'],
    ])
    const indexing = result.diagnostics.find((finding) => finding.code === 'I_KB_PROCESSING')
    expect(indexing?.message).toContain('2 document(s) of "Policies" are still being indexed')
    expect(codes((await get(workspaceId)).diagnostics, 'info')).toEqual(['I_KB_PROCESSING'])

    indexer.release()
    await indexed(workspaceId)

    // Handed to the dispatcher by the upload itself, not left in the outbox for a drain.
    const ids = storedDocs.map((doc) => doc.id)
    expect(
      indexer.dispatched
        .filter((call) => ids.includes(call.documentId))
        .sort((a, b) => compareStrings(a.documentId, b.documentId))
    ).toEqual(ids.sort(compareStrings).map((documentId) => ({ documentId, lane: 'interactive' })))
    expect(await undrainedProcessing(ids)).toEqual([])
    expect((await docs(stored.id)).map((doc) => doc.processingStatus)).toEqual([
      'completed',
      'completed',
    ])
    expect(codes((await get(workspaceId)).diagnostics, 'info')).toEqual([])
    const entry = result.base.resources['knowledge-base:policies']
    expect(entry?.id).toBe(stored.id)
    expect(Object.keys(entry?.blobs ?? {}).sort()).toEqual(['refunds.md', 'shipping.txt'])
    expect(Object.keys(result.files)).toEqual(['knowledge/policies/knowledge.ts'])
  })

  check(
    'a get names the documents whose indexing failed, without making the base stale',
    async () => {
      const { workspaceId, read, dir } = await setUp()
      expect(codes(read.diagnostics, 'info')).toEqual([])
      const stored = await knowledgeBaseNamed(workspaceId, 'Policies')
      const refunds = (await docs(stored.id)).find((doc) => doc.filename === 'refunds.md')
      if (!refunds) throw new Error('refunds.md was not stored')
      await db
        .update(document)
        .set({ processingStatus: 'failed', processingError: 'parse failed' })
        .where(eq(document.id, refunds.id))

      const reread = await get(workspaceId)

      const failed = reread.diagnostics.filter((finding) => finding.code === 'W_KB_DOC_FAILED')
      expect(failed.map((finding) => finding.message)).toEqual([
        '1 document(s) of "Policies" failed to index and are not searchable: refunds.md.',
      ])
      expect(reread.base).toEqual(read.base)
      const unchanged = await apply(workspaceId, dir, { base: read.base, carry: 'none' })
      expect(unchanged.applied).toEqual([])
    }
  )

  check(
    'a chunking change counts only the stored documents that keep their chunks, not the ones it replaces',
    async () => {
      const { workspaceId, read } = await setUp()

      const planned = await apply(
        workspaceId,
        {
          files: {
            [POLICIES_FILE]: declaration('Policies', '\n  chunking: { maxSize: 512 },'),
          },
          docs: { ...POLICIES.docs, [REFUNDS]: Buffer.from('# Refunds\nWithin 60 days.\n') },
        },
        { base: read.base, dryRun: true, carry: 'none' }
      )

      const chunking = planned.diagnostics.find((finding) => finding.code === 'I_KB_CHUNKING')
      expect(chunking?.message).toContain('1 stored document(s) keep their chunks')
    }
  )

  check('a get reproduces the apply, and re-applying it changes nothing', async () => {
    const workspaceId = await newWorkspace()
    const created = await apply(workspaceId, POLICIES)

    const read = await get(workspaceId)

    expect(read.files).toEqual(created.files)
    expect(read.base).toEqual(created.base)
    expect(read.blobs.map(({ path, sha256, size }) => ({ path, sha256, size }))).toEqual(
      blobs(POLICIES, 'none').sort((a, b) => compareStrings(a.path, b.path))
    )
    const before = await snapshot(workspaceId)

    const again = await apply(
      workspaceId,
      { files: read.files, docs: POLICIES.docs },
      { base: read.base, carry: 'none' }
    )

    expect(actions(again)).toEqual(['noop knowledge-base:policies'])
    expect(again.needBlobs).toEqual([])
    expect(again.applied).toEqual([])
    expect(await snapshot(workspaceId)).toEqual(before)
  })

  check(
    'a get reads past a page of documents the caller may not see to the readable ones after it',
    async () => {
      const workspaceId = await newWorkspace()
      const created = await apply(workspaceId, POLICIES)
      const list = listKnowledgeDocumentsAfter.execute
      // The list admits each document after it pages, so a page of withheld documents comes back
      // empty, with a cursor, while later pages still hold readable ones.
      const withheld = vi
        .spyOn(listKnowledgeDocumentsAfter, 'execute')
        .mockImplementation(async (args) => {
          if (args.input.after === null) return { documents: [], next: '' }
          return list(args)
        })

      const read = await get(workspaceId).finally(() => withheld.mockRestore())

      expect(read.files).toEqual(created.files)
      expect(read.blobs.map(({ path }) => path).sort(compareStrings)).toEqual(
        blobs(POLICIES, 'none')
          .map(({ path }) => path)
          .sort(compareStrings)
      )
    }
  )

  check('a document deleted while a get lists the documents never hides another one', async () => {
    const workspaceId = await newWorkspace()
    const { knowledgeBase: created } = await createKnowledgeBase.execute({
      principal: owner,
      input: { workspaceId, name: 'Many' },
    })
    // More documents than one page of the list holds, so the listing spans pages.
    const uploadedAt = new Date()
    const rows = Array.from({ length: 1_050 }, (_, index) => {
      const name = `doc-${String(index).padStart(4, '0')}.md`
      return {
        id: generateId(),
        knowledgeBaseId: created.id,
        filename: name,
        fileUrl: `https://storage.invalid/${name}`,
        fileSize: 10,
        fileSha256: sha256Hex(Buffer.from(name)),
        mimeType: 'text/markdown',
        processingStatus: 'completed',
        uploadedAt,
      }
    })
    for (let from = 0; from < rows.length; from += 500) {
      await db.insert(document).values(rows.slice(from, from + 500))
    }
    // Someone deletes a document the listing already passed, between its first two pages.
    listing.afterPage = async (ids) => {
      await db.update(document).set({ deletedAt: new Date() }).where(eq(document.id, ids[0]))
    }

    const read = await get(workspaceId).finally(() => {
      listing.afterPage = null
    })

    const live = await db
      .select({ filename: document.filename })
      .from(document)
      .where(and(eq(document.knowledgeBaseId, created.id), isNull(document.deletedAt)))
    expect(live).toHaveLength(rows.length - 1)
    const listed = new Set(read.blobs.map(({ path }) => path.slice(path.lastIndexOf('/') + 1)))
    expect(live.filter(({ filename }) => !listed.has(filename))).toEqual([])
  })

  check(
    'replacing a document shows the re-embed count, uploads it with its tag values, and keeps the others',
    async () => {
      const { workspaceId, read, dir } = await setUp()
      const stored = await knowledgeBaseNamed(workspaceId, 'Policies')
      const [refunds, shipping] = await docs(stored.id)
      await db
        .update(document)
        .set({ tag1: 'billing', number1: 3, boolean1: true })
        .where(eq(document.id, refunds.id))
      const edited: Directory = {
        files: dir.files,
        docs: {
          ...dir.docs,
          'knowledge/policies/docs/refunds.md': Buffer.from('# Refunds\nWithin 60 days.\n'),
        },
      }

      const dryRun = await apply(workspaceId, edited, {
        base: read.base,
        dryRun: true,
        carry: 'none',
      })

      expect(dryRun.plan).toMatchObject([
        { action: 'update', key: 'policies', fields: ['docs/refunds.md (replace)'] },
      ])
      expect(dryRun.needBlobs).toEqual(['knowledge/policies/docs/refunds.md'])
      expect(
        dryRun.diagnostics.find((finding) => finding.code === 'I_KB_REEMBED')?.message
      ).toContain('(0 new, 1 replaced)')
      expect(codes(dryRun.diagnostics, 'warning')).toEqual([])

      const result = await apply(workspaceId, edited, { base: read.base })

      expect(result.failed).toBeUndefined()
      const after = await docs(stored.id)
      expect(after.map((doc) => doc.filename)).toEqual(['refunds.md', 'shipping.txt'])
      expect(after[0].id).not.toBe(refunds.id)
      expect(after[1].id).toBe(shipping.id)
      const [replaced] = await db
        .select({ tag1: document.tag1, number1: document.number1, boolean1: document.boolean1 })
        .from(document)
        .where(eq(document.id, after[0].id))
      expect(replaced).toEqual({ tag1: 'billing', number1: 3, boolean1: true })
      expect(result.base.resources['knowledge-base:policies']?.blobs?.['refunds.md']).toMatchObject(
        { id: after[0].id, sha256: sha256Hex(edited.docs['knowledge/policies/docs/refunds.md']) }
      )
    }
  )

  check(
    'refuses an edit to a knowledge base changed on the server, and notes one it leaves',
    async () => {
      const { workspaceId, read, dir } = await setUp()
      const stored = await knowledgeBaseNamed(workspaceId, 'Policies')
      await updateKnowledgeBaseOperation.execute({
        principal: owner,
        input: { knowledgeBaseId: stored.id, description: 'Edited in the UI' },
      })
      const before = await snapshot(workspaceId)
      const edited: Directory = {
        ...dir,
        files: {
          'knowledge/policies/knowledge.ts': dir.files['knowledge/policies/knowledge.ts'].replace(
            "name: 'Policies'",
            "name: 'Policies v2'"
          ),
        },
      }

      const stale = await refusal(apply(workspaceId, edited, { base: read.base, carry: 'none' }))

      expect(stale.stale).toBe(true)
      expect(codes(stale.diagnostics)).toEqual(['E_APPLY_STALE'])
      expect(await snapshot(workspaceId)).toEqual(before)

      const untouched = await apply(workspaceId, dir, { base: read.base, carry: 'none' })
      expect(untouched.applied).toEqual([])
      expect(codes(untouched.diagnostics, 'warning')).toContain('W_SERVER_CHANGED')
      expect(await snapshot(workspaceId)).toEqual(before)
    }
  )

  check('refuses a changed embedding model, and never touches a connector document', async () => {
    const { workspaceId, read, dir } = await setUp()
    const stored = await knowledgeBaseNamed(workspaceId, 'Policies')
    const connectorId = generateId()
    await db.insert(knowledgeConnector).values({
      id: connectorId,
      knowledgeBaseId: stored.id,
      connectorType: 'github',
      sourceConfig: {},
      status: 'paused',
    })
    const syncedId = generateId()
    await db.insert(document).values({
      id: syncedId,
      knowledgeBaseId: stored.id,
      filename: 'synced.md',
      fileUrl: `data:text/markdown;base64,${Buffer.from('# Synced\n').toString('base64')}`,
      fileSize: 9,
      mimeType: 'text/markdown',
      connectorId,
      externalId: 'synced',
      contentHash: 'synced-v1',
    })
    const declared = dir.files['knowledge/policies/knowledge.ts']
    expect(declared).toContain(`embeddingModel: '${stored.embeddingModel}'`)
    const before = await snapshot(workspaceId)

    const refused = await refusal(
      apply(
        workspaceId,
        {
          ...dir,
          files: {
            'knowledge/policies/knowledge.ts': declared.replace(
              stored.embeddingModel,
              'text-embedding-3-large'
            ),
          },
        },
        { base: read.base, carry: 'none' }
      )
    )

    expect(codes(refused.diagnostics)).toEqual(['E_KB_EMBEDDING_IMMUTABLE'])
    expect(await snapshot(workspaceId)).toEqual(before)

    const reread = await get(workspaceId)
    expect(Object.keys(reread.files)).toEqual(['knowledge/policies/knowledge.ts'])
    expect(reread.blobs.map((blob) => blob.path)).not.toContain('knowledge/policies/docs/synced.md')
    expect(codes(reread.diagnostics, 'info')).toEqual(['I_KB_UNMANAGED_DOCS'])

    const emptied = await apply(
      workspaceId,
      { files: reread.files, docs: {} },
      { base: reread.base, allowDelete: true, carry: 'none' }
    )

    expect(emptied.failed).toBeUndefined()
    expect(emptied.plan[0]?.destructive).toEqual({ what: 'documents', counts: { documents: 2 } })
    expect((await docs(stored.id)).map((doc) => doc.id)).toEqual([syncedId])
  })

  check(
    'deletes documents and knowledge bases only with --allow-delete, showing document counts',
    async () => {
      const { workspaceId, read, dir } = await setUp()
      const before = await snapshot(workspaceId)
      const withoutShipping: Directory = {
        files: dir.files,
        docs: {
          'knowledge/policies/docs/refunds.md': dir.docs['knowledge/policies/docs/refunds.md'],
        },
      }

      const docRefused = await refusal(
        apply(workspaceId, withoutShipping, { base: read.base, carry: 'none' })
      )
      expect(codes(docRefused.diagnostics)).toEqual(['E_APPLY_DELETE_NOT_ALLOWED'])
      expect(docRefused.diagnostics[0].message).toContain('docs/shipping.txt')

      const kbRefused = await refusal(
        apply(workspaceId, { files: {}, docs: {} }, { base: read.base, carry: 'none' })
      )
      expect(codes(kbRefused.diagnostics)).toEqual(['E_APPLY_DELETE_NOT_ALLOWED'])
      expect(await snapshot(workspaceId)).toEqual(before)

      const dryRun = await apply(
        workspaceId,
        { files: {}, docs: {} },
        { base: read.base, allowDelete: true, dryRun: true, carry: 'none' }
      )
      expect(dryRun.plan).toEqual([
        expect.objectContaining({
          action: 'delete',
          destructive: { what: 'knowledge base', counts: { documents: 2 } },
        }),
      ])

      const deleted = await apply(
        workspaceId,
        { files: {}, docs: {} },
        { base: read.base, allowDelete: true, carry: 'none' }
      )
      expect(deleted.failed).toBeUndefined()
      expect(await knowledgeBases(workspaceId)).toEqual([])
      expect(deleted.base.resources).toEqual({})
    }
  )

  check('refuses a declared document the server holds twice under one name', async () => {
    const { workspaceId } = await setUp()
    const stored = await knowledgeBaseNamed(workspaceId, 'Policies')
    const [refunds] = await docs(stored.id)
    const [row] = await db.select().from(document).where(eq(document.id, refunds.id))
    await db.insert(document).values({ ...row, id: generateId() })
    const read = await get(workspaceId)
    expect(read.blobs.map((blob) => blob.path)).toEqual(['knowledge/policies/docs/shipping.txt'])
    expect(codes(read.diagnostics, 'info')).toEqual(['I_KB_UNMANAGED_DOCS'])
    const before = await snapshot(workspaceId)

    const refused = await refusal(
      apply(workspaceId, { files: read.files, docs: POLICIES.docs }, { base: read.base })
    )

    expect(codes(refused.diagnostics)).toEqual(['E_KB_DOC_AMBIGUOUS'])
    expect(await snapshot(workspaceId)).toEqual(before)
  })

  check('refuses at plan time a member whose permission group withholds uploads', async () => {
    const workspaceId = await newWorkspace({ organizationId })
    const groupId = generateId()
    await db.insert(permissionGroup).values({
      id: groupId,
      organizationId,
      createdBy: ownerId,
      name: `Knowledge uploads withheld ${groupId}`,
      config: { disableKnowledgeBaseFileUpload: true },
      membershipMode: 'inherit',
    })
    await db.insert(permissionGroupWorkspace).values({
      id: generateId(),
      permissionGroupId: groupId,
      workspaceId,
      organizationId,
    })
    const writer = createSessionPrincipal({ userId: memberId, sessionId: generateId() })

    const refused = await refusal(apply(workspaceId, POLICIES, { principal: writer }))

    expect(codes(refused.diagnostics)).toEqual(['E_APPLY_FORBIDDEN'])
    expect(refused.diagnostics.find((finding) => finding.severity === 'error')).toMatchObject({
      kind: 'knowledge-base',
      key: 'policies',
    })
    expect(await knowledgeBases(workspaceId)).toEqual([])
  })

  check(
    'documents not all staged refuse the apply before any write, deletes included, and a resumed run stages only the rest',
    async () => {
      const big = (fill: string) => Buffer.alloc(9_000_000, fill)
      const start: Directory = {
        files: {
          ...POLICIES.files,
          'knowledge/archive/knowledge.ts': declaration('Archive'),
        },
        docs: POLICIES.docs,
      }
      const { workspaceId, read, dir } = await setUp(start)
      const policies = await knowledgeBaseNamed(workspaceId, 'Policies')
      const shipping = (await docs(policies.id)).find((doc) => doc.filename === 'shipping.txt')
      const target: Directory = {
        files: {
          'knowledge/policies/knowledge.ts': dir.files['knowledge/policies/knowledge.ts'],
          'knowledge/faq/knowledge.ts': declaration('FAQ'),
        },
        docs: {
          'knowledge/faq/docs/a.txt': big('a'),
          'knowledge/policies/docs/refunds.md': dir.docs['knowledge/policies/docs/refunds.md'],
          'knowledge/policies/docs/b.txt': big('b'),
          'knowledge/policies/docs/c.txt': big('c'),
          'knowledge/policies/docs/d.txt': big('d'),
        },
      }
      const options = { base: read.base, allowDelete: true }

      const preview = await apply(workspaceId, target, { ...options, dryRun: true, carry: 'none' })
      expect(codes(preview.diagnostics)).toEqual([])
      expect(preview.needBlobs.sort()).toEqual([
        'knowledge/faq/docs/a.txt',
        'knowledge/policies/docs/b.txt',
        'knowledge/policies/docs/c.txt',
        'knowledge/policies/docs/d.txt',
      ])
      // Only a.txt and b.txt staged: the apply is refused and nothing changes, deletes included.
      const before = (await docs(policies.id)).map((doc) => doc.filename)
      const partial = await refusal(
        apply(workspaceId, target, {
          ...options,
          carry: ['knowledge/faq/docs/a.txt', 'knowledge/policies/docs/b.txt'],
        })
      )
      expect(
        partial.diagnostics
          .filter((finding) => finding.severity === 'error')
          .map((finding) => `${finding.code} ${finding.file}`)
          .sort()
      ).toEqual([
        'E_BLOB_MISSING knowledge/policies/docs/c.txt',
        'E_BLOB_MISSING knowledge/policies/docs/d.txt',
      ])
      expect((await docs(policies.id)).map((doc) => doc.filename)).toEqual(before)
      expect((await knowledgeBases(workspaceId)).map((row) => row.name).sort()).toEqual([
        'Archive',
        'Policies',
      ])

      // The resumed run stages only what is missing and plans once more: everything lands.
      const resumedPlan = await apply(workspaceId, target, {
        ...options,
        dryRun: true,
        carry: 'none',
      })
      expect(resumedPlan.needBlobs.sort()).toEqual([
        'knowledge/policies/docs/c.txt',
        'knowledge/policies/docs/d.txt',
      ])
      const two = await apply(workspaceId, target, { ...options, carry: resumedPlan.needBlobs })

      expect(two.failed).toBeUndefined()
      expect(actions(two, 'applied')).toEqual([
        'update knowledge-base:policies',
        'create knowledge-base:faq',
        'delete knowledge-base:archive',
      ])
      const final = await docs(policies.id)
      expect(final.map((doc) => doc.filename)).toEqual(['b.txt', 'c.txt', 'd.txt', 'refunds.md'])
      expect(final.map((doc) => doc.id)).not.toContain(shipping?.id)
      expect((await knowledgeBases(workspaceId)).map((row) => row.name).sort()).toEqual([
        'FAQ',
        'Policies',
      ])
      const saved = reprinted(target, two)

      const settled = await apply(workspaceId, saved, {
        base: two.base,
        allowDelete: true,
        carry: 'none',
      })
      expect(settled.plan.every((change) => change.action === 'noop')).toBe(true)
    }
  )
  check(
    'a replace whose old document cannot be deleted removes its replacement, and the next apply finishes it',
    async () => {
      const { workspaceId, read, dir } = await setUp()
      const stored = await knowledgeBaseNamed(workspaceId, 'Policies')
      const [refunds] = await docs(stored.id)
      const edited = withDoc(dir, REFUNDS, '# Refunds\nWithin 60 days.\n')
      const failing = vi
        .spyOn(deleteKnowledgeDocument, 'execute')
        .mockRejectedValueOnce(new Error('storage unavailable'))

      const first = await apply(workspaceId, edited, { base: read.base }).finally(() =>
        failing.mockRestore()
      )

      expect(first.failed).toMatchObject({ key: 'policies', code: 'E_APPLY_FAILED' })
      expect((await docs(stored.id)).map((doc) => [doc.filename, doc.id])).toEqual([
        ['refunds.md', refunds.id],
        ['shipping.txt', expect.any(String)],
      ])

      const second = await apply(workspaceId, edited, { base: first.base })

      expect(second.failed).toBeUndefined()
      const after = await docs(stored.id)
      expect(after.map((doc) => doc.filename)).toEqual(['refunds.md', 'shipping.txt'])
      expect(after[0].id).not.toBe(refunds.id)
    }
  )

  check(
    'a replace stopped between its upload and its delete is finished by the next apply',
    async () => {
      const { workspaceId, read, dir } = await setUp()
      const stored = await knowledgeBaseNamed(workspaceId, 'Policies')
      const [refunds] = await docs(stored.id)
      const edited = withDoc(dir, REFUNDS, '# Refunds\nWithin 60 days.\n')
      // The old document's delete fails, and so does removing the replacement again.
      const failing = vi
        .spyOn(deleteKnowledgeDocument, 'execute')
        .mockRejectedValueOnce(new Error('storage unavailable'))
        .mockRejectedValueOnce(new Error('storage unavailable'))

      const first = await apply(workspaceId, edited, { base: read.base }).finally(() =>
        failing.mockRestore()
      )

      expect(first.failed).toMatchObject({ key: 'policies' })
      // The replacement stays under the name that names the document it replaces.
      expect(await filenames(stored.id)).toEqual([
        `.sim-replace.${refunds.id}.refunds.md`,
        'refunds.md',
        'shipping.txt',
      ])

      const plan = await apply(workspaceId, edited, {
        base: first.base,
        dryRun: true,
        carry: 'none',
      })
      expect(codes(plan.diagnostics)).toEqual([])
      expect(plan.plan).toMatchObject([
        { action: 'update', key: 'policies', fields: ['docs/refunds.md (replace)'] },
      ])
      expect(plan.needBlobs).toEqual([])

      const second = await apply(workspaceId, edited, { base: first.base, carry: 'none' })

      expect(second.failed).toBeUndefined()
      const after = await docs(stored.id)
      expect(after.map((doc) => doc.filename)).toEqual(['refunds.md', 'shipping.txt'])
      expect(after[0].id).not.toBe(refunds.id)
      const settled = await apply(workspaceId, reprinted(edited, second), {
        base: second.base,
        carry: 'none',
      })
      expect(actions(settled)).toEqual(['noop knowledge-base:policies'])
    }
  )

  check(
    'a chunking change counts the replacement a stopped replace left among the documents keeping their chunks',
    async () => {
      const { workspaceId, read, dir } = await setUp()
      const edited = withDoc(dir, REFUNDS, '# Refunds\nWithin 60 days.\n')
      const failing = vi
        .spyOn(deleteKnowledgeDocument, 'execute')
        .mockRejectedValueOnce(new Error('storage unavailable'))
        .mockRejectedValueOnce(new Error('storage unavailable'))
      const first = await apply(workspaceId, edited, { base: read.base }).finally(() =>
        failing.mockRestore()
      )
      expect(first.failed).toMatchObject({ key: 'policies' })

      const planned = await apply(
        workspaceId,
        {
          ...edited,
          files: {
            ...edited.files,
            [POLICIES_FILE]: declaration('Policies', '\n  chunking: { maxSize: 512 },'),
          },
        },
        { base: first.base, dryRun: true, carry: 'none' }
      )

      // The finished replacement and shipping.txt keep their chunks; the replaced refunds.md goes.
      const chunking = planned.diagnostics.find((finding) => finding.code === 'I_KB_CHUNKING')
      expect(chunking?.message).toContain('2 stored document(s) keep their chunks')
    }
  )

  check('a create that fails partway is adopted and finished by the next apply', async () => {
    const workspaceId = await newWorkspace()
    const failing = failUpload(2)

    const first = await apply(workspaceId, POLICIES).finally(() => failing.mockRestore())

    expect(first.failed).toMatchObject({ key: 'policies', code: 'E_APPLY_FAILED' })
    const stored = await knowledgeBaseNamed(workspaceId, 'Policies')
    expect(await filenames(stored.id)).toEqual(['refunds.md'])
    // The uploaded document is stored, so its staged bytes stop counting toward the quota.
    const staging = await db
      .select({
        sha256: workspaceSourceStagedBlob.sha256,
        consumedAt: workspaceSourceStagedBlob.consumedAt,
      })
      .from(workspaceSourceStagedBlob)
      .where(eq(workspaceSourceStagedBlob.workspaceId, workspaceId))
    const consumedAt = new Map(staging.map((row) => [row.sha256, row.consumedAt]))
    const hashOf = (path: string) => sha256Hex(POLICIES.docs[path] ?? Buffer.alloc(0))
    expect(consumedAt.get(hashOf(REFUNDS))).toBeInstanceOf(Date)
    // Still staged, and unconsumed: a missing row reads undefined, never null.
    expect(consumedAt.get(hashOf('knowledge/policies/docs/shipping.txt'))).toBeNull()

    const second = await apply(workspaceId, POLICIES, { base: first.base })

    expect(second.failed).toBeUndefined()
    expect(actions(second, 'applied')).toEqual(['adopt knowledge-base:policies'])
    expect((await knowledgeBases(workspaceId)).map((row) => row.id)).toEqual([stored.id])
    expect(await filenames(stored.id)).toEqual(['refunds.md', 'shipping.txt'])
    expect(second.base.resources['knowledge-base:policies']?.id).toBe(stored.id)
  })

  check('an update that fails partway converges on the next apply', async () => {
    const { workspaceId, read, dir } = await setUp()
    const stored = await knowledgeBaseNamed(workspaceId, 'Policies')
    const edited = withDoc(
      withDoc(
        editText(
          dir,
          POLICIES_FILE,
          "name: 'Policies',",
          "name: 'Policies',\n  description: 'Rules',"
        ),
        REFUNDS,
        '# Refunds\nWithin 60 days.\n'
      ),
      'knowledge/policies/docs/faq.md',
      '# FAQ\n'
    )
    const failing = failUpload(2)

    const first = await apply(workspaceId, edited, { base: read.base }).finally(() =>
      failing.mockRestore()
    )

    expect(first.failed).toMatchObject({ key: 'policies', code: 'E_APPLY_FAILED' })
    expect(await filenames(stored.id)).toEqual(['faq.md', 'refunds.md', 'shipping.txt'])

    const second = await apply(workspaceId, edited, { base: first.base })

    expect(second.failed).toBeUndefined()
    expect(second.plan).toMatchObject([
      { action: 'update', key: 'policies', fields: ['docs/refunds.md (replace)'] },
    ])
    expect(await filenames(stored.id)).toEqual(['faq.md', 'refunds.md', 'shipping.txt'])
    expect((await knowledgeBaseNamed(workspaceId, 'Policies')).description).toBe('Rules')
    const settled = await apply(workspaceId, reprinted(edited, second), {
      base: second.base,
      carry: 'none',
    })
    expect(actions(settled)).toEqual(['noop knowledge-base:policies'])
    expect(settled.diagnostics).toEqual([])
  })

  check(
    'a get lists older documents past its download budget without a hash, and a plan never writes one it could not compare',
    async () => {
      const workspaceId = await newWorkspace()
      const big: Directory = {
        files: { 'knowledge/big/knowledge.ts': declaration('Big') },
        docs: Object.fromEntries(
          ['a', 'b', 'c'].map((fill) => [
            `knowledge/big/docs/${fill}.txt`,
            Buffer.alloc(9_000_000, fill),
          ])
        ),
      }
      const { knowledgeBase: created } = await createKnowledgeBase.execute({
        principal: owner,
        input: { workspaceId, name: 'Big' },
      })
      for (const [path, buffer] of Object.entries(big.docs)) {
        await uploadKnowledgeDocument.execute({
          principal: owner,
          input: {
            knowledgeBaseId: created.id,
            file: {
              buffer,
              filename: path.slice('knowledge/big/docs/'.length),
              fileSize: buffer.byteLength,
              mimeType: 'text/plain',
            },
          },
        })
      }
      for (const doc of await docs(created.id)) await forgetFileHash(doc.id)
      await indexed(workspaceId)
      const before = await snapshot(workspaceId)

      const adopted = await apply(workspaceId, big, { carry: 'none' })

      expect(actions(adopted, 'applied')).toEqual(['adopt knowledge-base:big'])
      expect(codes(adopted.diagnostics, 'warning')).toEqual(['W_KB_DOC_UNCHECKED'])
      expect(adopted.needBlobs).toEqual([])
      expect(await snapshot(workspaceId)).toEqual(before)
      // The plan recorded the hashes it downloaded; the get reads the documents as older again.
      for (const doc of await docs(created.id)) await forgetFileHash(doc.id)

      const read = await get(workspaceId)

      expect(read.blobs.filter((blob) => blob.sha256 === undefined)).toHaveLength(1)
      expect(read.blobs.map((blob) => blob.path).sort()).toEqual(Object.keys(big.docs).sort())
      expect(codes(read.diagnostics, 'info')).toEqual(['I_KB_DOCS_UNHASHED'])

      const compared = await apply(workspaceId, big, { base: read.base, carry: 'none' })

      expect(compared.applied).toEqual([])
      expect(
        Object.keys(compared.base.resources['knowledge-base:big']?.blobs ?? {}).sort()
      ).toEqual(['a.txt', 'b.txt', 'c.txt'])
      expect(await snapshot(workspaceId)).toEqual(before)
    }
  )

  check(
    'an unchanged directory applies over stored values a write would refuse: legacy chunking, an older document type',
    async () => {
      const { workspaceId } = await setUp()
      const stored = await knowledgeBaseNamed(workspaceId, 'Policies')
      const [refunds] = await docs(stored.id)
      await db
        .update(knowledgeBase)
        .set({
          chunkingConfig: {
            maxSize: 1024,
            minSize: 100,
            overlap: 200,
            strategy: 'recursive',
            strategyOptions: { separators: Array.from({ length: 300 }, (_, i) => `|${i}|`) },
          },
        })
        .where(eq(knowledgeBase.id, stored.id))
      await db
        .update(document)
        .set({ filename: 'refunds.legacy' })
        .where(eq(document.id, refunds.id))
      const read = await get(workspaceId)
      expect(read.blobs.map((blob) => blob.path)).toContain(
        'knowledge/policies/docs/refunds.legacy'
      )
      const dir: Directory = {
        files: read.files,
        docs: {
          'knowledge/policies/docs/refunds.legacy': POLICIES.docs[REFUNDS],
          'knowledge/policies/docs/shipping.txt':
            POLICIES.docs['knowledge/policies/docs/shipping.txt'],
        },
      }

      const again = await apply(workspaceId, dir, { base: read.base, carry: 'none' })

      expect(codes(again.diagnostics)).toEqual([])
      expect(actions(again)).toEqual(['noop knowledge-base:policies'])
    }
  )

  check('refuses at plan time a rename to a name another knowledge base holds', async () => {
    const { workspaceId, read, dir } = await setUp({
      files: { ...POLICIES.files, 'knowledge/faq/knowledge.ts': declaration('FAQ') },
      docs: POLICIES.docs,
    })
    const before = await snapshot(workspaceId)

    const refused = await refusal(
      apply(workspaceId, editText(dir, POLICIES_FILE, "name: 'Policies'", "name: 'FAQ'"), {
        base: read.base,
        carry: 'none',
      })
    )

    expect(codes(refused.diagnostics)).toEqual(['E_NAME_TAKEN'])
    expect(refused.diagnostics[0]).toMatchObject({ key: 'policies' })
    expect(await snapshot(workspaceId)).toEqual(before)
  })

  check(
    'refuses at plan time a create when the server cannot resolve its embedding model',
    async () => {
      const workspaceId = await newWorkspace()
      try {
        embedding.failure = new Error('connect ECONNREFUSED 127.0.0.1:11434')
        const unreachable = await refusal(apply(workspaceId, POLICIES, { carry: 'none' }))
        expect(codes(unreachable.diagnostics)).toEqual(['E_APPLY_REFUSED'])
        expect(unreachable.diagnostics[0].message).not.toContain('ECONNREFUSED')

        embedding.failure = new OrchestrationError('validation', 'Set EMBEDDING_OUTPUT_DIMS.')
        const unsized = await refusal(apply(workspaceId, POLICIES, { carry: 'none' }))
        expect(unsized.diagnostics.filter((finding) => finding.severity === 'error')).toMatchObject(
          [{ code: 'E_APPLY_REFUSED', message: 'Set EMBEDDING_OUTPUT_DIMS.', key: 'policies' }]
        )
      } finally {
        embedding.failure = null
      }
      expect(await knowledgeBases(workspaceId)).toEqual([])
    }
  )

  check(
    'a document deleted on the server stays deleted, and an edit beside it is stale',
    async () => {
      const { workspaceId, read, dir } = await setUp()
      const stored = await knowledgeBaseNamed(workspaceId, 'Policies')
      const [refunds] = await docs(stored.id)
      await deleteKnowledgeDocument.execute({
        principal: owner,
        input: { knowledgeBaseId: stored.id, documentId: refunds.id },
      })
      const before = await snapshot(workspaceId)

      const unchanged = await apply(workspaceId, dir, { base: read.base, carry: 'none' })

      expect(unchanged.applied).toEqual([])
      expect(codes(unchanged.diagnostics, 'warning')).toEqual(['W_SERVER_CHANGED'])
      expect(await snapshot(workspaceId)).toEqual(before)

      const stale = await refusal(
        apply(
          workspaceId,
          withDoc(dir, 'knowledge/policies/docs/shipping.txt', 'Ships in a day.\n'),
          { base: read.base, carry: 'none' }
        )
      )

      expect(codes(stale.diagnostics)).toEqual(['E_APPLY_STALE'])
      expect(await snapshot(workspaceId)).toEqual(before)
    }
  )

  check(
    'a knowledge base lives in a folder that exists, and refuses one that does not',
    async () => {
      const workspaceId = await newWorkspace()
      const inFolder: Directory = {
        files: { [POLICIES_FILE]: declaration('Policies', "\n  folder: '/support',") },
        docs: POLICIES.docs,
      }

      const missing = await refusal(apply(workspaceId, inFolder, { carry: 'none' }))

      expect(codes(missing.diagnostics)).toEqual(['E_KB_FOLDER'])
      expect(await knowledgeBases(workspaceId)).toEqual([])

      await createKnowledgeFolder.execute({
        principal: owner,
        input: { workspaceId, path: '/support' },
      })
      const created = await apply(workspaceId, inFolder)

      expect(created.failed).toBeUndefined()
      const read = await get(workspaceId)
      expect(read.files[POLICIES_FILE]).toContain("folder: '/support'")
      const again = await apply(
        workspaceId,
        { ...inFolder, files: read.files },
        {
          base: read.base,
          carry: 'none',
        }
      )
      expect(actions(again)).toEqual(['noop knowledge-base:policies'])
    }
  )

  check(
    'never reads, adopts or deletes the workspace search index, which only holds its name',
    async () => {
      const workspaceId = await newWorkspace()
      const { knowledgeBase: index } = await createKnowledgeBase.execute({
        principal: owner,
        input: { workspaceId, name: 'Policies', isSearchIndex: true },
      })

      const read = await get(workspaceId)

      expect(read.files).toEqual({})
      expect(read.base.resources).toEqual({})

      const refused = await refusal(apply(workspaceId, POLICIES, { carry: 'none' }))

      expect(codes(refused.diagnostics)).toEqual(['E_NAME_TAKEN'])

      const emptied = await apply(
        workspaceId,
        { files: {}, docs: {} },
        { base: read.base, allowDelete: true, carry: 'none' }
      )

      expect(emptied.plan).toEqual([])
      expect((await knowledgeBases(workspaceId)).map((row) => row.id)).toEqual([index.id])
    }
  )

  check(
    'refuses adopting a knowledge base the directory never read when it would replace a document or change a setting',
    async () => {
      const workspaceId = await newWorkspace()
      const { knowledgeBase: unbound } = await createKnowledgeBase.execute({
        principal: owner,
        input: { workspaceId, name: 'Policies', description: 'A teammate keeps this one' },
      })
      const teammate = Buffer.from('# Refunds\nA teammate wrote this.\n')
      await uploadKnowledgeDocument.execute({
        principal: owner,
        input: {
          knowledgeBaseId: unbound.id,
          file: {
            buffer: teammate,
            filename: 'refunds.md',
            fileSize: teammate.byteLength,
            mimeType: 'text/markdown',
          },
        },
      })
      await indexed(workspaceId)
      const before = await snapshot(workspaceId)

      const refused = await refusal(apply(workspaceId, POLICIES))

      expect(codes(refused.diagnostics)).toEqual(['E_APPLY_NO_BASE'])
      expect(refused.diagnostics.find((d) => d.code === 'E_APPLY_NO_BASE')?.message).toContain(
        'description, docs/refunds.md (replace)'
      )
      expect(await snapshot(workspaceId)).toEqual(before)
    }
  )

  check(
    'an adopt that fails partway leaves the key free, so the next apply adopts again',
    async () => {
      const workspaceId = await newWorkspace()
      const { knowledgeBase: unbound } = await createKnowledgeBase.execute({
        principal: owner,
        input: { workspaceId, name: 'Policies' },
      })
      const failing = failUpload(2)

      const first = await apply(workspaceId, POLICIES).finally(() => failing.mockRestore())

      expect(first.failed).toMatchObject({ key: 'policies', code: 'E_APPLY_FAILED' })
      const second = await apply(workspaceId, POLICIES, { base: first.base })

      expect(second.failed).toBeUndefined()
      expect(actions(second, 'applied')).toEqual(['adopt knowledge-base:policies'])
      expect(await filenames(unbound.id)).toEqual(['refunds.md', 'shipping.txt'])
    }
  )

  check('refuses at plan time two declarations of one knowledge base name', async () => {
    const workspaceId = await newWorkspace()

    const refused = await refusal(
      apply(
        workspaceId,
        {
          files: { ...POLICIES.files, 'knowledge/copy/knowledge.ts': declaration('Policies') },
          docs: POLICIES.docs,
        },
        { carry: 'none' }
      )
    )

    expect(codes(refused.diagnostics)).toEqual(['E_NAME_TAKEN'])
    expect(await knowledgeBases(workspaceId)).toEqual([])
  })

  check(
    'a knowledge base delete refuses one that gained a document after the plan read it',
    async () => {
      const { workspaceId, read } = await setUp()
      const stored = await knowledgeBaseNamed(workspaceId, 'Policies')
      const authorize = deleteKnowledgeBaseOperation.authorize
      const racing = vi
        .spyOn(deleteKnowledgeBaseOperation, 'authorize')
        .mockImplementation(async (args) => {
          const buffer = Buffer.from('Added in the UI.\n')
          await uploadKnowledgeDocument.execute({
            principal: owner,
            input: {
              knowledgeBaseId: stored.id,
              file: {
                buffer,
                filename: 'added.txt',
                fileSize: buffer.byteLength,
                mimeType: 'text/plain',
              },
            },
          })
          return authorize.call(deleteKnowledgeBaseOperation, args)
        })

      const result = await apply(
        workspaceId,
        { files: {}, docs: {} },
        { base: read.base, allowDelete: true }
      ).finally(() => racing.mockRestore())

      expect(result.failed).toMatchObject({ key: 'policies', code: 'E_APPLY_STALE' })
      expect((await knowledgeBases(workspaceId)).map((row) => row.id)).toEqual([stored.id])
    }
  )

  check('documents whose names differ only in letter case are left out of source', async () => {
    const workspaceId = await newWorkspace()
    const { knowledgeBase: created } = await createKnowledgeBase.execute({
      principal: owner,
      input: { workspaceId, name: 'Notes' },
    })
    for (const filename of ['Notes.txt', 'notes.txt']) {
      const buffer = Buffer.from(`${filename}\n`)
      await uploadKnowledgeDocument.execute({
        principal: owner,
        input: {
          knowledgeBaseId: created.id,
          file: { buffer, filename, fileSize: buffer.byteLength, mimeType: 'text/plain' },
        },
      })
    }
    await indexed(workspaceId)

    const read = await get(workspaceId)

    expect(read.blobs).toHaveLength(1)
    expect(codes(read.diagnostics, 'info')).toContain('I_KB_UNMANAGED_DOCS')
  })

  check(
    'a get lists uploaded documents by their recorded hash, downloading only an older one, once',
    async () => {
      const { workspaceId } = await setUp()
      const stored = await knowledgeBaseNamed(workspaceId, 'Policies')
      const [older] = await docs(stored.id)
      await forgetFileHash(older.id)
      const reads = vi.spyOn(readOriginalKnowledgeDocument, 'execute')
      const readIds = () => reads.mock.calls.map(([args]) => args.input.documentId)

      const first = await get(workspaceId)
      const firstReads = readIds()
      const second = await get(workspaceId)
      const allReads = readIds()
      reads.mockRestore()

      expect(firstReads).toEqual([older.id])
      expect(allReads).toEqual([older.id])
      expect(first.blobs.every((blob) => blob.sha256 !== undefined)).toBe(true)
      expect(second.blobs).toEqual(first.blobs)
    }
  )

  check(
    'a document whose bytes cannot be read is listed unhashed, not failing the get',
    async () => {
      const { workspaceId } = await setUp()
      const stored = await knowledgeBaseNamed(workspaceId, 'Policies')
      const [broken] = await docs(stored.id)
      await forgetFileHash(broken.id)
      const readOriginal = readOriginalKnowledgeDocument.execute
      const failing = vi
        .spyOn(readOriginalKnowledgeDocument, 'execute')
        .mockImplementation(async (args) => {
          if (args.input.documentId === broken.id) throw new Error('storage unavailable')
          return readOriginal.call(readOriginalKnowledgeDocument, args)
        })

      const read = await get(workspaceId).finally(() => failing.mockRestore())

      const listed = read.blobs.find((blob) => blob.id === broken.id)
      expect(listed).toMatchObject({ path: `knowledge/policies/docs/${broken.filename}` })
      expect(listed?.sha256).toBeUndefined()
      expect(read.blobs.filter((blob) => blob.sha256 !== undefined)).toHaveLength(
        read.blobs.length - 1
      )
      expect(codes(read.diagnostics, 'info')).toContain('I_KB_DOCS_UNHASHED')
    }
  )

  check(
    'a plan never downloads a document named in neither the base nor the directory',
    async () => {
      const { workspaceId, read, dir } = await setUp()
      const stored = await knowledgeBaseNamed(workspaceId, 'Policies')
      const extra = Buffer.from('Uploaded in the UI.\n')
      await uploadKnowledgeDocument.execute({
        principal: owner,
        input: {
          knowledgeBaseId: stored.id,
          file: {
            buffer: extra,
            filename: 'extra.txt',
            fileSize: extra.byteLength,
            mimeType: 'text/plain',
          },
        },
      })
      await indexed(workspaceId)
      const added = (await docs(stored.id)).find((doc) => doc.filename === 'extra.txt')
      if (!added) throw new Error('No extra document')
      await forgetFileHash(added.id)
      const reads = vi.spyOn(readOriginalKnowledgeDocument, 'execute')

      let readIds: string[] = []
      await apply(workspaceId, dir, { base: read.base, dryRun: true }).finally(() => {
        readIds = reads.mock.calls.map(([args]) => args.input.documentId)
        reads.mockRestore()
      })

      expect(readIds).not.toContain(added.id)
    }
  )

  check(
    "a replace stopped before its tags carried over keeps the old document's tags when the next apply finishes it",
    async () => {
      const { workspaceId, read, dir } = await setUp()
      const stored = await knowledgeBaseNamed(workspaceId, 'Policies')
      await tagRefunds(stored.id)
      const v2 = '# Refunds\nWithin 60 days.\n'
      const edited = withDoc(dir, REFUNDS, v2)
      // The tag carry fails, and so does removing the replacement again: as a kill there leaves it.
      const tags = failUpdate(1)
      const deletes = vi
        .spyOn(deleteKnowledgeDocument, 'execute')
        .mockRejectedValueOnce(new Error('storage unavailable'))

      const first = await apply(workspaceId, edited, { base: read.base }).finally(() => {
        tags.mockRestore()
        deletes.mockRestore()
      })
      expect(first.failed).toMatchObject({ key: 'policies' })
      expect(await docs(stored.id)).toHaveLength(3)

      const second = await apply(workspaceId, edited, { base: first.base, carry: 'none' })

      expect(second.failed).toBeUndefined()
      expect(await contents(stored.id)).toEqual([
        { filename: 'refunds.md', sha256: sha256Hex(Buffer.from(v2)), tag1: 'gold' },
        { filename: 'shipping.txt', sha256: expect.any(String), tag1: null },
      ])
    }
  )

  check(
    'a replace stopped before its delete, then edited again, is resumed with the new content and the old tags',
    async () => {
      const { workspaceId, read, dir } = await setUp()
      const stored = await knowledgeBaseNamed(workspaceId, 'Policies')
      await tagRefunds(stored.id)
      const failing = vi
        .spyOn(deleteKnowledgeDocument, 'execute')
        .mockRejectedValueOnce(new Error('storage unavailable'))
        .mockRejectedValueOnce(new Error('storage unavailable'))
      const first = await apply(
        workspaceId,
        withDoc(dir, REFUNDS, '# Refunds\nWithin 60 days.\n'),
        { base: read.base }
      ).finally(() => failing.mockRestore())
      expect(first.failed).toMatchObject({ key: 'policies' })
      expect(await docs(stored.id)).toHaveLength(3)

      const v3 = '# Refunds\nWithin 90 days.\n'
      const again = withDoc(dir, REFUNDS, v3)
      const planned = await apply(workspaceId, again, { base: first.base, dryRun: true })
      expect(codes(planned.diagnostics)).toEqual([])
      const second = await apply(workspaceId, again, { base: first.base })

      expect(second.failed).toBeUndefined()
      expect(await contents(stored.id)).toEqual([
        { filename: 'refunds.md', sha256: sha256Hex(Buffer.from(v3)), tag1: 'gold' },
        { filename: 'shipping.txt', sha256: expect.any(String), tag1: null },
      ])
      const settled = await apply(workspaceId, reprinted(again, second), {
        base: second.base,
        carry: 'none',
      })
      expect(actions(settled)).toEqual(['noop knowledge-base:policies'])
    }
  )

  check(
    'a replace stopped before its rename is finished by the next apply, or replaced again when edited since',
    async () => {
      const { workspaceId, read, dir } = await setUp()
      const stored = await knowledgeBaseNamed(workspaceId, 'Policies')
      await tagRefunds(stored.id)
      const v2 = '# Refunds\nWithin 60 days.\n'
      const renames = failUpdate(2)
      const first = await apply(workspaceId, withDoc(dir, REFUNDS, v2), {
        base: read.base,
      }).finally(() => renames.mockRestore())
      expect(first.failed).toMatchObject({ key: 'policies' })
      expect((await contents(stored.id)).map((doc) => doc.tag1)).toEqual(['gold', null])

      // A get meanwhile prints the replacement under its name.
      const midway = await get(workspaceId)
      expect(midway.blobs.map((blob) => blob.path).sort()).toEqual([
        'knowledge/policies/docs/refunds.md',
        'knowledge/policies/docs/shipping.txt',
      ])

      const v3 = '# Refunds\nWithin 90 days.\n'
      const again = withDoc(dir, REFUNDS, v3)
      const second = await apply(workspaceId, again, { base: first.base })

      expect(second.failed).toBeUndefined()
      expect(await contents(stored.id)).toEqual([
        { filename: 'refunds.md', sha256: sha256Hex(Buffer.from(v3)), tag1: 'gold' },
        { filename: 'shipping.txt', sha256: expect.any(String), tag1: null },
      ])

      // Stopped there again, the same directory finishes it with a rename alone.
      const stopped = failUpdate(2)
      const v4 = withDoc(dir, REFUNDS, '# Refunds\nWithin 120 days.\n')
      const third = await apply(workspaceId, v4, { base: second.base }).finally(() =>
        stopped.mockRestore()
      )
      expect(third.failed).toMatchObject({ key: 'policies' })
      const plan = await apply(workspaceId, v4, { base: third.base, dryRun: true, carry: 'none' })
      expect(codes(plan.diagnostics)).toEqual([])
      expect(plan.needBlobs).toEqual([])
      const fourth = await apply(workspaceId, v4, { base: third.base, carry: 'none' })
      expect(fourth.failed).toBeUndefined()
      expect((await contents(stored.id)).map((doc) => [doc.filename, doc.tag1])).toEqual([
        ['refunds.md', 'gold'],
        ['shipping.txt', null],
      ])
    }
  )
})
