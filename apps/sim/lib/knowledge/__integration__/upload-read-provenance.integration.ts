/** Authorized upload reads retain their captured revision across concurrent promotion. */
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { AuditAction } from '@sim/audit'
import { db } from '@sim/db'
import {
  auditLog,
  copilotChats,
  knowledgeBase,
  organization,
  user,
  workspace,
  workspaceFileSecretProvenance,
  workspaceFiles,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const fixtureStorage = vi.hoisted(() => ({ root: '' }))
vi.mock('@/lib/uploads/core/setup.server', () => ({
  get UPLOAD_DIR_SERVER() {
    return fixtureStorage.root
  },
}))

import {
  createKnowledgeAclFixtureIds,
  seedKnowledgeAclFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import {
  generateWorkspaceFileKey,
  trackChatUpload,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import {
  areModelSafeWorkspaceFileKeys,
  filterModelSafeWorkspaceFileAttachments,
  getBoundWorkspaceFileSecretProvenance,
  getBoundWorkspaceFileSecretProvenanceByMetadata,
  importWorkspaceFileSecretProvenanceForModelView,
  importWorkspaceFileSecretProvenanceForRuntime,
  isModelSafeWorkspaceFileKey,
  isOpaqueWorkspaceFileEgressSafe,
  replaceWorkspaceFileSecretProvenanceInTx,
  snapshotWorkspaceFileSecretProvenanceInTx,
  type WorkspaceFileSecretProvenance,
} from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import { uploadFile } from '@/lib/uploads/core/storage-service'
import { readWorkspaceFileText } from '@/lib/workspace-files/application/read-workspace-file-text'

const fixtures: ReturnType<typeof createKnowledgeAclFixtureIds>[] = []
const CONTENT = 'The same uploaded bytes remain readable after saving.\n'

async function seedUpload(provenance?: WorkspaceFileSecretProvenance) {
  const ids = createKnowledgeAclFixtureIds()
  fixtures.push(ids)
  await seedKnowledgeAclFixture(ids)
  const chatId = generateId()
  await db.insert(copilotChats).values({
    id: chatId,
    userId: ids.aliceId,
    workspaceId: ids.workspaceId,
    type: 'mothership',
  })
  const name = 'fixture.txt'
  const key = generateWorkspaceFileKey(ids.workspaceId, name)
  await uploadFile({
    file: Buffer.from(CONTENT),
    fileName: name,
    contentType: 'text/plain',
    context: 'mothership',
    customKey: key,
    preserveKey: true,
    metadata: { userId: ids.aliceId, workspaceId: ids.workspaceId, originalName: name },
  })
  await trackChatUpload(
    ids.workspaceId,
    ids.aliceId,
    chatId,
    key,
    name,
    'text/plain',
    Buffer.byteLength(CONTENT)
  )
  const [file] = await db.select().from(workspaceFiles).where(eq(workspaceFiles.key, key))
  if (provenance) {
    await db.transaction((tx) =>
      replaceWorkspaceFileSecretProvenanceInTx(tx, file.id, file.contentUpdatedAt, provenance)
    )
  }
  return { ...ids, chatId, file, name }
}

async function readUpload(ids: Awaited<ReturnType<typeof seedUpload>>) {
  const result = await readWorkspaceFileText.execute({
    principal: { kind: 'session', userId: ids.aliceId, sessionId: 'upload-provenance-fixture' },
    input: {
      workspaceId: ids.workspaceId,
      chatId: ids.chatId,
      reference: `uploads/${ids.name}`,
      includeSecretProvenance: true,
    },
  })
  return {
    value: { content: result.text },
    file: {
      fileId: result.file.id,
      key: result.file.key,
      context: result.file.storageContext ?? 'workspace',
      contentUpdatedAt: result.file.contentUpdatedAt ?? undefined,
    },
  }
}

/** Models promotion by an already-running Go tool after the new reader captured its revision. */
async function promoteUpload(ids: Awaited<ReturnType<typeof seedUpload>>) {
  await db
    .update(workspaceFiles)
    .set({ context: 'workspace', chatId: null })
    .where(eq(workspaceFiles.id, ids.file.id))
}

beforeAll(() => {
  fixtureStorage.root = mkdtempSync(path.join(tmpdir(), 'sim-upload-read-provenance-'))
})

afterAll(async () => {
  for (const ids of fixtures) {
    await db.delete(auditLog).where(eq(auditLog.workspaceId, ids.workspaceId))
    await db.delete(knowledgeBase).where(eq(knowledgeBase.id, ids.knowledgeBaseId))
    await db.delete(workspace).where(eq(workspace.id, ids.workspaceId))
    await db.delete(organization).where(eq(organization.id, ids.organizationId))
    await db.delete(user).where(inArray(user.id, [ids.aliceId, ids.bobId]))
  }
  await rm(fixtureStorage.root, { recursive: true, force: true })
  await db.$client.end()
})

describe('chat upload reads racing with save_upload', () => {
  it.each(['legacy', 'exact', 'unrecorded'] as const)(
    'keeps a %s authorized upload read valid across promotion',
    async (kind) => {
      const ids = await seedUpload(
        kind === 'legacy'
          ? undefined
          : kind === 'exact'
            ? { status: 'exact', entries: [] }
            : { status: 'unrecorded' }
      )
      const read = await readUpload(ids)
      expect(read?.value.content).toBe(CONTENT)
      expect(read?.file).toBeDefined()

      /** Fixes the production interleaving: save commits after bytes are read, before admission. */
      await promoteUpload(ids)

      for (const envelope of [read]) {
        if (!envelope?.file) throw new Error('Upload read did not return its identity')
        expect(
          await importWorkspaceFileSecretProvenanceForModelView({
            workspaceId: ids.workspaceId,
            identity: envelope.file,
            value: envelope.value,
            view: 'opaque',
          })
        ).toBe(true)
        expect(envelope.file.contentUpdatedAt).toEqual(ids.file.contentUpdatedAt)
      }
      await expect(readUpload(ids)).rejects.toMatchObject({ code: 'not_found' })
    }
  )

  it('still rejects changed bytes, mismatched scope or key, and a promotion without a captured revision', async () => {
    const ids = await seedUpload({ status: 'exact', entries: [] })
    const read = await readUpload(ids)
    if (!read?.file) throw new Error('Upload read did not return its identity')
    await promoteUpload(ids)
    for (const identity of [
      { ...read.file, key: `${read.file.key}-different` },
      { ...read.file, contentUpdatedAt: undefined },
      { ...read.file, context: 'execution' as const },
    ]) {
      expect(await getBoundWorkspaceFileSecretProvenance(ids.workspaceId, identity)).toEqual({
        status: 'unknown',
      })
    }
    expect(await getBoundWorkspaceFileSecretProvenance(generateId(), read.file)).toEqual({
      status: 'unknown',
    })
    const nextRevision = new Date(ids.file.contentUpdatedAt.getTime() + 1)
    await db.transaction(async (tx) => {
      await tx
        .update(workspaceFiles)
        .set({ contentUpdatedAt: nextRevision })
        .where(eq(workspaceFiles.id, ids.file.id))
      await replaceWorkspaceFileSecretProvenanceInTx(tx, ids.file.id, nextRevision, {
        status: 'exact',
        entries: [],
      })
    })
    expect(await getBoundWorkspaceFileSecretProvenance(ids.workspaceId, read.file)).toEqual({
      status: 'unknown',
    })
  })

  it.each<WorkspaceFileSecretProvenance>([
    { status: 'unknown' },
    {
      status: 'exact',
      entries: [
        { name: 'API_KEY', encryptedValue: 'fixture-ciphertext', sourceUserId: 'fixture-author' },
      ],
    },
  ])(
    'does not relax an opaque read with %j provenance when the upload is promoted',
    async (provenance) => {
      const ids = await seedUpload(provenance)
      const read = await readUpload(ids)
      if (!read?.file) throw new Error('Upload read did not return its identity')
      await promoteUpload(ids)
      expect(await getBoundWorkspaceFileSecretProvenance(ids.workspaceId, read.file)).toEqual(
        provenance
      )
      expect(
        await importWorkspaceFileSecretProvenanceForModelView({
          workspaceId: ids.workspaceId,
          identity: read.file,
          value: read.value,
          view: 'opaque',
        })
      ).toBe(false)
    }
  )
})

describe('recorded file absence policy', () => {
  it.each(['keys', 'attachments'] as const)(
    'records unscoped admitted %s once per canonical workspace',
    async (boundary) => {
      const first = await seedUpload({ status: 'unrecorded' })
      const second = await seedUpload({ status: 'unrecorded' })
      const sibling = {
        ...first.file,
        id: generateId(),
        key: `${first.file.key}-sibling`,
        originalName: 'sibling.txt',
        displayName: 'sibling.txt',
      }
      await db.insert(workspaceFiles).values(sibling)
      await db.transaction((tx) =>
        replaceWorkspaceFileSecretProvenanceInTx(tx, sibling.id, sibling.contentUpdatedAt, {
          status: 'unrecorded',
        })
      )
      const files = [first.file, sibling, second.file]
      if (boundary === 'keys') {
        expect(await areModelSafeWorkspaceFileKeys(files.map((file) => file.key))).toBe(true)
      } else {
        const attachments = files.map((file) => ({ id: file.id, key: file.key }))
        expect(await filterModelSafeWorkspaceFileAttachments(attachments)).toEqual(attachments)
      }
      const query = () =>
        db
          .select({ workspaceId: auditLog.workspaceId, metadata: auditLog.metadata })
          .from(auditLog)
          .where(
            and(
              inArray(auditLog.workspaceId, [first.workspaceId, second.workspaceId]),
              eq(auditLog.action, AuditAction.SECRET_PROVENANCE_UNRECORDED)
            )
          )
      await expect.poll(query).toHaveLength(2)
      const rows = await query()
      expect(rows.find((row) => row.workspaceId === first.workspaceId)?.metadata).toMatchObject({
        recordCount: 2,
      })
      expect(rows.find((row) => row.workspaceId === second.workspaceId)?.metadata).toMatchObject({
        recordCount: 1,
      })
      if (boundary === 'keys') {
        await db
          .delete(auditLog)
          .where(inArray(auditLog.workspaceId, [first.workspaceId, second.workspaceId]))
        await db.transaction((tx) =>
          replaceWorkspaceFileSecretProvenanceInTx(tx, sibling.id, sibling.contentUpdatedAt, {
            status: 'unknown',
          })
        )
        expect(await areModelSafeWorkspaceFileKeys(files.map((file) => file.key))).toBe(false)
        expect(await query()).toEqual([])
      }
    }
  )

  it('keeps valid unrecorded bytes usable across runtime, opaque and attachment boundaries', async () => {
    const ids = await seedUpload({ status: 'unrecorded' })
    const read = await readUpload(ids)
    expect(
      await importWorkspaceFileSecretProvenanceForRuntime({
        workspaceId: ids.workspaceId,
        identity: read.file,
      })
    ).toBe(true)
    expect(await isOpaqueWorkspaceFileEgressSafe(ids.workspaceId, read.file)).toBe(true)
    expect(await isModelSafeWorkspaceFileKey(ids.file.key, { workspaceId: ids.workspaceId })).toBe(
      true
    )
    const attachment = { id: ids.file.id, key: ids.file.key }
    expect(
      await filterModelSafeWorkspaceFileAttachments([attachment], { workspaceId: ids.workspaceId })
    ).toEqual([attachment])
    expect(await getBoundWorkspaceFileSecretProvenance(ids.workspaceId, read.file)).toEqual({
      status: 'unrecorded',
    })
  })

  it('does not discard recorded entries from an inconsistent unrecorded sidecar', async () => {
    const ids = await seedUpload({ status: 'unrecorded' })
    await db
      .update(workspaceFileSecretProvenance)
      .set({
        entries: [
          { name: 'TOKEN', encryptedValue: 'fixture-ciphertext', sourceUserId: ids.aliceId },
        ],
      })
      .where(eq(workspaceFileSecretProvenance.fileId, ids.file.id))
    const read = await readUpload(ids)
    expect(await getBoundWorkspaceFileSecretProvenance(ids.workspaceId, read.file)).toEqual({
      status: 'unknown',
    })
    const batch = await getBoundWorkspaceFileSecretProvenanceByMetadata(db, [
      { ...ids.file, secretProvenanceVersion: 1 },
    ])
    expect(batch.get(ids.file.id)).toEqual({ status: 'unknown' })
    expect(
      await db.transaction((tx) =>
        snapshotWorkspaceFileSecretProvenanceInTx(tx, ids.file.id, ids.file.contentUpdatedAt, 1)
      )
    ).toEqual({ status: 'unknown', entries: [] })
    expect(await isModelSafeWorkspaceFileKey(ids.file.key, { workspaceId: ids.workspaceId })).toBe(
      false
    )
    expect(
      await filterModelSafeWorkspaceFileAttachments([{ id: ids.file.id, key: ids.file.key }], {
        workspaceId: ids.workspaceId,
      })
    ).toEqual([])
  })
})
