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
  workspaceResourceKey,
  workspaceSourceStagedBlob,
} from '@sim/db/schema'
import { sha256Hex } from '@sim/security/hash'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { envFlagsMock, resetEnvFlagsMock, setEnvFlags } from '@sim/testing/mocks/env-flags.mock'
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
import type { WorkspaceBaseV1 } from '@sim/workspace-code'
import { WORKSPACE_SOURCE_LIMITS } from '@sim/workspace-code/limits'
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, vi } from 'vitest'

vi.mock('@/lib/core/config/env-flags', () => envFlagsMock)
vi.mock('@/lib/core/config/feature-flags', () => featureFlagsMock)
vi.mock('@/lib/realtime/notify', () => realtimeNotifyMock)
vi.mock('@/lib/posthog/server', () => posthogServerMock)

vi.mock('@/lib/uploads/core/setup.server', () => uploadsSetupMock)

import { withPermissionGroupScope } from '@/lib/permission-groups/request-scope.server'
import { ensureWorkspaceFileFolderPath } from '@/lib/uploads/contexts/workspace/file-folder-manager'
import { uploadWorkspaceFile } from '@/lib/uploads/contexts/workspace/file-manager'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/persistence/utils'
import * as deleteUseCases from '@/lib/workspace-files/application/delete-workspace-file'
import { moveWorkspaceFileItemsOperation } from '@/lib/workspace-files/application/move-workspace-file-items'
import { readWorkspaceFileContent } from '@/lib/workspace-files/application/read-workspace-file-content'
import { renameWorkspaceFile } from '@/lib/workspace-files/application/rename-workspace-file'
import * as contentUseCases from '@/lib/workspace-files/application/update-workspace-file-content'
import { createWorkspaceFileBufferByPath } from '@/lib/workspace-files/application/write-workspace-file-by-path'
import { findMissingSourceBlobs } from '@/lib/workspace-source/application/stage-blobs'
import {
  blobManifest,
  codes,
  failKeyClaims,
  type ManifestBlob,
  refusal,
  sourceChecks,
  sourceRunner,
  sourceWorkspaces,
  stageBlobsAs,
} from '@/lib/workspace-source/application/workspace-source.test-helpers'
import { WorkspaceSourceBusyError } from '@/lib/workspace-source/lease/store'
import { claimResourceKey } from '@/lib/workspaces/resource-keys'

/** Local object storage the suite's uploads land in, under a temp directory. */
let storageRoot = ''
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

/** The blob manifest a directory sends, staging the bytes of `send` (every blob by default). */
function blobsOf(files: Record<string, Buffer>, send?: readonly string[]): ManifestBlob[] {
  return blobManifest(files, (blobPath) => !send || send.includes(blobPath))
}

interface ApplyOptions {
  base?: WorkspaceBaseV1
  send?: readonly string[]
  allowDelete?: boolean
  dryRun?: boolean
  principal?: Principal
}

const runner = sourceRunner(['file'], owner)

/** Files beside the workflows that name them. */
const withFiles = sourceRunner(['file', 'workflow'], owner)

function apply(workspaceId: string, files: Record<string, Buffer>, options: ApplyOptions = {}) {
  const { send, ...input } = options
  return runner.apply(workspaceId, {
    files: {},
    blobs: blobsOf(files, options.dryRun ? [] : send),
    ...input,
  })
}

