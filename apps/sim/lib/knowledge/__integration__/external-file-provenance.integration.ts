/** Real parser downloads, execution storage, durable sidecars, and enforced model admission. */
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { db } from '@sim/db'
import {
  knowledgeBase,
  organization,
  user,
  workspace,
  workspaceFileColumns,
  workspaceFiles,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { isPlainRecord } from '@sim/utils/object'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const fixtureStorage = vi.hoisted(() => {
  process.env.DURABLE_SECRET_PROVENANCE_ENFORCED_SURFACES = 'workspace-file'
  return { root: '' }
})
vi.mock('@/lib/uploads/core/setup.server', () => ({
  get UPLOAD_DIR_SERVER() {
    return fixtureStorage.root
  },
}))

import { fileParseBodySchema } from '@/lib/api/contracts/storage-transfer'
import { encryptSecret } from '@/lib/core/security/encryption'
import * as inputValidation from '@/lib/core/security/input-validation.server'
import { isUserFileWithMetadata } from '@/lib/core/utils/user-file'
import { isDurableSecretProvenanceEnforced } from '@/lib/execution/durable-secret-provenance-enforcement'
import { executeFileParserOperation } from '@/lib/internal/file/parser'
import {
  createKnowledgeAclFixtureIds,
  seedKnowledgeAclFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import { uploadExecutionFile } from '@/lib/uploads/contexts/execution/execution-file-manager'
import { uploadWorkspaceFile } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import {
  getBoundWorkspaceFileSecretProvenance,
  importWorkspaceFileSecretProvenanceForModelView,
  type WorkspaceFileSecretProvenance,
  type WorkspaceFileSecretProvenanceIdentity,
} from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import { downloadFile } from '@/lib/uploads/core/storage-service'
import { createWorkspaceFileDelegatedPrincipal } from '@/lib/workspace-files/application/delegated-principal'
import type { UserFile } from '@/executor/types'
import { projectResolvedSecretModelContent } from '@/executor/utils/resolved-secret-content-projection'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const fixtures: ReturnType<typeof createKnowledgeAclFixtureIds>[] = []
const fetchSpy = vi.spyOn(inputValidation, 'secureFetchWithPinnedIP')
const validateUrlSpy = vi.spyOn(inputValidation, 'validateUrlWithDNS')
const EXTERNAL_IMAGE_URL = 'https://fixture.example.test/private/image.png'
const FIXTURE_SECRET = 'fixture-sim-secret-not-a-live-credential'
const IMAGE_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01])

async function seed() {
  const ids = createKnowledgeAclFixtureIds()
  fixtures.push(ids)
  await seedKnowledgeAclFixture(ids)
  return { ...ids, workflowId: generateId(), executionId: generateId() }
}

type Fixture = Awaited<ReturnType<typeof seed>>

async function parse(ids: Fixture, filePath: string, headers?: Record<string, string>) {
  const response = await executeFileParserOperation(
    fileParseBodySchema.parse({ filePath, headers }),
    {
      principal: createWorkspaceFileDelegatedPrincipal({
        serviceId: 'executor',
        subjectUserId: ids.aliceId,
        workspaceId: ids.workspaceId,
        delegationId: generateId(),
        executionId: ids.executionId,
      }),
      workspaceId: ids.workspaceId,
      workflowId: ids.workflowId,
      executionId: ids.executionId,
      attributedUserId: ids.aliceId,
      fileAccessUserId: ids.aliceId,
    }
  )
  const body: unknown = await response.json()
  expect(response.status, JSON.stringify(body)).toBe(200)
  if (
    !isPlainRecord(body) ||
    body.success !== true ||
    !isPlainRecord(body.output) ||
    !isUserFileWithMetadata(body.output.file) ||
    typeof body.output.content !== 'string'
  ) {
    throw new Error(`Parser did not return an execution copy: ${JSON.stringify(body)}`)
  }
  return { file: body.output.file, content: body.output.content }
}

async function identityFor(file: UserFile): Promise<WorkspaceFileSecretProvenanceIdentity> {
  const [record] = await db
    .select(workspaceFileColumns)
    .from(workspaceFiles)
    .where(eq(workspaceFiles.key, file.key))
  if (!record || record.context !== 'execution') {
    throw new Error('Parser copy has no canonical execution metadata')
  }
  expect(record.secretProvenanceVersion).toBe(1)
  return {
    fileId: record.id,
    key: record.key,
    context: record.context,
    contentUpdatedAt: record.contentUpdatedAt,
  }
}

