import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type {
  OAuthAccessTokenPrincipal,
  ResourceDelegatedPrincipal,
  ResourceFileCopyScope,
} from '@sim/auth/principal'
import { db } from '@sim/db'
import {
  copilotChats,
  folder,
  member,
  organization,
  permissionGroup,
  permissionGroupWorkspace,
  permissions,
  project,
  user,
  workspace,
  workspaceFiles,
} from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import {
  createExecutorPrincipal,
  createPersonalApiKeyPrincipal,
  createSessionPrincipal,
  createWorkspaceApiKeyPrincipal,
} from '@sim/testing/factories/principal.factory'
import { createDeferred } from '@sim/testing/helpers/deferred'
import { featureFlagsMock, featureFlagsMockFns } from '@sim/testing/mocks/feature-flags.mock'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { acquirePermissionGroupOrgLock } from '@/lib/permission-groups/locks'
import { createProjectFileFolder, listProjectFileFolders } from '@/lib/projects/files/application'
import { createFileCopyAuthorizer } from '@/lib/workspace-files/application/copy-authorization'
import { copyFileItems } from '@/lib/workspace-files/application/copy-file-items'

vi.mock('@/lib/core/config/feature-flags', () => featureFlagsMock)

const fixtures: {
  users: string[]
  organizationId: string
  projectId: string
  workspaces: string[]
}[] = []
const checks: { name: string; status: 'passed' | 'failed'; durationMs: number; error?: string }[] =
  []

