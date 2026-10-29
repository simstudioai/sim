/**
 * Real PostgreSQL behavior of the bounded workspace-file reads the browser, v2, and the Mothership
 * VFS share: keyset paging under every sort, folder filters by id, name search, batch lookup, and
 * folder rollups, under `files.list` authorization.
 */
import { db } from '@sim/db'
import { permissions, user, workspace, workspaceFiles } from '@sim/db/schema'
import { explainCaptured } from '@sim/db/testing/explain'
import { assertDisposableTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { generateId } from '@sim/utils/id'
import { inArray, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { CursorKey } from '@/lib/api/list-query'
import { queryWorkspaceFiles } from '@/lib/uploads/contexts/workspace/file-manager'
import {
  getWorkspaceFileFolderStats,
  listWorkspaceFileCollection,
  lookupWorkspaceFiles,
} from '@/lib/workspace-files/application/list-workspace-files'

const alice = generateId()
const bob = generateId()
const carol = generateId()
const workspaceId = generateId()
const otherWorkspaceId = generateId()
const session = (userId: string) => ({ kind: 'session' as const, userId, sessionId: generateId() })

/** Folder tree in the main workspace: Docs/{Sub/{Deep}}, Media; plus one in the other workspace. */
const folders = {
  docs: generateId(),
  sub: generateId(),
  deep: generateId(),
  media: generateId(),
  foreign: generateId(),
}

interface SeededFile {
  id: string
  name: string
  folderId: string | null
  size: number
  uploadedAt: string
  updatedAt: string
  key: string
}

const files: SeededFile[] = []
let foreignFile: SeededFile
let deletedFile: SeededFile

async function insertFile(input: {
  id?: string
  workspaceId?: string
  name: string
  folderId?: string | null
  size?: number
  uploadedAt: string
  updatedAt?: string
  deleted?: boolean
  context?: string
}): Promise<SeededFile> {
  const file: SeededFile = {
    id: input.id ?? `wf_${generateId()}`,
    name: input.name,
    folderId: input.folderId ?? null,
    size: input.size ?? 10,
    uploadedAt: input.uploadedAt,
    updatedAt: input.updatedAt ?? input.uploadedAt,
    key: `workspace/${input.workspaceId ?? workspaceId}/${generateId()}-${input.name}`,
  }
  await db.execute(sql`
    INSERT INTO ${workspaceFiles} (id, key, user_id, workspace_id, folder_id, context, original_name,
      content_type, size_bytes, uploaded_at, updated_at, deleted_at)
    VALUES (${file.id}, ${file.key}, ${alice}, ${input.workspaceId ?? workspaceId}, ${file.folderId},
      ${input.context ?? 'workspace'}, ${file.name}, 'text/plain', ${file.size},
      ${file.uploadedAt}::timestamp, ${file.updatedAt}::timestamp,
      ${input.deleted ? sql`now()` : sql`NULL`})`)
  return file
}

type PageQuery = NonNullable<
  Parameters<typeof listWorkspaceFileCollection.execute>[0]['input']['page']
>

function page(
  input: Partial<PageQuery>,
  options: { userId?: string; scope?: 'active' | 'archived'; workspace?: string } = {}
) {
  return listWorkspaceFileCollection.execute({
    principal: session(options.userId ?? alice),
    input: {
      workspaceId: options.workspace ?? workspaceId,
      scope: options.scope ?? 'active',
      page: { sortBy: 'name', sortOrder: 'asc', limit: 100, ...input },
    },
  })
}

async function walk(
  sortBy: 'name' | 'size' | 'uploadedAt' | 'updatedAt',
  sortOrder: 'asc' | 'desc',
  after?: CursorKey[]
) {
  const ids: string[] = []
  let cursor = after
  for (let guard = 0; guard < 50; guard++) {
    const result = await page({ sortBy, sortOrder, limit: 2, after: cursor })
    ids.push(...result.files.map((file) => file.id))
    if (!result.nextKeys) return ids
    cursor = result.nextKeys
  }
  throw new Error('Pagination did not terminate')
}

/** The live main-workspace files in the database's own `(<column>, id)` order. */
async function orderedIds(column: string, sortOrder: 'asc' | 'desc') {
  const direction = sql.raw(sortOrder)
  const rows = await db.execute<{ id: string }>(sql`
    SELECT id FROM ${workspaceFiles}
    WHERE workspace_id = ${workspaceId} AND context = 'workspace' AND deleted_at IS NULL
    ORDER BY ${sql.raw(column)} ${direction}, id ${direction}`)
  return rows.map((row) => row.id)
}

describe('bounded workspace file reads in PostgreSQL', () => {
  beforeAll(async () => {
    assertDisposableTestDatabaseUrl(process.env.DATABASE_URL ?? '')
    await db.insert(user).values(
      [alice, bob, carol].map((id) => ({
        id,
        name: `Fixture ${id}`,
        email: `${id}@fixture.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }))
    )
    await insertWorkspaceFixture(db, [
      { id: workspaceId, name: 'Listing fixture', ownerId: alice, billedAccountUserId: alice },
      { id: otherWorkspaceId, name: 'Other fixture', ownerId: alice, billedAccountUserId: alice },
    ])
    await db.insert(permissions).values([
      {
        id: generateId(),
        userId: alice,
        entityType: 'workspace',
        entityId: workspaceId,
        permissionType: 'admin',
      },
      {
        id: generateId(),
        userId: bob,
        entityType: 'workspace',
        entityId: workspaceId,
        permissionType: 'read',
      },
      {
        id: generateId(),
        userId: alice,
        entityType: 'workspace',
        entityId: otherWorkspaceId,
        permissionType: 'admin',
      },
    ])
    await db.execute(sql`
      INSERT INTO folder (id, name, user_id, workspace_id, resource_type, parent_id) VALUES
        (${folders.docs}, 'Docs', ${alice}, ${workspaceId}, 'file', NULL),
        (${folders.media}, 'Media', ${alice}, ${workspaceId}, 'file', NULL),
        (${folders.foreign}, 'Foreign', ${alice}, ${otherWorkspaceId}, 'file', NULL)`)
    await db.execute(sql`
      INSERT INTO folder (id, name, user_id, workspace_id, resource_type, parent_id)
        VALUES (${folders.sub}, 'Sub', ${alice}, ${workspaceId}, 'file', ${folders.docs})`)
    await db.execute(sql`
      INSERT INTO folder (id, name, user_id, workspace_id, resource_type, parent_id)
        VALUES (${folders.deep}, 'Deep', ${alice}, ${workspaceId}, 'file', ${folders.sub})`)

    /**
     * Ties on every sort key: the same name in different folders, equal sizes, and timestamps
     * equal to the microsecond or distinct only below the millisecond — where ordering on the raw
     * column and ordering on its millisecond truncation disagree.
     */
    const t = '2026-03-01T10:00:00.123'
    for (const seed of [
      {
        id: `wf_a_${generateId()}`,
        name: 'Quarterly-Report.csv',
        folderId: null,
        size: 300,
        uploadedAt: `${t}900`,
        updatedAt: '2026-03-05T00:00:00',
      },
      {
        id: `wf_c_${generateId()}`,
        name: 'alpha.txt',
        folderId: null,
        size: 100,
        uploadedAt: `${t}100`,
        updatedAt: `${t}100`,
      },
      {
        id: `wf_d_${generateId()}`,
        name: 'beta.txt',
        folderId: null,
        size: 100,
        uploadedAt: `${t}100`,
        updatedAt: `${t}500`,
      },
      {
        id: `wf_b_${generateId()}`,
        name: 'alpha.txt',
        folderId: folders.docs,
        size: 100,
        uploadedAt: `${t}500`,
        updatedAt: `${t}100`,
      },
      {
        name: 'report-draft.md',
        folderId: folders.docs,
        size: 200,
        uploadedAt: '2026-03-02T00:00:00',
        updatedAt: '2026-03-02T00:00:00',
      },
      {
        name: 'nested report.md',
        folderId: folders.sub,
        size: 400,
        uploadedAt: '2026-03-03T00:00:00',
      },
      { name: 'deep.bin', folderId: folders.deep, size: 1000, uploadedAt: '2026-03-04T00:00:00' },
      { name: 'photo.png', folderId: folders.media, size: 50, uploadedAt: '2026-02-01T00:00:00' },
      { name: '100%_done.txt', folderId: null, size: 5, uploadedAt: '2026-01-01T00:00:00' },
    ]) {
      files.push(await insertFile(seed))
    }
    deletedFile = await insertFile({
      name: 'old report.txt',
      folderId: folders.docs,
      size: 7000,
      uploadedAt: '2026-01-02T00:00:00',
      deleted: true,
    })
    await insertFile({
      name: 'chat report.txt',
      uploadedAt: '2026-01-03T00:00:00',
      context: 'mothership',
    })
    foreignFile = await insertFile({
      workspaceId: otherWorkspaceId,
      name: 'report.txt',
      folderId: folders.foreign,
      uploadedAt: '2026-01-04T00:00:00',
    })
  })

  afterAll(async () => {
    await deleteWorkspaceFixture(db, inArray(workspace.id, [workspaceId, otherWorkspaceId]))
    await db.delete(user).where(inArray(user.id, [alice, bob, carol]))
  })

  const byName = (name: string, folderId: string | null = null) => {
    const file = files.find((entry) => entry.name === name && entry.folderId === folderId)
    if (!file) throw new Error(`No seeded file ${name}`)
    return file
  }

  describe('keyset paging', () => {
    it.each([
      ['name', 'original_name'],
      ['size', 'size_bytes'],
      ['uploadedAt', 'uploaded_at'],
      ['updatedAt', 'updated_at'],
    ] as const)(
      'walks the %s sort in the database order, both directions, across ties',
      async (sortBy, column) => {
        for (const sortOrder of ['asc', 'desc'] as const) {
          expect(await walk(sortBy, sortOrder)).toEqual(await orderedIds(column, sortOrder))
        }
      }
    )

    it('finishes a walk begun under millisecond-truncated ordering without skipping or repeating', async () => {
      const legacy = await db.execute<{ id: string; uploaded_at: Date }>(sql`
        SELECT id, uploaded_at FROM ${workspaceFiles}
        WHERE workspace_id = ${workspaceId} AND context = 'workspace' AND deleted_at IS NULL
        ORDER BY date_trunc('milliseconds', uploaded_at), id`)
      const legacyOrder = legacy.map((row) => row.id)
      const firstPage = legacy.slice(0, 2)
      const last = firstPage[1]
      const resumed = await walk('uploadedAt', 'asc', [
        new Date(last.uploaded_at).toISOString(),
        last.id,
      ])
      expect([...firstPage.map((row) => row.id), ...resumed]).toEqual(legacyOrder)
    })

    it('rejects a cursor value the sort cannot hold as a validation error', async () => {
      await expect(
        page({ sortBy: 'uploadedAt', after: ['not-a-date', 'wf_x'] })
      ).rejects.toMatchObject({
        code: 'validation',
      })
    })
  })

  describe('folder filters by id', () => {
    const idsOf = (result: { files: { id: string }[] }) =>
      result.files.map((file) => file.id).sort()

    it('lists root files only for the root, and only direct children for a folder', async () => {
      expect(idsOf(await page({ folderId: null }))).toEqual(
        files
          .filter((file) => file.folderId === null)
          .map((file) => file.id)
          .sort()
      )
      expect(idsOf(await page({ folderId: folders.docs }))).toEqual(
        [byName('alpha.txt', folders.docs).id, byName('report-draft.md', folders.docs).id].sort()
      )
    })

    it('descends the active subtree with recursive, and the root recursive spans the workspace', async () => {
      expect(idsOf(await page({ folderId: folders.docs, recursive: true }))).toEqual(
        files
          .filter((file) => [folders.docs, folders.sub, folders.deep].includes(file.folderId ?? ''))
          .map((file) => file.id)
          .sort()
      )
      expect(idsOf(await page({ folderId: null, recursive: true }))).toEqual(
        files.map((file) => file.id).sort()
      )
    })

    it('matches nothing for another workspace folder or an unknown folder, recursive or not', async () => {
      for (const folderId of [folders.foreign, generateId()]) {
        for (const recursive of [false, true]) {
          expect((await page({ folderId, recursive })).files).toEqual([])
        }
      }
    })

    it('keeps deleted files and chat uploads out of the active scope, and archived files in theirs', async () => {
      const active = await page({ folderId: folders.docs })
      expect(active.files.map((file) => file.id)).not.toContain(deletedFile.id)
      const archived = await page({ folderId: folders.docs }, { scope: 'archived' })
      expect(archived.files.map((file) => file.id)).toEqual([deletedFile.id])
      const everything = await walk('name', 'asc')
      expect(everything).toHaveLength(files.length)
    })

    it('refuses an empty folder id rather than reading it as the root', async () => {
      await expect(
        queryWorkspaceFiles(workspaceId, {
          folderId: '',
          sortBy: 'name',
          sortOrder: 'asc',
          limit: 10,
        })
      ).rejects.toMatchObject({ code: 'validation' })
    })

    /**
     * The folder predicate must be spelled on `coalesce(folder_id, '')`: that is the key the
     * `(workspace_id, coalesce(folder_id, ''), original_name)` index leads with, and a name-sorted
     * folder page that cannot seek it reads every live file the workspace holds.
     */
    it('seeks the folder name index for a name-sorted root or folder page', async () => {
      await db.execute(sql`
        INSERT INTO ${workspaceFiles} (id, key, user_id, workspace_id, folder_id, context, original_name, content_type, size_bytes)
        SELECT 'wf_pad_' || n || '_' || ${workspaceId}, 'pad/' || n || '/' || ${workspaceId}, ${alice},
          ${workspaceId}, CASE WHEN n % 2 = 0 THEN ${folders.media} END, 'workspace', 'pad-' || n || '.txt',
          'text/plain', 1
        FROM generate_series(1, 3000) AS n`)
      await db.execute(sql`ANALYZE ${workspaceFiles}`)
      try {
        for (const folderId of [null, folders.media]) {
          const nodes = await explainCaptured(
            db,
            () =>
              queryWorkspaceFiles(workspaceId, {
                folderId,
                sortBy: 'name',
                sortOrder: 'asc',
                limit: 50,
                after: ['pad-1500.txt', 'wf_x'],
              }),
            { match: /order by/ }
          )
          const scan = nodes.find(
            (node) => node['Index Name'] === 'workspace_files_workspace_folder_name_active_unique'
          )
          expect(scan?.['Index Cond']).toMatch(/COALESCE\(folder_id.*original_name >=/)
        }
      } finally {
        await db.execute(
          sql`DELETE FROM ${workspaceFiles} WHERE id LIKE 'wf_pad_%' AND workspace_id = ${workspaceId}`
        )
      }
    })
  })

  describe('name search', () => {
    const search = (
      q: string,
      extra: { folderId?: string | null; recursive?: boolean; limit?: number } = {}
    ) =>
      page({
        search: q,
        recursive: extra.recursive ?? true,
        folderId: extra.folderId,
        limit: extra.limit ?? 20,
      })

    it('matches case-insensitively by substring across the workspace, with folder paths', async () => {
      const result = await search('REPORT')
      expect(result.files.map((file) => [file.name, file.folderPath ?? null]).sort()).toEqual([
        ['Quarterly-Report.csv', null],
        ['nested report.md', 'Docs/Sub'],
        ['report-draft.md', 'Docs'],
      ])
    })

    it('searches a folder with or without its subfolders, and honours the limit', async () => {
      expect(
        (await search('report', { folderId: folders.docs })).files.map((file) => file.name).sort()
      ).toEqual(['nested report.md', 'report-draft.md'])
      expect(
        (await search('report', { folderId: folders.docs, recursive: false })).files.map(
          (file) => file.name
        )
      ).toEqual(['report-draft.md'])
      expect((await search('report', { limit: 1 })).files).toHaveLength(1)
    })

    it('treats LIKE wildcards in the term literally', async () => {
      expect((await search('%_')).files.map((file) => file.name)).toEqual(['100%_done.txt'])
    })
  })

  describe('batch lookup', () => {
    it('resolves own live files by id, key, and reference, and ignores the rest', async () => {
      const alpha = byName('alpha.txt', folders.docs)
      const photo = byName('photo.png', folders.media)
      const draft = byName('report-draft.md', folders.docs)
      const result = await lookupWorkspaceFiles.execute({
        principal: session(bob),
        input: {
          workspaceId,
          ids: [alpha.id, foreignFile.id, deletedFile.id, 'wf_missing'],
          keys: [photo.key, foreignFile.key, deletedFile.key],
          references: [
            'files/Docs/report-draft.md',
            'Quarterly-Report.csv',
            'files/Foreign/report.txt',
          ],
        },
      })
      expect(result.files.map((file) => file.id).sort()).toEqual(
        [alpha.id, photo.id, draft.id, byName('Quarterly-Report.csv').id].sort()
      )
      expect(result.references).toEqual([
        { reference: 'files/Docs/report-draft.md', fileId: draft.id },
        { reference: 'Quarterly-Report.csv', fileId: byName('Quarterly-Report.csv').id },
        { reference: 'files/Foreign/report.txt', fileId: null },
      ])
    })

    it('refuses more than the per-list cap', async () => {
      await expect(
        lookupWorkspaceFiles.execute({
          principal: session(alice),
          input: { workspaceId, ids: Array.from({ length: 101 }, (_, n) => `wf_${n}`) },
        })
      ).rejects.toMatchObject({ code: 'validation' })
    })
  })

  describe('folder stats', () => {
    const stats = (parentId: string | null) =>
      getWorkspaceFileFolderStats.execute({
        principal: session(alice),
        input: { workspaceId, parentId },
      })

    it('rolls each child folder subtree up, excluding deleted files', async () => {
      expect((await stats(null)).folders).toEqual(
        expect.arrayContaining([
          { folderId: folders.docs, fileCount: 4, sizeBytes: 100 + 200 + 400 + 1000 },
          { folderId: folders.media, fileCount: 1, sizeBytes: 50 },
        ])
      )
      expect((await stats(null)).folders).toHaveLength(2)
      expect((await stats(folders.docs)).folders).toEqual([
        { folderId: folders.sub, fileCount: 2, sizeBytes: 1400 },
      ])
      expect((await stats(folders.deep)).folders).toEqual([])
    })

    it('reports nothing for another workspace folder or an unknown folder', async () => {
      expect((await stats(folders.foreign)).folders).toEqual([])
      expect((await stats(generateId())).folders).toEqual([])
    })
  })

  describe('authorization', () => {
    it('serves a read member and refuses a non-member on every read', async () => {
      await expect(page({}, { userId: bob })).resolves.toBeDefined()
      await expect(page({}, { userId: carol })).rejects.toBeDefined()
      await expect(
        lookupWorkspaceFiles.execute({
          principal: session(carol),
          input: { workspaceId, ids: ['wf_x'] },
        })
      ).rejects.toBeDefined()
      await expect(
        getWorkspaceFileFolderStats.execute({
          principal: session(carol),
          input: { workspaceId, parentId: null },
        })
      ).rejects.toBeDefined()
    })
  })
})
