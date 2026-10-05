import { mkdtempSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type { ResourceDelegatedPrincipal } from '@sim/auth/principal'
import { db } from '@sim/db'
import {
  member,
  organization,
  outboxEvent,
  permissions,
  projectWorkspace,
  user,
  workspace,
  workspaceFiles,
  workspaceFileVersion,
} from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { FILE_DOC_SEED } from '@sim/realtime-protocol/file-doc'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { setUploadDirServer, uploadsSetupMock } from '@sim/testing/mocks/uploads-setup.mock'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { eq, inArray, sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'

vi.mock('@/lib/uploads/core/setup.server', () => uploadsSetupMock)

import { applyMarkdownToYDoc } from '@/lib/collab-doc/converter'
import {
  createProjectFile,
  readProjectFileContent,
  updateProjectFileContent,
} from '@/lib/projects/files/application/content'
import { rotateProjectFileDocInTx } from '@/lib/projects/files/application/document-lifecycle'
import {
  buildProjectFileDocSeed,
  getProjectFileDocAccess,
  persistProjectFileDoc,
} from '@/lib/projects/files/application/documents'

const uploadRoot = mkdtempSync(join(tmpdir(), 'sim-project-documents-'))
setUploadDirServer(uploadRoot)
const fixtures: {
  ownerId: string
  editorId: string
  organizationId: string
  workspaceId: string
  projectId: string
}[] = []
const lifecycleTargets: string[] = []
const checks: { name: string; status: 'passed' | 'failed'; durationMs: number; error?: string }[] =
  []

beforeEach(() => {
  vi.stubEnv('PROJECT_API_ENABLED', 'true')
  vi.stubEnv('PROJECT_FILES_ENABLED', 'true')
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

async function fixture(permissionType: 'read' | 'write' = 'write') {
  const ownerId = generateId()
  const editorId = generateId()
  const organizationId = generateId()
  const workspaceId = generateId()
  await db.insert(user).values(
    [ownerId, editorId].map((id) => ({
      id,
      email: `${id}@documents.invalid`,
      name: 'Document fixture',
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }))
  )
  await db
    .insert(organization)
    .values({ id: organizationId, name: 'Documents', slug: organizationId, createdAt: new Date() })
  await db.insert(member).values(
    [ownerId, editorId].map((userId) => ({
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
    name: 'Document environment',
  })
  const [binding] = await db
    .select()
    .from(projectWorkspace)
    .where(eq(projectWorkspace.workspaceId, workspaceId))
  if (!binding) throw new Error('Project binding is missing')
  await db.insert(permissions).values({
    id: generateId(),
    userId: editorId,
    entityType: 'workspace',
    entityId: workspaceId,
    permissionType,
  })
  const ids = { ownerId, editorId, organizationId, workspaceId, projectId: binding.projectId }
  fixtures.push(ids)
  const owner = createSessionPrincipal({ userId: ownerId })
  const created = await createProjectFile.execute({
    principal: owner,
    input: {
      projectId: ids.projectId,
      name: 'architecture.md',
      contentType: 'text/markdown',
      content: '# Original architecture\n',
      encoding: 'utf-8',
    },
  })
  const target = { projectId: ids.projectId, fileId: created.file.id }
  const principal: ResourceDelegatedPrincipal = {
    kind: 'resource_delegated',
    serviceId: 'realtime',
    subjectUserId: editorId,
    audience: 'sim:project-files',
    delegationId: generateId(),
    issuedAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
    scope: {
      kind: 'entity',
      entityType: 'project',
      entityId: ids.projectId,
      fileId: created.file.id,
    },
    invocation: { kind: 'realtime', connectionId: `socket-${generateId()}` },
  }
  return { ...ids, owner, target, principal }
}

function edit(update: Uint8Array, markdown: string, replaceIdentity = false) {
  const doc = new Y.Doc()
  try {
    Y.applyUpdate(doc, update)
    applyMarkdownToYDoc(doc, markdown)
    if (replaceIdentity)
      doc.getMap(FILE_DOC_SEED.configMap).set(FILE_DOC_SEED.docIdKey, generateId())
    return Y.encodeStateAsUpdate(doc)
  } finally {
    doc.destroy()
  }
}

function documentId(update: Uint8Array) {
  const doc = new Y.Doc()
  try {
    Y.applyUpdate(doc, update)
    return doc.getMap(FILE_DOC_SEED.configMap).get(FILE_DOC_SEED.docIdKey)
  } finally {
    doc.destroy()
  }
}

describe('Project collaborative documents against current policy and durable storage', () => {
  check('readers receive a stable seed but cannot publish durable document edits', async () => {
    const f = await fixture('read')
    expect(
      await getProjectFileDocAccess.execute({ principal: f.principal, input: f.target })
    ).toMatchObject({ canRead: true, canWrite: false })
    const seed = await buildProjectFileDocSeed.execute({ principal: f.principal, input: f.target })
    const again = await buildProjectFileDocSeed.execute({ principal: f.principal, input: f.target })
    expect(typeof documentId(seed.update)).toBe('string')
    expect(documentId(again.update)).toBe(documentId(seed.update))
    await expect(
      persistProjectFileDoc.execute({
        principal: f.principal,
        input: {
          ...f.target,
          docState: edit(seed.update, '# Reader edit'),
          expectedVersion: seed.version,
        },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    const stored = await readProjectFileContent.execute({ principal: f.owner, input: f.target })
    expect(stored.content.toString()).toBe('# Original architecture\n')
  })

  check(
    'accepted snapshots preserve document identity and attribute versions to the editor',
    async () => {
      const f = await fixture()
      const seed = await buildProjectFileDocSeed.execute({
        principal: f.principal,
        input: f.target,
      })
      const result = await persistProjectFileDoc.execute({
        principal: f.principal,
        input: {
          ...f.target,
          docState: edit(seed.update, '# Shared architecture'),
          expectedVersion: seed.version,
        },
      })
      expect(result.status).toBe('persisted')
      const stored = await readProjectFileContent.execute({ principal: f.owner, input: f.target })
      expect(stored.content.toString()).toContain('# Shared architecture')
      const again = await buildProjectFileDocSeed.execute({
        principal: f.principal,
        input: f.target,
      })
      expect(documentId(again.update)).toBe(documentId(seed.update))
      const versions = await db
        .select()
        .from(workspaceFileVersion)
        .where(eq(workspaceFileVersion.fileId, f.target.fileId))
      expect(
        versions.some(
          (version) => version.source === 'collab' && version.authorUserIds.includes(f.editorId)
        )
      ).toBe(true)
      const [billing] = await db
        .select({ bytes: organization.storageUsedBytes })
        .from(organization)
        .where(eq(organization.id, f.organizationId))
      expect(billing?.bytes).toBe(stored.content.length)
    }
  )

  check(
    'lifecycle identity rotation is atomic and old snapshots cannot return after restore',
    async () => {
      const f = await fixture()
      lifecycleTargets.push(f.target.fileId)
      const initial = await buildProjectFileDocSeed.execute({
        principal: f.principal,
        input: f.target,
      })
      const original = new Y.Doc()
      Y.applyUpdate(original, initial.update)
      const originalId = original.getMap(FILE_DOC_SEED.configMap).get(FILE_DOC_SEED.docIdKey)
      original.destroy()
      const archive = await db.transaction(async (tx) => {
        await tx
          .select({ id: workspaceFiles.id })
          .from(workspaceFiles)
          .where(eq(workspaceFiles.id, f.target.fileId))
          .for('update')
        return rotateProjectFileDocInTx(tx, f.target)
      })
      expect(archive).not.toBeNull()
      const afterArchive = await getProjectFileDocAccess.execute({
        principal: f.principal,
        input: f.target,
      })
      expect(afterArchive.docId).not.toBe(originalId)
      await expect(
        db.transaction(async (tx) => {
          await tx
            .select({ id: workspaceFiles.id })
            .from(workspaceFiles)
            .where(eq(workspaceFiles.id, f.target.fileId))
            .for('update')
          await rotateProjectFileDocInTx(tx, f.target)
          throw new Error('rollback-lifecycle')
        })
      ).rejects.toThrow('rollback-lifecycle')
      expect(
        (await getProjectFileDocAccess.execute({ principal: f.principal, input: f.target })).docId
      ).toBe(afterArchive.docId)
      const restore = await db.transaction(async (tx) => {
        await tx
          .select({ id: workspaceFiles.id })
          .from(workspaceFiles)
          .where(eq(workspaceFiles.id, f.target.fileId))
          .for('update')
        return rotateProjectFileDocInTx(tx, f.target)
      })
      if (!archive || !restore) throw new Error('Missing committed lifecycle events')
      const rows = await db
        .select()
        .from(outboxEvent)
        .where(sql`${outboxEvent.payload}->>'fileId' = ${f.target.fileId}`)
      expect(rows).toHaveLength(2)
      const current = await buildProjectFileDocSeed.execute({
        principal: f.principal,
        input: f.target,
      })
      expect(
        await persistProjectFileDoc.execute({
          principal: f.principal,
          input: { ...f.target, docState: initial.update, expectedVersion: initial.version },
        })
      ).toMatchObject({ status: 'conflict' })
      const fresh = new Y.Doc()
      try {
        Y.applyUpdate(fresh, current.update)
        expect(fresh.getMap(FILE_DOC_SEED.configMap).get(FILE_DOC_SEED.docIdKey)).not.toBe(
          afterArchive.docId
        )
        expect(fresh.getMap(FILE_DOC_SEED.configMap).get(FILE_DOC_SEED.docIdKey)).not.toBe(
          originalId
        )
      } finally {
        fresh.destroy()
      }
      expect(
        (
          await readProjectFileContent.execute({ principal: f.owner, input: f.target })
        ).content.toString()
      ).toContain('Original architecture')
    }
  )

  check(
    'binary files remain readable as files but cannot become collaborative documents',
    async () => {
      const f = await fixture()
      const binary = Buffer.from('%PDF-1.7\n\x00\xff')
      const created = await createProjectFile.execute({
        principal: f.owner,
        input: {
          projectId: f.projectId,
          name: 'architecture.pdf',
          contentType: 'application/pdf',
          content: binary.toString('base64'),
          encoding: 'base64',
        },
      })
      const target = { projectId: f.projectId, fileId: created.file.id }
      const principal: ResourceDelegatedPrincipal = {
        ...f.principal,
        scope: {
          kind: 'entity',
          entityType: 'project',
          entityId: f.projectId,
          fileId: created.file.id,
        },
      }
      await expect(
        getProjectFileDocAccess.execute({ principal, input: target })
      ).rejects.toMatchObject({ code: 'validation' })
      await expect(
        buildProjectFileDocSeed.execute({ principal, input: target })
      ).rejects.toMatchObject({ code: 'validation' })
      const seed = await buildProjectFileDocSeed.execute({
        principal: f.principal,
        input: f.target,
      })
      await expect(
        persistProjectFileDoc.execute({
          principal,
          input: { ...target, docState: seed.update, expectedVersion: Date.now() },
        })
      ).rejects.toMatchObject({ code: 'validation' })
      expect(
        (
          await readProjectFileContent.execute({ principal: f.owner, input: target })
        ).content.equals(binary)
      ).toBe(true)
    }
  )

  check('current write revocation leaves readers live but rejects a dirty flush', async () => {
    const f = await fixture()
    const seed = await buildProjectFileDocSeed.execute({ principal: f.principal, input: f.target })
    await db
      .update(permissions)
      .set({ permissionType: 'read' })
      .where(eq(permissions.userId, f.editorId))
    expect(
      await getProjectFileDocAccess.execute({ principal: f.principal, input: f.target })
    ).toMatchObject({ canRead: true, canWrite: false })
    await expect(
      persistProjectFileDoc.execute({
        principal: f.principal,
        input: {
          ...f.target,
          docState: edit(seed.update, '# Revoked edit'),
          expectedVersion: seed.version,
        },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    await db.delete(permissions).where(eq(permissions.userId, f.editorId))
    await expect(
      buildProjectFileDocSeed.execute({ principal: f.principal, input: f.target })
    ).rejects.toMatchObject({ code: 'not_found' })
  })

  check('file-bound realtime grants never read or mutate another Project or file', async () => {
    const f = await fixture()
    for (const target of [
      { ...f.target, projectId: generateId() },
      { ...f.target, fileId: generateId() },
    ]) {
      await expect(
        buildProjectFileDocSeed.execute({ principal: f.principal, input: target })
      ).rejects.toMatchObject({ code: 'forbidden' })
    }
  })

  check(
    'a replacement generation and an unsynchronized durable write cannot be overwritten',
    async () => {
      const f = await fixture()
      const seed = await buildProjectFileDocSeed.execute({
        principal: f.principal,
        input: f.target,
      })
      expect(
        await persistProjectFileDoc.execute({
          principal: f.principal,
          input: {
            ...f.target,
            docState: edit(seed.update, '# Wrong generation', true),
            expectedVersion: seed.version,
          },
        })
      ).toEqual({ status: 'conflict' })
      await updateProjectFileContent.execute({
        principal: f.owner,
        input: { ...f.target, content: '# New durable architecture', encoding: 'utf-8' },
      })
      expect(
        await persistProjectFileDoc.execute({
          principal: f.principal,
          input: {
            ...f.target,
            docState: edit(seed.update, '# Stale client architecture'),
            expectedVersion: seed.version,
          },
        })
      ).toEqual({ status: 'conflict' })
      const stored = await readProjectFileContent.execute({ principal: f.owner, input: f.target })
      expect(stored.content.toString()).toBe('# New durable architecture')
    }
  )
})

afterAll(async () => {
  const reportPath =
    process.env.PROJECT_FILE_DOCUMENTS_REPORT_PATH ??
    resolve('test-results/project-file-documents.json')
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(reportPath, JSON.stringify({ checks }, null, 2))
  for (const fileId of lifecycleTargets) {
    await db.delete(outboxEvent).where(sql`${outboxEvent.payload}->>'fileId' = ${fileId}`)
  }
  for (const f of fixtures) {
    await db.delete(workspaceFiles).where(eq(workspaceFiles.projectId, f.projectId))
    await deleteWorkspaceFixture(db, eq(workspace.id, f.workspaceId))
    await db.delete(organization).where(eq(organization.id, f.organizationId))
    await db.delete(user).where(inArray(user.id, [f.ownerId, f.editorId]))
  }
  await rm(uploadRoot, { recursive: true, force: true })
})
