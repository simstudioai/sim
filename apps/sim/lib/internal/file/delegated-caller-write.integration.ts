/**
 * Mothership runs a file tool through `tools execute`, whose use case authorizes the chat's
 * delegated principal for `sim:tool-execution`. The File write that follows must still reach the
 * workspace-file use cases, which admit only `sim:workspace-files`, and must still refuse a
 * subject or workspace the original delegation does not cover. Exercises the real handler,
 * application authorization, metadata and local storage against Postgres.
 */
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { SubjectDelegatedPrincipal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { auditLog, organization, user, workspace, workspaceFiles } from '@sim/db/schema'
import { deleteWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { createDelegatedPrincipal } from '@sim/testing/factories/principal.factory'
import { setUploadDirServer, uploadsSetupMock } from '@sim/testing/mocks/uploads-setup.mock'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/uploads/core/setup.server', () => uploadsSetupMock)

import { executeFileTool } from '@/lib/internal/file/execute-tool'
import {
  createKnowledgeAclFixtureIds,
  seedKnowledgeAclFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import { uploadCopilotFile } from '@/lib/uploads/contexts/copilot/file-manager'

const fixtures: ReturnType<typeof createKnowledgeAclFixtureIds>[] = []

async function seed() {
  const ids = createKnowledgeAclFixtureIds()
  fixtures.push(ids)
  await seedKnowledgeAclFixture(ids)
  return ids
}

type Fixture = Awaited<ReturnType<typeof seed>>

/** The chat principal `tools execute` hands to the tool layer. */
function toolExecutionPrincipal(subjectUserId: string, workspaceId: string) {
  return createDelegatedPrincipal({
    subjectUserId,
    workspaceId,
    audience: 'sim:tool-execution',
    resourceScope: { chatId: generateId() },
  })
}

/** A generated image as `image_generate` stores it outside a workflow run. */
async function generatedImage(ownerId: string) {
  return uploadCopilotFile({
    buffer: Buffer.from(`image bytes ${generateId()}`),
    fileName: `${generateId()}.webp`,
    contentType: 'image/webp',
    userId: ownerId,
  })
}

async function writeCopy(
  ids: Fixture,
  principal: SubjectDelegatedPrincipal,
  fileInput: Awaited<ReturnType<typeof generatedImage>>
) {
  const fileName = `saved-${generateId()}.webp`
  const response = await executeFileTool({
    toolId: 'file_write',
    input: { operation: 'write', workspaceId: ids.workspaceId, fileName, fileInput },
    headers: new Headers(),
    requestId: generateId(),
    context: {
      workflowId: '',
      workspaceId: ids.workspaceId,
      userId: principal.subjectUserId,
      callerPrincipal: principal,
    },
  })
  const [saved] = await db
    .select({ id: workspaceFiles.id, sizeBytes: workspaceFiles.sizeBytes })
    .from(workspaceFiles)
    .where(
      and(
        eq(workspaceFiles.workspaceId, ids.workspaceId),
        eq(workspaceFiles.originalName, fileName),
        eq(workspaceFiles.context, 'workspace')
      )
    )
  return { status: response.status, saved }
}

const uploadRoot = mkdtempSync(path.join(tmpdir(), 'sim-delegated-caller-write-'))

beforeAll(() => {
  setUploadDirServer(uploadRoot)
})

afterAll(async () => {
  try {
    for (const ids of fixtures) {
      await db.delete(auditLog).where(eq(auditLog.workspaceId, ids.workspaceId))
      await db
        .delete(workspaceFiles)
        .where(inArray(workspaceFiles.userId, [ids.aliceId, ids.bobId]))
      await deleteWorkspaceFixture(db, eq(workspace.id, ids.workspaceId))
      await db.delete(organization).where(eq(organization.id, ids.organizationId))
      await db.delete(user).where(inArray(user.id, [ids.aliceId, ids.bobId]))
    }
    await rm(uploadRoot, { recursive: true, force: true })
  } finally {
    await db.$client.end()
  }
})

describe('a File write run directly from a Mothership chat', () => {
  it('saves a generated image into Workspace Files', async () => {
    const ids = await seed()
    const image = await generatedImage(ids.aliceId)

    const result = await writeCopy(ids, toolExecutionPrincipal(ids.aliceId, ids.workspaceId), image)

    expect(result.status).toBe(200)
    expect(result.saved?.sizeBytes).toBe(image.size)
  })

  it('still refuses a member whose role cannot write', async () => {
    const ids = await seed()
    const image = await generatedImage(ids.bobId)

    const result = await writeCopy(ids, toolExecutionPrincipal(ids.bobId, ids.workspaceId), image)

    expect(result.status).toBe(403)
    expect(result.saved).toBeUndefined()
  })

  it('still refuses a delegation minted for another workspace', async () => {
    const ids = await seed()
    const image = await generatedImage(ids.aliceId)

    const result = await writeCopy(ids, toolExecutionPrincipal(ids.aliceId, generateId()), image)

    expect(result.status).toBe(403)
    expect(result.saved).toBeUndefined()
  })
})
