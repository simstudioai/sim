/**
 * Real PostgreSQL reads of a workspace's whole file list: which rows each scope returns, their
 * order, and the plan the live list's SQL gets.
 */
import { db } from '@sim/db'
import { user, workspace, workspaceFiles } from '@sim/db/schema'
import { explainCaptured } from '@sim/db/testing/explain'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { uploadsSetupMock } from '@sim/testing/mocks/uploads-setup.mock'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/uploads/core/setup.server', () => uploadsSetupMock)

import { listWorkspaceFiles } from '@/lib/uploads/contexts/workspace/file-manager'
import { WORKSPACE_FILE_SEED_MAX } from '@/app/workspace/[workspaceId]/lib/seed-workspace-files'

const ownerId = generateId()
const workspaceId = generateId()
const otherWorkspaceId = generateId()
const tick = (seconds: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, seconds))

type FileRow = typeof workspaceFiles.$inferInsert

function fileRow(name: string, values: Partial<FileRow> = {}): FileRow {
  const id = `${name}-${workspaceId}`
  return {
    id,
    key: `workspace/${workspaceId}/${id}`,
    userId: ownerId,
    workspaceId,
    context: 'workspace',
    originalName: `${name}.txt`,
    contentType: 'text/plain',
    sizeBytes: 1,
    ...values,
  }
}

describe('workspace file list in PostgreSQL', () => {
  /**
   * Rows inserted, and deleted, out of id order, with uploaded_at ties inside each scope and
   * across them, so an order that is not (uploaded_at, id) shows up as a reordered list.
   */
  const live = [
    fileRow('live-d', { uploadedAt: tick(1) }),
    fileRow('live-c', { uploadedAt: tick(2) }),
    fileRow('live-b', { uploadedAt: tick(2) }),
    fileRow('live-a', { uploadedAt: tick(2) }),
    fileRow('live-e', { uploadedAt: tick(4) }),
  ]
  const archived = [
    fileRow('gone-b', { uploadedAt: tick(2), deletedAt: tick(10) }),
    fileRow('gone-c', { uploadedAt: tick(3), deletedAt: tick(11) }),
    fileRow('gone-a', { uploadedAt: tick(3), deletedAt: tick(12) }),
  ]
  const neverListed = [
    fileRow('chat-upload', { context: 'mothership', uploadedAt: tick(2) }),
    fileRow('execution-output', { context: 'execution', uploadedAt: tick(2) }),
    fileRow('other-workspace', {
      workspaceId: otherWorkspaceId,
      key: `workspace/${otherWorkspaceId}/other`,
      uploadedAt: tick(2),
    }),
  ]
  const byUploadThenId = (rows: FileRow[]) =>
    [...rows]
      .sort(
        (a, b) =>
          (a.uploadedAt?.getTime() ?? 0) - (b.uploadedAt?.getTime() ?? 0) ||
          (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
      )
      .map((row) => row.id)

  beforeAll(async () => {
    await db.insert(user).values({
      id: ownerId,
      email: `${ownerId}@file-list.invalid`,
      name: 'File list fixture',
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    await insertWorkspaceFixture(
      db,
      [workspaceId, otherWorkspaceId].map((id) => ({
        id,
        ownerId,
        billedAccountUserId: ownerId,
        name: 'File list fixture',
      }))
    )
    await db.insert(workspaceFiles).values([...live, ...archived, ...neverListed])
  })

  afterAll(async () => {
    try {
      await db.delete(workspaceFiles).where(eq(workspaceFiles.userId, ownerId))
      await deleteWorkspaceFixture(db, inArray(workspace.id, [workspaceId, otherWorkspaceId]))
      await db.delete(user).where(eq(user.id, ownerId))
    } finally {
      await db.$client.end()
    }
  })

  it.each([
    { scope: 'active', label: 'live files', expected: byUploadThenId(live) },
    { scope: 'archived', label: 'Recently Deleted files', expected: byUploadThenId(archived) },
    {
      scope: 'all',
      label: 'live and deleted files together',
      expected: byUploadThenId([...live, ...archived]),
    },
  ] as const)('lists $label by upload time, ties by id', async ({ scope, expected }) => {
    const files = await listWorkspaceFiles(workspaceId, { scope, throwOnError: true })
    expect(files.map((file) => file.id)).toEqual(expected)
  })

  /**
   * With every sorting plan ruled out, an ordered plan exists only if an index's predicate is
   * implied by the list's filter and its key gives the list's order.
   */
  it('reads the live list, whole or bounded, in order from its workspace index', async () => {
    for (const limit of [undefined, WORKSPACE_FILE_SEED_MAX + 1]) {
      const nodes = await explainCaptured(
        db,
        () => listWorkspaceFiles(workspaceId, { limit, throwOnError: true }),
        { match: /from "workspace_files"/, gucs: { enable_sort: 'off' } }
      )
      expect(nodes.map((node) => node['Node Type'])).not.toContain('Sort')
      expect(nodes.map((node) => node['Index Name'])).toContain(
        'workspace_files_workspace_active_uploaded_idx'
      )
    }
  })
})
