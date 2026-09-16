/** Real connector persistence, sync-log projection, API-key authentication, and HTTP response validation. */
import { db } from '@sim/db'
import {
  apiKey,
  document,
  knowledgeBase,
  knowledgeConnectorSyncLog,
  organization,
  user,
  workspace,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { hashApiKey } from '@/lib/api-key/crypto'
import {
  createKnowledgeAclFixtureIds,
  seedKnowledgeAclFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import { createContentSyncLease } from '@/lib/knowledge/connectors/sync-lock'
import { persistSkippedDocuments } from '@/lib/knowledge/connectors/sync-persistence'
import { GET } from '@/app/api/v2/knowledge/[knowledgeBaseId]/connectors/[connectorId]/route'
import { CONNECTOR_MAX_FILE_BYTES, sizeLimitSkipReason } from '@/connectors/utils'

describe('connector source metadata cannot break persistence or API projection', () => {
  const ids = createKnowledgeAclFixtureIds()
  const token = `sim-key-${generateId()}`
  const syncLogId = generateId()

  beforeAll(async () => {
    await seedKnowledgeAclFixture(ids)
    await db.insert(apiKey).values({
      id: generateId(),
      userId: ids.aliceId,
      name: 'Connector regression fixture',
      key: `fixture-${generateId()}`,
      keyHash: hashApiKey(token),
      type: 'personal',
    })
    await db.insert(knowledgeConnectorSyncLog).values({
      id: syncLogId,
      connectorId: ids.connectorId,
      status: 'completed',
      startedAt: new Date('2026-01-01T00:00:00Z'),
      completedAt: new Date('2026-01-01T00:01:00Z'),
      listedCount: 7,
      docsAdded: 3,
      docsSkipped: 4,
    })
  })

  afterAll(async () => {
    await db.delete(knowledgeBase).where(eq(knowledgeBase.id, ids.knowledgeBaseId))
    await db.delete(workspace).where(eq(workspace.id, ids.workspaceId))
    await db.delete(organization).where(eq(organization.id, ids.organizationId))
    await db.delete(user).where(inArray(user.id, [ids.aliceId, ids.bobId]))
    await db.$client.end()
  })

  it('returns connector details from current database rows without leaking internal sync fields', async () => {
    const url = `http://localhost/api/v2/knowledge/${ids.knowledgeBaseId}/connectors/${ids.connectorId}?workspaceId=${ids.workspaceId}`
    const response = await GET(
      new NextRequest(url, {
        headers: { 'x-api-key': token, 'x-forwarded-for': '127.0.0.1' },
      }),
      {
        params: Promise.resolve({
          knowledgeBaseId: ids.knowledgeBaseId,
          connectorId: ids.connectorId,
        }),
      }
    )
    const body = await response.json()
    expect(response.status, JSON.stringify(body)).toBe(200)
    expect(body.data.syncLogs).toEqual([
      {
        id: syncLogId,
        connectorId: ids.connectorId,
        status: 'completed',
        startedAt: '2026-01-01T00:00:00.000Z',
        completedAt: '2026-01-01T00:01:00.000Z',
        docsAdded: 3,
        docsUpdated: 0,
        docsDeleted: 0,
        docsUnchanged: 0,
        docsSkipped: 4,
        docsFailed: 0,
        errorMessage: null,
      },
    ])
  })

  it('persists an oversized source beside other skipped files without int32 overflow or phantom stored bytes', async () => {
    const persisted = await persistSkippedDocuments(
      ids.knowledgeBaseId,
      ids.connectorId,
      'google_drive',
      [2_800_000_000, Number.MAX_SAFE_INTEGER, 120_000_000, 12].map((size, index) => ({
        type: 'skip',
        extDoc: {
          externalId: `large-source-${index}`,
          title: `source-${index}.pdf`,
          content: '',
          contentHash: `version-${index}`,
          mimeType: 'application/pdf',
          metadata: { size },
          skippedReason:
            index === 3
              ? 'Document contains no extractable text'
              : sizeLimitSkipReason(CONNECTOR_MAX_FILE_BYTES),
        },
      })),
      undefined,
      'workspace',
      createContentSyncLease(ids.connectorId, ids.lockId)
    )
    expect(persisted).toHaveLength(4)
    const rows = await db
      .select({
        fileSize: document.fileSize,
        storageKey: document.storageKey,
        status: document.processingStatus,
      })
      .from(document)
      .where(eq(document.connectorId, ids.connectorId))
    expect(rows).toHaveLength(4)
    expect(rows).toEqual(
      Array.from({ length: 4 }, () => ({ fileSize: 0, storageKey: null, status: 'failed' }))
    )
  })
})
