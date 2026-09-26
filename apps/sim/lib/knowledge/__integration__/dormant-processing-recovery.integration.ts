/**
 * Processing recovery while indexed organization search is dormant (the default: Live Search on).
 * A search index is neither crawled nor projected in that state, so recovery must not re-admit its
 * failed documents from stored bytes; a workspace knowledge base's failed documents are recovered
 * exactly as before.
 */
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { db } from '@sim/db'
import {
  document,
  knowledgeBase,
  member,
  organization,
  outboxEvent,
  user,
  workspace,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ root: '' }))
vi.mock('@/lib/core/config/trigger-runtime', () => ({ isInsideTriggerRun: () => false }))
/** Pinned to Live Search, whatever `SIM_SEARCH_LIVE` the run was started with. */
vi.mock('@/lib/core/config/env-flags', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isLiveEnterpriseSearchEnabled: true,
}))
vi.mock('@/lib/uploads/core/setup.server', () => ({
  get UPLOAD_DIR_SERVER() {
    return fixture.root
  },
}))

import {
  createKnowledgeAclFixtureIds,
  seedKnowledgeAclFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import { createContentSyncLease } from '@/lib/knowledge/connectors/sync-lock'
import { addDocument } from '@/lib/knowledge/connectors/sync-persistence'
import {
  KNOWLEDGE_DOCUMENT_RECOVERY_OUTBOX_EVENT,
  recoverKnowledgeDocumentProcessing,
} from '@/lib/knowledge/documents/processing-recovery'
import { QUEUED_DISPATCH_GRACE_MS } from '@/lib/knowledge/documents/types'

type FixtureIds = ReturnType<typeof createKnowledgeAclFixtureIds>

const fixtures: FixtureIds[] = []
const old = () => new Date(Date.now() - QUEUED_DISPATCH_GRACE_MS - 60_000)

/** A connector document whose processing failed long enough ago to be recoverable. */
async function failedFile(ids: FixtureIds, organizationOwned: boolean) {
  const file = await addDocument(
    ids.knowledgeBaseId,
    ids.connectorId,
    'google_drive',
    {
      externalId: generateId(),
      title: 'Retained fixture.txt',
      content: 'Recovery fixture content retained from the source.',
      mimeType: 'text/plain',
      contentHash: 'fixture-retained-v1',
    },
    organizationOwned
      ? { userId: ids.aliceId, workspaceId: null, organizationId: ids.organizationId }
      : { userId: ids.aliceId, workspaceId: ids.workspaceId },
    undefined,
    'admin',
    createContentSyncLease(ids.connectorId, ids.lockId)
  )
  await db
    .update(document)
    .set({
      processingStatus: 'failed',
      processingAttempts: 1,
      uploadedAt: old(),
      processingCompletedAt: old(),
      processingQueuedAt: old(),
      processingQueueToken: 'old-fixture-generation',
      processingError: 'Synthetic prior failure',
    })
    .where(eq(document.id, file.documentId))
  return file
}

async function recoveryEvents(ids: FixtureIds) {
  return db
    .select({ id: outboxEvent.id })
    .from(outboxEvent)
    .where(
      and(
        eq(outboxEvent.eventType, KNOWLEDGE_DOCUMENT_RECOVERY_OUTBOX_EVENT),
        sql`${outboxEvent.payload}->>'knowledgeBaseId' = ${ids.knowledgeBaseId}`
      )
    )
}

beforeAll(() => {
  fixture.root = mkdtempSync(path.join(tmpdir(), 'sim-dormant-recovery-'))
})

afterAll(async () => {
  for (const ids of fixtures) {
    await db
      .delete(outboxEvent)
      .where(sql`${outboxEvent.payload}->>'knowledgeBaseId' = ${ids.knowledgeBaseId}`)
    await db.delete(knowledgeBase).where(eq(knowledgeBase.id, ids.knowledgeBaseId))
    await db.delete(workspace).where(eq(workspace.id, ids.workspaceId))
    await db.delete(organization).where(eq(organization.id, ids.organizationId))
    await db.delete(user).where(inArray(user.id, [ids.aliceId, ids.bobId]))
  }
  await rm(fixture.root, { recursive: true, force: true })
  await db.$client.end()
})

describe('processing recovery while indexed organization search is dormant', () => {
  it('re-admits a workspace document and leaves a search-index document alone', async () => {
    const workspaceIds = createKnowledgeAclFixtureIds()
    const indexIds = createKnowledgeAclFixtureIds()
    fixtures.push(workspaceIds, indexIds)
    await seedKnowledgeAclFixture(workspaceIds, { connectorType: 'google_drive' })
    await seedKnowledgeAclFixture(indexIds, { connectorType: 'google_drive' })
    await db.insert(member).values({
      id: generateId(),
      organizationId: indexIds.organizationId,
      userId: indexIds.aliceId,
      role: 'owner',
    })
    await db
      .update(knowledgeBase)
      .set({ workspaceId: null, organizationId: indexIds.organizationId, isSearchIndex: true })
      .where(eq(knowledgeBase.id, indexIds.knowledgeBaseId))
    const workspaceFile = await failedFile(workspaceIds, false)
    const indexFile = await failedFile(indexIds, true)

    await recoverKnowledgeDocumentProcessing()

    expect(await recoveryEvents(workspaceIds)).toHaveLength(1)
    expect(await recoveryEvents(indexIds)).toEqual([])
    const rows = await db
      .select({ id: document.id, attempts: document.processingAttempts })
      .from(document)
      .where(inArray(document.id, [workspaceFile.documentId, indexFile.documentId]))
    const attempts = new Map(rows.map((row) => [row.id, row.attempts]))
    expect(attempts.get(workspaceFile.documentId)).toBe(2)
    expect(attempts.get(indexFile.documentId)).toBe(1)
  })
})
