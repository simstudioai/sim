import { mkdtempSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { db, runOutsideTransactionContext } from '@sim/db'
import {
  folder,
  member,
  organization,
  permissions,
  project,
  projectWorkspace,
  user,
  workspace,
  workspaceFileSearchBuild,
  workspaceFileSearchChunk,
  workspaceFileSearchRevision,
  workspaceFiles,
} from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { setUploadDirServer, uploadsSetupMock } from '@sim/testing/mocks/uploads-setup.mock'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { Document, Packer, Paragraph } from 'docx'
import { eq, inArray, sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/uploads/core/setup.server', () => uploadsSetupMock)

import { getFileContentProvenance } from '@/lib/internal/file/operations'
import { lockProject } from '@/lib/projects/membership'
import { listFileFolders } from '@/lib/uploads/contexts/workspace/workspace-file-folder-manager'
import { uploadWorkspaceFile } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { storeCompiledDoc } from '@/lib/uploads/documents/compiled-store'
import { fileDocumentInputIdentity } from '@/lib/uploads/documents/input-identity'
import { searchWorkspaceFileContent } from '@/lib/workspace-files/application/search-workspace-file-content'
import { resolveFileSearchFolderScope } from '@/lib/workspace-files/search/delivery'
import {
  appendFileSearchChunks,
  beginFileSearchBuild,
  publishFileSearchBuild,
} from '@/lib/workspace-files/search/index-state'
import { indexWorkspaceFileForSearch } from '@/lib/workspace-files/search/indexing'
import { compileFileSearchPattern } from '@/lib/workspace-files/search/pattern'
import { searchFileIndex } from '@/lib/workspace-files/search/repository'

const storageRoot = mkdtempSync(join(tmpdir(), 'sim-file-owner-search-'))
setUploadDirServer(storageRoot)
const fixtures: {
  ownerId: string
  readerId: string
  organizationId: string
  workspaceId: string
  projectId: string
}[] = []
const checks: { name: string; status: 'passed' | 'failed'; durationMs: number; error?: string }[] =
  []
const signal = new AbortController().signal

beforeEach(() => {
  vi.stubEnv('FREE_STORAGE_LIMIT_GB', '')
})

function check(name: string, run: () => Promise<void>) {
  it(name, async () => {
    const started = performance.now()
    try {
      await run()
      checks.push({ name, status: 'passed', durationMs: performance.now() - started })
    } catch (error) {
      checks.push({
        name,
        status: 'failed',
        durationMs: performance.now() - started,
        error: getErrorMessage(error),
      })
      throw error
    }
  })
}

async function fixture() {
  const ownerId = generateId()
  const readerId = generateId()
  const organizationId = generateId()
  const workspaceId = generateId()
  await db.insert(user).values(
    [ownerId, readerId].map((id) => ({
      id,
      email: `${id}@search.invalid`,
      name: 'Search fixture',
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }))
  )
  await db
    .insert(organization)
    .values({ id: organizationId, name: 'Search', slug: organizationId, createdAt: new Date() })
  await db.insert(member).values(
    [ownerId, readerId].map((userId) => ({
      id: generateId(),
      organizationId,
      userId,
      role: userId === ownerId ? 'owner' : 'member',
      createdAt: new Date(),
    }))
  )
  await insertWorkspaceFixture(db, {
    id: workspaceId,
    ownerId,
    billedAccountUserId: ownerId,
    organizationId,
    workspaceMode: 'organization',
    name: 'Search environment',
  })
  const [binding] = await db
    .select()
    .from(projectWorkspace)
    .where(eq(projectWorkspace.workspaceId, workspaceId))
  if (!binding) throw new Error('Missing Project binding')
  await db.insert(permissions).values({
    id: generateId(),
    userId: readerId,
    entityType: 'workspace',
    entityId: workspaceId,
    permissionType: 'read',
  })
  const ids = { ownerId, readerId, organizationId, workspaceId, projectId: binding.projectId }
  fixtures.push(ids)
  return {
    ...ids,
    principal: createSessionPrincipal({ userId: ownerId }),
    reader: createSessionPrincipal({ userId: readerId }),
    owner: { entityType: 'project' as const, entityId: binding.projectId },
  }
}

async function create(
  f: Awaited<ReturnType<typeof fixture>>,
  content: string,
  options: { name?: string; folderId?: string } = {}
) {
  const id = generateId()
  const name = options.name ?? 'architecture.md'
  const key = `project/${f.projectId}/${id}/${name}`
  await mkdir(dirname(join(storageRoot, key)), { recursive: true })
  await writeFile(join(storageRoot, key), content)
  const [file] = await db
    .insert(workspaceFiles)
    .values({
      id,
      userId: f.ownerId,
      projectId: f.projectId,
      context: 'project',
      key,
      originalName: name,
      contentType: 'text/plain',
      sizeBytes: Buffer.byteLength(content),
      folderId: options.folderId,
    })
    .returning()
  if (!file) throw new Error('Search source fixture missing')
  return { file }
}

async function claim(fileId: string) {
  const token = new Date()
  const [row] = await db
    .update(workspaceFileSearchRevision)
    .set({ dispatchedAt: token })
    .where(eq(workspaceFileSearchRevision.fileId, fileId))
    .returning()
  if (!row) throw new Error('File trigger did not enqueue the search revision')
  return {
    fileId,
    sourceContentUpdatedAt: row.sourceContentUpdatedAt.toISOString(),
    dispatchToken: token.toISOString(),
  }
}

async function changeFile(fileId: string, content: string) {
  const [old] = await db.select().from(workspaceFiles).where(eq(workspaceFiles.id, fileId))
  if (!old) throw new Error('Search source fixture missing')
  const key = `project/${old.projectId}/${generateId()}/${old.originalName}`
  await mkdir(dirname(join(storageRoot, key)), { recursive: true })
  await writeFile(join(storageRoot, key), content)
  await db
    .update(workspaceFiles)
    .set({
      key,
      sizeBytes: Buffer.byteLength(content),
      contentUpdatedAt: new Date(old.contentUpdatedAt.getTime() + 1_000),
    })
    .where(eq(workspaceFiles.id, fileId))
}

async function createFolder(
  f: Awaited<ReturnType<typeof fixture>>,
  name: string,
  parentId?: string
) {
  const [record] = await db
    .insert(folder)
    .values({
      id: generateId(),
      resourceType: 'file',
      projectId: f.projectId,
      userId: f.ownerId,
      name,
      parentId,
    })
    .returning()
  if (!record) throw new Error('Search folder fixture missing')
  return { folder: record }
}

async function search(
  f: Awaited<ReturnType<typeof fixture>>,
  query: string,
  options: { folderPaths?: string[]; includeSubfolders?: boolean } = {}
) {
  const folders = await listFileFolders(f.owner)
  return searchFileIndex({
    owner: f.owner,
    pattern: compileFileSearchPattern(query, 'exact'),
    maxResults: 100,
    folderScope: resolveFileSearchFolderScope(folders, options),
    signal,
  })
}

describe('owner-scoped indexed file search on PostgreSQL and stored bytes', () => {
  check(
    'fences duplicate legacy and owner-aware workspace workers to one published build',
    async () => {
      const f = await fixture()
      const file = await uploadWorkspaceFile(
        f.workspaceId,
        f.ownerId,
        Buffer.from('duplicateneedle'),
        'duplicate.txt',
        'text/plain',
        { notifyWorkspaceChange: false }
      )
      const claimed = await claim(file.id)
      const identity = {
        fileId: file.id,
        sourceContentUpdatedAt: new Date(claimed.sourceContentUpdatedAt),
      }
      const builds = await Promise.all([
        beginFileSearchBuild({ workspaceId: f.workspaceId, ...identity }, claimed.dispatchToken),
        beginFileSearchBuild(
          { owner: { entityType: 'workspace', entityId: f.workspaceId }, ...identity },
          claimed.dispatchToken
        ),
      ])
      expect(builds.filter(Boolean)).toHaveLength(2)
      const outcomes = []
      for (const build of builds) {
        if (!build) throw new Error('Both compatible workers must resolve the canonical revision')
        await appendFileSearchChunks(
          build,
          [{ ordinal: 0, lineStart: 1, fragment: false, overlap: 0, content: 'duplicateneedle' }],
          signal
        )
        outcomes.push(
          await publishFileSearchBuild(
            build,
            { status: 'ready', lineCount: 1, indexedBytes: 15, chunkCount: 1 },
            signal
          )
        )
      }
      expect(outcomes.filter(Boolean)).toHaveLength(1)
      const result = await searchWorkspaceFileContent.execute({
        principal: f.reader,
        input: {
          workspaceId: f.workspaceId,
          query: 'duplicateneedle',
          mode: 'exact',
          maxResults: 100,
        },
      })
      expect(result.results.map((hit) => hit.fileId)).toEqual([file.id])
    }
  )

  check('queues canonical Project revisions and isolates workspace and Project text', async () => {
    const f = await fixture()
    const projectFile = await create(f, 'projectneedle owner-isolated')
    const workspaceFile = await uploadWorkspaceFile(
      f.workspaceId,
      f.ownerId,
      Buffer.from('workspaceneedle owner-isolated'),
      'architecture.md',
      'text/plain',
      { notifyWorkspaceChange: false }
    )
    const projectClaim = await claim(projectFile.file.id)
    const queue = await db.execute<{ entity_type: string; entity_id: string }>(
      sql`SELECT entity_type, entity_id FROM file_search_dispatch_queue WHERE entity_type = 'project' AND entity_id = ${f.projectId}`
    )
    expect(queue).toHaveLength(1)
    await indexWorkspaceFileForSearch({ owner: f.owner, ...projectClaim }, signal)
    await indexWorkspaceFileForSearch(
      { workspaceId: f.workspaceId, ...(await claim(workspaceFile.id)) },
      signal
    )
    expect((await search(f, 'owner-isolated')).results.map((hit) => hit.fileId)).toEqual([
      projectFile.file.id,
    ])
    expect((await search(f, 'workspaceneedle')).results).toEqual([])
    const legacy = await searchWorkspaceFileContent.execute({
      principal: f.reader,
      input: {
        workspaceId: f.workspaceId,
        query: 'owner-isolated',
        mode: 'exact',
        maxResults: 100,
      },
    })
    expect(legacy.results.map((hit) => hit.fileId)).toEqual([workspaceFile.id])
  })

  check(
    'fences an old Project build and dispatch token after a content revision changes',
    async () => {
      const f = await fixture()
      const created = await create(f, 'supersededneedle')
      const claimed = await claim(created.file.id)
      const revision = {
        owner: f.owner,
        fileId: created.file.id,
        sourceContentUpdatedAt: new Date(claimed.sourceContentUpdatedAt),
      }
      const build = await beginFileSearchBuild(revision, claimed.dispatchToken)
      if (!build) throw new Error('Current Project build was not admitted')
      await appendFileSearchChunks(
        build,
        [{ ordinal: 0, lineStart: 1, fragment: false, overlap: 0, content: 'supersededneedle' }],
        signal
      )
      await changeFile(created.file.id, 'currentneedle')
      expect(
        await publishFileSearchBuild(
          build,
          { status: 'ready', lineCount: 1, indexedBytes: 16, chunkCount: 1 },
          signal
        )
      ).toBe(false)
      await indexWorkspaceFileForSearch({ owner: f.owner, ...claimed }, signal)
      await indexWorkspaceFileForSearch(
        { owner: f.owner, ...(await claim(created.file.id)) },
        signal
      )
      expect((await search(f, 'supersededneedle')).results).toEqual([])
      expect((await search(f, 'currentneedle')).results.map((hit) => hit.fileId)).toEqual([
        created.file.id,
      ])
    }
  )

  check('keeps empty and recursive folder scopes exact after the creator is detached', async () => {
    const f = await fixture()
    const folder = await createFolder(f, 'Architecture')
    const child = await createFolder(f, 'Backend', folder.folder.id)
    const created = await create(f, 'folderneedle', { folderId: child.folder.id })
    await db
      .update(workspaceFiles)
      .set({ userId: null })
      .where(eq(workspaceFiles.id, created.file.id))
    await indexWorkspaceFileForSearch({ owner: f.owner, ...(await claim(created.file.id)) }, signal)
    expect((await search(f, 'folderneedle', { folderPaths: [] })).results).toEqual([])
    expect(
      (
        await search(f, 'folderneedle', {
          folderPaths: ['/Architecture'],
          includeSubfolders: false,
        })
      ).results
    ).toEqual([])
    expect(
      (await search(f, 'folderneedle', { folderPaths: ['/Architecture'] })).results.map(
        (hit) => hit.fileId
      )
    ).toEqual([created.file.id])
  })

  check('rejects forged owner payloads without changing the current revision', async () => {
    const f = await fixture()
    const created = await create(f, 'boundedneedle')
    const claimed = await claim(created.file.id)
    await expect(
      indexWorkspaceFileForSearch(
        { owner: { entityType: 'organization', entityId: f.organizationId }, ...claimed },
        signal
      )
    ).rejects.toThrow()
    await expect(
      indexWorkspaceFileForSearch(
        { owner: f.owner, workspaceId: f.workspaceId, ...claimed },
        signal
      )
    ).rejects.toThrow()
    const [revision] = await db
      .select()
      .from(workspaceFileSearchRevision)
      .where(eq(workspaceFileSearchRevision.fileId, created.file.id))
    expect(revision.status).toBe('pending')
    expect(revision.buildId).toBeNull()
  })

  check(
    'reads only an owner and dependency-bound cached artifact without executing source',
    async () => {
      const f = await fixture()
      const dependency = await create(f, 'artifact dependency', { name: 'input.txt' })
      const source = `getFileBase64('${dependency.file.id}')`
      const generated = await create(f, source, { name: 'report.docx' })
      const [dependencyRow] = await db
        .select()
        .from(workspaceFiles)
        .where(eq(workspaceFiles.id, dependency.file.id))
      const artifact = Buffer.from('PK\u0003\u0004cached office bytes')
      await storeCompiledDoc(
        f.owner,
        source,
        'docx',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        artifact,
        fileDocumentInputIdentity(f.owner, [dependencyRow])
      )
      const { loadFileSearchSource } = await import('@/lib/workspace-files/search/source')
      const revision = {
        owner: f.owner,
        fileId: generated.file.id,
        sourceContentUpdatedAt: generated.file.contentUpdatedAt,
      }
      const loaded = await loadFileSearchSource(revision, signal)
      expect(loaded?.bytes.buffer).toEqual(artifact)
      expect(loaded?.bytes.kind).toBe('artifact')
      expect(loaded?.dependencies.map((row) => row.fileId)).toEqual([dependency.file.id])
      await changeFile(dependency.file.id, 'new input')
      const changed = await loadFileSearchSource(revision, signal)
      expect(changed?.bytes.kind).toBe('source')
      expect(changed?.bytes.buffer.toString()).toBe(source)
    }
  )

  check(
    'refuses publication after a generated input changes without a parent source edit',
    async () => {
      const f = await fixture()
      const dependency = await create(f, 'before', { name: 'dependency.md' })
      const created = await create(f, 'generated source', { name: 'derived.docx' })
      const claimed = await claim(created.file.id)
      const build = await beginFileSearchBuild(
        {
          owner: f.owner,
          fileId: created.file.id,
          sourceContentUpdatedAt: new Date(claimed.sourceContentUpdatedAt),
        },
        claimed.dispatchToken
      )
      if (!build) throw new Error('Current Project build was not admitted')
      await appendFileSearchChunks(
        build,
        [{ ordinal: 0, lineStart: 1, fragment: false, overlap: 0, content: 'old dependency text' }],
        signal
      )
      const dependencies = [
        {
          fileId: dependency.file.id,
          key: dependency.file.key,
          sourceContentUpdatedAt: dependency.file.contentUpdatedAt,
        },
      ]
      await changeFile(dependency.file.id, 'after')
      expect(
        await publishFileSearchBuild(
          build,
          { status: 'ready', lineCount: 1, indexedBytes: 19, chunkCount: 1, dependencies },
          signal
        )
      ).toBe(false)
      expect((await search(f, 'old dependency')).results).toEqual([])
    }
  )

  check('retains workspace generated-input provenance in indexed snippet delivery', async () => {
    const f = await fixture()
    const ciphertext = 'fixture-encrypted-generated-input'
    const dependency = await uploadWorkspaceFile(
      f.workspaceId,
      f.ownerId,
      Buffer.from('input'),
      'secret-input.txt',
      'text/plain',
      {
        notifyWorkspaceChange: false,
        secretProvenance: {
          status: 'exact',
          entries: [
            {
              encryptedValue: ciphertext,
              sourceUserId: f.ownerId,
              sourceWorkspaceId: f.workspaceId,
            },
          ],
        },
      }
    )
    const source = `getFileBase64('${dependency.id}')`
    const generated = await uploadWorkspaceFile(
      f.workspaceId,
      f.ownerId,
      Buffer.from(source),
      'derived.docx',
      'text/plain',
      { notifyWorkspaceChange: false, secretProvenance: { status: 'exact', entries: [] } }
    )
    const [dependencyRow] = await db
      .select()
      .from(workspaceFiles)
      .where(eq(workspaceFiles.id, dependency.id))
    const owner = { entityType: 'workspace' as const, entityId: f.workspaceId }
    const artifact = await Packer.toBuffer(
      new Document({ sections: [{ children: [new Paragraph('derivedsnippetneedle')] }] })
    )
    await storeCompiledDoc(
      owner,
      source,
      'docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      artifact,
      fileDocumentInputIdentity(owner, [dependencyRow])
    )
    await indexWorkspaceFileForSearch({ owner, ...(await claim(generated.id)) }, signal)
    const found = await searchWorkspaceFileContent.execute({
      principal: f.principal,
      input: {
        workspaceId: f.workspaceId,
        query: 'derivedsnippetneedle',
        mode: 'exact',
        maxResults: 100,
      },
    })
    expect(found.results.map((hit) => hit.fileId)).toEqual([generated.id])
    const provenance = await getFileContentProvenance(
      f.principal,
      f.workspaceId,
      found.sources,
      signal
    )
    expect(provenance.complete).toBe(true)
    expect(provenance.entries).toContainEqual({ encryptedValue: ciphertext })
  })

  check(
    'ignores stale artifact completion without invalidating a newer ready revision',
    async () => {
      const f = await fixture()
      const dependency = await create(f, 'before', { name: 'input.txt' })
      const source = `getFileBase64('${dependency.file.id}')`
      const generated = await create(f, source, { name: 'race.docx' })
      const [dependencyRow] = await db
        .select()
        .from(workspaceFiles)
        .where(eq(workspaceFiles.id, dependency.file.id))
      const artifactKeys: string[] = []
      await storeCompiledDoc(
        f.owner,
        source,
        'docx',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        await Packer.toBuffer(
          new Document({ sections: [{ children: [new Paragraph('oldrender')] }] })
        ),
        fileDocumentInputIdentity(f.owner, [dependencyRow]),
        (key) => artifactKeys.push(key)
      )
      const artifactKey = artifactKeys.find((key) => key.endsWith('.docx'))
      if (!artifactKey) throw new Error('Artifact was not stored')
      const completion = {
        owner: f.owner,
        file: {
          fileId: generated.file.id,
          key: generated.file.key,
          contentUpdatedAt: generated.file.contentUpdatedAt,
        },
        dependencies: [
          {
            fileId: dependency.file.id,
            key: dependency.file.key,
            sourceContentUpdatedAt: dependency.file.contentUpdatedAt,
          },
        ],
        artifactKey,
      }
      await changeFile(generated.file.id, 'newrevisionneedle')
      await indexWorkspaceFileForSearch(
        { owner: f.owner, ...(await claim(generated.file.id)) },
        signal
      )
      const [ready] = await db
        .select()
        .from(workspaceFileSearchRevision)
        .where(eq(workspaceFileSearchRevision.fileId, generated.file.id))
      const { markFileSearchArtifactReadyInTx } = await import(
        '@/lib/workspace-files/search/artifact-ready'
      )
      expect(await db.transaction((tx) => markFileSearchArtifactReadyInTx(tx, completion))).toBe(
        false
      )
      const [unchanged] = await db
        .select()
        .from(workspaceFileSearchRevision)
        .where(eq(workspaceFileSearchRevision.fileId, generated.file.id))
      expect(unchanged.status).toBe('ready')
      expect(unchanged.buildId).toBe(ready.buildId)
      expect((await search(f, 'newrevisionneedle')).count).toBe(1)
    }
  )
  check(
    'fences an artifact completion queued behind a concurrent dependency revision',
    async () => {
      const f = await fixture()
      const dependency = await create(f, 'before', { name: 'concurrent-input.txt' })
      const source = `getFileBase64('${dependency.file.id}')`
      const generated = await create(f, source, { name: 'concurrent.docx' })
      await indexWorkspaceFileForSearch(
        { owner: f.owner, ...(await claim(generated.file.id)) },
        signal
      )
      const [ready] = await db
        .select()
        .from(workspaceFileSearchRevision)
        .where(eq(workspaceFileSearchRevision.fileId, generated.file.id))
      const [dependencyRow] = await db
        .select()
        .from(workspaceFiles)
        .where(eq(workspaceFiles.id, dependency.file.id))
      const artifactKeys: string[] = []
      await storeCompiledDoc(
        f.owner,
        source,
        'docx',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        await Packer.toBuffer(
          new Document({ sections: [{ children: [new Paragraph('old-contributor')] }] })
        ),
        fileDocumentInputIdentity(f.owner, [dependencyRow]),
        (key) => artifactKeys.push(key)
      )
      const artifactKey = artifactKeys.find((key) => key.endsWith('.docx'))
      if (!artifactKey) throw new Error('Artifact was not stored')
      const { markFileSearchArtifactReadyInTx } = await import(
        '@/lib/workspace-files/search/artifact-ready'
      )
      let completion: Promise<boolean> | undefined
      let completionPid: number | undefined
      let completionError: unknown
      await db.transaction(async (tx) => {
        await tx
          .select({ id: workspaceFiles.id })
          .from(workspaceFiles)
          .where(eq(workspaceFiles.id, dependency.file.id))
          .for('update')
        completion = runOutsideTransactionContext(() =>
          db.transaction(async (pendingTx) => {
            const [backend] = await pendingTx.execute<{ pid: number }>(
              sql`SELECT pg_backend_pid() AS pid`
            )
            completionPid = backend.pid
            return markFileSearchArtifactReadyInTx(pendingTx, {
              owner: f.owner,
              file: {
                fileId: generated.file.id,
                key: generated.file.key,
                contentUpdatedAt: generated.file.contentUpdatedAt,
              },
              dependencies: [
                {
                  fileId: dependency.file.id,
                  key: dependency.file.key,
                  sourceContentUpdatedAt: dependency.file.contentUpdatedAt,
                },
              ],
              artifactKey,
            })
          })
        )
        void completion.catch((error: unknown) => {
          completionError = error
        })
        let waited = false
        const deadline = Date.now() + 2_000
        while (Date.now() < deadline) {
          if (completionError) throw completionError
          if (completionPid !== undefined) {
            const [activity] = await tx.execute<{ waiting: boolean }>(
              sql`SELECT wait_event_type = 'Lock' AS waiting FROM pg_stat_activity WHERE pid = ${completionPid}`
            )
            if (activity?.waiting) {
              waited = true
              break
            }
          }
          await sleep(10)
        }
        expect(waited).toBe(true)
        await tx
          .update(workspaceFiles)
          .set({ contentUpdatedAt: new Date(dependency.file.contentUpdatedAt.getTime() + 1_000) })
          .where(eq(workspaceFiles.id, dependency.file.id))
      })
      expect(await completion).toBe(false)
      const [unchanged] = await db
        .select()
        .from(workspaceFileSearchRevision)
        .where(eq(workspaceFileSearchRevision.fileId, generated.file.id))
      expect(unchanged.buildId).toBe(ready.buildId)
      expect((await search(f, source)).results).toEqual([])
    }
  )
  check('waits at Project authority before taking file locks for a background build', async () => {
    const f = await fixture()
    const generated = await create(f, 'authority-order-needle')
    const claimed = await claim(generated.file.id)
    let building: ReturnType<typeof beginFileSearchBuild> | undefined
    try {
      await db.transaction(async (tx) => {
        const [backend] = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)
        await lockProject(tx, f.projectId)
        await tx
          .select({ id: workspaceFiles.id })
          .from(workspaceFiles)
          .where(eq(workspaceFiles.id, generated.file.id))
          .for('share')
        building = runOutsideTransactionContext(() =>
          beginFileSearchBuild(
            {
              owner: f.owner,
              fileId: generated.file.id,
              sourceContentUpdatedAt: new Date(claimed.sourceContentUpdatedAt),
            },
            claimed.dispatchToken
          )
        )
        void building.catch(() => {})
        let event: string | undefined
        const deadline = Date.now() + 2_000
        while (Date.now() < deadline) {
          const [blocked] = await tx.execute<{
            event: string
          }>(sql`SELECT wait_event AS event FROM pg_stat_activity
            WHERE ${backend.pid} = ANY(pg_blocking_pids(pid)) AND wait_event_type = 'Lock'`)
          if (blocked) {
            event = blocked.event
            break
          }
          await sleep(10)
        }
        expect(event).toBe('advisory')
      })
    } finally {
      await building
    }
  })
})

afterAll(async () => {
  const report = process.env.FILE_OWNER_SEARCH_REPORT_PATH
  if (report) {
    await mkdir(dirname(report), { recursive: true })
    await writeFile(report, JSON.stringify({ checks }, null, 2))
  }
  const fileIds = (
    await db
      .select({ id: workspaceFiles.id })
      .from(workspaceFiles)
      .where(
        inArray(
          workspaceFiles.projectId,
          fixtures.flatMap((f) => [f.projectId, f.workspaceId])
        )
      )
  ).map((row) => row.id)
  if (fileIds.length) {
    const builds = await db
      .select({ id: workspaceFileSearchBuild.id })
      .from(workspaceFileSearchBuild)
      .where(inArray(workspaceFileSearchBuild.fileId, fileIds))
    await db.delete(workspaceFiles).where(inArray(workspaceFiles.id, fileIds))
    if (builds.length) {
      await db.delete(workspaceFileSearchChunk).where(
        inArray(
          workspaceFileSearchChunk.buildId,
          builds.map((row) => row.id)
        )
      )
      await db.delete(workspaceFileSearchBuild).where(
        inArray(
          workspaceFileSearchBuild.id,
          builds.map((row) => row.id)
        )
      )
    }
  }
  for (const f of fixtures) {
    await db.delete(folder).where(eq(folder.projectId, f.projectId))
    await deleteWorkspaceFixture(db, eq(workspace.id, f.workspaceId))
    await db.delete(project).where(eq(project.id, f.projectId))
    await db.delete(organization).where(eq(organization.id, f.organizationId))
    await db.delete(user).where(inArray(user.id, [f.ownerId, f.readerId]))
  }
  await rm(storageRoot, { recursive: true, force: true })
  await db.$client.end()
})
