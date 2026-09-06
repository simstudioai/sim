/** @vitest-environment node */
import { db } from '@sim/db'
import { uploadSession } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { eq, sql } from 'drizzle-orm'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  completeUploadSession,
  type UploadSessionRecord,
} from '@/lib/uploads/upload-session/service'
import {
  bindWorkspaceFileUploadProvenance,
  readWorkspaceFileUploadProvenance,
  WORKSPACE_FILE_UPLOAD_PROVENANCE_KEY,
} from '@/lib/uploads/upload-session/workspace-file-provenance'

const state = vi.hoisted(() => ({ close: async () => {} }))
vi.unmock('@sim/db/schema')
vi.unmock('drizzle-orm')
vi.mock('@sim/db', async () => {
  const url = process.env.MSHIP_TEST_DATABASE_URL
  if (!url) {
    const { databaseMock } = await import('@sim/testing')
    return databaseMock
  }
  if (!new URL(url).pathname.startsWith('/mship_audit_'))
    throw new Error('Expected disposable audit database')
  const { default: postgres } = await import('postgres')
  const { drizzle } = await import('drizzle-orm/postgres-js')
  const client = postgres(url, { max: 1 })
  const database = drizzle(client)
  state.close = () => client.end()
  return { db: database, dbFor: () => database }
})
vi.mock('@/lib/billing/storage', () => ({
  checkStorageQuotaForBillingContext: vi.fn(),
  resolveStorageBillingContext: vi.fn(),
}))
vi.mock('@/lib/uploads/contexts/workspace', () => ({ generateWorkspaceFileKey: vi.fn() }))
vi.mock('@/lib/uploads/upload-session/cleanup', () => ({
  maybeCleanupLocalUploadArtifacts: vi.fn(),
}))
vi.mock('@/lib/uploads/upload-session/provider', () => ({
  headProviderObject: async () => ({
    size: 4,
    contentType: 'text/plain',
    uploadId: 'upload',
    version: 'version-1',
  }),
}))

const source = {
  status: 'exact',
  entries: [{ encryptedValue: 'ciphertext', sourceUserId: 'reader' }],
} as const
const workspaceId = 'workspace'

/** Real completion SQL; only provider HEAD and unrelated application services are fixtures. */
describe.skipIf(!process.env.MSHIP_TEST_DATABASE_URL)(
  'workspace upload classification in Postgres',
  () => {
    beforeAll(async () => {
      const columns = getTableConfig(uploadSession).columns.map((column) => {
        const type = column.getSQLType()
        return `"${column.name}" ${type.startsWith('upload_session_') ? 'text' : type}`
      })
      await db.execute(sql.raw(`CREATE TEMP TABLE upload_session (${columns.join(', ')})`))
    })
    afterAll(async () => {
      await state.close()
    })

    async function createSession(metadata: Record<string, unknown>): Promise<UploadSessionRecord> {
      await db.delete(uploadSession)
      const now = new Date()
      const [row] = await db
        .insert(uploadSession)
        .values({
          id: 'upload',
          tokenHash: generateId(),
          userId: 'reader',
          workspaceId,
          purpose: 'workspace_file',
          method: 'put',
          storageContext: 'workspace',
          finalKey: 'workspace/key',
          storageProvider: 's3',
          fileName: 'file.txt',
          contentType: 'text/plain',
          fileSize: 4,
          status: 'uploading',
          metadata,
          createdAt: now,
          expiresAt: new Date(now.getTime() + 60_000),
          updatedAt: now,
        })
        .returning()
      if (!row) throw new Error('Missing fixture session')
      return {
        ...row,
        storageContext: 'workspace',
        storageKey: row.finalKey,
        uploadToken: 'fixture',
      }
    }
    const pending = () => ({
      authBinding: { fixture: 'preserve' },
      folderId: 'folder',
      [WORKSPACE_FILE_UPLOAD_PROVENANCE_KEY]: bindWorkspaceFileUploadProvenance(
        workspaceId,
        'pending'
      ),
    })
    const finalize = async (session: UploadSessionRecord) => ({
      value: readWorkspaceFileUploadProvenance(session),
    })

    it('seals streamed evidence before the finalizer sees the file', async () => {
      const session = await createSession(pending())
      const result = await completeUploadSession({ session, secretProvenance: source, finalize })
      expect(result.value).toEqual(source)
      expect(result.session.metadata.authBinding).toEqual({ fixture: 'preserve' })
      expect(result.session.metadata.folderId).toBe('folder')
      expect(readWorkspaceFileUploadProvenance(result.session)).toEqual(source)
    })

    it('a public completion without trusted evidence seals unknown', async () => {
      const session = await createSession(pending())
      const result = await completeUploadSession({ session, finalize })
      expect(result.value).toEqual({ status: 'unknown' })
    })

    it('recovery keeps the first claim even if a later caller supplies different evidence', async () => {
      const session = await createSession(pending())
      await expect(
        completeUploadSession({
          session,
          secretProvenance: source,
          finalize: async () => {
            throw new Error('registration unavailable')
          },
        })
      ).rejects.toThrow('registration unavailable')
      const [row] = await db.select().from(uploadSession).where(eq(uploadSession.id, 'upload'))
      expect(row.status).toBe('finalizing')
      const recovered = await completeUploadSession({
        session: { ...session, ...row, storageContext: 'workspace' },
        secretProvenance: { status: 'exact', entries: [] },
        finalize,
      })
      expect(recovered.value).toEqual(source)
    })

    it('two competing completion claims cannot replace the winner classification', async () => {
      const session = await createSession(pending())
      let release = () => {}
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      let claimed = () => {}
      const entered = new Promise<void>((resolve) => {
        claimed = resolve
      })
      const first = completeUploadSession({
        session,
        secretProvenance: source,
        finalize: async (current) => {
          claimed()
          await gate
          return finalize(current)
        },
      })
      await entered
      try {
        await expect(
          completeUploadSession({
            session,
            secretProvenance: { status: 'exact', entries: [] },
            finalize,
          })
        ).rejects.toMatchObject({ code: 'conflict' })
      } finally {
        release()
      }
      expect((await first).value).toEqual(source)
    })

    it('ordinary upload metadata and an already bound source are unchanged', async () => {
      for (const metadata of [
        { folderId: 'folder' },
        {
          [WORKSPACE_FILE_UPLOAD_PROVENANCE_KEY]: bindWorkspaceFileUploadProvenance(
            workspaceId,
            source
          ),
        },
      ]) {
        const session = await createSession(metadata)
        const result = await completeUploadSession({
          session,
          secretProvenance: { status: 'exact', entries: [] },
          finalize,
        })
        expect(result.session.metadata).toEqual(metadata)
      }
    })
  }
)
