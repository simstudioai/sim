/** Real file versions, storage, and output lineage around the media-processing boundary. */
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import * as audit from '@sim/audit'
import { db } from '@sim/db'
import { auditLog, organization, user, workspace } from '@sim/db/schema'
import { deleteWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { observeContentDelivery, observeContentOutsideModel } from '@/lib/core/application'
import { encryptSecret } from '@/lib/core/security/encryption'
import {
  createKnowledgeAclFixtureIds,
  seedKnowledgeAclFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import type { FfmpegOperation, MediaFile } from '@/lib/media/ffmpeg'
import { createCopilotChatPrincipal } from '@/lib/mothership/auth/application-delegation'
import { createRegistryContentGate } from '@/lib/mothership/content-delivery/registry-gate'
import { ffmpegServerTool } from '@/lib/mothership/tools/server/media/ffmpeg'
import * as workspaceReader from '@/lib/uploads/contexts/workspace'
import {
  fetchWorkspaceFileBuffer,
  getWorkspaceFile,
  updateWorkspaceFileContent,
  uploadWorkspaceFile,
} from '@/lib/uploads/contexts/workspace/file-manager'
import {
  getBoundWorkspaceFileSecretProvenance,
  type WorkspaceFileSecretProvenance,
} from '@/lib/uploads/contexts/workspace/file-secret-provenance'
import { WORKSPACE_FILES_DELEGATION_AUDIENCE } from '@/lib/workspace-files/application/authorization'
import { readWorkspaceFileContent } from '@/lib/workspace-files/application/read-workspace-file-content'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const storage = vi.hoisted(() => ({ root: '' }))
vi.mock('@/lib/uploads/core/setup.server', () => ({
  get UPLOAD_DIR_SERVER() {
    return storage.root
  },
}))
vi.mock('@/lib/media/ffmpeg', () => ({
  runFfmpegOperation: async (_operation: FfmpegOperation, inputs: MediaFile[]) => ({
    buffer: inputs[0].buffer,
    ext: 'bin',
    contentType: 'application/octet-stream',
  }),
}))

const ids = createKnowledgeAclFixtureIds()
const SECRET = 'fixture-media-token-847159'
const CLEAN = { status: 'exact', entries: [] } as const
let known: WorkspaceFileSecretProvenance
let submittedAudits = 0

async function drainAudits() {
  await vi.waitFor(async () =>
    expect(
      await db
        .select({ id: auditLog.id })
        .from(auditLog)
        .where(eq(auditLog.workspaceId, ids.workspaceId))
    ).toHaveLength(submittedAudits)
  )
}

async function replace(fileId: string, content: string, provenance: WorkspaceFileSecretProvenance) {
  return updateWorkspaceFileContent(
    ids.workspaceId,
    fileId,
    ids.aliceId,
    Buffer.from(content),
    undefined,
    {
      version: { source: 'api', authorUserId: ids.aliceId },
      secretProvenancePolicy: { mode: 'replace', provenance },
    }
  )
}

beforeAll(async () => {
  storage.root = mkdtempSync(path.join(tmpdir(), 'sim-media-lineage-'))
  await seedKnowledgeAclFixture(ids)
  known = {
    status: 'exact',
    entries: [
      {
        name: 'MEDIA_TOKEN',
        encryptedValue: (await encryptSecret(SECRET)).encrypted,
        sourceUserId: ids.aliceId,
        sourceWorkspaceId: ids.workspaceId,
      },
    ],
  }
  const record = audit.recordAudit
  vi.spyOn(audit, 'recordAudit').mockImplementation((entry) => {
    if (entry.workspaceId === ids.workspaceId) submittedAudits += 1
    record(entry)
  })
  const batch = audit.recordAuditBatch
  vi.spyOn(audit, 'recordAuditBatch').mockImplementation((entries) => {
    submittedAudits += entries.filter((entry) => entry.workspaceId === ids.workspaceId).length
    batch(entries)
  })
})

afterAll(async () => {
  await drainAudits()
  vi.restoreAllMocks()
  await db.delete(auditLog).where(eq(auditLog.workspaceId, ids.workspaceId))
  await deleteWorkspaceFixture(db, eq(workspace.id, ids.workspaceId))
  await db.delete(organization).where(eq(organization.id, ids.organizationId))
  await db.delete(user).where(inArray(user.id, [ids.aliceId, ids.bobId]))
  await rm(storage.root, { recursive: true, force: true })
})

describe('media input version lineage', () => {
  it.each(['known', 'unknown'] as const)(
    'preserves the storage size-limit error for an admitted %s media source',
    async (classification) => {
      const file = await uploadWorkspaceFile(
        ids.workspaceId,
        ids.aliceId,
        Buffer.from(SECRET),
        `bounded-${generateId()}.bin`,
        'application/octet-stream',
        {
          secretProvenance: classification === 'known' ? known : { status: 'unknown' },
          notifyWorkspaceChange: false,
        }
      )
      await expect(
        observeContentOutsideModel(() =>
          readWorkspaceFileContent.execute({
            principal: createCopilotChatPrincipal(
              { userId: ids.aliceId, workspaceId: ids.workspaceId },
              WORKSPACE_FILES_DELEGATION_AUDIENCE
            ),
            input: { fileId: file.id, maxBytes: 8, includeSecretProvenance: true },
          })
        )
      ).rejects.toMatchObject({
        name: 'PayloadSizeLimitError',
        maxBytes: 8,
        observedBytes: Buffer.byteLength(SECRET),
      })
    }
  )

  it.each(['known', 'unknown'] as const)(
    'does not expose storage failures for %s input bytes before a read result exists',
    async (classification) => {
      const file = await uploadWorkspaceFile(
        ids.workspaceId,
        ids.aliceId,
        Buffer.from(SECRET),
        `${SECRET}-${classification}.bin`,
        'application/octet-stream',
        {
          secretProvenance: classification === 'known' ? known : { status: 'unknown' },
          notifyWorkspaceChange: false,
        }
      )
      await rm(path.join(storage.root, file.key))
      await expect(fetchWorkspaceFileBuffer(file, { maxBytes: 1024 })).rejects.toThrow(SECRET)
      const result = await ffmpegServerTool.execute(
        { operation: 'convert', inputs: { files: [{ path: file.id }] } },
        {
          userId: ids.aliceId,
          workspaceId: ids.workspaceId,
          toolCallId: generateId(),
          copilotToolExecution: true,
          resolvedSecretTraceRegistry: new ResolvedSecretTraceRegistry([], {
            userId: ids.aliceId,
            workspaceId: ids.workspaceId,
          }),
        }
      )
      expect(result.success).toBe(false)
      expect(result.message).not.toContain(SECRET)
      expect(result.message).not.toContain(storage.root)
      await expect(
        observeContentDelivery(
          createRegistryContentGate({
            registry: new ResolvedSecretTraceRegistry([], {
              userId: ids.aliceId,
              workspaceId: ids.workspaceId,
            }),
            actorUserId: ids.aliceId,
            workspaceId: ids.workspaceId,
          }),
          () =>
            readWorkspaceFileContent.execute({
              principal: createCopilotChatPrincipal(
                { userId: ids.aliceId, workspaceId: ids.workspaceId },
                WORKSPACE_FILES_DELEGATION_AUDIENCE
              ),
              input: { fileId: file.id },
            })
        )
      ).rejects.toThrow(
        classification === 'known'
          ? 'File content could not be read'
          : 'File cannot be sent to a model because its secret provenance is unavailable'
      )
      await expect(
        readWorkspaceFileContent.execute({
          principal: { kind: 'session', userId: ids.aliceId, sessionId: generateId() },
          input: { fileId: file.id, includeSecretProvenance: true },
        })
      ).rejects.toThrow(SECRET)
    }
  )

  it.each(['known', 'unknown'] as const)(
    'persists the %s evidence of the bytes read after reference resolution',
    async (classification) => {
      const file = await uploadWorkspaceFile(
        ids.workspaceId,
        ids.aliceId,
        Buffer.from('public version one'),
        `input-${generateId()}.bin`,
        'application/octet-stream',
        { secretProvenance: CLEAN, notifyWorkspaceChange: false }
      )
      const provenance = classification === 'known' ? known : { status: 'unknown' as const }
      const execute = readWorkspaceFileContent.execute
      const pause = vi
        .spyOn(readWorkspaceFileContent, 'execute')
        .mockImplementationOnce(async (args) => {
          await replace(file.id, SECRET, provenance)
          return execute(args)
        })
      try {
        const result = await ffmpegServerTool.execute(
          {
            operation: 'convert',
            inputs: { files: [{ path: `files/${file.name}` }] },
            outputs: { files: [{ path: `files/output-${generateId()}.bin` }] },
          },
          {
            userId: ids.aliceId,
            workspaceId: ids.workspaceId,
            toolCallId: generateId(),
            copilotToolExecution: true,
            resolvedSecretTraceRegistry: new ResolvedSecretTraceRegistry([], {
              userId: ids.aliceId,
              workspaceId: ids.workspaceId,
            }),
          }
        )
        expect(result.success, result.message).toBe(true)
        if (!result.fileId) throw new Error('No output file was persisted')
        const output = await getWorkspaceFile(ids.workspaceId, result.fileId)
        if (!output) throw new Error('Output file cannot be read back')
        expect((await fetchWorkspaceFileBuffer(output, { maxBytes: output.size })).toString()).toBe(
          SECRET
        )
        expect(
          await getBoundWorkspaceFileSecretProvenance(ids.workspaceId, {
            fileId: output.id,
            key: output.key,
            context: output.storageContext ?? 'workspace',
            contentUpdatedAt: output.contentUpdatedAt ?? undefined,
          })
        ).toEqual(provenance)
      } finally {
        pause.mockRestore()
      }
    }
  )

  it('returns the captured version evidence when a replacement commits during its storage read', async () => {
    const file = await uploadWorkspaceFile(
      ids.workspaceId,
      ids.aliceId,
      Buffer.from(SECRET),
      `input-${generateId()}.bin`,
      'application/octet-stream',
      { secretProvenance: known, notifyWorkspaceChange: false }
    )
    const fetchContent = workspaceReader.fetchWorkspaceFileBuffer
    const pause = vi
      .spyOn(workspaceReader, 'fetchWorkspaceFileBuffer')
      .mockImplementationOnce(async (...args) => {
        const bytes = await fetchContent(...args)
        await replace(file.id, 'public replacement', CLEAN)
        return bytes
      })
    try {
      const result = await readWorkspaceFileContent.execute({
        principal: { kind: 'session', userId: ids.aliceId, sessionId: generateId() },
        input: {
          fileId: file.id,
          assertedWorkspaceId: ids.workspaceId,
          includeSecretProvenance: true,
        },
      })
      expect(result.content.toString()).toBe(SECRET)
      expect(result.file.key).toBe(file.key)
      expect(result.secretProvenance).toEqual(known)
    } finally {
      pause.mockRestore()
    }
  })
})
