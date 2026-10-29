/**
 * The plans the paged file reads must get from the live workspace-file indexes, proven on the
 * exact SQL the managers send: a workspace-wide page by upload date streams
 * `workspace_files_workspace_active_uploaded_idx`, a folder page streams
 * `workspace_files_workspace_folder_uploaded_idx`, a name-sorted folder page seeks the folder-name
 * index, a folder rollup seeks a folder-keyed index, and a name search probes
 * `workspace_files_workspace_name_trgm_idx`.
 */
import { db } from '@sim/db'
import { permissions, user, workspace, workspaceFiles } from '@sim/db/schema'
import { explainCaptured, type PlanNode } from '@sim/db/testing/explain'
import { assertDisposableTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { generateId } from '@sim/utils/id'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  aggregateWorkspaceFileFolderUsage,
  queryWorkspaceFiles,
} from '@/lib/uploads/contexts/workspace/file-manager'

const alice = generateId()
const workspaceId = generateId()
const folderId = generateId()

const scanOf = (nodes: PlanNode[], index: string) =>
  nodes.find((node) => node['Index Name'] === index)
const sorts = (nodes: PlanNode[]) =>
  nodes.filter((node) => node['Node Type'] === 'Sort' || node['Node Type'] === 'Incremental Sort')

describe('paged file read plans in PostgreSQL', () => {
  beforeAll(async () => {
    assertDisposableTestDatabaseUrl(process.env.DATABASE_URL ?? '')
    await db.insert(user).values({
      id: alice,
      name: 'Plan fixture',
      email: `${alice}@fixture.test`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    await insertWorkspaceFixture(db, {
      id: workspaceId,
      name: 'Plan fixture',
      ownerId: alice,
      billedAccountUserId: alice,
    })
    await db.insert(permissions).values({
      id: generateId(),
      userId: alice,
      entityType: 'workspace',
      entityId: workspaceId,
      permissionType: 'admin',
    })
    await db.execute(sql`
      INSERT INTO folder (id, name, user_id, workspace_id, resource_type)
      VALUES (${folderId}, 'Plans', ${alice}, ${workspaceId}, 'file')`)
    await db.execute(sql`
      INSERT INTO ${workspaceFiles} (id, key, user_id, workspace_id, folder_id, context, original_name,
        content_type, size_bytes, uploaded_at)
      SELECT 'wf_plan_' || n || '_' || ${workspaceId}, 'plan/' || n || '/' || ${workspaceId}, ${alice},
        ${workspaceId}, CASE WHEN n % 3 = 0 THEN ${folderId} END, 'workspace',
        'file-' || md5(n::text) || '.txt', 'text/plain', n,
        timestamp '2026-01-01' + n * interval '1 second'
      FROM generate_series(1, 6000) AS n`)
    await db.execute(sql`VACUUM ANALYZE ${workspaceFiles}`)
  })

  afterAll(async () => {
    await deleteWorkspaceFixture(db, eq(workspace.id, workspaceId))
    await db.delete(user).where(eq(user.id, alice))
  })

  const uploadedPage = (folder: string | null | undefined, sortOrder: 'asc' | 'desc') =>
    explainCaptured(
      db,
      () =>
        queryWorkspaceFiles(workspaceId, {
          folderId: folder,
          sortBy: 'uploadedAt',
          sortOrder,
          limit: 50,
          after: ['2026-01-01T00:30:00.000000Z', 'wf_plan_x'],
        }),
      { match: /order by/ }
    )

  it.each(['asc', 'desc'] as const)(
    'streams a workspace-wide page by upload date (%s) from the active upload index, without sorting',
    async (sortOrder) => {
      const nodes = await uploadedPage(undefined, sortOrder)
      const scan = scanOf(nodes, 'workspace_files_workspace_active_uploaded_idx')
      expect(scan?.['Index Cond']).toMatch(/uploaded_at [<>]=/)
      expect(sorts(nodes)).toEqual([])
    }
  )

  it.each([
    ['the root', null, 'asc'],
    ['the root', null, 'desc'],
    ['a folder', folderId, 'asc'],
    ['a folder', folderId, 'desc'],
  ] as const)(
    'streams a page of %s by upload date (%s) from the folder upload index, without sorting',
    async (_label, folder, sortOrder) => {
      const nodes = await uploadedPage(folder, sortOrder)
      const scan = scanOf(nodes, 'workspace_files_workspace_folder_uploaded_idx')
      expect(scan?.['Index Cond']).toMatch(/COALESCE\(folder_id.*uploaded_at [<>]=/)
      expect(sorts(nodes)).toEqual([])
    }
  )

  /**
   * Either folder-keyed index serves the rollup's seek — this one or the folder-name unique
   * index, which leads with the same `(workspace_id, coalesce(folder_id, ''))` — and the planner
   * picks between them on cost; what must never happen is a scan of the workspace's files.
   */
  it('rolls folder usage up by seeking a folder-keyed index', async () => {
    let usage: Awaited<ReturnType<typeof aggregateWorkspaceFileFolderUsage>> | undefined
    const nodes = await explainCaptured(db, async () => {
      usage = await aggregateWorkspaceFileFolderUsage(workspaceId, [folderId])
    })
    expect(usage?.get(folderId)?.fileCount).toBe(2000)
    const seek = nodes.find((node) => /COALESCE\(folder_id/.test(node['Index Cond'] ?? ''))
    expect([
      'workspace_files_workspace_folder_uploaded_idx',
      'workspace_files_workspace_folder_name_active_unique',
    ]).toContain(seek?.['Index Name'])
  })

  /**
   * The folder predicate must be spelled on `coalesce(folder_id, '')`: that is the key the
   * `(workspace_id, coalesce(folder_id, ''), original_name)` index leads with, and a name-sorted
   * folder page that cannot seek it reads every live file the workspace holds.
   */
  it.each([
    ['the root', null],
    ['a folder', folderId],
  ])('seeks the folder name index for a name-sorted page of %s', async (_label, folder) => {
    const nodes = await explainCaptured(
      db,
      () =>
        queryWorkspaceFiles(workspaceId, {
          folderId: folder,
          sortBy: 'name',
          sortOrder: 'asc',
          limit: 50,
          after: ['file-8', 'wf_plan_x'],
        }),
      { match: /order by/ }
    )
    const scan = scanOf(nodes, 'workspace_files_workspace_folder_name_active_unique')
    expect(scan?.['Index Cond']).toMatch(/COALESCE\(folder_id.*original_name >=/)
  })

  it('builds the trigram name index with fastupdate off', async () => {
    const [index] = await db.execute<{ options: string | null }>(sql`
      SELECT array_to_string(reloptions, ',') AS options FROM pg_class
      WHERE relname = 'workspace_files_workspace_name_trgm_idx'`)
    expect(index?.options).toBe('fastupdate=off')
  })

  it('probes the trigram name index for a substring search', async () => {
    const nodes = await explainCaptured(
      db,
      () =>
        queryWorkspaceFiles(workspaceId, {
          search: 'c4ca42',
          sortBy: 'name',
          sortOrder: 'asc',
          limit: 20,
        }),
      { match: /order by/ }
    )
    expect(scanOf(nodes, 'workspace_files_workspace_name_trgm_idx')?.['Index Cond']).toMatch(
      /original_name ~~\* '%c4ca42%'/
    )
  })
})
