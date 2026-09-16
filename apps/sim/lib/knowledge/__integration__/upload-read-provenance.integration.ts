/** Real upload reads and save_upload must agree on the same bytes across promotion. */
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { db } from '@sim/db'
import {
  copilotChats,
  knowledgeBase,
  organization,
  user,
  workspace,
  workspaceFiles,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const fixtureStorage = vi.hoisted(() => ({ root: '' }))
vi.mock('@/lib/uploads/core/setup.server', () => ({
  get UPLOAD_DIR_SERVER() {
    return fixtureStorage.root
  },
}))

import { executeMaterializeFile } from '@/lib/copilot/tools/handlers/materialize-file'
import {
  grepChatUploadWithProvenance,
  readChatUploadWithProvenance,
} from '@/lib/copilot/tools/handlers/upload-file-reader'
import {
  createKnowledgeAclFixtureIds,
  seedKnowledgeAclFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import {
  generateWorkspaceFileKey,
  trackChatUpload,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import {
  getBoundWorkspaceFileSecretProvenance,
  importWorkspaceFileSecretProvenanceForModelView,
  replaceWorkspaceFileSecretProvenanceInTx,
  type WorkspaceFileSecretProvenance,
} from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import { uploadFile } from '@/lib/uploads/core/storage-service'

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
    CONTENT.length
  )
  const [file] = await db.select().from(workspaceFiles).where(eq(workspaceFiles.key, key))
  if (provenance) {
    await db.transaction((tx) =>
      replaceWorkspaceFileSecretProvenanceInTx(tx, file.id, file.contentUpdatedAt, provenance)
    )
  }
  return { ...ids, chatId, file, name }
}

async function promoteUpload(ids: Awaited<ReturnType<typeof seedUpload>>) {
  const result = await executeMaterializeFile(
    { fileNames: [ids.name], operation: 'save' },
    {
      userId: ids.aliceId,
      workspaceId: ids.workspaceId,
      workflowId: '',
      chatId: ids.chatId,
      toolCallId: generateId(),
      copilotToolExecution: true,
    }
  )
  expect(result.success).toBe(true)
}

beforeAll(() => {
  fixtureStorage.root = mkdtempSync(path.join(tmpdir(), 'sim-upload-read-provenance-'))
})

afterAll(async () => {
  for (const ids of fixtures) {
    await db.delete(knowledgeBase).where(eq(knowledgeBase.id, ids.knowledgeBaseId))
    await db.delete(workspace).where(eq(workspace.id, ids.workspaceId))
    await db.delete(organization).where(eq(organization.id, ids.organizationId))
    await db.delete(user).where(inArray(user.id, [ids.aliceId, ids.bobId]))
  }
  await rm(fixtureStorage.root, { recursive: true, force: true })
  await db.$client.end()
})

describe('chat upload reads racing with save_upload', () => {
  it.each(['legacy', 'exact'] as const)(
    'keeps a %s upload read and grep valid across promotion',
    async (kind) => {
      const ids = await seedUpload(kind === 'exact' ? { status: 'exact', entries: [] } : undefined)
      const read = await readChatUploadWithProvenance(ids.name, ids.chatId)
      const grep = await grepChatUploadWithProvenance(ids.name, ids.chatId, 'uploaded')
      expect(read?.value.content).toBe(CONTENT)
      expect(read?.file).toBeDefined()
      expect(grep.file).toBeDefined()

      /** Fixes the production interleaving: save commits after bytes are read, before admission. */
      await promoteUpload(ids)

      for (const envelope of [read, grep]) {
        if (!envelope?.file) throw new Error('Upload read did not return its identity')
        expect(
          await importWorkspaceFileSecretProvenanceForModelView({
            workspaceId: ids.workspaceId,
            actorUserId: ids.aliceId,
            identity: envelope.file,
            value: envelope.value,
            view: 'opaque',
          })
        ).toBe(true)
        expect(envelope.file.contentUpdatedAt).toEqual(ids.file.contentUpdatedAt)
      }
      expect(await readChatUploadWithProvenance(ids.name, ids.chatId)).toBeNull()
    }
  )

  it('still rejects changed bytes, mismatched scope or key, and a promotion without a captured revision', async () => {
    const ids = await seedUpload({ status: 'exact', entries: [] })
    const read = await readChatUploadWithProvenance(ids.name, ids.chatId)
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
      const read = await readChatUploadWithProvenance(ids.name, ids.chatId)
      if (!read?.file) throw new Error('Upload read did not return its identity')
      await promoteUpload(ids)
      expect(await getBoundWorkspaceFileSecretProvenance(ids.workspaceId, read.file)).toEqual(
        provenance
      )
      expect(
        await importWorkspaceFileSecretProvenanceForModelView({
          workspaceId: ids.workspaceId,
          actorUserId: ids.aliceId,
          identity: read.file,
          value: read.value,
          view: 'opaque',
        })
      ).toBe(false)
    }
  )
})