beforeEach(() => {
  featureFlagsMockFns.mockIsFeatureEnabled.mockImplementation(async (flag) => flag === 'projects')
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
  const projectId = generateId()
  const workspaces = [generateId(), generateId()]
  fixtures.push({ users: [ownerId, readerId], organizationId, projectId, workspaces })
  await db.insert(user).values(
    [ownerId, readerId].map((id) => ({
      id,
      name: 'Project file fixture',
      email: `${id}@files.invalid`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }))
  )
  await db.insert(organization).values({
    id: organizationId,
    name: 'Project files',
    slug: organizationId,
    createdAt: new Date(),
  })
  await db.insert(member).values([
    { id: generateId(), organizationId, userId: ownerId, role: 'owner', createdAt: new Date() },
    { id: generateId(), organizationId, userId: readerId, role: 'member', createdAt: new Date() },
  ])
  await db.transaction(async (tx) => {
    await tx
      .insert(project)
      .values({ id: projectId, organizationId, ownerId, name: 'Project files' })
    await tx.insert(workspace).values(
      workspaces.map((id, index) => ({
        id,
        organizationId,
        ownerId,
        billedAccountUserId: ownerId,
        workspaceMode: 'organization' as const,
        name: 'Environment',
        projectId,
        forkedFromWorkspaceId: index ? workspaces[0] : null,
      }))
    )
  })
  await db.insert(permissions).values({
    id: generateId(),
    entityType: 'workspace',
    entityId: workspaces[0],
    userId: readerId,
    permissionType: 'read',
  })
  return {
    ownerId,
    readerId,
    organizationId,
    projectId,
    workspaces,
    reader: createSessionPrincipal({ userId: readerId }),
  }
}

async function grant(
  userId: string,
  workspaceId: string,
  permissionType: 'read' | 'write' | 'admin'
) {
  await db
    .delete(permissions)
    .where(
      and(
        eq(permissions.userId, userId),
        eq(permissions.entityType, 'workspace'),
        eq(permissions.entityId, workspaceId)
      )
    )
  await db.insert(permissions).values({
    id: generateId(),
    userId,
    entityType: 'workspace',
    entityId: workspaceId,
    permissionType,
  })
}

function delegated(
  userId: string,
  projectId: string,
  workspaceId: string
): Extract<ResourceDelegatedPrincipal, { serviceId: 'copilot' }> {
  return {
    kind: 'resource_delegated',
    serviceId: 'copilot',
    subjectUserId: userId,
    audience: 'sim:project-files',
    delegationId: generateId(),
    issuedAt: new Date(),
    expiresAt: new Date(Date.now() + 30_000),
    scope: { kind: 'entity', entityType: 'project', entityId: projectId },
    invocation: { kind: 'workspace', workspaceId },
  }
}

afterAll(async () => {
  const reportPath =
    process.env.PROJECT_FILE_AUTHORIZATION_REPORT_PATH ??
    resolve('test-results/project-file-authorization.json')
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(reportPath, JSON.stringify({ checks }, null, 2))
  for (const f of fixtures) {
    const memberships = await db
      .select({ projectId: workspace.projectId })
      .from(workspace)
      .where(inArray(workspace.id, f.workspaces))
    const projectIds = [f.projectId, ...memberships.map((row) => row.projectId)]
    await db.delete(workspaceFiles).where(inArray(workspaceFiles.projectId, projectIds))
    await db.delete(folder).where(inArray(folder.projectId, projectIds))
    await deleteWorkspaceFixture(db, inArray(workspace.id, f.workspaces))
    await db.delete(project).where(inArray(project.id, projectIds))
    await db.delete(organization).where(eq(organization.id, f.organizationId))
    await db.delete(user).where(inArray(user.id, f.users))
  }
})

describe('compound copy owner authority', () => {
  function selection(f: Awaited<ReturnType<typeof fixture>>): Omit<ResourceFileCopyScope, 'kind'> {
    return {
      source: {
        owner: { entityType: 'project', entityId: f.projectId },
        fileIds: [generateId()],
        folderIds: [],
      },
      destination: {
        owner: { entityType: 'workspace', entityId: f.workspaces[1] },
        folderId: null,
      },
    }
  }

  function copyPrincipal(
    f: Awaited<ReturnType<typeof fixture>>,
    input: Omit<ResourceFileCopyScope, 'kind'>
  ) {
    return {
      ...delegated(f.readerId, f.projectId, f.workspaces[0]),
      audience: 'sim:files:copy',
      scope: { kind: 'file_copy' as const, ...input },
    }
  }

  check(
    'copy checks source read and destination write independently and rechecks after preparation',
    async () => {
      const f = await fixture()
      await grant(f.readerId, f.workspaces[1], 'write')
      const input = selection(f)
      const authorize = await createFileCopyAuthorizer(f.reader, input)
      expect(await db.transaction(authorize)).toMatchObject({
        source: { owner: input.source.owner, canWrite: false, ownerUserId: f.ownerId },
        destination: { owner: input.destination.owner, billedAccountUserId: f.ownerId },
      })
      const reverse = {
        source: { ...input.source, owner: input.destination.owner },
        destination: { ...input.destination, owner: input.source.owner },
      }
      const reverseAuthorize = await createFileCopyAuthorizer(f.reader, reverse)
      await expect(db.transaction(reverseAuthorize)).rejects.toMatchObject({ code: 'forbidden' })
      await grant(f.readerId, f.workspaces[1], 'read')
      await expect(db.transaction(authorize)).rejects.toMatchObject({ code: 'forbidden' })
    }
  )

  check(
    'copy refuses widened paired grants, entity grants, workspace keys and executors',
    async () => {
      const f = await fixture()
      await grant(f.readerId, f.workspaces[1], 'write')
      const input = selection(f)
      const principal = copyPrincipal(f, input)
      expect(await db.transaction(await createFileCopyAuthorizer(principal, input))).toMatchObject({
        source: { owner: input.source.owner },
        destination: { owner: input.destination.owner },
      })
      for (const changed of [
        { ...input, source: { ...input.source, fileIds: [generateId()] } },
        { ...input, destination: { ...input.destination, folderId: generateId() } },
        { ...input, source: { ...input.source, owner: input.destination.owner } },
      ]) {
        await expect(createFileCopyAuthorizer(principal, changed)).rejects.toMatchObject({
          code: 'forbidden',
        })
      }
      const realtime: ResourceDelegatedPrincipal = {
        kind: 'resource_delegated',
        serviceId: 'realtime',
        subjectUserId: f.readerId,
        audience: 'sim:files:copy',
        delegationId: generateId(),
        issuedAt: new Date(),
        expiresAt: new Date(Date.now() + 30_000),
        scope: {
          kind: 'entity',
          entityType: 'project',
          entityId: f.projectId,
          fileId: input.source.fileIds[0],
        },
        invocation: { kind: 'realtime', connectionId: 'copy-fixture' },
      }
      for (const rejected of [
        realtime,
        delegated(f.readerId, f.projectId, f.workspaces[0]),
        createWorkspaceApiKeyPrincipal({ workspaceId: f.workspaces[1] }),
        createExecutorPrincipal({ subjectUserId: f.readerId, workspaceId: f.workspaces[1] }),
      ]) {
        await expect(createFileCopyAuthorizer(rejected, input)).rejects.toMatchObject({
          code: 'forbidden',
        })
      }
    }
  )

  check('copy cannot escape the origin organization despite access to both owners', async () => {
    const f = await fixture()
    const other = await fixture()
    for (const workspaceId of other.workspaces) await grant(f.ownerId, workspaceId, 'admin')
    const input = {
      ...selection(f),
      destination: {
        owner: { entityType: 'project' as const, entityId: other.projectId },
        folderId: null,
      },
    }
    const principal = { ...copyPrincipal(f, input), subjectUserId: f.ownerId }
    const authorize = await createFileCopyAuthorizer(principal, input)
    await expect(db.transaction(authorize)).rejects.toMatchObject({ code: 'not_found' })
    expect(
      await db.transaction(
        await createFileCopyAuthorizer(createSessionPrincipal({ userId: f.ownerId }), input)
      )
    ).toMatchObject({ destination: { owner: input.destination.owner } })
  })

  check('copy rechecks organization chat actor and mode at commit', async () => {
    const f = await fixture()
    await grant(f.readerId, f.workspaces[1], 'write')
    const input = selection(f)
    const chatId = generateId()
    await db.insert(copilotChats).values({
      id: chatId,
      userId: f.readerId,
      organizationId: f.organizationId,
      workspaceId: null,
      type: 'mothership',
      config: { conversationMode: 'agent' },
      title: 'Copy files',
    })
    const principal = { ...copyPrincipal(f, input), invocation: { kind: 'chat' as const, chatId } }
    const authorize = await createFileCopyAuthorizer(principal, input)
    expect(await db.transaction(authorize)).toMatchObject({ source: { owner: input.source.owner } })
    await db
      .update(copilotChats)
      .set({ config: { conversationMode: 'ask' } })
      .where(eq(copilotChats.id, chatId))
    await expect(db.transaction(authorize)).rejects.toMatchObject({ code: 'not_found' })
    await db
      .update(copilotChats)
      .set({ config: { conversationMode: 'agent' }, userId: f.ownerId })
      .where(eq(copilotChats.id, chatId))
    await expect(db.transaction(authorize)).rejects.toMatchObject({ code: 'not_found' })
  })

  check('copy applies personal-key availability and OAuth write scope to both owners', async () => {
    const f = await fixture()
    await grant(f.readerId, f.workspaces[1], 'write')
    await db
      .update(workspace)
      .set({ allowPersonalApiKeys: true })
      .where(inArray(workspace.id, f.workspaces))
    const input = selection(f)
    const key = createPersonalApiKeyPrincipal({ userId: f.readerId })
    expect(await db.transaction(await createFileCopyAuthorizer(key, input))).toMatchObject({
      destination: { owner: input.destination.owner },
    })
    await db
      .update(workspace)
      .set({ allowPersonalApiKeys: false })
      .where(eq(workspace.id, f.workspaces[0]))
    await expect(db.transaction(await createFileCopyAuthorizer(key, input))).rejects.toMatchObject({
      code: 'forbidden',
    })
    const oauth: OAuthAccessTokenPrincipal = {
      kind: 'oauth_access_token',
      userId: f.readerId,
      tokenId: generateId(),
      clientId: 'test-client',
      scopes: ['api:read'],
      expiresAt: new Date(Date.now() + 60_000),
    }
    await expect(createFileCopyAuthorizer(oauth, input)).rejects.toMatchObject({
      code: 'forbidden',
    })
  })

  check('copy blocks a suspended actor after preparation for workspace-only owners', async () => {
    const f = await fixture()
    await grant(f.readerId, f.workspaces[1], 'write')
    const original = selection(f)
    const input = {
      ...original,
      source: {
        ...original.source,
        owner: { entityType: 'workspace' as const, entityId: f.workspaces[0] },
      },
    }
    const authorize = await createFileCopyAuthorizer(f.reader, input)
    expect(await db.transaction(authorize)).toMatchObject({ source: { owner: input.source.owner } })
    await db.update(user).set({ banned: true }).where(eq(user.id, f.readerId))
    await expect(db.transaction(authorize)).rejects.toMatchObject({ code: 'forbidden' })
  })

  check(
    'copy between workspaces runs with Projects off; a Project owner still needs them',
    async () => {
      featureFlagsMockFns.mockIsFeatureEnabled.mockImplementation(async () => false)
      const f = await fixture()
      await grant(f.readerId, f.workspaces[1], 'write')
      const withProject = selection(f)
      const between = {
        ...withProject,
        source: {
          ...withProject.source,
          owner: { entityType: 'workspace' as const, entityId: f.workspaces[0] },
        },
      }
      for (const principal of [f.reader, copyPrincipal(f, between)]) {
        const authorize = await createFileCopyAuthorizer(principal, between)
        expect(await db.transaction(authorize)).toMatchObject({
          source: { owner: between.source.owner },
          destination: { owner: between.destination.owner },
        })
      }
      await expect(createFileCopyAuthorizer(f.reader, withProject)).rejects.toMatchObject({
        statusCode: 503,
      })
    }
  )

  check(
    'copy locks opposite Project directions consistently in overlapping transactions',
    async () => {
      const f = await fixture()
      const other = await fixture()
      for (const workspaceId of other.workspaces) await grant(f.ownerId, workspaceId, 'admin')
      const principal = createSessionPrincipal({ userId: f.ownerId })
      const input = {
        ...selection(f),
        destination: {
          owner: { entityType: 'project' as const, entityId: other.projectId },
          folderId: null,
        },
      }
      const reverse = {
        source: { ...input.source, owner: input.destination.owner },
        destination: { ...input.destination, owner: input.source.owner },
      }
      const forward = await createFileCopyAuthorizer(principal, input)
      const backward = await createFileCopyAuthorizer(principal, reverse)
      const results = await Promise.all([db.transaction(forward), db.transaction(backward)])
      expect(results.map((result) => result.destination.owner.entityId)).toEqual([
        other.projectId,
        f.projectId,
      ])
    }
  )

  check(
    'copy does not upgrade shared membership locks across two Projects in one organization',
    async () => {
      const f = await fixture()
      const extraWorkspaceId = generateId()
      f.workspaces.push(extraWorkspaceId)
      await insertWorkspaceFixture(db, {
        id: extraWorkspaceId,
        name: 'Separate Project',
        organizationId: f.organizationId,
        ownerId: f.ownerId,
        billedAccountUserId: f.ownerId,
        workspaceMode: 'organization',
      })
      const [extra] = await db.select().from(workspace).where(eq(workspace.id, extraWorkspaceId))
      const first = selection(f)
      const second = {
        source: {
          ...first.source,
          owner: { entityType: 'project' as const, entityId: extra.projectId },
        },
        destination: {
          owner: { entityType: 'workspace' as const, entityId: extraWorkspaceId },
          folderId: null,
        },
      }
      const principal = createSessionPrincipal({ userId: f.ownerId })
      const authorizeFirst = await createFileCopyAuthorizer(principal, first)
      const authorizeSecond = await createFileCopyAuthorizer(principal, second)
      const ready = createDeferred<number>()
      const release = createDeferred<void>()
      const organizationEdit = db.transaction(async (tx) => {
        await acquirePermissionGroupOrgLock(tx, f.organizationId)
        const [connection] = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)
        ready.resolve(connection.pid)
        await release.promise
      })
      const pid = await Promise.race([
        ready.promise,
        organizationEdit.then(() => {
          throw new Error('Organization edit exited early')
        }),
      ])
      const outcomes = Promise.allSettled([
        db.transaction(authorizeFirst),
        db.transaction(authorizeSecond),
      ])
      try {
        let blocked = 0
        for (let attempt = 0; attempt < 100; attempt++) {
          const [state] = await db.execute<{ count: number }>(sql`
          SELECT count(*)::int AS count FROM pg_stat_activity
          WHERE ${pid} = ANY(pg_blocking_pids(pid)) AND wait_event = 'advisory'
        `)
          blocked = state.count
          if (blocked === 2) break
          await sleep(10)
        }
        expect(blocked).toBe(2)
      } finally {
        release.resolve()
        await organizationEdit
        await outcomes
      }
      const results = await outcomes
      expect(results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled'])
    }
  )
})

describe('Mothership origin navigation and independent Project authority', () => {
  async function target(f: Awaited<ReturnType<typeof fixture>>) {
    const workspaceId = generateId()
    f.workspaces.push(workspaceId)
    await insertWorkspaceFixture(db, {
      id: workspaceId,
      name: 'Independent target',
      organizationId: f.organizationId,
      ownerId: f.ownerId,
      billedAccountUserId: f.ownerId,
      workspaceMode: 'organization',
    })
    const [binding] = await db.select().from(workspace).where(eq(workspace.id, workspaceId))
    if (!binding) throw new Error('Target Project missing')
    await grant(f.readerId, workspaceId, 'admin')
    return { workspaceId, projectId: binding.projectId }
  }

  check(
    'origin A reads and writes B and authorizes A to B copy with independent live grants',
    async () => {
      const f = await fixture()
      const b = await target(f)
      const principal = delegated(f.readerId, b.projectId, f.workspaces[0])
      const result = await createProjectFileFolder.execute({
        principal,
        input: { projectId: b.projectId, name: 'Target folder' },
      })
      expect(
        (
          await listProjectFileFolders.execute({ principal, input: { projectId: b.projectId } })
        ).folders.map((row) => row.id)
      ).toContain(result.folder.id)
      const { folder: source } = await createProjectFileFolder.execute({
        principal: createSessionPrincipal({ userId: f.ownerId }),
        input: { projectId: f.projectId, name: 'Copy me' },
      })
      const input = {
        source: {
          owner: { entityType: 'project' as const, entityId: f.projectId },
          fileIds: [],
          folderIds: [source.id],
        },
        destination: {
          owner: { entityType: 'project' as const, entityId: b.projectId },
          folderId: null,
        },
      }
      const copy = {
        ...principal,
        audience: 'sim:files:copy',
        scope: { kind: 'file_copy' as const, ...input },
      }
      const copied = await copyFileItems.execute({ principal: copy, input })
      expect(copied.folders).toHaveLength(1)
      expect(
        (
          await listProjectFileFolders.execute({ principal, input: { projectId: b.projectId } })
        ).folders.map((row) => row.id)
      ).toContain(copied.folders[0].id)
      const authorize = await createFileCopyAuthorizer(copy, input)
      expect(await db.transaction(authorize)).toMatchObject({
        source: { canWrite: false },
        destination: { canWrite: true },
      })
      await grant(f.readerId, b.workspaceId, 'read')
      await expect(db.transaction(authorize)).rejects.toMatchObject({ code: 'forbidden' })
      await db
        .delete(permissions)
        .where(and(eq(permissions.userId, f.readerId), eq(permissions.entityId, b.workspaceId)))
      await expect(
        listProjectFileFolders.execute({ principal, input: { projectId: b.projectId } })
      ).rejects.toMatchObject({ code: 'not_found' })
    }
  )

  check(
    'origin access and copilot capability are rechecked after preparation independently of B',
    async () => {
      for (const revoke of ['permission', 'copilot', 'files'] as const) {
        const f = await fixture()
        const b = await target(f)
        const input = {
          source: {
            owner: { entityType: 'project' as const, entityId: b.projectId },
            fileIds: [generateId()],
            folderIds: [],
          },
          destination: {
            owner: { entityType: 'project' as const, entityId: b.projectId },
            folderId: null,
          },
        }
        const principal = {
          ...delegated(f.readerId, b.projectId, f.workspaces[0]),
          audience: 'sim:files:copy',
          scope: { kind: 'file_copy' as const, ...input },
        }
        const authorize = await createFileCopyAuthorizer(principal, input)
        await db.transaction(authorize)
        if (revoke === 'permission') {
          await db
            .delete(permissions)
            .where(
              and(eq(permissions.userId, f.readerId), eq(permissions.entityId, f.workspaces[0]))
            )
        } else {
          const groupId = generateId()
          await db.insert(permissionGroup).values({
            id: groupId,
            organizationId: f.organizationId,
            createdBy: f.ownerId,
            name: 'Revoked capability',
            membershipMode: 'inherit',
            config: revoke === 'copilot' ? { hideCopilot: true } : { hideFilesTab: true },
          })
          await db.insert(permissionGroupWorkspace).values({
            id: generateId(),
            permissionGroupId: groupId,
            workspaceId: revoke === 'copilot' ? f.workspaces[0] : b.workspaceId,
            organizationId: f.organizationId,
          })
        }
        await expect(db.transaction(authorize)).rejects.toMatchObject({ code: 'forbidden' })
      }
    }
  )
})