beforeAll(() => {
  fixtureStorage.root = mkdtempSync(path.join(tmpdir(), 'sim-external-file-provenance-'))
  expect(isDurableSecretProvenanceEnforced('workspace-file')).toBe(true)
})
beforeEach(() => {
  fetchSpy.mockReset()
  validateUrlSpy.mockReset()
  validateUrlSpy.mockResolvedValue({
    isValid: true,
    resolvedIP: '203.0.113.10',
    originalHostname: new URL(EXTERNAL_IMAGE_URL).hostname,
  })
  const response = new Response(IMAGE_BYTES)
  fetchSpy.mockResolvedValue({
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    headers: new inputValidation.SecureFetchHeaders({ 'content-type': 'image/png' }),
    body: response.body,
    text: () => response.text(),
    json: () => response.json(),
    arrayBuffer: () => response.arrayBuffer(),
  })
})
afterAll(async () => {
  fetchSpy.mockRestore()
  validateUrlSpy.mockRestore()
  for (const ids of fixtures) {
    await db.delete(knowledgeBase).where(eq(knowledgeBase.id, ids.knowledgeBaseId))
    await db.delete(workspace).where(eq(workspace.id, ids.workspaceId))
    await db.delete(organization).where(eq(organization.id, ids.organizationId))
    await db.delete(user).where(inArray(user.id, [ids.aliceId, ids.bobId]))
  }
  await rm(fixtureStorage.root, { recursive: true, force: true })
  await db.$client.end()
})

describe('external file ingress under durable enforcement', () => {
  it('admits the exact downloaded binary bytes despite authenticated transport', async () => {
    const ids = await seed()
    const parsed = await parse(ids, EXTERNAL_IMAGE_URL, {
      Authorization: 'Bearer fixture-download-credential',
    })
    expect(fetchSpy).toHaveBeenCalledWith(
      EXTERNAL_IMAGE_URL,
      '203.0.113.10',
      expect.objectContaining({
        headers: { Authorization: 'Bearer fixture-download-credential' },
      })
    )
    const identity = await identityFor(parsed.file)
    expect(await downloadFile({ key: parsed.file.key, context: 'execution' })).toEqual(IMAGE_BYTES)
    expect(await getBoundWorkspaceFileSecretProvenance(ids.workspaceId, identity)).toEqual({
      status: 'exact',
      entries: [],
    })
    expect(
      await importWorkspaceFileSecretProvenanceForModelView({
        workspaceId: ids.workspaceId,
        identity,
        view: 'opaque',
      })
    ).toBe(true)

    /** A real unrecorded control proves this suite has not silently disabled enforcement. */
    const unrecorded = await uploadExecutionFile(
      ids,
      IMAGE_BYTES,
      'unrecorded.png',
      'image/png',
      ids.aliceId,
      { status: 'unrecorded' }
    )
    expect(
      await importWorkspaceFileSecretProvenanceForModelView({
        workspaceId: ids.workspaceId,
        identity: await identityFor(unrecorded),
        view: 'opaque',
      })
    ).toBe(false)
  })

  it('preserves and redacts owned text lineage while refusing opaque egress', async () => {
    const ids = await seed()
    const { encrypted } = await encryptSecret(FIXTURE_SECRET)
    const provenance: WorkspaceFileSecretProvenance = {
      status: 'exact',
      entries: [
        {
          name: 'FIXTURE_SECRET',
          encryptedValue: encrypted,
          sourceUserId: ids.aliceId,
          sourceWorkspaceId: ids.workspaceId,
        },
      ],
    }
    const content = `Saved secret: ${FIXTURE_SECRET}\n`
    const source = await uploadWorkspaceFile(
      ids.workspaceId,
      ids.aliceId,
      Buffer.from(content),
      'owned.txt',
      'text/plain',
      { secretProvenance: provenance }
    )
    const parsed = await parse(ids, source.url)
    const identity = await identityFor(parsed.file)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(parsed.content).toBe(content)
    expect(await getBoundWorkspaceFileSecretProvenance(ids.workspaceId, identity)).toEqual(
      provenance
    )
    expect(
      await importWorkspaceFileSecretProvenanceForModelView({
        workspaceId: ids.workspaceId,
        identity,
        view: 'opaque',
      })
    ).toBe(false)

    const registry = new ResolvedSecretTraceRegistry([], {
      userId: ids.aliceId,
      workspaceId: ids.workspaceId,
    })
    expect(
      await importWorkspaceFileSecretProvenanceForModelView({
        workspaceId: ids.workspaceId,
        identity,
        registry,
        value: parsed.content,
        view: 'complete',
      })
    ).toBe(true)
    const projected = projectResolvedSecretModelContent(parsed.content, registry)
    expect(projected).toEqual({ safe: true, value: 'Saved secret: {{FIXTURE_SECRET}}\n' })
  })

  it('keeps an owned unknown source unknown through its execution copy', async () => {
    const ids = await seed()
    const source = await uploadWorkspaceFile(
      ids.workspaceId,
      ids.aliceId,
      IMAGE_BYTES,
      'unknown.png',
      'image/png',
      { secretProvenance: { status: 'unknown' } }
    )
    const parsed = await parse(ids, source.url)
    const identity = await identityFor(parsed.file)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(await getBoundWorkspaceFileSecretProvenance(ids.workspaceId, identity)).toEqual({
      status: 'unknown',
    })
    expect(
      await importWorkspaceFileSecretProvenanceForModelView({
        workspaceId: ids.workspaceId,
        identity,
        view: 'opaque',
      })
    ).toBe(false)
  })
})
