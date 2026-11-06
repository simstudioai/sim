/**
 * A File block write that copies an existing workspace file (`fileInput`) carries the source's
 * durable secret provenance onto the copy. Exercises the real file operation, application
 * authorization, metadata, provenance sidecars and local storage against Postgres.
 */
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { db } from '@sim/db'
import {
  auditLog,
  organization,
  permissions,
  user,
  workspace,
  workspaceFiles,
} from '@sim/db/schema'
import { deleteWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const fixtureStorage = vi.hoisted(() => ({ root: '' }))
vi.mock('@/lib/uploads/core/setup.server', () => ({
  get UPLOAD_DIR_SERVER() {
    return fixtureStorage.root
  },
}))

import { fileManageBodySchema } from '@/lib/api/contracts/tools/file'
import { encryptSecret } from '@/lib/core/security/encryption'
import { executeFileManageOperation } from '@/lib/internal/file/operations'
import {
  createKnowledgeAclFixtureIds,
  seedKnowledgeAclFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import {
  updateWorkspaceFileContent,
  uploadWorkspaceFile,
} from '@/lib/uploads/contexts/workspace/file-manager'
import {
  getBoundWorkspaceFileSecretProvenance,
  type WorkspaceFileSecretProvenance,
} from '@/lib/uploads/contexts/workspace/file-secret-provenance'
import { createWorkspaceFileDelegatedPrincipal } from '@/lib/workspace-files/application/delegated-principal'

const fixtures: ReturnType<typeof createKnowledgeAclFixtureIds>[] = []
const FIXTURE_SECRET = 'fixture-resolved-secret-not-a-live-key'

async function seed() {
  const ids = createKnowledgeAclFixtureIds()
  fixtures.push(ids)
  await seedKnowledgeAclFixture(ids)
  return ids
}

type Fixture = Awaited<ReturnType<typeof seed>>

async function secretEntryFrom(ownerId: string, workspaceId: string) {
  return {
    name: 'FIXTURE_TOKEN',
    encryptedValue: (await encryptSecret(FIXTURE_SECRET)).encrypted,
    sourceUserId: ownerId,
    sourceWorkspaceId: workspaceId,
  }
}

async function uploadSource(
  workspaceId: string,
  ownerId: string,
  provenance: WorkspaceFileSecretProvenance = { status: 'exact', entries: [] }
) {
  return uploadWorkspaceFile(
    workspaceId,
    ownerId,
    Buffer.from(`source bytes ${generateId()}`),
    `source-${generateId()}.txt`,
    'text/plain',
    { secretProvenance: provenance }
  )
}

/** The File block's executor-delegated call, as a workflow run makes it. */
async function runOperation(ids: Fixture, body: Record<string, unknown>) {
  return executeFileManageOperation(
    fileManageBodySchema.parse({ workspaceId: ids.workspaceId, ...body }),
    {
      principal: createWorkspaceFileDelegatedPrincipal({
        serviceId: 'executor',
        subjectUserId: ids.aliceId,
        workspaceId: ids.workspaceId,
        delegationId: generateId(),
      }),
      workspaceId: ids.workspaceId,
      attributedUserId: ids.aliceId,
      fileAccessUserId: ids.aliceId,
      workflowId: generateId(),
      headers: new Headers(),
      requestId: generateId(),
    }
  )
}

/** Writes a copy of `fileInput` and returns the provenance stored for the copy, or the refusal. */
async function copyProvenance(ids: Fixture, fileInput: Record<string, unknown>) {
  const response = await runOperation(ids, {
    operation: 'write',
    fileName: `copy-${generateId()}.txt`,
    fileInput,
  })
  const body = await response.json()
  if (response.status !== 200) return { refused: response.status }
  const [copy] = await db.select().from(workspaceFiles).where(eq(workspaceFiles.id, body.data.id))
  if (!copy) throw new Error('The copy has no workspace file record')
  return getBoundWorkspaceFileSecretProvenance(ids.workspaceId, {
    fileId: copy.id,
    key: copy.key,
    context: 'workspace',
    contentUpdatedAt: copy.contentUpdatedAt,
  })
}

/** A block-reference UserFile, as a File list/read output hands it on. */
type SourceFile = Awaited<ReturnType<typeof uploadSource>>

function blockReference(source: SourceFile) {
  return {
    id: source.id,
    name: source.name,
    url: source.url,
    size: source.size,
    type: source.type,
    key: source.key,
    context: 'workspace',
  }
}

beforeAll(() => {
  fixtureStorage.root = mkdtempSync(path.join(tmpdir(), 'sim-write-copy-provenance-'))
})

afterAll(async () => {
  try {
    for (const ids of fixtures) {
      await db.delete(auditLog).where(eq(auditLog.workspaceId, ids.workspaceId))
      await deleteWorkspaceFixture(db, eq(workspace.id, ids.workspaceId))
      await db.delete(organization).where(eq(organization.id, ids.organizationId))
      await db.delete(user).where(inArray(user.id, [ids.aliceId, ids.bobId]))
    }
    await rm(fixtureStorage.root, { recursive: true, force: true })
  } finally {
    await db.$client.end()
  }
})

describe('copying a workspace file with the File write operation', () => {
  it.each<{ shape: string; toInput: (source: SourceFile) => Record<string, unknown> }>([
    { shape: 'a block-reference file', toInput: blockReference },
    {
      shape: 'a block-reference file without a context',
      toInput: (source) => {
        const { context: _context, ...file } = blockReference(source)
        return file
      },
    },
    {
      shape: 'a file picker value',
      toInput: (source) => ({
        name: source.name,
        path: source.url,
        key: source.key,
        size: source.size,
        type: source.type,
      }),
    },
  ])('keeps a clean source exact when given $shape', async ({ toInput }) => {
    const ids = await seed()
    const source = await uploadSource(ids.workspaceId, ids.aliceId)

    expect(await copyProvenance(ids, toInput(source))).toEqual({ status: 'exact', entries: [] })
  })

  it("carries the caller's own recorded secrets onto the copy", async () => {
    const ids = await seed()
    const entry = await secretEntryFrom(ids.aliceId, ids.workspaceId)
    const source = await uploadSource(ids.workspaceId, ids.aliceId, {
      status: 'exact',
      entries: [entry],
    })

    expect(await copyProvenance(ids, blockReference(source))).toEqual({
      status: 'exact',
      entries: [entry],
    })
  })

  it("keeps a copy of another member's secret-bearing file unknown", async () => {
    const ids = await seed()
    const source = await uploadSource(ids.workspaceId, ids.bobId, {
      status: 'exact',
      entries: [await secretEntryFrom(ids.bobId, ids.workspaceId)],
    })

    expect(await copyProvenance(ids, blockReference(source))).toEqual({ status: 'unknown' })
  })

  it('refuses to copy a superseded version key', async () => {
    const ids = await seed()
    const source = await uploadSource(ids.workspaceId, ids.aliceId)
    await updateWorkspaceFileContent(
      ids.workspaceId,
      source.id,
      ids.aliceId,
      Buffer.from('newer bytes'),
      'text/plain',
      {
        version: { source: 'api', authorUserId: ids.aliceId },
        syncLiveDoc: false,
        secretProvenancePolicy: {
          mode: 'replace',
          provenance: { status: 'exact', entries: [] },
        },
      }
    )

    expect(await copyProvenance(ids, blockReference(source))).toEqual({ refused: 404 })
  })

  it("refuses to copy another workspace's key", async () => {
    const ids = await seed()
    const other = await seed()
    /** Alice can read the other workspace, so only the key's tenancy makes it foreign here. */
    await db.insert(permissions).values({
      id: generateId(),
      userId: ids.aliceId,
      entityType: 'workspace',
      entityId: other.workspaceId,
      permissionType: 'admin',
    })
    const foreign = await uploadSource(other.workspaceId, other.aliceId)

    expect(await copyProvenance(ids, blockReference(foreign))).toEqual({ refused: 404 })
  })
})

describe('managing sharing for a file picker value', () => {
  it('resolves the storage key to its workspace file', async () => {
    const ids = await seed()
    const source = await uploadSource(ids.workspaceId, ids.aliceId)

    const response = await runOperation(ids, {
      operation: 'manage_sharing',
      fileInput: { name: source.name, path: source.url, key: source.key },
      isActive: true,
    })
    const body = await response.json()

    expect(response.status, JSON.stringify(body)).toBe(200)
    expect(body.data.share).toMatchObject({ isActive: true })
  })
})
