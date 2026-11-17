/**
 * Real PostgreSQL (and local object storage) coverage for workspace files as source: `files/**`
 * read by `readWorkspaceSource` and written back by `applyWorkspaceSource`. Every check runs in
 * its own workspace and reads the stored rows and bytes directly, so "nothing was written" means
 * the rows are unchanged, not that the use case said so. Writes a report to
 * `WORKSPACE_SOURCE_FILES_REPORT_PATH`.
 */
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import {
  organization,
  permissionGroup,
  permissionGroupMember,
  permissionGroupWorkspace,
  user,
  workspaceFiles,
  workspaceFileVersion,
} from '@sim/db/schema'
import { sha256Hex } from '@sim/security/hash'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { envFlagsMock } from '@sim/testing/mocks/env-flags.mock'
import { featureFlagsMock, featureFlagsMockFns } from '@sim/testing/mocks/feature-flags.mock'
import { posthogServerMock } from '@sim/testing/mocks/posthog-server.mock'
import { realtimeNotifyMock } from '@sim/testing/mocks/realtime-notify.mock'
import { generateId } from '@sim/utils/id'
import { compareStrings } from '@sim/utils/string'
import type { WorkspaceBaseV1 } from '@sim/workspace-code'
import { WORKSPACE_SOURCE_LIMITS } from '@sim/workspace-code/limits'
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, vi } from 'vitest'

vi.mock('@/lib/core/config/env-flags', () => ({ ...envFlagsMock, isAccessControlEnabled: true }))
vi.mock('@/lib/core/config/feature-flags', () => featureFlagsMock)
vi.mock('@/lib/realtime/notify', () => realtimeNotifyMock)
vi.mock('@/lib/posthog/server', () => posthogServerMock)

const fixtureStorage = vi.hoisted(() => ({ root: '' }))
vi.mock('@/lib/uploads/core/setup.server', () => ({
  get UPLOAD_DIR_SERVER() {
    return fixtureStorage.root
  },
}))

import { withPermissionGroupScope } from '@/lib/permission-groups/request-scope.server'
import { ensureWorkspaceFileFolderPath } from '@/lib/uploads/contexts/workspace/file-folder-manager'
import { uploadWorkspaceFile } from '@/lib/uploads/contexts/workspace/file-manager'
import { deleteWorkspaceFileOperation } from '@/lib/workspace-files/application/delete-workspace-file'
import { readWorkspaceFileContent } from '@/lib/workspace-files/application/read-workspace-file-content'
import { renameWorkspaceFile } from '@/lib/workspace-files/application/rename-workspace-file'
import * as contentUseCases from '@/lib/workspace-files/application/update-workspace-file-content'
import {
  type ApplyWorkspaceSourceInput,
  applyWorkspaceSource,
} from '@/lib/workspace-source/application/apply-workspace-source'
import { readWorkspaceSource } from '@/lib/workspace-source/application/read-workspace-source'
import {
  blobManifest,
  cliRound,
  codes,
  refusal,
  sourceChecks,
  sourceWorkspaces,
} from '@/lib/workspace-source/application/workspace-source.test-helpers'

const ownerId = generateId()
const blockedId = generateId()
const organizationId = generateId()
const owner = createSessionPrincipal({ userId: ownerId, sessionId: generateId() })
const blocked = createSessionPrincipal({ userId: blockedId, sessionId: generateId() })
const { check, writeReport } = sourceChecks(
  'WORKSPACE_SOURCE_FILES_REPORT_PATH',
  'workspace-source-files.json'
)
const workspaces = sourceWorkspaces()

/** The directory a check starts from: one file at the root, one in a folder. */
const STARTER: Record<string, Buffer> = {
  'files/notes.txt': Buffer.from('first notes'),
  'files/docs/plan.md': Buffer.from('# Plan\n'),
}

async function newWorkspace(): Promise<string> {
  return workspaces.create({
    name: 'Workspace source files',
    ownerId,
    organizationId,
    members: [{ userId: blockedId, permission: 'admin' }],
  })
}

