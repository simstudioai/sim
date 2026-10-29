/**
 * Real PostgreSQL behavior of the bounded workspace-file reads the browser, v2, and the Mothership
 * VFS share: keyset paging under every sort, folder filters by id, name search, kind/size/uploader
 * filters, batch lookup, and folder rollups, under `files.list` authorization.
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
import { EXTENSION_TO_MIME } from '@/lib/uploads/utils/file'
import {
  getWorkspaceFileFolderStats,
  listWorkspaceFileCollection,
  lookupWorkspaceFiles,
  searchWorkspaceFiles,
} from '@/lib/workspace-files/application/list-workspace-files'
import { fileBrowserKinds, fileBrowserTypeLabel } from '@/lib/workspace-files/browser'
import {
  workspaceFileKindCondition,
  workspaceFileTypeLabelExpression,
} from '@/lib/workspace-files/query-scope'

const alice = generateId()
const bob = generateId()
const carol = generateId()
const workspaceId = generateId()
const otherWorkspaceId = generateId()
const filterWorkspaceId = generateId()
const sortWorkspaceId = generateId()
const parityWorkspaceId = generateId()
/** Uploaders with fixed display names: two members and one who has left the workspace. */
const ann = generateId()
const ben = generateId()
const zed = generateId()
/** The four kind columns of a parity row. */
const pick = (row: Record<string, string | boolean>) => ({
  document: row.document,
  image: row.image,
  audio: row.audio,
  video: row.video,
})
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
  contentType?: string
  userId?: string
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
    VALUES (${file.id}, ${file.key}, ${input.userId ?? alice}, ${input.workspaceId ?? workspaceId},
      ${file.folderId}, ${input.context ?? 'workspace'}, ${file.name},
      ${input.contentType ?? 'text/plain'}, ${file.size},
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
      [alice, bob, carol, ann, ben, zed].map((id) => ({
        id,
        name: id === ann ? 'Ann' : id === ben ? 'Ben' : id === zed ? 'Zed' : `Fixture ${id}`,
        email: `${id}@fixture.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }))
    )
    await insertWorkspaceFixture(db, [
      { id: workspaceId, name: 'Listing fixture', ownerId: alice, billedAccountUserId: alice },
      { id: otherWorkspaceId, name: 'Other fixture', ownerId: alice, billedAccountUserId: alice },
      { id: filterWorkspaceId, name: 'Filter fixture', ownerId: alice, billedAccountUserId: alice },
      { id: sortWorkspaceId, name: 'Sort fixture', ownerId: alice, billedAccountUserId: alice },
      { id: parityWorkspaceId, name: 'Parity fixture', ownerId: alice, billedAccountUserId: alice },
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
      {
        id: generateId(),
        userId: alice,
        entityType: 'workspace',
        entityId: filterWorkspaceId,
        permissionType: 'admin',
      },
      ...[alice, ann, ben].map((userId) => ({
        id: generateId(),
        userId,
        entityType: 'workspace',
        entityId: sortWorkspaceId,
        permissionType: 'admin' as const,
      })),
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

    // Ties on every sort key: the same name in different folders, equal sizes, and timestamps
    // equal to the microsecond or distinct only below the millisecond — where ordering on the raw
    // column and ordering on its millisecond truncation disagree.
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
    await deleteWorkspaceFixture(
      db,
      inArray(workspace.id, [
        workspaceId,
        otherWorkspaceId,
        filterWorkspaceId,
        sortWorkspaceId,
        parityWorkspaceId,
      ])
    )
    await db.delete(user).where(inArray(user.id, [alice, bob, carol, ann, ben, zed]))
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
      // The millisecond cursor a legacy page minted, spelled in SQL: a raw `timestamp` read back
      // through the driver is parsed as local time.
      const legacy = await db.execute<{ id: string; cursor: string }>(sql`
        SELECT id, to_char(uploaded_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS cursor
        FROM ${workspaceFiles}
        WHERE workspace_id = ${workspaceId} AND context = 'workspace' AND deleted_at IS NULL
        ORDER BY date_trunc('milliseconds', uploaded_at), id`)
      const legacyOrder = legacy.map((row) => row.id)
      // End the legacy page on wf_a, first of the four rows sharing one millisecond, so the walk
      // resumes inside the tie, where raw and truncated ordering disagree.
      const cut = legacy.findIndex((row) => row.id.startsWith('wf_a_')) + 1
      const firstPage = legacy.slice(0, cut)
      const last = firstPage[firstPage.length - 1]
      expect(legacy[cut].cursor).toBe(last.cursor)
      const resumed = await walk('uploadedAt', 'asc', [last.cursor, last.id])
      expect([...firstPage.map((row) => row.id), ...resumed]).toEqual(legacyOrder)
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

  describe('kind, size, and uploader filters', () => {
    const MIB = 1_048_576
    /**
     * Each file labelled with the Type filter's own classification: the declared type when it
     * names a format, else the extension's — so a generic or empty declaration falls back, a
     * `.webm` with nothing declared is video, and a document is decided by extension alone.
     */
    const fixtures = [
      { name: 'photo.png', contentType: 'image/png', size: 500, kinds: ['image'] },
      {
        name: 'upload.png',
        contentType: 'application/octet-stream',
        size: 2 * MIB,
        kinds: ['image'],
      },
      { name: 'clip.webm', contentType: '', size: MIB - 1, kinds: ['video'] },
      { name: 'voice.webm', contentType: 'audio/webm', size: 10 * MIB, kinds: ['audio'] },
      {
        name: 'song.MP3',
        contentType: 'binary/octet-stream',
        size: 10 * MIB + 1,
        kinds: ['audio'],
      },
      { name: 'movie.mov', contentType: 'video/quicktime', size: 40 * MIB, kinds: ['video'] },
      { name: 'paper.pdf', contentType: 'application/pdf', size: MIB, kinds: ['document'] },
      { name: 'chart.json', contentType: 'image/png', size: 10, kinds: ['document', 'image'] },
      { name: 'bundle.zip', contentType: 'application/zip', size: 10, kinds: [] },
      { name: 'README', contentType: 'text/plain', size: 10, kinds: [], uploader: 'bob' },
    ] as const
    const seeded: {
      id: string
      name: string
      size: number
      kinds: readonly string[]
      userId: string
    }[] = []

    beforeAll(async () => {
      for (const [index, fixture] of fixtures.entries()) {
        const userId = 'uploader' in fixture ? bob : alice
        const file = await insertFile({
          workspaceId: filterWorkspaceId,
          name: fixture.name,
          contentType: fixture.contentType,
          size: fixture.size,
          userId,
          uploadedAt: `2026-04-01T00:00:0${index}`,
        })
        seeded.push({ ...file, kinds: fixture.kinds, userId })
      }
    })

    const filtered = async (input: Partial<PageQuery>) =>
      (await page(input, { workspace: filterWorkspaceId })).files.map((file) => file.name).sort()
    const names = (predicate: (file: (typeof seeded)[number]) => boolean) =>
      seeded
        .filter(predicate)
        .map((file) => file.name)
        .sort()

    it.each([['document'], ['image'], ['audio'], ['video'], ['image', 'video']] as const)(
      'lists the %s files a kind filter names',
      async (...kinds) => {
        expect(await filtered({ kinds })).toEqual(
          names((file) => file.kinds.some((kind) => (kinds as readonly string[]).includes(kind)))
        )
      }
    )

    it('splits sizes into buckets at exactly 1 MiB and 10 MiB', async () => {
      expect(await filtered({ sizeBuckets: ['small'] })).toEqual(names((file) => file.size < MIB))
      expect(await filtered({ sizeBuckets: ['medium'] })).toEqual(
        names((file) => file.size >= MIB && file.size <= 10 * MIB)
      )
      expect(await filtered({ sizeBuckets: ['small', 'large'] })).toEqual(
        names((file) => file.size < MIB || file.size > 10 * MIB)
      )
    })

    it('filters by uploader, and intersects every filter with the others and the search', async () => {
      expect(await filtered({ uploadedBy: [bob] })).toEqual(['README'])
      expect(
        await filtered({ kinds: ['image', 'audio'], sizeBuckets: ['large'], uploadedBy: [alice] })
      ).toEqual(['song.MP3'])
      expect(await filtered({ kinds: ['image'], search: 'PHO' })).toEqual(['photo.png'])
    })

    it('pages a filtered list without skipping or repeating', async () => {
      const ids: string[] = []
      let after: CursorKey[] | undefined
      for (let guard = 0; guard < 20; guard++) {
        const result = await page(
          {
            kinds: ['image', 'audio', 'video'],
            sortBy: 'size',
            sortOrder: 'desc',
            limit: 2,
            after,
          },
          { workspace: filterWorkspaceId }
        )
        ids.push(...result.files.map((file) => file.id))
        if (!result.nextKeys) break
        after = result.nextKeys
      }
      expect(ids).toEqual(
        seeded
          .filter((file) => file.kinds.some((kind) => kind !== 'document'))
          .sort((a, b) => b.size - a.size)
          .map((file) => file.id)
      )
    })
  })

  describe('Type and Owner sorts', () => {
    const fixtures = [
      { name: 'b.pdf', contentType: 'application/pdf', userId: ben },
      { name: 'a.pdf', contentType: 'application/pdf', userId: zed },
      { name: 'd.pdf', contentType: 'application/pdf', userId: ann },
      { name: 'c.txt', contentType: 'text/plain', userId: ann },
      { name: 'x.png', contentType: 'application/octet-stream', userId: ann },
      { name: 'y.webm', contentType: '', userId: ben },
      { name: 'zz.foo', contentType: 'application/octet-stream', userId: zed },
      { name: 'noext', contentType: 'application/x-custom', userId: ben },
      { name: 'e.md', contentType: 'text/markdown', userId: ben },
    ]
    const ownerNames = new Map([
      [ann, 'Ann'],
      [ben, 'Ben'],
    ])
    const seeded: { id: string; name: string; label: string; owner: string | null }[] = []

    beforeAll(async () => {
      for (const [index, fixture] of fixtures.entries()) {
        const file = await insertFile({
          workspaceId: sortWorkspaceId,
          name: fixture.name,
          contentType: fixture.contentType,
          userId: fixture.userId,
          uploadedAt: `2026-05-01T00:00:0${index}`,
        })
        seeded.push({
          id: file.id,
          name: fixture.name,
          label: fileBrowserTypeLabel(fixture.contentType, fixture.name),
          owner: ownerNames.get(fixture.userId) ?? null,
        })
      }
    })

    async function walkSorted(sortBy: 'type' | 'owner', sortOrder: 'asc' | 'desc') {
      const ids: string[] = []
      let after: CursorKey[] | undefined
      for (let guard = 0; guard < 20; guard++) {
        const result = await page(
          { folderId: null, sortBy, sortOrder, limit: 2, after },
          { workspace: sortWorkspaceId }
        )
        ids.push(...result.files.map((file) => file.id))
        if (!result.nextKeys) return ids
        after = result.nextKeys
      }
      throw new Error('Pagination did not terminate')
    }

    /**
     * The browser's order, collated by the database the server sorts in: the key in the
     * requested direction, then the name A→Z, a file with no member owner last either way.
     */
    async function expectedOrder(key: 'label' | 'owner', sortOrder: 'asc' | 'desc') {
      const rows = sql.join(
        seeded.map(
          (file) =>
            sql`(${file.id}, ${key === 'label' ? file.label : file.owner}::text, ${file.name})`
        ),
        sql`, `
      )
      const result = await db.execute<{ id: string }>(sql`
        SELECT id FROM (VALUES ${rows}) AS expected(id, key, name)
        ORDER BY (key IS NULL) ASC, key ${sql.raw(sortOrder)}, name ASC, id ASC`)
      return result.map((row) => row.id)
    }

    it.each(['asc', 'desc'] as const)(
      'pages the Type sort by the label each file shows, ties A→Z by name (%s)',
      async (sortOrder) => {
        expect(await walkSorted('type', sortOrder)).toEqual(await expectedOrder('label', sortOrder))
      }
    )

    it.each(['asc', 'desc'] as const)(
      'pages the Owner sort by member name, a former member last (%s)',
      async (sortOrder) => {
        expect(await walkSorted('owner', sortOrder)).toEqual(
          await expectedOrder('owner', sortOrder)
        )
      }
    )

    /**
     * Neither key is indexed, so a page sorts its scope — but only its scope: the folder
     * predicate must still seek the folder index rather than reading every live file.
     */
    it("sorts one folder's rows, reached through the folder index", async () => {
      const padFolder = generateId()
      await db.execute(sql`
        INSERT INTO folder (id, name, user_id, workspace_id, resource_type, parent_id)
          VALUES (${padFolder}, 'Pad', ${ann}, ${sortWorkspaceId}, 'file', NULL)`)
      await db.execute(sql`
        INSERT INTO ${workspaceFiles} (id, key, user_id, workspace_id, folder_id, context, original_name, content_type, size_bytes)
        SELECT 'wf_sortpad_' || n, 'sortpad/' || n || '/' || ${sortWorkspaceId}, ${ann},
          ${sortWorkspaceId}, ${padFolder}, 'workspace', 'pad-' || n || '.txt', 'text/plain', 1
        FROM generate_series(1, 3000) AS n`)
      await db.execute(sql`ANALYZE ${workspaceFiles}`)
      try {
        for (const sortBy of ['type', 'owner'] as const) {
          const nodes = await explainCaptured(
            db,
            () =>
              queryWorkspaceFiles(sortWorkspaceId, {
                folderId: null,
                sortBy,
                sortOrder: 'asc',
                limit: 50,
              }),
            { match: /order by/ }
          )
          expect(nodes.some((node) => node['Index Cond']?.includes('COALESCE(folder_id'))).toBe(
            true
          )
        }
      } finally {
        await db.execute(
          sql`DELETE FROM ${workspaceFiles} WHERE id LIKE 'wf_sortpad_%' AND workspace_id = ${sortWorkspaceId}`
        )
      }
    })
  })

  describe('SQL type labels and kinds', () => {
    /**
     * Every extension the MIME table knows, stored three ways: declaring nothing (so the
     * extension decides), declaring the generic type (likewise), and declaring its own type (so
     * the declared type decides) — plus names the table does not know, with and without an
     * extension. The SQL must agree with the JS rules for each.
     */
    it('labels and classifies a file of every known extension as the JS rules do', async () => {
      const cases = [
        ...Object.keys(EXTENSION_TO_MIME).flatMap((extension) =>
          ['', 'application/octet-stream', EXTENSION_TO_MIME[extension]].map((contentType) => ({
            name: `file.${extension}`,
            contentType,
          }))
        ),
        { name: 'noext', contentType: 'application/x-custom' },
        { name: 'file.bin', contentType: 'Image/PNG; charset=binary' },
        { name: 'file.txt', contentType: ' Text/Markdown ; charset=utf-8' },
        { name: 'file.mp3', contentType: 'AUDIO/MPEG' },
        { name: 'file.dat', contentType: 'Application/Octet-Stream; x=1' },
        { name: 'clip.bin', contentType: 'video/ogg' },
        { name: 'song.bin', contentType: 'Audio/X-Unlisted; rate=44100' },
        { name: 'clip.vid', contentType: 'video/x-unlisted' },
        { name: 'file.foo', contentType: 'application/octet-stream' },
        { name: 'file.foo', contentType: '' },
      ]
      const ids = new Map<string, { name: string; contentType: string }>()
      for (const [index, fixture] of cases.entries()) {
        const file = await insertFile({
          workspaceId: parityWorkspaceId,
          name: `${index}-${fixture.name}`,
          contentType: fixture.contentType,
          uploadedAt: '2026-06-01T00:00:00',
        })
        ids.set(file.id, { name: file.name, contentType: fixture.contentType })
      }
      const rows = await db.execute<Record<string, string | boolean>>(sql`
        SELECT id, ${workspaceFileTypeLabelExpression} AS label,
          ${workspaceFileKindCondition(['document'])} AS document,
          ${workspaceFileKindCondition(['image'])} AS image,
          ${workspaceFileKindCondition(['audio'])} AS audio,
          ${workspaceFileKindCondition(['video'])} AS video
        FROM ${workspaceFiles} WHERE workspace_id = ${parityWorkspaceId}`)
      expect(rows).toHaveLength(cases.length)
      for (const row of rows) {
        const fixture = ids.get(String(row.id))
        if (!fixture) throw new Error('Unexpected row')
        const kinds = fileBrowserKinds(fixture.contentType, fixture.name)
        expect({ id: row.id, label: row.label, ...pick(row) }).toEqual({
          id: row.id,
          label: fileBrowserTypeLabel(fixture.contentType, fixture.name),
          document: kinds.has('document'),
          image: kinds.has('image'),
          audio: kinds.has('audio'),
          video: kinds.has('video'),
        })
      }
    })
  })

  describe('palette search', () => {
    const search = (query: string, extra: { folderId?: string | null; recursive?: boolean } = {}) =>
      searchWorkspaceFiles.execute({
        principal: session(alice),
        input: {
          workspaceId,
          query,
          folderId: extra.folderId,
          recursive: extra.recursive ?? true,
          limit: 20,
        },
      })
    const names = async (
      query: string,
      extra?: { folderId?: string | null; recursive?: boolean }
    ) => (await search(query, extra)).files.map((file) => file.name)

    it('ranks an exact name, then a prefix, then a substring, then a fuzzy match', async () => {
      expect((await names('alpha.txt')).slice(0, 2)).toEqual(['alpha.txt', 'alpha.txt'])
      const ranked = await names('report')
      expect(ranked[0]).toBe('report-draft.md')
      expect(ranked.slice(1, 3).sort()).toEqual(['Quarterly-Report.csv', 'nested report.md'])
    })

    it('tolerates a typo in the name', async () => {
      expect(await names('repot')).toEqual(
        expect.arrayContaining(['report-draft.md', 'nested report.md'])
      )
      expect(await names('qarterly')).toContain('Quarterly-Report.csv')
    })

    it('matches words in any order and initials from a word start, as the palette did', async () => {
      expect(await names('report nested')).toContain('nested report.md')
      expect(await names('qrep')).toContain('Quarterly-Report.csv')
      expect(await names('uarep')).not.toContain('Quarterly-Report.csv')
    })

    it('finds the files beneath a folder the query names', async () => {
      expect((await names('Sub')).sort()).toEqual(['deep.bin', 'nested report.md'])
      expect(await names('media')).toEqual(['photo.png'])
      const docs = await names('docs')
      expect(docs.sort()).toEqual(
        ['alpha.txt', 'deep.bin', 'nested report.md', 'report-draft.md'].sort()
      )
    })

    it('stays within the folder scope, and never returns deleted or chat files', async () => {
      expect(await names('report', { folderId: folders.docs, recursive: false })).toEqual([
        'report-draft.md',
      ])
      const all = await names('report')
      expect(all).not.toContain('old report.txt')
      expect(all).not.toContain('chat report.txt')
      expect(await names('report', { folderId: generateId() })).toEqual([])
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

    it('reads a reference that is not valid encoding as a bare name, and never fails the batch', async () => {
      const done = byName('100%_done.txt')
      const alpha = byName('alpha.txt', folders.docs)
      const result = await lookupWorkspaceFiles.execute({
        principal: session(alice),
        input: {
          workspaceId,
          ids: [alpha.id],
          references: ['100%_done.txt', 'files/Docs/%E0%A4%A', 'files/Docs/../alpha.txt'],
        },
      })
      expect(result.files.map((file) => file.id).sort()).toEqual([alpha.id, done.id].sort())
      expect(result.references).toEqual([
        { reference: '100%_done.txt', fileId: done.id },
        { reference: 'files/Docs/%E0%A4%A', fileId: null },
        { reference: 'files/Docs/../alpha.txt', fileId: null },
      ])
    })
  })

  describe('folder stats', () => {
    const stats = (...parentIds: (string | null)[]) =>
      getWorkspaceFileFolderStats.execute({
        principal: session(alice),
        input: { workspaceId, parentIds },
      })

    it('rolls each child folder subtree up, excluding deleted files', async () => {
      const atRoot = (await stats(null)).folders
      expect(atRoot).toHaveLength(2)
      expect(atRoot).toEqual(
        expect.arrayContaining([
          { folderId: folders.docs, fileCount: 4, sizeBytes: 100 + 200 + 400 + 1000 },
          { folderId: folders.media, fileCount: 1, sizeBytes: 50 },
        ])
      )
      expect((await stats(folders.docs)).folders).toEqual([
        { folderId: folders.sub, fileCount: 2, sizeBytes: 1400 },
      ])
      expect((await stats(folders.deep)).folders).toEqual([])
    })

    it('rolls up the children of several parents in one read, skipping unknown ones', async () => {
      const combined = (await stats(null, folders.docs, generateId())).folders
      expect(combined).toHaveLength(3)
      expect(combined).toEqual(
        expect.arrayContaining([
          { folderId: folders.docs, fileCount: 4, sizeBytes: 100 + 200 + 400 + 1000 },
          { folderId: folders.media, fileCount: 1, sizeBytes: 50 },
          { folderId: folders.sub, fileCount: 2, sizeBytes: 1400 },
        ])
      )
    })

    it('reports nothing for another workspace folder or an unknown folder', async () => {
      expect((await stats(folders.foreign)).folders).toEqual([])
      expect((await stats(generateId())).folders).toEqual([])
    })
  })

  describe('authorization', () => {
    it('serves a read member and refuses a non-member on every read', async () => {
      expect((await page({}, { userId: bob })).files).toHaveLength(files.length)
      const refused = { code: 'forbidden' }
      await expect(page({}, { userId: carol })).rejects.toMatchObject(refused)
      await expect(
        lookupWorkspaceFiles.execute({
          principal: session(carol),
          input: { workspaceId, ids: ['wf_x'] },
        })
      ).rejects.toMatchObject(refused)
      await expect(
        getWorkspaceFileFolderStats.execute({
          principal: session(carol),
          input: { workspaceId, parentIds: [null] },
        })
      ).rejects.toMatchObject(refused)
    })
  })
})
