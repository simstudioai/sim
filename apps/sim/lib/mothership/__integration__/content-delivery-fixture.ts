import { createHash } from 'node:crypto'
import { db } from '@sim/db'
import {
  apiKey,
  auditLog,
  document,
  embedding,
  embeddingSecretProvenance,
  knowledgeConnector,
  organization,
  user,
  userTableRowSecretProvenance,
  userTableRows,
  workflow,
  workflowExecutionLogs,
  workflowExecutionSnapshots,
  workspace,
  workspaceFileSearchRevision,
} from '@sim/db/schema'
import { deleteWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { matchV2Route } from '@/lib/api/server/routes/in-process-transport'
import { hashApiKey } from '@/lib/api-key/crypto'
import { encryptSecret } from '@/lib/core/security/encryption'
import {
  createKnowledgeAclFixtureIds,
  seedKnowledgeAclFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import { embeddingVectorValues } from '@/lib/knowledge/vector-columns'
import { uploadExecutionFile } from '@/lib/uploads/contexts/execution/file-manager'
import { uploadWorkspaceFile } from '@/lib/uploads/contexts/workspace/file-manager'
import type { WorkspaceFileSecretProvenance } from '@/lib/uploads/contexts/workspace/file-secret-provenance'
import { indexWorkspaceFileForSearch } from '@/lib/workspace-files/search/indexing'

export const ORIGIN = 'http://localhost:3000'

/** A literal no store vouches for: every canary is one of these, so a leak names its source. */
export const CANARY = {
  unknown: 'UNKNOWN_PROVENANCE_CANARY_7Q2',
  unrecorded: 'UNRECORDED_PROVENANCE_TEXT_4M8',
  clean: 'CLEAN_PROVENANCE_TEXT_9K1',
  secret: 'sk_live_FIXTURE_ENTRY_SECRET_0123456789',
} as const

/** Classifications every content store is seeded with, one item each. */
type SeededClassification = 'clean' | 'entries' | 'unknown' | 'unrecorded'

export interface ContentFixture {
  ids: ReturnType<typeof createKnowledgeAclFixtureIds>
  personalKey: string
  files: Record<SeededClassification, string>
  knowledge: {
    knowledgeBaseId: string
    documentId: string
    chunks: Record<Exclude<SeededClassification, 'unrecorded'>, string>
  }
  table: { tableId: string; rows: Record<Exclude<SeededClassification, 'unrecorded'>, string> }
  run: {
    workflowId: string
    runId: string
    files: Record<Exclude<SeededClassification, 'unrecorded'>, string>
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

/** The text each seeded item holds: the canary its classification names, beside shared prose. */
function seededText(classification: SeededClassification): string {
  switch (classification) {
    case 'clean':
      return `public notes ${CANARY.clean}\nsecond line`
    case 'entries':
      return `config token=${CANARY.secret}\nsecond line`
    case 'unknown':
      return `tainted export ${CANARY.unknown}\nsecond line`
    case 'unrecorded':
      return `untracked upload ${CANARY.unrecorded}\nsecond line`
  }
}

async function exactEntries(ids: ContentFixture['ids']) {
  return [
    {
      encryptedValue: (await encryptSecret(CANARY.secret)).encrypted,
      sourceUserId: ids.aliceId,
      sourceWorkspaceId: ids.workspaceId,
      name: 'FIXTURE_TOKEN',
    },
  ]
}

/**
 * Invokes a generated v2 route exactly as a deployed request reaches it: the real handler,
 * authenticated by the fixture's personal API key.
 */
export async function callV2(
  fixture: Pick<ContentFixture, 'personalKey'>,
  method: string,
  path: string,
  body?: unknown
): Promise<Response> {
  const url = new URL(path, ORIGIN)
  const matched = matchV2Route(url.pathname)
  if (!matched) throw new Error(`No v2 route for ${url.pathname}`)
  const handler = Reflect.get(await matched.load(), method)
  if (typeof handler !== 'function') throw new Error(`No ${method} handler for ${url.pathname}`)
  const request = new NextRequest(url, {
    method,
    headers: {
      'x-api-key': fixture.personalKey,
      'x-forwarded-for': '127.0.0.1',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const response: unknown = await handler(request, { params: Promise.resolve(matched.params) })
  if (!(response instanceof Response)) throw new Error('Route returned no response')
  return response
}

async function seedFiles(ids: ContentFixture['ids']): Promise<ContentFixture['files']> {
  const provenance: Record<SeededClassification, WorkspaceFileSecretProvenance> = {
    clean: { status: 'exact', entries: [] },
    entries: { status: 'exact', entries: await exactEntries(ids) },
    unknown: { status: 'unknown' },
    unrecorded: { status: 'unrecorded' },
  }
  const files = {} as ContentFixture['files']
  for (const classification of ['clean', 'entries', 'unknown', 'unrecorded'] as const) {
    const file = await uploadWorkspaceFile(
      ids.workspaceId,
      ids.aliceId,
      Buffer.from(seededText(classification)),
      `${classification}.txt`,
      'text/plain',
      { secretProvenance: provenance[classification], notifyWorkspaceChange: false }
    )
    files[classification] = file.id
    const dispatchedAt = new Date()
    const sourceContentUpdatedAt = file.contentUpdatedAt ?? new Date()
    await db
      .insert(workspaceFileSearchRevision)
      .values({
        fileId: file.id,
        workspaceId: ids.workspaceId,
        sourceContentUpdatedAt,
        status: 'pending',
        dispatchedAt,
      })
      .onConflictDoUpdate({
        target: workspaceFileSearchRevision.fileId,
        set: { status: 'pending', dispatchedAt, sourceContentUpdatedAt, buildId: null },
      })
    await indexWorkspaceFileForSearch(
      {
        workspaceId: ids.workspaceId,
        fileId: file.id,
        sourceContentUpdatedAt: sourceContentUpdatedAt.toISOString(),
        dispatchToken: dispatchedAt.toISOString(),
      },
      new AbortController().signal
    )
  }
  return files
}

async function seedKnowledge(ids: ContentFixture['ids']): Promise<ContentFixture['knowledge']> {
  const documentId = generateId()
  await db.insert(document).values({
    id: documentId,
    knowledgeBaseId: ids.knowledgeBaseId,
    filename: 'fixture.txt',
    fileUrl: `https://fixture.invalid/${documentId}`,
    fileSize: 64,
    mimeType: 'text/plain',
    processingStatus: 'completed',
    acl: ['ws'],
    aclRequirements: [],
    aclVerifiedAt: new Date(),
  })
  const entries = await exactEntries(ids)
  const chunks = {} as ContentFixture['knowledge']['chunks']
  let chunkIndex = 0
  for (const classification of ['clean', 'entries', 'unknown'] as const) {
    const id = generateId()
    const content = seededText(classification)
    await db.insert(embedding).values({
      id,
      documentId,
      knowledgeBaseId: ids.knowledgeBaseId,
      chunkIndex: chunkIndex++,
      chunkHash: sha256(content),
      content,
      contentLength: content.length,
      tokenCount: 8,
      startOffset: 0,
      endOffset: content.length,
      embeddingModel: 'text-embedding-3-small',
      ...embeddingVectorValues(1536, [1, chunkIndex / 10, ...Array<number>(1534).fill(0)]),
      ...(classification === 'clean' ? {} : { secretProvenanceVersion: 1 }),
    })
    if (classification === 'entries') {
      await db.insert(embeddingSecretProvenance).values({
        embeddingId: id,
        contentHash: sha256(content),
        status: 'exact',
        entries,
      })
    }
    chunks[classification] = id
  }
  return { knowledgeBaseId: ids.knowledgeBaseId, documentId, chunks }
}

async function seedTable(
  fixture: Pick<ContentFixture, 'personalKey' | 'ids'>
): Promise<ContentFixture['table']> {
  const workspaceId = fixture.ids.workspaceId
  const created = await callV2(fixture, 'POST', '/api/v2/tables', {
    workspaceId,
    name: 'content_fixture',
    schema: { columns: [{ name: 'note', type: 'string' }] },
  })
  if (created.status !== 201) throw new Error(`Table fixture failed: ${await created.text()}`)
  const tableId: string = (await created.json()).data.id
  const rows = {} as ContentFixture['table']['rows']
  for (const classification of ['clean', 'entries', 'unknown'] as const) {
    const inserted = await callV2(fixture, 'POST', `/api/v2/tables/${tableId}/rows`, {
      workspaceId,
      data: { note: seededText(classification) },
    })
    if (inserted.status !== 201) throw new Error(`Row fixture failed: ${await inserted.text()}`)
    rows[classification] = (await inserted.json()).data.id
  }
  /** Cells are stored by column id; the sidecar names the one column the secret is in. */
  const [stored] = await db
    .select({ data: userTableRows.data })
    .from(userTableRows)
    .where(eq(userTableRows.id, rows.entries))
  const [columnId] = Object.keys(stored?.data ?? {})
  if (!columnId) throw new Error('Row fixture stored no cells')
  const columnEntries = (await exactEntries(fixture.ids)).map((entry) => ({ ...entry, columnId }))
  /** v2 inserts already bind an exact-empty sidecar; only its classification is rewritten. */
  await db
    .update(userTableRowSecretProvenance)
    .set({ entries: columnEntries })
    .where(eq(userTableRowSecretProvenance.rowId, rows.entries))
  await db
    .update(userTableRowSecretProvenance)
    .set({ status: 'unknown' })
    .where(eq(userTableRowSecretProvenance.rowId, rows.unknown))
  return { tableId, rows }
}

async function seedRun(ids: ContentFixture['ids']): Promise<ContentFixture['run']> {
  const workflowId = generateId()
  const runId = generateId()
  const snapshotId = generateId()
  const now = new Date()
  await db.insert(workflow).values({
    id: workflowId,
    userId: ids.aliceId,
    workspaceId: ids.workspaceId,
    name: `content fixture ${workflowId}`,
    lastSynced: now,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(workflowExecutionSnapshots).values({
    id: snapshotId,
    workflowId,
    stateHash: snapshotId,
    stateData: {},
  })
  const context = { workspaceId: ids.workspaceId, workflowId, executionId: runId }
  const entries = await exactEntries(ids)
  const provenance = {
    clean: { status: 'exact', entries: [] },
    entries: { status: 'exact', entries },
    unknown: { status: 'unknown' },
  } as const
  const outputs: Record<string, unknown> = {}
  const files = {} as ContentFixture['run']['files']
  for (const classification of ['clean', 'entries', 'unknown'] as const) {
    const file = await uploadExecutionFile(
      context,
      Buffer.from(seededText(classification)),
      `${classification}.txt`,
      'text/plain',
      ids.aliceId,
      provenance[classification]
    )
    files[classification] = file.id
    outputs[classification] = file
  }
  await db.insert(workflowExecutionLogs).values({
    id: generateId(),
    workflowId,
    workspaceId: ids.workspaceId,
    executionId: runId,
    stateSnapshotId: snapshotId,
    level: 'info',
    status: 'completed',
    trigger: 'api',
    startedAt: now,
    endedAt: now,
    executionData: { finalOutput: outputs, traceSpans: [] },
  })
  return { workflowId, runId, files }
}

/** One workspace holding a clean, a secret-bearing, an unknown and an unrecorded item per store. */
export async function seedContentFixture(): Promise<ContentFixture> {
  const ids = createKnowledgeAclFixtureIds()
  await seedKnowledgeAclFixture(ids)
  const personalKey = `sk-sim-fixture-${generateId()}`
  await db.insert(apiKey).values({
    id: generateId(),
    userId: ids.aliceId,
    name: 'Content fixture',
    key: personalKey,
    keyHash: hashApiKey(personalKey),
    type: 'personal',
  })
  const files = await seedFiles(ids)
  const knowledge = await seedKnowledge(ids)
  const table = await seedTable({ ids, personalKey })
  const run = await seedRun(ids)
  return { ids, personalKey, files, knowledge, table, run }
}

export async function removeContentFixture(fixture: ContentFixture): Promise<void> {
  const { ids } = fixture
  await db.delete(auditLog).where(eq(auditLog.workspaceId, ids.workspaceId))
  await db
    .delete(workflowExecutionLogs)
    .where(eq(workflowExecutionLogs.workspaceId, ids.workspaceId))
  await db
    .delete(workflowExecutionSnapshots)
    .where(eq(workflowExecutionSnapshots.workflowId, fixture.run.workflowId))
  await deleteWorkspaceFixture(db, eq(workspace.id, ids.workspaceId))
  await db.delete(organization).where(eq(organization.id, ids.organizationId))
  await db.delete(user).where(inArray(user.id, [ids.aliceId, ids.bobId]))
}

/**
 * Adds a document a connector synced, so a connector listing has a row to classify. Kept out of
 * the shared seed, whose non-Chat responses the compat baseline records.
 */
export async function seedKnowledgeConnector(
  fixture: ContentFixture
): Promise<{ connectorId: string; documentId: string }> {
  const connectorId = generateId()
  await db.insert(knowledgeConnector).values({
    id: connectorId,
    knowledgeBaseId: fixture.knowledge.knowledgeBaseId,
    connectorType: 'fixture',
    sourceConfig: {},
  })
  const documentId = generateId()
  await db.insert(document).values({
    id: documentId,
    knowledgeBaseId: fixture.knowledge.knowledgeBaseId,
    connectorId,
    filename: 'synced.txt',
    fileUrl: `https://fixture.invalid/${documentId}`,
    fileSize: 64,
    mimeType: 'text/plain',
    processingStatus: 'completed',
    acl: ['ws'],
    aclRequirements: [],
    aclVerifiedAt: new Date(),
  })
  return { connectorId, documentId }
}