type Blob = NonNullable<ApplyWorkspaceSourceInput['blobs']>[number]

/** The blob manifest a directory sends, carrying the content of `send` (every blob by default). */
function blobsOf(files: Record<string, Buffer>, send?: readonly string[]): Blob[] {
  return blobManifest(files, (blobPath) => !send || send.includes(blobPath))
}

interface ApplyOptions {
  base?: WorkspaceBaseV1
  send?: readonly string[]
  allowDelete?: boolean
  dryRun?: boolean
  principal?: Principal
}

function apply(workspaceId: string, files: Record<string, Buffer>, options: ApplyOptions = {}) {
  const { principal = owner, send, ...input } = options
  return withPermissionGroupScope(() =>
    applyWorkspaceSource.execute({
      principal,
      input: {
        workspaceId,
        files: {},
        blobs: blobsOf(files, options.dryRun ? [] : send),
        kinds: ['file'],
        ...input,
      },
    })
  )
}

function get(workspaceId: string) {
  return withPermissionGroupScope(() =>
    readWorkspaceSource.execute({ principal: owner, input: { workspaceId, kinds: ['file'] } })
  )
}

function summary(changes: ReadonlyArray<{ action: string; key: string }>) {
  return changes.map(({ action, key }) => `${action} ${key}`)
}

/** Every live workspace file: id, name, content revision and version count. */
async function storedFiles(workspaceId: string) {
  const rows = await db
    .select({
      id: workspaceFiles.id,
      name: workspaceFiles.originalName,
      contentUpdatedAt: workspaceFiles.contentUpdatedAt,
    })
    .from(workspaceFiles)
    .where(and(eq(workspaceFiles.workspaceId, workspaceId), isNull(workspaceFiles.deletedAt)))
  const versions = rows.length
    ? await db
        .select({ fileId: workspaceFileVersion.fileId })
        .from(workspaceFileVersion)
        .where(
          inArray(
            workspaceFileVersion.fileId,
            rows.map((row) => row.id)
          )
        )
    : []
  return rows
    .map((row) => ({
      ...row,
      versions: versions.filter((version) => version.fileId === row.id).length,
    }))
    .sort((a, b) => compareStrings(a.name, b.name))
}

async function bytesOf(workspaceId: string, fileId: string): Promise<string> {
  const { content } = await readWorkspaceFileContent.execute({
    principal: owner,
    input: { fileId, assertedWorkspaceId: workspaceId },
  })
  return content.toString('utf8')
}

/** A UI edit: the Files tab replacing a file's bytes. */
async function editInUi(workspaceId: string, fileId: string, text: string) {
  await contentUseCases.updateWorkspaceFileContentFromBuffer.execute({
    principal: owner,
    input: { fileId, assertedWorkspaceId: workspaceId, content: Buffer.from(text) },
  })
}

/** A Files tab upload into `folderPath` (slash-separated, created as needed). */
async function uploadInUi(workspaceId: string, folderPath: string, name: string, text: string) {
  const { folderId } = await ensureWorkspaceFileFolderPath({
    workspaceId,
    userId: ownerId,
    pathSegments: folderPath ? folderPath.split('/') : [],
  })
  return uploadWorkspaceFile(workspaceId, ownerId, Buffer.from(text), name, 'text/plain', {
    folderId,
    notifyWorkspaceChange: false,
  })
}

/** The directory a get writes: every listed blob with the bytes stored under it. */
async function downloaded(
  workspaceId: string,
  read: Awaited<ReturnType<typeof get>>
): Promise<Record<string, Buffer>> {
  const files: Record<string, Buffer> = {}
  for (const blob of read.blobs) {
    files[blob.path] = Buffer.from(await bytesOf(workspaceId, blob.id))
  }
  return files
}

/** Creates the starter files and returns the directory a get then writes. */
async function setUp(workspaceId: string) {
  const created = await apply(workspaceId, STARTER)
  expect(created.failed).toBeUndefined()
  return get(workspaceId)
}