function get(workspaceId: string) {
  return runner.get(workspaceId)
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
  storageRoot = mkdtempSync(path.join(tmpdir(), 'sim-workspace-source-files-'))
  setUploadDirServer(storageRoot)
  setEnvFlags({ isAccessControlEnabled: true })
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
  resetUploadsSetupMock()
  resetEnvFlagsMock()
  await workspaces.cleanup()
  await db.delete(permissionGroup).where(eq(permissionGroup.organizationId, organizationId))
  await db.delete(organization).where(eq(organization.id, organizationId))
  await db.delete(user).where(inArray(user.id, [ownerId, blockedId]))
  await rm(storageRoot, { recursive: true, force: true })
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

  check('a dry run plans with staged bytes and leaves their expiry as it was', async () => {
    const workspaceId = await newWorkspace()
    await stageBlobsAs(
      owner,
      workspaceId,
      blobsOf(STARTER).map(({ sha256, content }) => ({ sha256, content: content ?? '' }))
    )
    const soon = new Date(Date.now() + 30 * 60 * 1000)
    const staged = eq(workspaceSourceStagedBlob.workspaceId, workspaceId)
    await db.update(workspaceSourceStagedBlob).set({ expiresAt: soon }).where(staged)

    const dryRun = await apply(workspaceId, STARTER, { dryRun: true })

    expect(dryRun.needBlobs).toEqual([])
    const expiries = await db
      .select({ expiresAt: workspaceSourceStagedBlob.expiresAt })
      .from(workspaceSourceStagedBlob)
      .where(staged)
    expect(expiries.map((row) => row.expiresAt.getTime())).toEqual([soon.getTime(), soon.getTime()])
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
    expect(codes(unchanged.diagnostics, 'warning')).toEqual(['W_SERVER_CHANGED'])

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
    'an apply missing a staged blob is refused before any write; staging it and applying again writes everything, deletes included',
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
      const manifest = blobsOf(directory, [])
      const before = await storedFiles(workspaceId)

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
      expect(preview.needBlobs.sort()).toEqual([
        'files/big/a.bin',
        'files/big/b.bin',
        'files/big/c.bin',
      ])

      // Two of the three staged (an upload cut short): the apply writes nothing at all.
      await stageBlobsAs(
        owner,
        workspaceId,
        manifest.flatMap((blob) =>
          blob.path === 'files/big/a.bin' || blob.path === 'files/big/b.bin'
            ? [{ sha256: blob.sha256, content: directory[blob.path].toString('base64') }]
            : []
        )
      )
      const refused = await refusal(
        runner.apply(workspaceId, {
          files: {},
          blobs: manifest,
          base: read.base,
          allowDelete: true,
        })
      )
      expect(
        refused.diagnostics
          .filter((finding) => finding.severity === 'error')
          .map((finding) => `${finding.code} ${finding.file}`)
      ).toEqual(['E_BLOB_MISSING files/big/c.bin'])
      expect(await storedFiles(workspaceId)).toEqual(before)

      // The resumed upload asks first: only c.bin is missing (notes.txt stays staged from the
      // set-up apply), so only c.bin is sent.
      const missing = await withPermissionGroupScope(() =>
        findMissingSourceBlobs.execute({
          principal: owner,
          input: { workspaceId, blobs: manifest.map(({ sha256, size }) => ({ sha256, size })) },
        })
      )
      const c = manifest.find((blob) => blob.path === 'files/big/c.bin')
      expect(missing.missing).toEqual([c?.sha256])
      await stageBlobsAs(owner, workspaceId, [
        { sha256: c?.sha256 ?? '', content: directory['files/big/c.bin'].toString('base64') },
      ])

      const applied = await runner.apply(workspaceId, {
        files: {},
        blobs: manifest,
        base: read.base,
        allowDelete: true,
      })
      expect(applied.failed).toBeUndefined()
      expect(summary(applied.applied)).toEqual([
        'create big/a.bin',
        'create big/b.bin',
        'create big/c.bin',
        'delete docs/plan.md',
      ])
      expect((await storedFiles(workspaceId)).map((file) => file.name)).toEqual([
        'a.bin',
        'b.bin',
        'c.bin',
        'notes.txt',
      ])
      // What the apply wrote stays staged until it expires, so applying it again uploads nothing.
      const after = await withPermissionGroupScope(() =>
        findMissingSourceBlobs.execute({
          principal: owner,
          input: { workspaceId, blobs: manifest.map(({ sha256, size }) => ({ sha256, size })) },
        })
      )
      expect(after.missing).toEqual([])

      const settled = await apply(workspaceId, directory, { base: applied.base, dryRun: true })
      expect(settled.plan.every((change) => change.action === 'noop')).toBe(true)
      expect(settled.needBlobs).toEqual([])
    }
  )

  check(
    'two applies by one caller sharing a staged blob: the second, refused while the first writes, still finds the bytes once it finished',
    async () => {
      const workspaceId = await newWorkspace()
      const shared = Buffer.from('bytes both applies write')
      const first: Record<string, Buffer> = {
        'files/first/lead.txt': Buffer.from('written before the pause'),
        'files/first/shared.txt': shared,
      }
      const second: Record<string, Buffer> = { 'files/second/shared.txt': shared }
      const create = createWorkspaceFileBufferByPath.execute
      let refused: unknown = null
      // The first apply pauses at its first write, after it planned with the shared blob; the
      // second apply, which staged the same bytes, is refused meanwhile.
      const paused = vi
        .spyOn(createWorkspaceFileBufferByPath, 'execute')
        .mockImplementationOnce(async (...args) => {
          refused = await apply(workspaceId, second).then(
            () => null,
            (error: unknown) => error
          )
          return create(...args)
        })

      const result = await apply(workspaceId, first).finally(() => paused.mockRestore())
      expect(refused).toBeInstanceOf(WorkspaceSourceBusyError)
      expect(result.failed).toBeUndefined()
      expect(summary(result.applied)).toEqual(['create first/lead.txt', 'create first/shared.txt'])

      // Sending no bytes: the first apply finishing left the shared blob staged.
      const other = await apply(workspaceId, second, { send: [] })
      expect(other.failed).toBeUndefined()
      expect((await storedFiles(workspaceId)).map((file) => file.name).sort()).toEqual([
        'lead.txt',
        'shared.txt',
        'shared.txt',
      ])
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
      expect(replaced.code).toBe('payload_too_large')
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

  check(
    'a UI edit between the plan and a delete fails that delete and keeps the file with the UI bytes',
    async () => {
      const workspaceId = await newWorkspace()
      const read = await setUp(workspaceId)
      const id = fileId(read.base, 'docs/plan.md')
      const remove = deleteUseCases.deleteWorkspaceFileOperation.execute
      const spy = vi
        .spyOn(deleteUseCases.deleteWorkspaceFileOperation, 'execute')
        .mockImplementationOnce(async (args) => {
          await editInUi(workspaceId, id, '# Plan, racing UI edit\n')
          return remove(args)
        })
      try {
        const result = await apply(
          workspaceId,
          { 'files/notes.txt': STARTER['files/notes.txt'] },
          { base: read.base, allowDelete: true }
        )
        expect(result.failed).toMatchObject({ key: 'docs/plan.md', code: 'E_APPLY_STALE' })
      } finally {
        spy.mockRestore()
      }
      const [row] = await db
        .select({ deletedAt: workspaceFiles.deletedAt })
        .from(workspaceFiles)
        .where(eq(workspaceFiles.id, id))
      expect(row?.deletedAt).toBeNull()
      expect(await bytesOf(workspaceId, id)).toBe('# Plan, racing UI edit\n')
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
      const moved = unchanged.diagnostics.find((finding) => finding.code === 'W_SERVER_MOVED')
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
      const size = Math.floor(WORKSPACE_SOURCE_LIMITS.maxHashBytesPerRequest / 2.5)
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
    await rm(path.join(storageRoot, lost.key))

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

  check(
    'declares nothing at a workflow test path, and --allow-delete leaves a workflow test intact',
    async () => {
      const workspaceId = await newWorkspace()
      const read = await setUp(workspaceId)
      const test = await uploadInUi(workspaceId, 'tests', 'routing.test.js', 'test("x", () => {})')
      await db.update(workspaceFiles).set({ context: 'test' }).where(eq(workspaceFiles.id, test.id))
      const files = await downloaded(workspaceId, read)

      const dropped = await apply(
        workspaceId,
        { 'files/notes.txt': files['files/notes.txt'] },
        { base: read.base, allowDelete: true }
      )
      expect(dropped.failed).toBeUndefined()
      const [kept] = await db
        .select({ deletedAt: workspaceFiles.deletedAt })
        .from(workspaceFiles)
        .where(eq(workspaceFiles.id, test.id))
      expect(kept?.deletedAt).toBeNull()
      expect((await get(workspaceId)).blobs.map((blob) => blob.path)).toEqual(['files/notes.txt'])

      const declared = await refusal(
        apply(workspaceId, { 'files/tests/billing.test.js': Buffer.from('test("y", () => {})') })
      )
      expect(
        declared.diagnostics
          .filter((finding) => finding.severity === 'error')
          .map((finding) => `${finding.code} ${finding.key}`)
      ).toEqual(['E_FILE_PATH tests/billing.test.js'])
    }
  )

  check(
    'a workflow may name a file the same apply uploads, and deleting it is refused',
    async () => {
      const workspaceId = await newWorkspace()
      const pdf = Buffer.from('%PDF-1.4 a contract')
      const reader = (extra = '') => `// @sim-sdk 1
import { file, trigger, workflow } from '@sim/workflow-sdk'

export default workflow('Reader', {}, () => {
  const start = trigger.start('Start', { inputFormat: {${extra}} })
  const read = file.read('Read', {
    readFileInput: { name: 'contract.pdf', path: 'contract.pdf', key: file('contract-pdf') },
    folderIncludeSubfolders: true,
  })
  start.to(read)
})
`
      const text = { 'workflows/reader/workflow.ts': reader() }
      const manifest = blobsOf({ 'files/contract.pdf': pdf }, [])

      const dryRun = await withFiles.apply(workspaceId, {
        files: text,
        blobs: manifest,
        dryRun: true,
      })
      expect(dryRun.diagnostics.filter((finding) => finding.severity === 'error')).toEqual([])
      // Neither the file nor the workflow naming it is written while the file's bytes are missing.
      const first = await refusal(withFiles.apply(workspaceId, { files: text, blobs: manifest }))
      expect(codes(first.diagnostics)).toEqual(['E_BLOB_MISSING'])
      expect(await storedFiles(workspaceId)).toEqual([])
      const second = await withFiles.apply(workspaceId, {
        files: text,
        blobs: blobsOf({ 'files/contract.pdf': pdf }),
      })
      expect(second.failed).toBeUndefined()
      expect(second.applied.map(({ kind, key }) => `${kind}:${key}`)).toEqual([
        'file:contract.pdf',
        'workflow:reader',
      ])
      const fileRow = second.base.resources['file:contract.pdf']?.id
      const workflowRow = second.base.resources['workflow:reader']?.id
      if (!fileRow || !workflowRow) throw new Error('The apply wrote nothing')
      const stored = await loadWorkflowFromNormalizedTables(workflowRow)
      expect(JSON.stringify(stored?.blocks)).toContain(fileRow)

      // An edited workflow that still names the file refuses its delete.
      const read = await withFiles.get(workspaceId)
      const refused = await refusal(
        withFiles.apply(workspaceId, {
          files: {
            ...read.files,
            'workflows/reader/workflow.ts': reader(" note: 'string' "),
          },
          blobs: [],
          base: read.base,
          allowDelete: true,
        })
      )
      expect(
        refused.diagnostics
          .filter((finding) => finding.severity === 'error')
          .map((finding) => `${finding.code} ${finding.kind}:${finding.key}`)
      ).toEqual(['E_PLAN_REF_DELETED workflow:reader'])
    }
  )
  check(
    'nine creates of one name each claim a free key, past a key a live file already holds',
    async () => {
      const workspaceId = await newWorkspace()
      const holder = await uploadInUi(workspaceId, '', 'holder.txt', 'holds a key')
      // The ninth key a plan would offer `data.csv`, held by a file the Files tab uploaded.
      await claimResourceKey({
        workspaceId,
        kind: 'file',
        key: 'data-csv-9',
        resourceId: holder.id,
        origin: 'adopted',
        createdBy: ownerId,
      })
      const files = Object.fromEntries(
        'abcdefghi'
          .split('')
          .map((folder) => [`files/${folder}/data.csv`, Buffer.from(`rows of ${folder}`)])
      )

      const created = await apply(workspaceId, files)

      expect(created.failed).toBeUndefined()
      const keys = await db
        .select({ key: workspaceResourceKey.key, resourceId: workspaceResourceKey.resourceId })
        .from(workspaceResourceKey)
        .where(
          and(
            eq(workspaceResourceKey.workspaceId, workspaceId),
            eq(workspaceResourceKey.kind, 'file')
          )
        )
      const createdIds = Object.keys(files).map((blobPath) =>
        fileId(created.base, blobPath.slice('files/'.length))
      )
      expect(keys.filter((row) => createdIds.includes(row.resourceId))).toHaveLength(9)
      expect(keys.find((row) => row.key === 'data-csv-9')?.resourceId).toBe(holder.id)
    }
  )

  check(
    'a file create whose key claim fails leaves no file behind, so applying again creates and keys it',
    async () => {
      const workspaceId = await newWorkspace()
      const files = { 'files/claim-crash.pdf': Buffer.from('%PDF-1.4 a claim') }
      const restore = await failKeyClaims('claim-crash-pdf')
      const crashed = await apply(workspaceId, files).finally(restore)

      expect(crashed.failed).toMatchObject({ kind: 'file', key: 'claim-crash.pdf' })
      expect(await storedFiles(workspaceId)).toEqual([])

      const again = await apply(workspaceId, files)
      expect(again.failed).toBeUndefined()
      const [binding] = await db
        .select({ resourceId: workspaceResourceKey.resourceId })
        .from(workspaceResourceKey)
        .where(
          and(
            eq(workspaceResourceKey.workspaceId, workspaceId),
            eq(workspaceResourceKey.kind, 'file'),
            eq(workspaceResourceKey.key, 'claim-crash-pdf')
          )
        )
      expect(binding?.resourceId).toBe(fileId(again.base, 'claim-crash.pdf'))
    }
  )

  check(
    'a declared file the server can no longer hand to source since the get refuses only a directory that changes it',
    async () => {
      const workspaceId = await newWorkspace()
      const twin = await uploadInUi(workspaceId, 'archive', 'Notes.txt', 'an older file')
      const read = await setUp(workspaceId)
      const dir = await downloaded(workspaceId, read)
      const notesId = fileId(read.base, 'notes.txt')
      const planId = fileId(read.base, 'docs/plan.md')
      // The older file moved beside notes.txt in the Files tab (a case-insensitive disk merges
      // them, and the older one keeps the path), and plan.md edited past the blob cap.
      await moveWorkspaceFileItemsOperation.execute({
        principal: owner,
        input: { workspaceId, fileIds: [twin.id], targetFolderId: null },
      })
      await contentUseCases.updateWorkspaceFileContentFromBuffer.execute({
        principal: owner,
        input: {
          fileId: planId,
          assertedWorkspaceId: workspaceId,
          content: Buffer.alloc(WORKSPACE_SOURCE_LIMITS.maxBlobBytes + 1, 'p'),
        },
      })
      const before = await storedFiles(workspaceId)

      const planned = await apply(workspaceId, dir, { base: read.base, dryRun: true })
      expect(codes(planned.diagnostics)).toEqual([])
      const unchanged = await apply(workspaceId, dir, { base: read.base })

      expect(
        unchanged.diagnostics
          .filter((finding) => finding.code === 'W_SERVER_CHANGED')
          .map((finding) => `${finding.code} ${finding.key}`)
          .sort()
      ).toEqual(['W_SERVER_CHANGED docs/plan.md', 'W_SERVER_CHANGED notes.txt'])
      expect(unchanged.applied).toEqual([])
      expect(await storedFiles(workspaceId)).toEqual(before)

      const edited = await refusal(
        apply(
          workspaceId,
          {
            ...dir,
            'files/notes.txt': Buffer.from('edited'),
            'files/docs/plan.md': Buffer.from('edited'),
          },
          { base: read.base }
        )
      )
      expect(codes(edited.diagnostics).sort()).toEqual([
        'E_FILE_PATH_COLLISION',
        'E_FILE_TOO_LARGE',
      ])
      expect(await storedFiles(workspaceId)).toEqual(before)
      expect([notesId, planId, twin.id].every((id) => before.some((file) => file.id === id))).toBe(
        true
      )
    }
  )
})
