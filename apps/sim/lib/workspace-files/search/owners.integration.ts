import { mkdtempSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { db, runOutsideTransactionContext } from '@sim/db'
import {
  changelogRelease,
  fileSearchDispatchQueue,
  folder,
  member,
  organization,
  permissions,
  project,
  user,
  workflowTest,
  workspace,
  workspaceFileSearchBuild,
  workspaceFileSearchChunk,
  workspaceFileSearchRevision,
  workspaceFiles,
} from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import {
  createExecutorPrincipal,
  createSessionPrincipal,
  createWorkspaceApiKeyPrincipal,
} from '@sim/testing/factories/principal.factory'
import { createDeferred } from '@sim/testing/helpers/deferred'
import { envFlagsMock, setEnvFlags } from '@sim/testing/mocks/env-flags.mock'
import { featureFlagsMock, featureFlagsMockFns } from '@sim/testing/mocks/feature-flags.mock'
import { setUploadDirServer, uploadsSetupMock } from '@sim/testing/mocks/uploads-setup.mock'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { Document, Packer, Paragraph } from 'docx'
import { and, eq, inArray, or, sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/uploads/core/setup.server', () => uploadsSetupMock)
vi.mock('@/lib/core/config/feature-flags', () => featureFlagsMock)
vi.mock('@/lib/core/config/env-flags', () => envFlagsMock)

import { removeUserFromOrganization } from '@/lib/billing/organizations/membership'
import { getFileContentProvenance } from '@/lib/internal/file/operations'
import { readProjectFileArtifact } from '@/lib/projects/files/application/artifacts'
import {
  createProjectFile,
  updateProjectFileContent,
} from '@/lib/projects/files/application/content'
import { createProjectFileFolder } from '@/lib/projects/files/application/folders'
import { lockProject } from '@/lib/projects/membership'
import {
  createOwnedWorkspaceFile,
  uploadWorkspaceFile,
} from '@/lib/uploads/contexts/workspace/file-manager'
import { fileDocumentCacheIdentity, getE2BDocFormat } from '@/lib/uploads/documents/compile'
import { compiledArtifactKey, storeCompiledDoc } from '@/lib/uploads/documents/compiled-store'
import { fileDocumentInputIdentity } from '@/lib/uploads/documents/input-identity'
import { deleteUserAccount } from '@/lib/users/account-deletion'
import { fetchAuthorizedServableWorkspaceFileBuffer } from '@/lib/workspace-files/application/fetch-servable-workspace-file-buffer'
import { observeWorkspaceFileDelivery } from '@/lib/workspace-files/application/file-delivery-observer'
import { searchWorkspaceFileContent } from '@/lib/workspace-files/application/search-workspace-file-content'
import { prepareWorkspaceFileSearchDispatch } from '@/lib/workspace-files/search/dispatcher'
import {
  appendFileSearchChunks,
  beginFileSearchBuild,
  publishFileSearchBuild,
} from '@/lib/workspace-files/search/index-state'
import {
  indexWorkspaceFileForSearch,
  markWorkspaceFileSearchIndexFailed,
} from '@/lib/workspace-files/search/indexing'

async function requireDocxFormat() {
  const format = await getE2BDocFormat('report.docx')
  if (!format) throw new Error('DOCX rendering format is required for this fixture')
  return format
}

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
  featureFlagsMockFns.mockIsFeatureEnabled.mockReset()
  featureFlagsMockFns.mockIsFeatureEnabled.mockImplementation(async (flag) => flag === 'projects')
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
  const [binding] = await db.select().from(workspace).where(eq(workspace.id, workspaceId))
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
  return createProjectFile.execute({
    principal: f.principal,
    input: {
      projectId: f.projectId,
      name: options.name ?? 'architecture.md',
      contentType: 'text/plain',
      content,
      encoding: 'utf-8',
      exactName: true,
      ...(options.folderId ? { folderId: options.folderId } : {}),
    },
  })
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

async function search(
  f: Awaited<ReturnType<typeof fixture>>,
  query: string,
  options: { folderPaths?: string[]; includeSubfolders?: boolean } = {}
) {
  const { searchProjectFileContent } = await import('@/lib/projects/files/application/search')
  return searchProjectFileContent.execute({
    principal: f.reader,
    input: { projectId: f.projectId, query, mode: 'exact', maxResults: 100, ...options },
  })
}

describe('owner-scoped indexed file search on PostgreSQL and stored bytes', () => {
  for (const context of ['test', 'changelog'] as const) {
    check(
      `indexes a generated document with a live ${context} input and preserves input access`,
      async () => {
        const f = await fixture()
        featureFlagsMockFns.mockIsFeatureEnabled.mockResolvedValue(true)
        const body = await createOwnedWorkspaceFile({
          context,
          workspaceId: f.workspaceId,
          userId: f.ownerId,
          content: 'owned body',
          contentType: 'text/plain',
          fileName: (id) => `${id}.txt`,
          insertOwner: async (tx, bodyFileId) => {
            if (context === 'test')
              await tx.insert(workflowTest).values({
                id: generateId(),
                workspaceId: f.workspaceId,
                name: generateId(),
                title: 'Search input',
                bodyFileId,
                sourceHash: 'fixture',
              })
            else
              await tx.insert(changelogRelease).values({
                id: generateId(),
                workspaceId: f.workspaceId,
                title: 'Search input',
                bodyFileId,
                versionMajor: 1,
                versionMinor: 0,
                versionPatch: 0,
                bumpReason: 'fixture',
              })
          },
        })
        const source = `getFileBase64('${body.fileId}')`
        const generated = await uploadWorkspaceFile(
          f.workspaceId,
          f.ownerId,
          Buffer.from(source),
          'owned-input.docx',
          'text/plain',
          { notifyWorkspaceChange: false }
        )
        const [inputRow] = await db
          .select()
          .from(workspaceFiles)
          .where(eq(workspaceFiles.id, body.fileId))
        const owner = { entityType: 'workspace' as const, entityId: f.workspaceId }
        const artifact = await Packer.toBuffer(
          new Document({ sections: [{ children: [new Paragraph('ownedinputneedle')] }] })
        )
        await storeCompiledDoc(
          owner,
          source,
          'docx',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          artifact,
          JSON.stringify({
            version: 1,
            inputs: [
              {
                fileId: body.fileId,
                key: inputRow.key,
                context: 'workspace',
                contentVersion: inputRow.contentUpdatedAt.toISOString(),
                size: inputRow.sizeBytes,
              },
            ],
          })
        )
        setEnvFlags({ isDocSandboxEnabled: true })
        const served = await fetchAuthorizedServableWorkspaceFileBuffer(generated, f.principal, {
          maxBytes: 1024 * 1024,
        })
        expect(served.buffer).toEqual(artifact)
        expect(served.contributingFiles?.map((file) => file.context)).toEqual([context])
        const extraction = await import('@/lib/workspace-files/search/extract')
        const extract = extraction.extractIndexText
        const entered = createDeferred<void>()
        const release = createDeferred<void>()
        const pause = vi
          .spyOn(extraction, 'extractIndexText')
          .mockImplementationOnce(async (...args) => {
            entered.resolve()
            await release.promise
            return extract(...args)
          })
        const indexing = indexWorkspaceFileForSearch(
          { owner, ...(await claim(generated.id)) },
          signal
        )
        await entered.promise
        try {
          for (let repeat = 0; repeat < 2; repeat++) {
            const cached = await fetchAuthorizedServableWorkspaceFileBuffer(
              generated,
              f.principal,
              {
                maxBytes: 1024 * 1024,
              }
            )
            expect(cached.buffer).toEqual(artifact)
          }
        } finally {
          release.resolve()
          await indexing
          pause.mockRestore()
        }
        const read = () =>
          searchWorkspaceFileContent.execute({
            principal: f.principal,
            input: {
              workspaceId: f.workspaceId,
              query: 'ownedinputneedle',
              mode: 'exact',
              maxResults: 100,
            },
          })
        const result = await read()
        expect(result.results.map((hit) => hit.fileId)).toEqual([generated.id])
        expect(
          result.sources.find((entry) => entry.identity.fileId === body.fileId)?.identity.context
        ).toBe(context)
        await expect(
          searchWorkspaceFileContent.execute({
            principal: createWorkspaceApiKeyPrincipal({ workspaceId: f.workspaceId }),
            input: {
              workspaceId: f.workspaceId,
              query: 'ownedinputneedle',
              mode: 'exact',
              maxResults: 100,
            },
          })
        ).rejects.toMatchObject({ code: 'not_found' })
        featureFlagsMockFns.mockIsFeatureEnabled.mockResolvedValue(false)
        await expect(read()).rejects.toMatchObject({ code: 'forbidden' })
        featureFlagsMockFns.mockIsFeatureEnabled.mockResolvedValue(true)
        await db
          .delete(fileSearchDispatchQueue)
          .where(
            and(
              eq(fileSearchDispatchQueue.entityType, 'workspace'),
              eq(fileSearchDispatchQueue.entityId, f.workspaceId)
            )
          )
        await db
          .update(workspaceFiles)
          .set({ contentUpdatedAt: new Date(inputRow.contentUpdatedAt.getTime() + 1000) })
          .where(eq(workspaceFiles.id, body.fileId))
        expect((await read()).results).toEqual([])
        expect(
          await db
            .select()
            .from(fileSearchDispatchQueue)
            .where(
              and(
                eq(fileSearchDispatchQueue.entityType, 'workspace'),
                eq(fileSearchDispatchQueue.entityId, f.workspaceId)
              )
            )
        ).toHaveLength(1)
        expect(
          await db
            .select()
            .from(workspaceFileSearchRevision)
            .where(eq(workspaceFileSearchRevision.fileId, body.fileId))
        ).toEqual([])
        await db
          .update(workspaceFiles)
          .set({ contentUpdatedAt: inputRow.contentUpdatedAt })
          .where(eq(workspaceFiles.id, body.fileId))
        expect((await read()).count).toBe(1)
        if (context === 'test')
          await db.delete(workflowTest).where(eq(workflowTest.bodyFileId, body.fileId))
        else await db.delete(changelogRelease).where(eq(changelogRelease.bodyFileId, body.fileId))
        expect((await read()).results).toEqual([])
      }
    )
  }

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

  check('requeues the former owner and rebuilds derived files after an input moves', async () => {
    const f = await fixture()
    const destination = await fixture()
    const dependencyId = generateId()
    const sourceId = generateId()
    const [dependency] = await db
      .insert(workspaceFiles)
      .values({
        id: dependencyId,
        userId: f.ownerId,
        workspaceId: f.workspaceId,
        context: 'workspace',
        key: `workspace/${f.workspaceId}/${dependencyId}/input.txt`,
        originalName: 'input.txt',
        contentType: 'text/plain',
        sizeBytes: 5,
      })
      .returning()
    await db.insert(workspaceFiles).values({
      id: sourceId,
      userId: f.ownerId,
      workspaceId: f.workspaceId,
      context: 'workspace',
      key: `workspace/${f.workspaceId}/${sourceId}/derived.docx`,
      originalName: 'derived.docx',
      contentType: 'text/x-docxjs',
      sizeBytes: 10,
    })
    const claimed = await claim(sourceId)
    const build = await beginFileSearchBuild(
      {
        workspaceId: f.workspaceId,
        fileId: sourceId,
        sourceContentUpdatedAt: new Date(claimed.sourceContentUpdatedAt),
      },
      claimed.dispatchToken
    )
    if (!build) throw new Error('Derived file build was not admitted')
    expect(
      await publishFileSearchBuild(
        build,
        {
          status: 'ready',
          lineCount: 0,
          indexedBytes: 0,
          chunkCount: 0,
          dependencies: [
            {
              fileId: dependencyId,
              key: dependency.key,
              sourceContentUpdatedAt: dependency.contentUpdatedAt,
            },
          ],
        },
        signal
      )
    ).toBe(true)
    await prepareWorkspaceFileSearchDispatch(0)
    await db
      .delete(fileSearchDispatchQueue)
      .where(
        and(
          eq(fileSearchDispatchQueue.entityType, 'workspace'),
          eq(fileSearchDispatchQueue.entityId, f.workspaceId)
        )
      )
    await db
      .update(workspaceFiles)
      .set({ workspaceId: destination.workspaceId })
      .where(eq(workspaceFiles.id, dependencyId))
    const queued = await db
      .select()
      .from(fileSearchDispatchQueue)
      .where(
        and(
          eq(fileSearchDispatchQueue.entityType, 'workspace'),
          eq(fileSearchDispatchQueue.entityId, f.workspaceId)
        )
      )
    expect(queued).toHaveLength(1)
    const locked = createDeferred<void>()
    const release = createDeferred<void>()
    const blocker = runOutsideTransactionContext(() =>
      db.transaction(async (tx) => {
        await tx.select().from(workspaceFiles).where(eq(workspaceFiles.id, sourceId)).for('update')
        locked.resolve()
        await release.promise
      })
    )
    await locked.promise
    try {
      await prepareWorkspaceFileSearchDispatch()
      const waiting = await db
        .select()
        .from(fileSearchDispatchQueue)
        .where(
          and(
            eq(fileSearchDispatchQueue.entityType, 'workspace'),
            eq(fileSearchDispatchQueue.entityId, f.workspaceId)
          )
        )
      expect(waiting).toHaveLength(1)
    } finally {
      release.resolve()
      await blocker
    }
    const dispatch = await prepareWorkspaceFileSearchDispatch()
    expect(dispatch.payloads.some((payload) => payload.fileId === sourceId)).toBe(true)
    const [revision] = await db
      .select()
      .from(workspaceFileSearchRevision)
      .where(eq(workspaceFileSearchRevision.fileId, sourceId))
    expect(revision).toMatchObject({ status: 'pending', buildId: null })
  })

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
      await updateProjectFileContent.execute({
        principal: f.principal,
        input: {
          projectId: f.projectId,
          fileId: created.file.id,
          content: 'currentneedle',
          encoding: 'utf-8',
        },
      })
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

  check('keeps empty and recursive folder scopes exact after creator handoff', async () => {
    const f = await fixture()
    await db
      .update(permissions)
      .set({ permissionType: 'write' })
      .where(and(eq(permissions.userId, f.readerId), eq(permissions.entityId, f.workspaceId)))
    const folder = await createProjectFileFolder.execute({
      principal: f.principal,
      input: { projectId: f.projectId, name: 'Architecture' },
    })
    const child = await createProjectFileFolder.execute({
      principal: f.principal,
      input: { projectId: f.projectId, name: 'Backend', parentId: folder.folder.id },
    })
    const created = await create({ ...f, principal: f.reader }, 'folderneedle', {
      folderId: child.folder.id,
    })
    const [creatorMembership] = await db
      .select({ id: member.id })
      .from(member)
      .where(and(eq(member.organizationId, f.organizationId), eq(member.userId, f.readerId)))
    if (!creatorMembership) throw new Error('Creator membership missing')
    const removal = await removeUserFromOrganization({
      userId: f.readerId,
      organizationId: f.organizationId,
      memberId: creatorMembership.id,
      actorUserId: f.ownerId,
      skipBillingLogic: true,
      onError: 'throw',
    })
    expect(removal.success).toBe(true)
    await deleteUserAccount(f.readerId, { recordIdentity: false })
    const surviving = { ...f, reader: f.principal }
    await indexWorkspaceFileForSearch({ owner: f.owner, ...(await claim(created.file.id)) }, signal)
    expect((await search(surviving, 'folderneedle', { folderPaths: [] })).results).toEqual([])
    expect(
      (
        await search(surviving, 'folderneedle', {
          folderPaths: ['/Architecture'],
          includeSubfolders: false,
        })
      ).results
    ).toEqual([])
    expect(
      (await search(surviving, 'folderneedle', { folderPaths: ['/Architecture'] })).results.map(
        (hit) => hit.fileId
      )
    ).toEqual([created.file.id])
  })

  check('denies current access revocation, wrong owner and execution principals', async () => {
    const f = await fixture()
    const other = await fixture()
    const created = await create(f, 'protectedneedle')
    await indexWorkspaceFileForSearch({ owner: f.owner, ...(await claim(created.file.id)) }, signal)
    const { searchProjectFileContent } = await import('@/lib/projects/files/application/search')
    const input = {
      projectId: f.projectId,
      query: 'protectedneedle',
      mode: 'exact' as const,
      maxResults: 100,
    }
    await expect(
      searchProjectFileContent.execute({ principal: other.reader, input })
    ).rejects.toMatchObject({ code: 'not_found' })
    await expect(
      searchProjectFileContent.execute({
        principal: createExecutorPrincipal({ workspaceId: f.workspaceId }),
        input,
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    await db
      .delete(permissions)
      .where(and(eq(permissions.userId, f.readerId), eq(permissions.entityId, f.workspaceId)))
    await expect(search(f, 'protectedneedle')).rejects.toMatchObject({ code: 'not_found' })
  })

  check('settles private source provenance before returning indexed snippets', async () => {
    const f = await fixture()
    const created = await create(f, 'observerneedle')
    await indexWorkspaceFileForSearch({ owner: f.owner, ...(await claim(created.file.id)) }, signal)
    await expect(
      observeWorkspaceFileDelivery(
        async () => {
          throw new Error('Delivery rejected')
        },
        () => search(f, 'observerneedle')
      )
    ).rejects.toThrow('Delivery rejected')
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
        fileDocumentCacheIdentity(
          source,
          await requireDocxFormat(),
          'text/plain',
          fileDocumentInputIdentity(f.owner, [dependencyRow])
        )
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
      await updateProjectFileContent.execute({
        principal: f.principal,
        input: {
          projectId: f.projectId,
          fileId: dependency.file.id,
          content: 'new input',
          encoding: 'utf-8',
        },
      })
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
      await updateProjectFileContent.execute({
        principal: f.principal,
        input: {
          projectId: f.projectId,
          fileId: dependency.file.id,
          content: 'after',
          encoding: 'utf-8',
        },
      })
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
  check(
    'replaces indexed generation source after an authorized current artifact read',
    async () => {
      const f = await fixture()
      const source = 'unrenderedsourceonly'
      const generated = await create(f, source, { name: 'transition.docx' })
      await indexWorkspaceFileForSearch(
        { owner: f.owner, ...(await claim(generated.file.id)) },
        signal
      )
      expect((await search(f, source)).count).toBe(1)
      const artifact = await Packer.toBuffer(
        new Document({ sections: [{ children: [new Paragraph('renderedartifactneedle')] }] })
      )
      await storeCompiledDoc(
        f.owner,
        source,
        'docx',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        artifact,
        fileDocumentCacheIdentity(source, await requireDocxFormat(), 'text/plain')
      )
      const input = { projectId: f.projectId, fileId: generated.file.id, maxBytes: 1_000_000 }
      const rendered = await readProjectFileArtifact.execute({ principal: f.reader, input })
      expect(rendered.buffer).toEqual(artifact)
      const [pending] = await db
        .select()
        .from(workspaceFileSearchRevision)
        .where(eq(workspaceFileSearchRevision.fileId, generated.file.id))
      expect(pending.status).toBe('pending')
      expect(pending.sourceContentUpdatedAt).toEqual(generated.file.contentUpdatedAt)
      await indexWorkspaceFileForSearch(
        { owner: f.owner, ...(await claim(generated.file.id)) },
        signal
      )
      expect((await search(f, 'renderedartifactneedle')).results.map((hit) => hit.fileId)).toEqual([
        generated.file.id,
      ])
      expect((await search(f, source)).results).toEqual([])
      const [ready] = await db
        .select()
        .from(workspaceFileSearchRevision)
        .where(eq(workspaceFileSearchRevision.fileId, generated.file.id))
      await readProjectFileArtifact.execute({ principal: f.reader, input })
      const [unchanged] = await db
        .select()
        .from(workspaceFileSearchRevision)
        .where(eq(workspaceFileSearchRevision.fileId, generated.file.id))
      expect(unchanged.status).toBe('ready')
      expect(unchanged.buildId).toBe(ready.buildId)
    }
  )
  check('keeps a skipped artifact build on later reads but requeues a failed one', async () => {
    const f = await fixture()
    const source = 'binaryartifactsource'
    const generated = await create(f, source, { name: 'binary.docx' })
    await storeCompiledDoc(
      f.owner,
      source,
      'docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.alloc(64), Buffer.from([0xff, 0xfe])]),
      fileDocumentCacheIdentity(source, await requireDocxFormat(), 'text/plain')
    )
    const input = { projectId: f.projectId, fileId: generated.file.id, maxBytes: 1_000_000 }
    const revisionOf = async () => {
      const [row] = await db
        .select()
        .from(workspaceFileSearchRevision)
        .where(eq(workspaceFileSearchRevision.fileId, generated.file.id))
      return row
    }
    await readProjectFileArtifact.execute({ principal: f.reader, input })
    await markWorkspaceFileSearchIndexFailed({
      owner: f.owner,
      ...(await claim(generated.file.id)),
    })
    expect((await revisionOf()).status).toBe('failed')
    await readProjectFileArtifact.execute({ principal: f.reader, input })
    expect((await revisionOf()).status).toBe('pending')
    await indexWorkspaceFileForSearch(
      { owner: f.owner, ...(await claim(generated.file.id)) },
      signal
    )
    const skipped = await revisionOf()
    expect(skipped).toMatchObject({ status: 'skipped', failureReason: 'binary_or_degraded' })
    await readProjectFileArtifact.execute({ principal: f.reader, input })
    const unchanged = await revisionOf()
    expect(unchanged.status).toBe('skipped')
    expect(unchanged.buildId).toBe(skipped.buildId)
  })

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
      await storeCompiledDoc(
        f.owner,
        source,
        'docx',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        await Packer.toBuffer(
          new Document({ sections: [{ children: [new Paragraph('oldrender')] }] })
        ),
        fileDocumentCacheIdentity(
          source,
          await requireDocxFormat(),
          'text/plain',
          fileDocumentInputIdentity(f.owner, [dependencyRow])
        )
      )
      const artifactKey = compiledArtifactKey(
        f.owner,
        source,
        'docx',
        fileDocumentCacheIdentity(
          source,
          await requireDocxFormat(),
          'text/plain',
          fileDocumentInputIdentity(f.owner, [dependencyRow])
        )
      )
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
      await updateProjectFileContent.execute({
        principal: f.principal,
        input: {
          projectId: f.projectId,
          fileId: generated.file.id,
          content: 'newrevisionneedle',
          encoding: 'utf-8',
        },
      })
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
      await storeCompiledDoc(
        f.owner,
        source,
        'docx',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        await Packer.toBuffer(
          new Document({ sections: [{ children: [new Paragraph('old-contributor')] }] })
        ),
        fileDocumentCacheIdentity(
          source,
          await requireDocxFormat(),
          'text/plain',
          fileDocumentInputIdentity(f.owner, [dependencyRow])
        )
      )
      const artifactKey = compiledArtifactKey(
        f.owner,
        source,
        'docx',
        fileDocumentCacheIdentity(
          source,
          await requireDocxFormat(),
          'text/plain',
          fileDocumentInputIdentity(f.owner, [dependencyRow])
        )
      )
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
          }>(sql`SELECT locktype AS event FROM pg_locks
            WHERE NOT granted AND ${backend.pid} = ANY(pg_blocking_pids(pid))`)
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
        or(
          inArray(
            workspaceFiles.projectId,
            fixtures.map((f) => f.projectId)
          ),
          inArray(
            workspaceFiles.workspaceId,
            fixtures.map((f) => f.workspaceId)
          )
        )
      )
  ).map((row) => row.id)
  if (fileIds.length) {
    await db.delete(workflowTest).where(inArray(workflowTest.bodyFileId, fileIds))
    await db.delete(changelogRelease).where(inArray(changelogRelease.bodyFileId, fileIds))
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
    await db.execute(
      sql`DELETE FROM file_search_dispatch_queue WHERE (entity_type = 'project' AND entity_id = ${f.projectId}) OR (entity_type = 'workspace' AND entity_id = ${f.workspaceId})`
    )
    await db.execute(
      sql`DELETE FROM workspace_file_search_dispatch_queue WHERE workspace_id = ${f.workspaceId}`
    )
    await db.delete(folder).where(eq(folder.projectId, f.projectId))
    await deleteWorkspaceFixture(db, eq(workspace.id, f.workspaceId))
    await db.delete(project).where(eq(project.id, f.projectId))
    await db.delete(organization).where(eq(organization.id, f.organizationId))
    await db.delete(user).where(inArray(user.id, [f.ownerId, f.readerId]))
  }
  await rm(storageRoot, { recursive: true, force: true })
  await db.$client.end()
})
