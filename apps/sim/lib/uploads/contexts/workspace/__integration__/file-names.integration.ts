/**
 * Real PostgreSQL name allocation and name lookups for workspace files and chat uploads, plus the
 * URL fetch path.
 */
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { db, dbFor } from '@sim/db'
import {
  copilotChats,
  displaySegmentKey,
  organization,
  user,
  workspace,
  workspaceFiles,
} from '@sim/db/schema'
import { deleteWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { createDeferred } from '@sim/testing/helpers/deferred'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const fixtureStorage = vi.hoisted(() => ({ root: '' }))
vi.mock('@/lib/uploads/core/setup.server', () => ({
  get UPLOAD_DIR_SERVER() {
    return fixtureStorage.root
  },
}))

import { fileParseBodySchema } from '@/lib/api/contracts/storage-transfer'
import * as inputValidation from '@/lib/core/security/input-validation.server'
import { textArrayLiteral } from '@/lib/db/arrays'
import { executeFileParserOperation } from '@/lib/internal/file/parser'
import {
  createKnowledgeAclFixtureIds,
  seedKnowledgeAclFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import {
  bulkArchiveWorkspaceFileItems,
  createWorkspaceFileFolder,
  fileNameExistsInWorkspaceFolder,
  moveWorkspaceFileItems,
  updateWorkspaceFileFolder,
  workspaceFileNameFolderCondition,
} from '@/lib/uploads/contexts/workspace/file-folder-manager'
import {
  deleteWorkspaceFile,
  fetchWorkspaceFileBuffer,
  findListedWorkspaceFiles,
  findWorkspaceFileRecord,
  generateWorkspaceFileKey,
  getWorkspaceFileByName,
  listWorkspaceFiles,
  resolveWorkspaceFileReference,
  trackChatUpload,
  uploadWorkspaceFile,
  workspaceFileVfsPath,
} from '@/lib/uploads/contexts/workspace/file-manager'
import { normalizeDisplaySegment } from '@/lib/vfs/path'
import { createWorkspaceFileDelegatedPrincipal } from '@/lib/workspace-files/application/delegated-principal'
import { restoreWorkspaceFileOperation } from '@/lib/workspace-files/application/restore-workspace-file'

describe('workspace file names in PostgreSQL', () => {
  const fixtures: ReturnType<typeof createKnowledgeAclFixtureIds>[] = []

  beforeAll(() => {
    fixtureStorage.root = mkdtempSync(path.join(tmpdir(), 'sim-file-names-'))
  })

  afterAll(async () => {
    vi.restoreAllMocks()
    for (const ids of fixtures) {
      await deleteWorkspaceFixture(db, eq(workspace.id, ids.workspaceId))
      await db.delete(organization).where(eq(organization.id, ids.organizationId))
      await db.delete(user).where(inArray(user.id, [ids.aliceId, ids.bobId]))
    }
    await rm(fixtureStorage.root, { recursive: true, force: true })
    await Promise.all([db.$client.end(), dbFor('cleanup').$client.end()])
  })

  async function seedWorkspace() {
    const ids = createKnowledgeAclFixtureIds()
    fixtures.push(ids)
    await seedKnowledgeAclFixture(ids)
    return ids
  }

  it.each(['update', 'move', 'archive'] as const)(
    'allows a small subtree %s when unrelated folders exceed the bulk limit',
    async (operation) => {
      const fixture = await seedWorkspace()
      const rootId = generateId()
      const targetId = generateId()
      const childId = generateId()
      await db.execute(sql`INSERT INTO folder (id, name, user_id, workspace_id, resource_type)
        SELECT ${rootId} || '-' || n, 'Unrelated ' || n, ${fixture.aliceId}, ${fixture.workspaceId}, 'file'
        FROM generate_series(1, 5001) n`)
      await db.execute(sql`INSERT INTO folder (id, name, user_id, workspace_id, resource_type)
        VALUES (${rootId}, 'Root', ${fixture.aliceId}, ${fixture.workspaceId}, 'file'),
          (${targetId}, 'Target', ${fixture.aliceId}, ${fixture.workspaceId}, 'file')`)
      await db.execute(sql`INSERT INTO folder (id, name, user_id, workspace_id, resource_type, parent_id)
        VALUES (${childId}, 'Child', ${fixture.aliceId}, ${fixture.workspaceId}, 'file', ${rootId})`)
      if (operation === 'update') {
        await updateWorkspaceFileFolder({
          workspaceId: fixture.workspaceId,
          folderId: rootId,
          parentId: targetId,
        })
      } else if (operation === 'move') {
        await moveWorkspaceFileItems({
          workspaceId: fixture.workspaceId,
          folderIds: [rootId],
          targetFolderId: targetId,
        })
      } else {
        await bulkArchiveWorkspaceFileItems({
          workspaceId: fixture.workspaceId,
          folderIds: [rootId],
        })
      }
      const rows = await db.execute<{ id: string; parentId: string | null; archived: boolean }>(sql`
        SELECT id, parent_id AS "parentId", deleted_at IS NOT NULL AS archived
        FROM folder WHERE id IN (${rootId}, ${childId}) ORDER BY name`)
      expect([...rows]).toEqual([
        { id: childId, parentId: rootId, archived: operation === 'archive' },
        {
          id: rootId,
          parentId: operation === 'archive' ? null : targetId,
          archived: operation === 'archive',
        },
      ])
      const [unrelated] = await db.execute<{
        count: number
      }>(sql`SELECT count(*)::int AS count FROM folder
        WHERE workspace_id = ${fixture.workspaceId} AND parent_id IS NULL AND deleted_at IS NULL
          AND id NOT IN (${rootId}, ${childId}, ${targetId})`)
      expect(unrelated.count).toBe(5001)
    }
  )

  it('rejects a move whose actual subtree exceeds the bulk limit without changing its parent', async () => {
    const fixture = await seedWorkspace()
    const rootId = generateId()
    const targetId = generateId()
    await db.execute(sql`INSERT INTO folder (id, name, user_id, workspace_id, resource_type)
      VALUES (${rootId}, 'Root', ${fixture.aliceId}, ${fixture.workspaceId}, 'file'),
        (${targetId}, 'Target', ${fixture.aliceId}, ${fixture.workspaceId}, 'file')`)
    await db.execute(sql`INSERT INTO folder (id, name, user_id, workspace_id, resource_type, parent_id)
      SELECT ${rootId} || '-' || n, 'Child ' || n, ${fixture.aliceId}, ${fixture.workspaceId}, 'file', ${rootId}
      FROM generate_series(1, 5000) n`)
    await expect(
      updateWorkspaceFileFolder({
        workspaceId: fixture.workspaceId,
        folderId: rootId,
        parentId: targetId,
      })
    ).rejects.toMatchObject({
      code: 'validation',
      message: 'File operation affects more than 5000 items',
    })
    expect([...(await db.execute(sql`SELECT parent_id FROM folder WHERE id = ${rootId}`))]).toEqual(
      [{ parent_id: null }]
    )
  })

  it('rejects descendant destinations when unrelated folders exceed the bulk limit', async () => {
    const fixture = await seedWorkspace()
    const rootId = generateId()
    const childId = generateId()
    await db.execute(sql`INSERT INTO folder (id, name, user_id, workspace_id, resource_type)
      SELECT ${rootId} || '-' || n, 'Unrelated ' || n, ${fixture.aliceId}, ${fixture.workspaceId}, 'file'
      FROM generate_series(1, 5001) n`)
    await db.execute(sql`INSERT INTO folder (id, name, user_id, workspace_id, resource_type)
      VALUES (${rootId}, 'Root', ${fixture.aliceId}, ${fixture.workspaceId}, 'file')`)
    await db.execute(sql`INSERT INTO folder (id, name, user_id, workspace_id, resource_type, parent_id)
      VALUES (${childId}, 'Child', ${fixture.aliceId}, ${fixture.workspaceId}, 'file', ${rootId})`)
    await expect(
      updateWorkspaceFileFolder({
        workspaceId: fixture.workspaceId,
        folderId: rootId,
        parentId: childId,
      })
    ).rejects.toMatchObject({
      code: 'validation',
      message: 'Cannot move a folder into one of its descendants',
    })
    expect([...(await db.execute(sql`SELECT parent_id FROM folder WHERE id = ${rootId}`))]).toEqual(
      [{ parent_id: null }]
    )
  })

  it('serializes crossed folder moves and rejects the move that would close a cycle', async () => {
    const fixture = await seedWorkspace()
    const first = await createWorkspaceFileFolder({
      workspaceId: fixture.workspaceId,
      userId: fixture.aliceId,
      name: 'First',
    })
    const second = await createWorkspaceFileFolder({
      workspaceId: fixture.workspaceId,
      userId: fixture.aliceId,
      name: 'Second',
    })
    const outcomes = await Promise.allSettled([
      updateWorkspaceFileFolder({
        workspaceId: fixture.workspaceId,
        folderId: first.id,
        parentId: second.id,
      }),
      updateWorkspaceFileFolder({
        workspaceId: fixture.workspaceId,
        folderId: second.id,
        parentId: first.id,
      }),
    ])
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
    const rejected = outcomes.find((outcome) => outcome.status === 'rejected')
    expect(rejected?.status === 'rejected' && rejected.reason).toMatchObject({
      code: 'validation',
      message: 'Cannot move a folder into one of its descendants',
    })
    const parents = [
      ...(await db.execute<{ id: string; parent_id: string | null }>(sql`
      SELECT id, parent_id FROM folder WHERE id IN (${first.id}, ${second.id})`)),
    ]
    expect(parents.filter((row) => row.parent_id === null)).toHaveLength(1)
    expect(parents.filter((row) => row.parent_id !== null)).toHaveLength(1)
  })

  function upload(workspaceId: string, userId: string, name: string, folderId?: string | null) {
    return uploadWorkspaceFile(workspaceId, userId, Buffer.from(name), name, 'text/plain', {
      folderId,
      notifyWorkspaceChange: false,
    })
  }

  async function seedChat(workspaceId: string, userId: string) {
    const chatId = generateId()
    await db.insert(copilotChats).values({ id: chatId, userId, workspaceId, type: 'mothership' })
    return chatId
  }

  async function trackUpload(workspaceId: string, userId: string, chatId: string, name: string) {
    const key = generateWorkspaceFileKey(workspaceId, name)
    await trackChatUpload(workspaceId, userId, chatId, key, name, 'image/png', 10)
    const [row] = await db.select().from(workspaceFiles).where(eq(workspaceFiles.key, key))
    return row
  }

  async function parseExternalUrl(executionId?: string) {
    const fixture = await seedWorkspace()
    const url = 'https://example.com/page.txt'
    vi.spyOn(inputValidation, 'validateUrlWithDNS').mockResolvedValue({
      isValid: true,
      resolvedIP: '203.0.113.10',
      originalHostname: new URL(url).hostname,
    })
    vi.spyOn(inputValidation, 'secureFetchWithPinnedIP').mockImplementation(async () => {
      const response = new Response('fetched page body')
      return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        headers: new inputValidation.SecureFetchHeaders({ 'content-type': 'text/plain' }),
        body: response.body,
        text: () => response.text(),
        json: () => response.json(),
        arrayBuffer: () => response.arrayBuffer(),
      }
    })

    const response = await executeFileParserOperation(
      fileParseBodySchema.parse({ filePath: url, workspaceId: fixture.workspaceId }),
      {
        principal: createWorkspaceFileDelegatedPrincipal({
          serviceId: 'executor',
          subjectUserId: fixture.aliceId,
          workspaceId: fixture.workspaceId,
          delegationId: generateId(),
          executionId,
        }),
        workspaceId: fixture.workspaceId,
        workflowId: generateId(),
        executionId,
        attributedUserId: fixture.aliceId,
        fileAccessUserId: fixture.aliceId,
      }
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.output.content).toContain('fetched page body')
    return db
      .select({ context: workspaceFiles.context })
      .from(workspaceFiles)
      .where(eq(workspaceFiles.workspaceId, fixture.workspaceId))
  }

  it('parses an external URL without saving a copy to workspace Files', async () => {
    expect(await parseExternalUrl()).toEqual([])
  })

  it('keeps an external URL parsed during an execution as an execution file only', async () => {
    expect(await parseExternalUrl(generateId())).toEqual([{ context: 'execution' }])
  })

  it('scopes name lookups to root or folder through the unique name index', async () => {
    const fixture = await seedWorkspace()
    const folder = await createWorkspaceFileFolder({
      workspaceId: fixture.workspaceId,
      userId: fixture.aliceId,
      name: 'Reports',
    })
    const rootFile = await upload(fixture.workspaceId, fixture.aliceId, 'root.txt')
    const folderFile = await upload(fixture.workspaceId, fixture.aliceId, 'nested.txt', folder.id)

    expect(await fileNameExistsInWorkspaceFolder(fixture.workspaceId, 'root.txt', null)).toBe(true)
    expect(await fileNameExistsInWorkspaceFolder(fixture.workspaceId, 'root.txt', folder.id)).toBe(
      false
    )
    expect(await fileNameExistsInWorkspaceFolder(fixture.workspaceId, 'nested.txt', null)).toBe(
      false
    )
    expect(
      await fileNameExistsInWorkspaceFolder(fixture.workspaceId, 'nested.txt', folder.id)
    ).toBe(true)
    expect((await getWorkspaceFileByName(fixture.workspaceId, 'root.txt'))?.id).toBe(rootFile.id)
    expect(
      await getWorkspaceFileByName(fixture.workspaceId, 'root.txt', { folderId: folder.id })
    ).toBeNull()
    expect(
      (await getWorkspaceFileByName(fixture.workspaceId, 'nested.txt', { folderId: folder.id }))?.id
    ).toBe(folderFile.id)
    expect(await getWorkspaceFileByName(fixture.workspaceId, 'nested.txt')).toBeNull()

    await db.execute(sql`
      INSERT INTO ${workspaceFiles} (id, key, user_id, workspace_id, folder_id, context, original_name, content_type)
      SELECT 'wf_pad_' || n || '_' || ${fixture.workspaceId}, 'pad/' || n || '/' || ${fixture.workspaceId},
        ${fixture.aliceId}, ${fixture.workspaceId}, CASE WHEN n % 2 = 0 THEN ${folder.id} END,
        'workspace', 'pad-' || n || '.txt', 'text/plain'
      FROM generate_series(1, 2000) AS n`)
    await db.execute(sql`ANALYZE ${workspaceFiles}`)

    for (const folderId of [null, folder.id]) {
      const plan = await db.execute(
        sql`EXPLAIN (FORMAT JSON) SELECT id FROM ${workspaceFiles} WHERE ${and(
          eq(workspaceFiles.workspaceId, fixture.workspaceId),
          eq(workspaceFiles.originalName, 'root.txt'),
          eq(workspaceFiles.context, 'workspace'),
          workspaceFileNameFolderCondition(folderId),
          isNull(workspaceFiles.deletedAt)
        )}`
      )
      const scan = JSON.stringify(plan[0]['QUERY PLAN'])
      expect(scan).toContain('workspace_files_workspace_folder_name_active_unique')
      expect(scan).toMatch(/"Index Cond":"[^"]*COALESCE\(folder_id/)
    }
  })

  it.each([false, true])(
    'restores with a new name when a deployed writer claims the candidate (nested=%s)',
    async (nested) => {
      const fixture = await seedWorkspace()
      const folderId = nested
        ? (
            await createWorkspaceFileFolder({
              workspaceId: fixture.workspaceId,
              userId: fixture.aliceId,
              name: 'Restore target',
            })
          ).id
        : null
      const archived = await upload(fixture.workspaceId, fixture.aliceId, 'restore.txt', folderId)
      await deleteWorkspaceFile(fixture.workspaceId, archived.id)
      const competitor = await upload(fixture.workspaceId, fixture.aliceId, 'other.txt', folderId)
      const triggerName = sql.identifier(`restore_race_${generateId().replaceAll('-', '')}`)
      await db.execute(sql`
        CREATE FUNCTION ${triggerName}() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.id = TG_ARGV[0] THEN
            PERFORM pg_advisory_xact_lock(hashtext('restore-race:' || NEW.id));
          END IF;
          RETURN NEW;
        END $$
      `)
      await db.execute(sql`
        CREATE TRIGGER ${triggerName} BEFORE UPDATE OF deleted_at ON ${workspaceFiles}
        FOR EACH ROW WHEN (OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL)
        EXECUTE FUNCTION ${triggerName}(${sql.raw(`'${archived.id}'`)})
      `)
      const ready = createDeferred<number>()
      const release = createDeferred<void>()
      const blocker = db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext(${`restore-race:${archived.id}`}))`
        )
        const [connection] = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)
        ready.resolve(connection.pid)
        await release.promise
      })
      const blockerPid = await ready.promise
      const restoration = Promise.allSettled([
        restoreWorkspaceFileOperation.execute({
          principal: { kind: 'session', userId: fixture.aliceId, sessionId: generateId() },
          input: { fileId: archived.id, assertedWorkspaceId: fixture.workspaceId },
        }),
      ])
      try {
        await expect
          .poll(
            async () =>
              (
                await db.execute(sql`
          SELECT pid FROM pg_stat_activity WHERE ${blockerPid} = ANY(pg_blocking_pids(pid))
        `)
              ).length,
            { timeout: 5000 }
          )
          .toBe(1)
        /** The deployed rename updates only the file row; it does not take the new directory mutex. */
        await db
          .update(workspaceFiles)
          .set({ originalName: archived.name, updatedAt: new Date() })
          .where(
            and(
              eq(workspaceFiles.id, competitor.id),
              eq(workspaceFiles.workspaceId, fixture.workspaceId),
              eq(workspaceFiles.context, 'workspace')
            )
          )
      } finally {
        release.resolve()
        await blocker
        await restoration
        await db.execute(sql`DROP TRIGGER ${triggerName} ON ${workspaceFiles}`)
        await db.execute(sql`DROP FUNCTION ${triggerName}()`)
      }
      const [result] = await restoration
      if (result.status === 'rejected') throw result.reason
      expect(result.value.file).toMatchObject({
        id: archived.id,
        name: 'restore_restored.txt',
        folderId,
        key: archived.key,
      })
      expect(
        (await fetchWorkspaceFileBuffer(result.value.file, { maxBytes: 1024 })).toString()
      ).toBe('restore.txt')
      expect(
        (await getWorkspaceFileByName(fixture.workspaceId, 'restore.txt', { folderId }))?.id
      ).toBe(competitor.id)
      expect(
        (await getWorkspaceFileByName(fixture.workspaceId, 'restore_restored.txt', { folderId }))
          ?.id
      ).toBe(archived.id)
    }
  )
  // Names stored before upload normalization: U+202F before AM/PM, doubled and edge whitespace,
  // a decomposed accent, a control character, and a BOM.
  const unnormalizedNames = [
    'Screenshot 2026-01-15 at 9.41.07\u202fAM.png',
    'Quarterly  Report.pdf',
    ' padded.txt\t',
    'Cafe\u0301 menu.png',
    'ring\u0007ing.png',
    '\ufeffbom.md',
  ]

  it('normalizes a display name in SQL exactly as normalizeDisplaySegment does', async () => {
    const rows = await db.execute<{ name: string; key: string }>(
      sql`SELECT name, ${displaySegmentKey(sql`name`)} AS key FROM unnest(${textArrayLiteral(unnormalizedNames)}) AS name`
    )
    expect(rows).toHaveLength(unnormalizedNames.length)
    for (const row of rows) expect(row.key).toBe(normalizeDisplaySegment(row.name))
  })

  it('resolves a stored name that differs from its VFS path through the display-name index', async () => {
    const fixture = await seedWorkspace()
    const folder = await createWorkspaceFileFolder({
      workspaceId: fixture.workspaceId,
      userId: fixture.aliceId,
      name: 'Reports',
    })

    const files = unnormalizedNames.map((name, n) => ({
      name,
      id: `wf_legacy_${n}_${fixture.workspaceId}`,
      folderId: n === 0 ? folder.id : null,
    }))
    for (const file of files) {
      await db.execute(sql`
        INSERT INTO ${workspaceFiles} (id, key, user_id, workspace_id, folder_id, context, original_name, content_type, size_bytes)
        VALUES (${file.id}, ${`legacy/${file.id}`}, ${fixture.aliceId}, ${fixture.workspaceId},
          ${file.folderId}, 'workspace', ${file.name}, 'text/plain', 1)`)
    }
    await db.execute(sql`
      INSERT INTO ${workspaceFiles} (id, key, user_id, workspace_id, context, original_name, content_type)
      SELECT 'wf_pad_' || n || '_' || ${fixture.workspaceId}, 'pad/' || n || '/' || ${fixture.workspaceId},
        ${fixture.aliceId}, ${fixture.workspaceId}, 'workspace', 'pad-' || n || '.txt', 'text/plain'
      FROM generate_series(1, 2000) AS n`)
    await db.execute(sql`ANALYZE ${workspaceFiles}`)

    for (const file of files) {
      const vfsPath = workspaceFileVfsPath({
        folderPath: file.folderId ? 'Reports' : null,
        name: file.name,
      })
      const displayed = normalizeDisplaySegment(file.name)
      for (const reference of [vfsPath, displayed]) {
        expect((await resolveWorkspaceFileReference(fixture.workspaceId, reference))?.id).toBe(
          file.id
        )
      }
    }
    expect(await resolveWorkspaceFileReference(fixture.workspaceId, 'brand-new.txt')).toBeNull()

    // The resolver's candidate query for a miss: the id arm, the display-name arm, its order.
    const plan = await db.execute(
      sql`EXPLAIN (FORMAT JSON) SELECT id, original_name, folder_id, uploaded_at
        FROM ${workspaceFiles} WHERE ${and(
          eq(workspaceFiles.workspaceId, fixture.workspaceId),
          eq(workspaceFiles.context, 'workspace'),
          isNull(workspaceFiles.deletedAt),
          or(
            inArray(workspaceFiles.id, ['brand-new.txt']),
            eq(displaySegmentKey(workspaceFiles.originalName), 'brand-new.txt')
          )
        )} ORDER BY ${workspaceFiles.uploadedAt}`
    )
    const scan = JSON.stringify(plan[0]['QUERY PLAN'])
    expect(scan).toContain('workspace_files_workspace_display_name_idx')
    expect(scan).not.toContain('workspace_files_workspace_active_keyset_idx')
  })

  it('picks the same file from candidate rows as from the whole listing', async () => {
    const fixture = await seedWorkspace()
    const reports = await createWorkspaceFileFolder({
      workspaceId: fixture.workspaceId,
      userId: fixture.aliceId,
      name: 'Reports',
    })
    const archive = await createWorkspaceFileFolder({
      workspaceId: fixture.workspaceId,
      userId: fixture.aliceId,
      name: 'Archive',
      parentId: reports.id,
    })
    const rootDuplicate = await upload(fixture.workspaceId, fixture.aliceId, 'dup.txt', null)
    await upload(fixture.workspaceId, fixture.aliceId, 'dup.txt', reports.id)
    const nested = await upload(fixture.workspaceId, fixture.aliceId, 'Q1 Plan.csv', archive.id)
    const deleted = await upload(fixture.workspaceId, fixture.aliceId, 'gone.txt', null)
    await db
      .update(workspaceFiles)
      .set({ deletedAt: new Date() })
      .where(eq(workspaceFiles.id, deleted.id))
    const listing = await listWorkspaceFiles(fixture.workspaceId)

    const references = [
      'dup.txt',
      'files/dup.txt',
      'files/Reports/dup.txt',
      'Reports/dup.txt',
      'files/Reports/Archive/Q1%20Plan.csv',
      'Q1 Plan.csv',
      nested.id,
      `files/${nested.id}`,
      rootDuplicate.id,
      'gone.txt',
      'missing.txt',
    ]
    const batched = await findListedWorkspaceFiles(fixture.workspaceId, references)
    for (const reference of references) {
      const expected = findWorkspaceFileRecord(listing, reference)?.id
      expect(batched.get(reference)?.id, reference).toBe(expected)
      const [single] = (await findListedWorkspaceFiles(fixture.workspaceId, [reference])).values()
      expect(single?.id, reference).toBe(expected)
    }
    expect(batched.get('dup.txt')?.id).toBe(rootDuplicate.id)
  })

  it('falls back to a short-id suffix after 20 numbered copies, including under concurrency', async () => {
    const fixture = await seedWorkspace()
    await upload(fixture.workspaceId, fixture.aliceId, 'page.html')
    for (let n = 1; n <= 20; n++) {
      await upload(fixture.workspaceId, fixture.aliceId, `page (${n}).html`)
    }

    const next = await upload(fixture.workspaceId, fixture.aliceId, 'page.html')
    const concurrent = await Promise.all(
      Array.from({ length: 8 }, () => upload(fixture.workspaceId, fixture.aliceId, 'page.html'))
    )

    const shortIdSuffixed = /^page \([A-Za-z0-9_-]{8}\)\.html$/
    expect(next.name).toMatch(shortIdSuffixed)
    const names = concurrent.map((file) => file.name)
    for (const name of names) expect(name).toMatch(shortIdSuffixed)
    expect(new Set([next.name, ...names]).size).toBe(names.length + 1)
  })

  it('resolves a chat upload by the path its upload notice prints when the name is not in VFS form', async () => {
    const fixture = await seedWorkspace()
    const chatId = await seedChat(fixture.workspaceId, fixture.aliceId)
    const otherChatId = await seedChat(fixture.workspaceId, fixture.aliceId)
    // macOS screenshot names carry U+202F before AM/PM, pasted names keep doubled spaces, some
    // pickers report decomposed (NFD) accents, and control characters drop out of VFS names.
    const names = [
      'Screenshot 2026-01-15 at 9.41.07\u202fAM.png',
      'Quarterly  Report.pdf',
      'Cafe\u0301 menu.png',
      'ring\u0007ing.png',
      'trail.png \u0007',
    ]
    for (const name of names) {
      const row = await trackUpload(fixture.workspaceId, fixture.aliceId, chatId, name)
      const noticePath = workspaceFileVfsPath({ folderPath: null, name, vfsNamespace: 'uploads' })
      for (const reference of [noticePath, `uploads/${name}`]) {
        for (const options of [{ chatId }, {}]) {
          const record = await resolveWorkspaceFileReference(fixture.workspaceId, reference, {
            includeChatUploads: true,
            ...options,
          })
          expect(record?.id).toBe(row.id)
          expect(record?.name).toBe(name)
        }
      }
      expect(
        await resolveWorkspaceFileReference(fixture.workspaceId, noticePath, {
          includeChatUploads: true,
          chatId: otherChatId,
        })
      ).toBeNull()
    }
  })

  it('matches a chat upload name exactly, never as a pattern or a fragment', async () => {
    const fixture = await seedWorkspace()
    const chatId = await seedChat(fixture.workspaceId, fixture.aliceId)
    await trackUpload(fixture.workspaceId, fixture.aliceId, chatId, 'axb.png')
    await trackUpload(fixture.workspaceId, fixture.aliceId, chatId, 'my notes.png.bak')
    await trackUpload(fixture.workspaceId, fixture.aliceId, chatId, 'notes 100%.png')
    await trackUpload(fixture.workspaceId, fixture.aliceId, chatId, 'back\\slash.png')

    for (const reference of [
      'uploads/a_b.png',
      'uploads/a.b.png',
      'uploads/notes.png',
      'uploads/notes%20%25.png',
    ]) {
      expect(
        await resolveWorkspaceFileReference(fixture.workspaceId, reference, {
          includeChatUploads: true,
          chatId,
        })
      ).toBeNull()
    }
    expect(
      (
        await resolveWorkspaceFileReference(fixture.workspaceId, 'uploads/notes%20100%25.png', {
          includeChatUploads: true,
          chatId,
        })
      )?.name
    ).toBe('notes 100%.png')
    expect(
      (
        await resolveWorkspaceFileReference(fixture.workspaceId, 'uploads/back%5Cslash.png', {
          includeChatUploads: true,
          chatId,
        })
      )?.name
    ).toBe('back\\slash.png')
  })

  /**
   * Counts every display-name write into the chat, including ones a unique violation rolls
   * back: `nextval` is not transactional.
   */
  async function countChatNameWrites<T>(chatId: string, run: () => Promise<T>) {
    const suffix = generateId().replaceAll('-', '')
    const counterName = `chat_name_writes_${suffix}`
    const counter = sql.identifier(counterName)
    const fn = sql.identifier(`count_chat_name_write_${suffix}`)
    await db.execute(sql`CREATE SEQUENCE ${counter}`)
    await db.execute(sql`
      CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.chat_id::text = TG_ARGV[0] THEN
          PERFORM nextval(TG_ARGV[1]);
        END IF;
        RETURN NEW;
      END $$
    `)
    await db.execute(sql`
      CREATE TRIGGER ${fn} BEFORE INSERT OR UPDATE OF display_name ON ${workspaceFiles}
      FOR EACH ROW EXECUTE FUNCTION ${fn}(${sql.raw(`'${chatId}'`)}, ${sql.raw(`'${counterName}'`)})
    `)
    try {
      const result = await run()
      const [{ writes }] = await db.execute<{ writes: number }>(
        sql`SELECT CASE WHEN is_called THEN last_value ELSE 0 END::int AS writes FROM ${counter}`
      )
      return { result, writes }
    } finally {
      await db.execute(sql`DROP TRIGGER ${fn} ON ${workspaceFiles}`)
      await db.execute(sql`DROP FUNCTION ${fn}()`)
      await db.execute(sql`DROP SEQUENCE ${counter}`)
    }
  }

  /** A chat upload the storage service registered before the chat message linked it. */
  async function seedUnlinkedChatUpload(workspaceId: string, userId: string, name: string) {
    const key = generateWorkspaceFileKey(workspaceId, name)
    await db.insert(workspaceFiles).values({
      id: `wf_${generateId()}`,
      key,
      userId,
      workspaceId,
      context: 'mothership',
      originalName: name,
      contentType: 'image/png',
      sizeBytes: 10,
    })
    return key
  }

  function linkUpload(workspaceId: string, userId: string, chatId: string, key: string) {
    return trackChatUpload(workspaceId, userId, chatId, key, 'image.png', 'image/png', 10)
  }

  it('names many same-named attachments with one write each', async () => {
    const fixture = await seedWorkspace()
    const chatId = await seedChat(fixture.workspaceId, fixture.aliceId)
    const unlinked: string[] = []
    for (let n = 0; n < 10; n++) {
      unlinked.push(await seedUnlinkedChatUpload(fixture.workspaceId, fixture.aliceId, 'image.png'))
    }

    const { result, writes } = await countChatNameWrites(chatId, async () => {
      const names = []
      for (const key of unlinked) {
        names.push(
          (await linkUpload(fixture.workspaceId, fixture.aliceId, chatId, key)).displayName
        )
      }
      for (let n = 0; n < 10; n++) {
        names.push(
          (await trackUpload(fixture.workspaceId, fixture.aliceId, chatId, 'image.png')).displayName
        )
      }
      return names
    })

    expect(result).toEqual([
      'image.png',
      ...Array.from({ length: 19 }, (_, n) => `image (${n + 2}).png`),
    ])
    expect(writes).toBe(20)
  })

  it('keeps a re-linked upload on its name and treats soft-deleted siblings as taken', async () => {
    const fixture = await seedWorkspace()
    const chatId = await seedChat(fixture.workspaceId, fixture.aliceId)
    const first = await trackUpload(fixture.workspaceId, fixture.aliceId, chatId, 'image.png')
    const key = await seedUnlinkedChatUpload(fixture.workspaceId, fixture.aliceId, 'image.png')

    expect((await linkUpload(fixture.workspaceId, fixture.aliceId, chatId, key)).displayName).toBe(
      'image (2).png'
    )
    await db
      .update(workspaceFiles)
      .set({ deletedAt: new Date() })
      .where(eq(workspaceFiles.id, first.id))
    const { result, writes } = await countChatNameWrites(chatId, () =>
      linkUpload(fixture.workspaceId, fixture.aliceId, chatId, key)
    )
    expect(result.displayName).toBe('image (2).png')
    expect(writes).toBe(1)
    expect(
      (await trackUpload(fixture.workspaceId, fixture.aliceId, chatId, 'image.png')).displayName
    ).toBe('image (3).png')
  })

  it.each([
    ['notes 100%.png', 'notes 100% (2).png', 'notes 100% (3).png'],
    ['a_b.png', 'a_b (2).png', 'a_b (3).png'],
    ['report (2).pdf', 'report (2) (2).pdf', 'report (2) (3).pdf'],
    ['README', 'README (2)', 'README (3)'],
    ['archive.tar.gz', 'archive.tar (2).gz', 'archive.tar (3).gz'],
    ['back\\slash.png', 'back\\slash (2).png', 'back\\slash (3).png'],
    ['.env', '.env (2)', '.env (3)'],
  ])('suffixes %s literally with one write per upload', async (...expected) => {
    const fixture = await seedWorkspace()
    const chatId = await seedChat(fixture.workspaceId, fixture.aliceId)
    const { result, writes } = await countChatNameWrites(chatId, async () => {
      const names = []
      for (let n = 0; n < 3; n++) {
        names.push(
          (await trackUpload(fixture.workspaceId, fixture.aliceId, chatId, expected[0])).displayName
        )
      }
      return names
    })
    expect(result).toEqual(expected)
    expect(writes).toBe(3)
  })
})
