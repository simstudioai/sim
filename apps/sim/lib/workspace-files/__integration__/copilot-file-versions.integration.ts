/** Chat's in-process CLI reading and reverting workspace file version history as the delegating user. */
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { db } from '@sim/db'
import {
  auditLog,
  organization,
  permissionGroup,
  permissionGroupMember,
  permissionGroupWorkspace,
  permissions,
  user,
  workspace,
  workspaceFileVersion,
} from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { envFlagsMock } from '@sim/testing/mocks/env-flags.mock'
import { generateId } from '@sim/utils/id'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/config/env-flags', () => ({ ...envFlagsMock, isAccessControlEnabled: true }))

const fixtureStorage = vi.hoisted(() => ({ root: '' }))
vi.mock('@/lib/uploads/core/setup.server', () => ({
  get UPLOAD_DIR_SERVER() {
    return fixtureStorage.root
  },
}))

import { withWorkspaceInvocationScope } from '@/lib/core/application/workspace-invocation-scope'
import { encryptSecret } from '@/lib/core/security/encryption'
import {
  createKnowledgeAclFixtureIds,
  seedKnowledgeAclFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import { createFileReadTransport } from '@/lib/mothership/agent-cli/file-read-transport'
import { createScopedCliTransport } from '@/lib/mothership/agent-cli/scoped-transport'
import {
  updateWorkspaceFileContent,
  uploadWorkspaceFile,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import type { WorkspaceFileSecretProvenance } from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import { projectResolvedSecretModelContent } from '@/executor/utils/resolved-secret-content-projection'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import '@/app/api/v2/files/[fileId]/versions/route'
import '@/app/api/v2/files/[fileId]/versions/[version]/route'
import '@/app/api/v2/files/[fileId]/versions/[version]/content/route'
import '@/app/api/v2/files/[fileId]/versions/[version]/revert/route'
import '@/app/api/v2/files/[fileId]/versions/[version]/text/route'

const ORIGIN = 'http://localhost:3000'
const SECRET = 'SYNTHETIC_CHAT_VERSION_SECRET'
const UNAVAILABLE = {
  error: { code: 'FORBIDDEN', message: 'This operation is unavailable through Mothership.' },
}

describe('chat-delegated file version history', () => {
  const fixtures: ReturnType<typeof createKnowledgeAclFixtureIds>[] = []

  beforeAll(() => {
    fixtureStorage.root = mkdtempSync(path.join(tmpdir(), 'sim-chat-file-versions-'))
  })

  const extraWorkspaceIds: string[] = []

  afterAll(async () => {
    if (extraWorkspaceIds.length > 0)
      await deleteWorkspaceFixture(db, inArray(workspace.id, extraWorkspaceIds))
    for (const ids of fixtures) {
      await db.delete(auditLog).where(eq(auditLog.workspaceId, ids.workspaceId))
      await deleteWorkspaceFixture(db, eq(workspace.id, ids.workspaceId))
      await db.delete(organization).where(eq(organization.id, ids.organizationId))
      await db.delete(user).where(inArray(user.id, [ids.aliceId, ids.bobId]))
    }
    await rm(fixtureStorage.root, { recursive: true, force: true })
  })

  /** Version 2 holds a named secret; version 3 replaced it with public text. */
  async function seedVersionedFile(historicalProvenance?: WorkspaceFileSecretProvenance) {
    const ids = createKnowledgeAclFixtureIds()
    fixtures.push(ids)
    await seedKnowledgeAclFixture(ids)
    const file = await uploadWorkspaceFile(
      ids.workspaceId,
      ids.aliceId,
      Buffer.from('placeholder'),
      `notes-${generateId()}.txt`,
      'text/plain',
      { notifyWorkspaceChange: false }
    )
    const secretProvenance = {
      status: 'exact',
      entries: [
        {
          encryptedValue: (await encryptSecret(SECRET)).encrypted,
          sourceUserId: ids.aliceId,
          sourceWorkspaceId: ids.workspaceId,
          name: 'FILE_TOKEN',
        },
      ],
    } as const
    for (const [content, provenance] of [
      [`token=${SECRET}`, historicalProvenance ?? secretProvenance],
      ['public replacement', { status: 'exact', entries: [] }],
    ] as const) {
      await updateWorkspaceFileContent(
        ids.workspaceId,
        file.id,
        ids.aliceId,
        Buffer.from(content),
        undefined,
        {
          version: { source: 'api', authorUserId: ids.aliceId },
          secretProvenancePolicy: { mode: 'replace', provenance },
        }
      )
    }
    return { ...ids, fileId: file.id }
  }

  /**
   * Chat's composed CLI transport: the provenance-observing read layer over in-process admission.
   * `layers` drops the outer layers to prove the inner ones hold on their own.
   */
  function chatTransport(
    fixture: { workspaceId: string; organizationId: string },
    userId: string,
    registry?: ResolvedSecretTraceRegistry,
    layers: { observer?: boolean; invocationScope?: boolean } = {}
  ) {
    const invocation = { userId, workspaceId: fixture.workspaceId, chatId: generateId() }
    const scoped = createScopedCliTransport(ORIGIN, invocation)
    const transport =
      layers.observer === false
        ? scoped
        : createFileReadTransport({
            endpoint: ORIGIN,
            transport: scoped,
            userId,
            invocation,
            ...(registry ? { registry } : {}),
          })
    return (url: string, init?: RequestInit) =>
      layers.invocationScope === false
        ? transport(`${ORIGIN}${url}`, init)
        : withWorkspaceInvocationScope(
            { workspaceId: fixture.workspaceId, organizationId: fixture.organizationId },
            () => transport(`${ORIGIN}${url}`, init)
          )
  }

  function registryFor(fixture: { workspaceId: string }, userId: string) {
    return new ResolvedSecretTraceRegistry([], { userId, workspaceId: fixture.workspaceId })
  }

  function versionRows(fileId: string) {
    return db
      .select({ version: workspaceFileVersion.version, source: workspaceFileVersion.source })
      .from(workspaceFileVersion)
      .where(eq(workspaceFileVersion.fileId, fileId))
      .orderBy(asc(workspaceFileVersion.version))
  }

  it('lists and describes versions for a read-only member', async () => {
    const fixture = await seedVersionedFile()
    const chat = chatTransport(fixture, fixture.bobId)
    const query = `workspaceId=${fixture.workspaceId}`

    const list = await chat(`/api/v2/files/${fixture.fileId}/versions?${query}`)
    expect(list.status).toBe(200)
    expect((await list.json()).data.map((entry: { version: number }) => entry.version)).toEqual([
      3, 2, 1,
    ])

    const detail = await chat(`/api/v2/files/${fixture.fileId}/versions/2?${query}`)
    expect(detail.status).toBe(200)
    expect(await detail.json()).toMatchObject({ data: { version: 2, isCurrent: false } })
  })

  it("reads a historical version's text under its snapshot's secret provenance", async () => {
    const fixture = await seedVersionedFile()
    const url = `/api/v2/files/${fixture.fileId}/versions/2/text?workspaceId=${fixture.workspaceId}`
    const registry = new ResolvedSecretTraceRegistry([], {
      userId: fixture.bobId,
      workspaceId: fixture.workspaceId,
    })

    const response = await chatTransport(fixture, fixture.bobId, registry)(url)
    expect(response.status).toBe(200)
    const body = await response.text()
    expect(body).toContain(SECRET)
    const projected = projectResolvedSecretModelContent(body, registry)
    if (!projected.safe) throw new Error('Historical version text was withheld')
    expect(projected.value).not.toContain(SECRET)
    expect(projected.value).toContain('token=[REDACTED_SECRET]')

    const untracked = await chatTransport(fixture, fixture.bobId)(url)
    expect(untracked.status).toBe(503)
    const refusal = await untracked.text()
    expect(refusal).not.toContain(SECRET)
    expect(refusal).toContain('provenance is unavailable')
  })

  it('reverts as the delegating writer and audits the Chat actor', async () => {
    const fixture = await seedVersionedFile()

    const response = await chatTransport(fixture, fixture.aliceId)(
      `/api/v2/files/${fixture.fileId}/versions/1/revert`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId: fixture.workspaceId, expectedCurrentVersion: 3 }),
      }
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      data: { reverted: true, version: { version: 4, source: 'revert', restoredFromVersion: 1 } },
    })
    await vi.waitFor(async () => {
      const [audit] = await db
        .select({ actorId: auditLog.actorId, metadata: auditLog.metadata })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.workspaceId, fixture.workspaceId),
            eq(auditLog.resourceId, fixture.fileId)
          )
        )
      expect(audit).toMatchObject({
        actorId: fixture.aliceId,
        metadata: {
          operation: 'files.versions.revert',
          actor: { kind: 'delegated', serviceId: 'copilot' },
        },
      })
    })
  })

  it('refuses a revert from a read-only member', async () => {
    const fixture = await seedVersionedFile()

    const response = await chatTransport(fixture, fixture.bobId)(
      `/api/v2/files/${fixture.fileId}/versions/1/revert`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId: fixture.workspaceId }),
      }
    )

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({
      error: { code: 'FORBIDDEN', details: { code: 'INSUFFICIENT_WORKSPACE_ROLE' } },
    })
    expect((await versionRows(fixture.fileId)).map((row) => row.version)).toEqual([1, 2, 3])
  })

  it('keeps version delete and download direct-only', async () => {
    const fixture = await seedVersionedFile()
    const chat = chatTransport(fixture, fixture.aliceId)
    const query = `workspaceId=${fixture.workspaceId}`

    const deletion = await chat(`/api/v2/files/${fixture.fileId}/versions/1?${query}`, {
      method: 'DELETE',
    })
    expect(deletion.status).toBe(403)
    expect(await deletion.json()).toMatchObject(UNAVAILABLE)

    const download = await chat(`/api/v2/files/${fixture.fileId}/versions/2/content?${query}`)
    expect(download.status).toBe(403)
    expect(await download.json()).toMatchObject(UNAVAILABLE)

    expect((await versionRows(fixture.fileId)).map((row) => row.version)).toEqual([1, 2, 3])
  })

  it('refuses a delegated version read that no delivery observer records', async () => {
    const fixture = await seedVersionedFile()

    const response = await chatTransport(fixture, fixture.bobId, undefined, { observer: false })(
      `/api/v2/files/${fixture.fileId}/versions/2/text?workspaceId=${fixture.workspaceId}`
    )

    expect(response.status).toBe(503)
    const body = await response.text()
    expect(body).not.toContain(SECRET)
    expect(JSON.parse(body)).toMatchObject({ error: { code: 'SERVICE_UNAVAILABLE' } })
  })

  it("refuses a file in another of the user's workspaces without the invocation scope", async () => {
    const fixture = await seedVersionedFile()
    const otherWorkspaceId = generateId()
    extraWorkspaceIds.push(otherWorkspaceId)
    await insertWorkspaceFixture(db, {
      id: otherWorkspaceId,
      organizationId: fixture.organizationId,
      name: 'Second workspace',
      ownerId: fixture.aliceId,
      billedAccountUserId: fixture.aliceId,
    })
    await db.insert(permissions).values({
      id: generateId(),
      userId: fixture.aliceId,
      entityType: 'workspace',
      entityId: otherWorkspaceId,
      permissionType: 'admin',
    })
    const chat = chatTransport(
      { workspaceId: otherWorkspaceId, organizationId: fixture.organizationId },
      fixture.aliceId,
      undefined,
      { invocationScope: false }
    )

    for (const assertedWorkspaceId of [fixture.workspaceId, otherWorkspaceId]) {
      const list = await chat(
        `/api/v2/files/${fixture.fileId}/versions?workspaceId=${assertedWorkspaceId}`
      )
      expect(list.status).toBe(404)
      expect(await list.json()).toMatchObject({ error: { code: 'NOT_FOUND' } })
    }
    const revert = await chat(`/api/v2/files/${fixture.fileId}/versions/1/revert`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspaceId: fixture.workspaceId }),
    })
    expect(revert.status).toBe(404)
    expect((await versionRows(fixture.fileId)).map((row) => row.version)).toEqual([1, 2, 3])
  })

  it('refuses a member whose permission group withholds the Files module', async () => {
    const fixture = await seedVersionedFile()
    const groupId = generateId()
    await db.insert(permissionGroup).values({
      id: groupId,
      organizationId: fixture.organizationId,
      name: 'No files',
      createdBy: fixture.aliceId,
      config: { hideFilesTab: true },
    })
    await db.insert(permissionGroupWorkspace).values({
      id: generateId(),
      permissionGroupId: groupId,
      workspaceId: fixture.workspaceId,
      organizationId: fixture.organizationId,
    })
    await db.insert(permissionGroupMember).values({
      id: generateId(),
      permissionGroupId: groupId,
      organizationId: fixture.organizationId,
      userId: fixture.bobId,
    })

    const response = await chatTransport(
      fixture,
      fixture.bobId
    )(`/api/v2/files/${fixture.fileId}/versions?workspaceId=${fixture.workspaceId}`)

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({
      error: { code: 'FORBIDDEN', details: { code: 'PERMISSION_GROUP_CAPABILITY_BLOCKED' } },
    })
  })

  it('withholds a historical version whose secret provenance is unknown', async () => {
    const fixture = await seedVersionedFile({ status: 'unknown' })

    const response = await chatTransport(
      fixture,
      fixture.bobId,
      registryFor(fixture, fixture.bobId)
    )(`/api/v2/files/${fixture.fileId}/versions/2/text?workspaceId=${fixture.workspaceId}`)

    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain(SECRET)
  })

  it('keeps a secret redacted after Chat reverts the file to the version holding it', async () => {
    const fixture = await seedVersionedFile()
    const reverted = await chatTransport(fixture, fixture.aliceId)(
      `/api/v2/files/${fixture.fileId}/versions/2/revert`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId: fixture.workspaceId }),
      }
    )
    expect(reverted.status).toBe(200)
    const url = `/api/v2/files/${fixture.fileId}/text?workspaceId=${fixture.workspaceId}`
    const registry = registryFor(fixture, fixture.bobId)

    const response = await chatTransport(fixture, fixture.bobId, registry)(url)
    expect(response.status).toBe(200)
    const projected = projectResolvedSecretModelContent(await response.text(), registry)
    if (!projected.safe) throw new Error('Reverted file text was withheld')
    expect(projected.value).not.toContain(SECRET)
    expect(projected.value).toContain('token=[REDACTED_SECRET]')

    const untracked = await chatTransport(fixture, fixture.bobId)(url)
    expect(untracked.status).toBe(503)
    expect(await untracked.text()).not.toContain(SECRET)
  })
})