function fileId(base: WorkspaceBaseV1, key: string): string {
  const id = base.resources[`file:${key}`]?.id
  if (!id) throw new Error(`The base has no file ${key}`)
  return id
}

beforeAll(async () => {
  fixtureStorage.root = mkdtempSync(path.join(tmpdir(), 'sim-workspace-source-files-'))
  featureFlagsMockFns.mockIsFeatureEnabled.mockImplementation(
    async (flag: string) => flag === 'workflow-code'
  )
  const now = new Date()
  await db.insert(user).values(
    [ownerId, blockedId].map((id) => ({
      id,
      name: 'Workspace source files fixture',
      email: `${id}@workspace-source.invalid`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    }))
  )
  await db.insert(organization).values({
    id: organizationId,
    name: 'Workspace source files',
    slug: organizationId,
  })
})

afterAll(async () => {
  await writeReport()
  await workspaces.cleanup()
  await db.delete(permissionGroup).where(eq(permissionGroup.organizationId, organizationId))
  await db.delete(organization).where(eq(organization.id, organizationId))
  await db.delete(user).where(inArray(user.id, [ownerId, blockedId]))
  await rm(fixtureStorage.root, { recursive: true, force: true })
})

describe('workspace source files', () => {
  check('creates files and their folders, then reads them back byte for byte', async () => {
    const workspaceId = await newWorkspace()

    const dryRun = await apply(workspaceId, STARTER, { dryRun: true })
    expect(codes(dryRun.diagnostics)).toEqual([])
    expect(summary(dryRun.plan)).toEqual(['create notes.txt', 'create docs/plan.md'])
    expect(dryRun.needBlobs.sort()).toEqual(['files/docs/plan.md', 'files/notes.txt'])
    expect(await storedFiles(workspaceId)).toEqual([])

    const created = await apply(workspaceId, STARTER)

    expect(created.failed).toBeUndefined()
    expect(created.remainingBlobs).toEqual([])
    const stored = await storedFiles(workspaceId)
    expect(stored.map((file) => file.name)).toEqual(['notes.txt', 'plan.md'])
    expect(await bytesOf(workspaceId, fileId(created.base, 'docs/plan.md'))).toBe('# Plan\n')

    const read = await get(workspaceId)
    expect(read.skipped).toEqual([])
    expect(read.files).toEqual({})
    expect(
      read.blobs.map(({ path: blobPath, sha256, size }) => ({ path: blobPath, sha256, size }))
    ).toEqual(blobsOf(STARTER, []).sort((a, b) => compareStrings(b.path, a.path)))
    expect(read.base.resources).toEqual(created.base.resources)
  })

  check('re-applying what a get read changes nothing and records no version', async () => {
    const workspaceId = await newWorkspace()
    const read = await setUp(workspaceId)
    const before = await storedFiles(workspaceId)

    const again = await apply(workspaceId, STARTER, { base: read.base })

    expect(summary(again.plan)).toEqual(['noop notes.txt', 'noop docs/plan.md'])
    expect(again.applied).toEqual([])
    expect(again.needBlobs).toEqual([])
    expect(await storedFiles(workspaceId)).toEqual(before)
  })

  check('an edited file becomes a new version and the old one stays restorable', async () => {
    const workspaceId = await newWorkspace()
    const read = await setUp(workspaceId)
    const id = fileId(read.base, 'notes.txt')
    const [before] = (await storedFiles(workspaceId)).filter((file) => file.id === id)

    const edited = { ...STARTER, 'files/notes.txt': Buffer.from('second notes') }
    const result = await apply(workspaceId, edited, { base: read.base })

    expect(summary(result.applied)).toEqual(['update notes.txt'])
    expect(await bytesOf(workspaceId, id)).toBe('second notes')
    const [after] = (await storedFiles(workspaceId)).filter((file) => file.id === id)
    expect(after.versions).toBeGreaterThan(before.versions)
    const superseded = await db
      .select({ version: workspaceFileVersion.version })
      .from(workspaceFileVersion)
      .where(and(eq(workspaceFileVersion.fileId, id), isNotNull(workspaceFileVersion.supersededAt)))
    expect(superseded).toHaveLength(1)
    const reread = await get(workspaceId)
    expect(reread.base.resources['file:notes.txt']).toEqual(result.base.resources['file:notes.txt'])
  })

  check('a UI edit after the get refuses the apply (409) and keeps the UI bytes', async () => {
    const workspaceId = await newWorkspace()
    const read = await setUp(workspaceId)
    const id = fileId(read.base, 'notes.txt')
    await editInUi(workspaceId, id, 'edited in the UI')

    const unchanged = await apply(workspaceId, STARTER, { base: read.base })
    expect(summary(unchanged.plan)).toEqual(['noop notes.txt', 'noop docs/plan.md'])
    expect(codes(unchanged.diagnostics, 'info')).toEqual(['I_SERVER_CHANGED'])

    const refused = await refusal(
      apply(
        workspaceId,
        { ...STARTER, 'files/notes.txt': Buffer.from('edited locally') },
        { base: read.base }
      )
    )
    expect(refused.code).toBe('conflict')
    expect(codes(refused.diagnostics)).toEqual(['E_APPLY_STALE'])
    expect(await bytesOf(workspaceId, id)).toBe('edited in the UI')
  })

  check(
    'a UI edit between the plan and the write fails that write and keeps the UI bytes',
    async () => {
      const workspaceId = await newWorkspace()
      const read = await setUp(workspaceId)
      const id = fileId(read.base, 'notes.txt')
      const update = contentUseCases.updateWorkspaceFileContentFromBuffer.execute
      const spy = vi
        .spyOn(contentUseCases.updateWorkspaceFileContentFromBuffer, 'execute')
        .mockImplementationOnce(async (args) => {
          await update({
            principal: owner,
            input: {
              fileId: id,
              assertedWorkspaceId: workspaceId,
              content: Buffer.from('racing UI edit'),
            },
          })
          return update(args)
        })
      try {
        const result = await apply(
          workspaceId,
          { ...STARTER, 'files/notes.txt': Buffer.from('edited locally') },
          { base: read.base }
        )
        expect(result.failed).toMatchObject({ key: 'notes.txt', code: 'E_APPLY_STALE' })
      } finally {
        spy.mockRestore()
      }
      expect(await bytesOf(workspaceId, id)).toBe('racing UI edit')
    }
  )

  check(
    'a member whose permission group withholds Files is refused before anything is written',
    async () => {
      const workspaceId = await newWorkspace()
      const groupId = generateId()
      await db.insert(permissionGroup).values({
        id: groupId,
        organizationId,
        name: `No files ${groupId}`,
        createdBy: ownerId,
        config: { hideFilesTab: true },
      })
      await db.insert(permissionGroupWorkspace).values({
        id: generateId(),
        permissionGroupId: groupId,
        workspaceId,
        organizationId,
      })
      await db.insert(permissionGroupMember).values({
        id: generateId(),
        permissionGroupId: groupId,
        organizationId,
        userId: blockedId,
      })

      const refused = await refusal(apply(workspaceId, STARTER, { principal: blocked }))

      expect(codes(refused.diagnostics)).toEqual(['E_APPLY_FORBIDDEN'])
      expect(refused.diagnostics.find((finding) => finding.severity === 'error')).toMatchObject({
        kind: 'file',
      })
      expect(await storedFiles(workspaceId)).toEqual([])
    }
  )

  check(
    'blob rounds over the request cap: writes land round by round, deletes only in the last, and an interrupted round resumes',
    async () => {
      const workspaceId = await newWorkspace()
      const read = await setUp(workspaceId)
      const big = (fill: string) => Buffer.alloc(WORKSPACE_SOURCE_LIMITS.maxBlobBytes - 1, fill)
      const directory: Record<string, Buffer> = {
        'files/notes.txt': STARTER['files/notes.txt'],
        'files/big/a.bin': big('a'),
        'files/big/b.bin': big('b'),
        'files/big/c.bin': big('c'),
      }

      const preview = await apply(workspaceId, directory, {
        base: read.base,
        allowDelete: true,
        dryRun: true,
      })
      expect(summary(preview.plan)).toEqual([
        'noop notes.txt',
        'create big/a.bin',
        'create big/b.bin',
        'create big/c.bin',
        'delete docs/plan.md',
      ])
      expect(preview.plan.find((change) => change.action === 'delete')?.destructive).toEqual({
        what: 'file',
        counts: { files: 1, bytes: STARTER['files/docs/plan.md'].length },
      })

      const round = (wanted: readonly string[]) => cliRound(blobsOf(directory, []), wanted)
      const first = round(preview.needBlobs)
      expect(first).toHaveLength(2)

      const roundOne = await apply(workspaceId, directory, {
        base: read.base,
        allowDelete: true,
        send: first,
      })
      expect(roundOne.failed).toBeUndefined()
      expect(summary(roundOne.applied)).toEqual(['create big/a.bin', 'create big/b.bin'])
      expect(roundOne.remainingBlobs).toEqual(['files/big/c.bin'])
      expect((await storedFiles(workspaceId)).map((file) => file.name)).toContain('plan.md')

      /** Round one's answer was lost: round two starts again from the base the get wrote. */
      const resumed = await apply(workspaceId, directory, {
        base: read.base,
        allowDelete: true,
        send: round(roundOne.remainingBlobs),
      })
      expect(resumed.failed).toBeUndefined()
      expect(summary(resumed.plan)).toEqual([
        'noop notes.txt',
        'noop big/a.bin',
        'noop big/b.bin',
        'create big/c.bin',
        'delete docs/plan.md',
      ])
      expect(summary(resumed.applied)).toEqual(['create big/c.bin', 'delete docs/plan.md'])
      expect(resumed.remainingBlobs).toEqual([])
      expect((await storedFiles(workspaceId)).map((file) => file.name)).toEqual([
        'a.bin',
        'b.bin',
        'c.bin',
        'notes.txt',
      ])

      const settled = await apply(workspaceId, directory, { base: resumed.base, dryRun: true })
      expect(settled.plan.every((change) => change.action === 'noop')).toBe(true)
      expect(settled.needBlobs).toEqual([])
    }
  )

  check(
    'a file over the blob cap, or with a path no directory holds, is skipped by get and never touched by apply',
    async () => {
      const workspaceId = await newWorkspace()
      await setUp(workspaceId)
      const huge = await uploadWorkspaceFile(
        workspaceId,
        ownerId,
        Buffer.alloc(WORKSPACE_SOURCE_LIMITS.maxBlobBytes + 1, 'h'),
        'huge.bin',
        'application/octet-stream',
        { notifyWorkspaceChange: false }
      )

      const unsafe = await uploadWorkspaceFile(
        workspaceId,
        ownerId,
        Buffer.from('colon'),
        'q1:summary.txt',
        'text/plain',
        { notifyWorkspaceChange: false }
      )

      const reread = await get(workspaceId)
      expect(reread.skipped).toEqual([
        { kind: 'file', key: 'huge.bin', reason: expect.stringContaining('over the') },
        {
          kind: 'file',
          key: 'q1:summary.txt',
          reason: expect.stringContaining('reserved character'),
        },
      ])
      expect(reread.blobs.map((blob) => blob.path)).not.toContain('files/huge.bin')
      expect(reread.base.resources['file:huge.bin']).toBeUndefined()

      const emptied = await apply(workspaceId, {}, { base: reread.base, allowDelete: true })
      expect(summary(emptied.applied).sort()).toEqual(['delete docs/plan.md', 'delete notes.txt'])
      expect(codes(emptied.diagnostics, 'warning')).toEqual([])
      expect((await storedFiles(workspaceId)).map((file) => file.id)).toEqual([huge.id, unsafe.id])

      const hugeBefore = (await storedFiles(workspaceId)).find((file) => file.id === huge.id)
      const replaced = await refusal(
        apply(workspaceId, { 'files/huge.bin': Buffer.from('small') }, { base: emptied.base })
      )
      expect(codes(replaced.diagnostics)).toEqual(['E_FILE_TOO_LARGE'])
      expect((await storedFiles(workspaceId)).find((file) => file.id === huge.id)).toEqual(
        hugeBefore
      )
      const { content } = await readWorkspaceFileContent.execute({
        principal: owner,
        input: { fileId: huge.id, assertedWorkspaceId: workspaceId, contentView: 'opaque' },
      })
      expect(sha256Hex(content)).toBe(
        sha256Hex(Buffer.alloc(WORKSPACE_SOURCE_LIMITS.maxBlobBytes + 1, 'h'))
      )
    }
  )

  check(
    'a file the directory dropped is deleted only with --allow-delete, into Recently Deleted',
    async () => {
      const workspaceId = await newWorkspace()
      const read = await setUp(workspaceId)
      const id = fileId(read.base, 'docs/plan.md')
      const dropped = { 'files/notes.txt': STARTER['files/notes.txt'] }

      const refused = await refusal(apply(workspaceId, dropped, { base: read.base }))
      expect(codes(refused.diagnostics)).toEqual(['E_APPLY_DELETE_NOT_ALLOWED'])
      expect((await storedFiles(workspaceId)).map((file) => file.id)).toContain(id)

      const deleted = await apply(workspaceId, dropped, { base: read.base, allowDelete: true })
      expect(summary(deleted.applied)).toEqual(['delete docs/plan.md'])
      expect(deleted.base.resources['file:docs/plan.md']).toBeUndefined()
      const [row] = await db
        .select({ deletedAt: workspaceFiles.deletedAt })
        .from(workspaceFiles)
        .where(eq(workspaceFiles.id, id))
      expect(row?.deletedAt).toBeInstanceOf(Date)
    }
  )

  check('a dropped file edited in the UI since the get is not deleted', async () => {
    const workspaceId = await newWorkspace()
    const read = await setUp(workspaceId)
    const id = fileId(read.base, 'docs/plan.md')
    await editInUi(workspaceId, id, '# Plan, edited in the UI\n')

    const refused = await refusal(
      apply(
        workspaceId,
        { 'files/notes.txt': STARTER['files/notes.txt'] },
        { base: read.base, allowDelete: true }
      )
    )

    expect(codes(refused.diagnostics)).toEqual(['E_APPLY_STALE'])
    expect(await bytesOf(workspaceId, id)).toBe('# Plan, edited in the UI\n')
  })

  check(
    'names the server would store differently, or that collide by case, are refused',
    async () => {
      const workspaceId = await newWorkspace()
      await setUp(workspaceId)

      const refused = await refusal(
        apply(workspaceId, {
          'files/two  spaces.txt': Buffer.from('x'),
          'files/Notes.TXT': Buffer.from('y'),
        })
      )

      expect(codes(refused.diagnostics).sort()).toEqual(['E_FILE_NAME', 'E_FILE_PATH_COLLISION'])
      expect(await storedFiles(workspaceId)).toHaveLength(2)
    }
  )

  check('a file whose bytes do not match their declared hash is not written', async () => {
    const workspaceId = await newWorkspace()
    const forged = blobsOf({ 'files/a.txt': Buffer.from('declared') })
    const [blob] = forged
    const refused = await refusal(
      withPermissionGroupScope(() =>
        applyWorkspaceSource.execute({
          principal: owner,
          input: {
            workspaceId,
            files: {},
            blobs: [{ ...blob, content: Buffer.from('replaced!').toString('base64') }],
            kinds: ['file'],
          },
        })
      )
    )

    expect(codes(refused.diagnostics)).toEqual(['E_BLOB_CONTENT'])
    expect(await storedFiles(workspaceId)).toEqual([])
  })

  check(
    'server files and folders a case-insensitive disk would merge are left out of get, and an apply names the collision',
    async () => {
      const workspaceId = await newWorkspace()
      await uploadInUi(workspaceId, 'docs', 'a.txt', 'in the docs folder')
      await uploadInUi(workspaceId, '', 'docs', 'a file named like the folder')
      await uploadInUi(workspaceId, 'Reports', 'x.txt', 'upper')
      await uploadInUi(workspaceId, 'reports', 'y.txt', 'lower')

      const read = await get(workspaceId)

      expect(read.skipped).toEqual([
        { kind: 'file', key: 'docs', reason: expect.stringContaining('files/docs is a folder') },
        {
          kind: 'file',
          key: 'reports/y.txt',
          reason: expect.stringContaining('differs only in letter case from files/Reports'),
        },
      ])
      expect(read.blobs.map((blob) => blob.path).sort()).toEqual([
        'files/Reports/x.txt',
        'files/docs/a.txt',
      ])
      const before = await storedFiles(workspaceId)

      const directory = await downloaded(workspaceId, read)
      const again = await apply(workspaceId, directory, { base: read.base, allowDelete: true })
      expect(again.applied).toEqual([])
      expect(codes(again.diagnostics, 'warning')).toEqual([])

      const declared = await refusal(
        apply(
          workspaceId,
          { 'files/reports/y.txt': Buffer.from('lower, edited') },
          { base: read.base, allowDelete: true }
        )
      )
      expect(codes(declared.diagnostics)).toEqual(['E_FILE_PATH_COLLISION'])
      expect(await storedFiles(workspaceId)).toEqual(before)
    }
  )

  check(
    'a file renamed in the Files tab is not re-created at its old path, and a local edit of it is stale',
    async () => {
      const workspaceId = await newWorkspace()
      const read = await setUp(workspaceId)
      const id = fileId(read.base, 'notes.txt')
      await renameWorkspaceFile.execute({
        principal: owner,
        input: { fileId: id, assertedWorkspaceId: workspaceId, name: 'renamed.txt' },
      })
      const before = await storedFiles(workspaceId)

      const unchanged = await apply(workspaceId, STARTER, { base: read.base })
      expect(summary(unchanged.plan)).toEqual([
        'noop notes.txt',
        'noop docs/plan.md',
        'noop renamed.txt',
      ])
      const moved = unchanged.diagnostics.find((finding) => finding.code === 'I_SERVER_MOVED')
      expect(moved?.message).toContain('files/renamed.txt')
      expect(unchanged.needBlobs).toEqual([])

      const refused = await refusal(
        apply(
          workspaceId,
          { ...STARTER, 'files/notes.txt': Buffer.from('edited locally') },
          { base: read.base }
        )
      )
      expect(refused.code).toBe('conflict')
      expect(codes(refused.diagnostics)).toEqual(['E_APPLY_STALE'])
      expect(
        refused.diagnostics.find((finding) => finding.severity === 'error')?.message
      ).toContain('files/renamed.txt')
      expect(await storedFiles(workspaceId)).toEqual(before)
    }
  )

  check(
    'a file deleted in the Files tab is not re-created, and a local edit of it is stale',
    async () => {
      const workspaceId = await newWorkspace()
      const read = await setUp(workspaceId)
      await deleteWorkspaceFileOperation.execute({
        principal: owner,
        input: { fileId: fileId(read.base, 'notes.txt'), assertedWorkspaceId: workspaceId },
      })
      const before = await storedFiles(workspaceId)

      const unchanged = await apply(workspaceId, STARTER, { base: read.base })
      expect(summary(unchanged.plan)).toEqual(['noop notes.txt', 'noop docs/plan.md'])
      expect(codes(unchanged.diagnostics, 'info')).toEqual(['I_SERVER_DELETED'])
      expect(unchanged.needBlobs).toEqual([])

      const refused = await refusal(
        apply(
          workspaceId,
          { ...STARTER, 'files/notes.txt': Buffer.from('edited locally') },
          { base: read.base }
        )
      )
      expect(refused.code).toBe('conflict')
      expect(codes(refused.diagnostics)).toEqual(['E_APPLY_STALE'])
      expect(await storedFiles(workspaceId)).toEqual(before)
    }
  )

  check('a case-only rename applies when the same apply deletes the old spelling', async () => {
    const workspaceId = await newWorkspace()
    const read = await setUp(workspaceId)
    const renamed = {
      'files/Notes.txt': STARTER['files/notes.txt'],
      'files/docs/plan.md': STARTER['files/docs/plan.md'],
    }

    const kept = await refusal(apply(workspaceId, renamed, { base: read.base }))
    expect(codes(kept.diagnostics).sort()).toEqual([
      'E_APPLY_DELETE_NOT_ALLOWED',
      'E_FILE_PATH_COLLISION',
    ])

    const result = await apply(workspaceId, renamed, { base: read.base, allowDelete: true })
    expect(result.failed).toBeUndefined()
    expect(summary(result.applied)).toEqual(['create Notes.txt', 'delete notes.txt'])
    expect((await storedFiles(workspaceId)).map((file) => file.name)).toEqual([
      'Notes.txt',
      'plan.md',
    ])
  })

  check(
    'server hashing stops at the per-request budget: a get lists the rest without a hash, and a plan refuses them rather than creating',
    async () => {
      const workspaceId = await newWorkspace()
      const size = Math.floor(WORKSPACE_SOURCE_LIMITS.maxBlobBytesPerRequest / 2.5)
      const directory: Record<string, Buffer> = {}
      for (const name of ['a.bin', 'b.bin', 'c.bin']) {
        const bytes = Buffer.alloc(size, name)
        directory[`files/${name}`] = bytes
        await uploadWorkspaceFile(workspaceId, ownerId, bytes, name, 'application/octet-stream', {
          notifyWorkspaceChange: false,
        })
      }

      const read = await get(workspaceId)
      expect(read.skipped).toEqual([])
      const unhashed = read.blobs.filter((blob) => blob.sha256 === undefined)
      expect(read.blobs).toHaveLength(3)
      expect(unhashed).toHaveLength(1)
      expect(unhashed[0]).toMatchObject({ size, rev: expect.any(String) })
      const unhashedKey = unhashed[0].path.slice('files/'.length)
      expect(read.base.resources[`file:${unhashedKey}`]).toEqual({ id: unhashed[0].id })
      for (const blob of read.blobs.filter((entry) => entry.sha256 !== undefined)) {
        expect(blob.sha256).toBe(sha256Hex(directory[blob.path]))
      }

      const adopted = await apply(workspaceId, directory, { dryRun: true })
      expect(summary(adopted.plan)).toEqual(['noop a.bin', 'noop b.bin', 'noop c.bin'])
      expect(
        adopted.diagnostics
          .filter((finding) => finding.severity === 'error')
          .map((finding) => `${finding.code} ${finding.key}`)
      ).toEqual(['E_APPLY_NO_BASE c.bin'])
      expect(adopted.needBlobs).toEqual([])
    }
  )

  check('a stored file whose bytes cannot be read refuses only itself', async () => {
    const workspaceId = await newWorkspace()
    const readable = Buffer.from('readable')
    const broken = Buffer.from('gone from storage')
    await uploadWorkspaceFile(workspaceId, ownerId, readable, 'a.txt', 'text/plain', {
      notifyWorkspaceChange: false,
    })
    const lost = await uploadWorkspaceFile(workspaceId, ownerId, broken, 'b.txt', 'text/plain', {
      notifyWorkspaceChange: false,
    })
    await rm(path.join(fixtureStorage.root, lost.key))

    const planned = await apply(
      workspaceId,
      { 'files/a.txt': readable, 'files/b.txt': broken },
      { dryRun: true }
    )

    expect(summary(planned.plan)).toEqual(['noop a.txt', 'noop b.txt'])
    expect(
      planned.diagnostics
        .filter((finding) => finding.severity === 'error')
        .map((finding) => `${finding.code} ${finding.key}`)
    ).toEqual(['E_APPLY_NO_BASE b.txt'])
  })
})
