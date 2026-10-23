import { mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname, resolve } from 'node:path'
import { db } from '@sim/db'
import {
  copilotChats,
  folder,
  member,
  organization,
  permissions,
  project,
  user,
  workspace,
  workspaceFiles,
} from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { Logger } from '@sim/logger'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { featureFlagsMock, featureFlagsMockFns } from '@sim/testing/mocks/feature-flags.mock'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { copilotRequestPrincipal } from '@/lib/api/server/routes/copilot-request'
import { createProjectFileCliTransport } from '@/lib/mothership/agent-cli/project-file-transport'
import { markCopilotProjectFileRequest } from '@/lib/mothership/application/execute-project-file-use-case'
import { executeCopilotProjectDiscovery } from '@/lib/mothership/application/execute-project-use-case'
import { withFileOwnerContext } from '@/lib/mothership/application/file-owner-context'
import {
  type CopilotExecutionContext,
  createCopilotResourceAdmission,
} from '@/lib/mothership/auth/application-delegation'
import { WORKSPACE_FILE_COPY_CAPABILITY } from '@/lib/mothership/generated/protocol'
import { listProjects } from '@/lib/projects/application'
import { getProjectFileMetadata } from '@/lib/projects/files/application'
import { projectFileOperations } from '@/lib/projects/files/application/operations'

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
        projectId,
        organizationId,
        ownerId,
        billedAccountUserId: ownerId,
        workspaceMode: 'organization' as const,
        name: 'Environment',
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

afterAll(async () => {
  const reportPath =
    process.env.PROJECT_FILE_AUTHORIZATION_PRODUCT_REPORT_PATH ??
    resolve('test-results/project-file-authorization-product.json')
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

describe('Project file authority at the database boundary', () => {
  check(
    'private v2 admission preserves the actor and rechecks live Project membership',
    async () => {
      const f = await fixture()
      const chatId = generateId()
      const fileId = generateId()
      await db.insert(copilotChats).values({
        id: chatId,
        userId: f.readerId,
        organizationId: f.organizationId,
        workspaceId: null,
        type: 'mothership',
        config: { conversationMode: 'agent' },
        title: 'Private Project files',
      })
      await db.insert(workspaceFiles).values({
        id: fileId,
        userId: f.ownerId,
        projectId: f.projectId,
        context: 'project',
        key: `project/${f.projectId}/${fileId}`,
        originalName: 'architecture.md',
        contentType: 'text/markdown',
        sizeBytes: 0,
      })
      const request = new Request(
        `http://localhost/api/v2/projects/${f.projectId}/files/${fileId}/metadata`
      )
      markCopilotProjectFileRequest(
        request,
        {
          userId: f.readerId,
          organizationId: f.organizationId,
          chatId,
          toolCallId: generateId(),
          copilotToolExecution: true,
          copilotResourceAdmission: createCopilotResourceAdmission({
            userId: f.readerId,
            invocation: { kind: 'chat', chatId },
          }),
        },
        { projectId: f.projectId, fileId }
      )
      const principal = copilotRequestPrincipal(
        request,
        projectFileOperations.readMetadata,
        getProjectFileMetadata
      )
      if (!principal) throw new Error('Private Project admission did not produce a principal')
      const input = { projectId: f.projectId, fileId }
      expect(await getProjectFileMetadata.execute({ principal, input })).toMatchObject({
        file: { id: fileId, owner: { entityType: 'project', entityId: f.projectId } },
        capabilities: { canRead: true, canWrite: false },
      })
      await expect(
        getProjectFileMetadata.execute({ principal, input: { ...input, fileId: generateId() } })
      ).rejects.toMatchObject({ code: 'forbidden' })
      await db.delete(permissions).where(eq(permissions.userId, f.readerId))
      await expect(getProjectFileMetadata.execute({ principal, input })).rejects.toMatchObject({
        code: 'not_found',
      })
    }
  )

  check(
    'Project-only v2 transport reaches the canonical route and cannot change owners',
    async () => {
      const f = await fixture()
      const fileId = generateId()
      await db.insert(workspaceFiles).values({
        id: fileId,
        userId: f.ownerId,
        projectId: f.projectId,
        context: 'project',
        key: `project/${f.projectId}/${fileId}`,
        originalName: 'transport.md',
        contentType: 'text/markdown',
        sizeBytes: 0,
      })
      const context: CopilotExecutionContext = {
        userId: f.readerId,
        workspaceId: f.workspaces[0],
        toolCallId: generateId(),
        copilotToolExecution: true,
        copilotResourceAdmission: createCopilotResourceAdmission({
          userId: f.readerId,
          invocation: { kind: 'workspace', workspaceId: f.workspaces[0] },
        }),
      }
      const endpoint = 'http://localhost:3000'
      const filePath = `/api/v2/projects/${f.projectId}/files/${fileId}/metadata`
      const transport = createProjectFileCliTransport(endpoint, context, {
        projectId: f.projectId,
        fileId,
      })
      const response = await transport(`${endpoint}${filePath}`)
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({
        data: { id: fileId, owner: { entityType: 'project', entityId: f.projectId } },
      })
      for (const url of [
        `http://other.invalid${filePath}`,
        `${endpoint}/api/v2/projects/${generateId()}/files/${fileId}/metadata`,
        `${endpoint}/api/v2/projects/${f.projectId}/files/${generateId()}/metadata`,
        `${endpoint}/api/v2/projects/${f.projectId}/files/folders`,
        `${endpoint}/api/v2/files/${fileId}/metadata?workspaceId=${f.workspaces[0]}`,
      ]) {
        expect((await transport(url)).status).toBe(400)
      }
      const projectTransport = createProjectFileCliTransport(endpoint, context, {
        projectId: f.projectId,
      })
      expect(
        (await projectTransport(`${endpoint}/api/v2/projects/${f.projectId}/files`)).status
      ).toBe(200)
      expect((await projectTransport(`${endpoint}${filePath}`)).status).toBe(200)
      context.boundWorkflowExecutionId = 'workflow-run'
      expect((await transport(`${endpoint}${filePath}`)).status).toBe(403)
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

  function context(f: Awaited<ReturnType<typeof fixture>>): CopilotExecutionContext {
    return {
      userId: f.readerId,
      workspaceId: f.workspaces[0],
      requestMode: 'agent',
      toolCallId: generateId(),
      copilotToolExecution: true,
      copilotResourceAdmission: createCopilotResourceAdmission({
        userId: f.readerId,
        invocation: { kind: 'workspace', workspaceId: f.workspaces[0] },
      }),
    }
  }

  /** A worker that advertises the file-owner protocol, so turn hints are actually negotiated. */
  async function withProtocolPeer(run: (workerURL: string) => Promise<void>) {
    const peer = createServer((_request, response) => {
      response.setHeader('X-Mothership-File-Owner-Protocol', '1')
      response.end()
    })
    await new Promise<void>((resolve) => peer.listen(0, '127.0.0.1', resolve))
    try {
      const address = peer.address()
      if (!address || typeof address === 'string') throw new Error('Protocol peer unavailable')
      await run(`http://127.0.0.1:${address.port}`)
    } finally {
      await new Promise<void>((resolve, reject) =>
        peer.close((error) => (error ? reject(error) : resolve()))
      )
    }
  }

  check('origin A discovers accessible B while current-parent hints remain A', async () => {
    const f = await fixture()
    const b = await target(f)
    const execution = context(f)
    const listed = await executeCopilotProjectDiscovery(execution, listProjects, { limit: 100 })
    expect(listed.projects.map((row) => row.id).sort()).toEqual([f.projectId, b.projectId].sort())
    await withProtocolPeer(async (workerURL) => {
      for (const [workspaceId, projectId] of [
        [f.workspaces[0], f.projectId],
        [b.workspaceId, b.projectId],
      ]) {
        const current = {
          ...execution,
          workspaceId,
          copilotResourceAdmission: createCopilotResourceAdmission({
            userId: f.readerId,
            invocation: { kind: 'workspace', workspaceId },
          }),
        }
        const hints = await withFileOwnerContext({}, current, workerURL, '/api/mothership')
        expect(hints.project).toMatchObject({ id: projectId })
      }
    })
    await db
      .delete(permissions)
      .where(and(eq(permissions.userId, f.readerId), eq(permissions.entityId, b.workspaceId)))
    const revoked = await executeCopilotProjectDiscovery(execution, listProjects, { limit: 100 })
    expect(revoked.projects.map((row) => row.id)).toEqual([f.projectId])
  })

  check(
    'sends the turn without Project hints, warning only when the lookup fails unexpectedly',
    async () => {
      const f = await fixture()
      const forged = {
        message: 'hello',
        fileOwnerProtocolVersion: 1,
        project: { id: generateId(), name: 'Forged' },
        fileOwnerCapabilities: [
          {
            owner: { entityType: 'project', entityId: generateId() },
            canRead: true,
            canWrite: true,
          },
        ],
      }
      const copies = { clientCapabilities: [WORKSPACE_FILE_COPY_CAPABILITY] }
      const noProject = {
        message: 'hello',
        ...copies,
        fileOwnerProtocolVersion: 1,
        project: null,
        fileOwnerCapabilities: [],
      }
      const warn = vi.spyOn(Logger.prototype, 'warn')
      const hintWarnings = () =>
        warn.mock.calls.filter(([message]) =>
          message.includes('Sending turn without Project file owner hints')
        )
      try {
        await withProtocolPeer(async (workerURL) => {
          const send = () => withFileOwnerContext(forged, context(f), workerURL, '/api/mothership')

          featureFlagsMockFns.mockIsFeatureEnabled.mockImplementation(async () => false)
          // Projects off: the admitted turn still copies between workspaces, and only it does.
          expect(await send()).toEqual({ message: 'hello', ...copies })
          expect(
            await withFileOwnerContext(
              forged,
              { ...context(f), requestMode: 'assistant' },
              workerURL,
              '/api/mothership'
            )
          ).toEqual({ message: 'hello' })
          expect(
            await withFileOwnerContext(forged, context(f), workerURL, '/api/tools/resume')
          ).toEqual({ message: 'hello' })

          featureFlagsMockFns.mockIsFeatureEnabled.mockImplementation(
            async (flag) => flag === 'projects'
          )
          expect((await send()).project).toEqual({ id: f.projectId, name: 'Project files' })

          await db
            .update(project)
            .set({ archivedAt: new Date() })
            .where(eq(project.id, f.projectId))
          expect(await send()).toEqual(noProject)
          await db.update(project).set({ archivedAt: null }).where(eq(project.id, f.projectId))

          await db.delete(permissions).where(eq(permissions.userId, f.readerId))
          expect(await send()).toEqual(noProject)
          expect(hintWarnings()).toEqual([])

          /** The rollout switches off between admitting the turn and reading its Project. */
          featureFlagsMockFns.mockIsFeatureEnabled
            .mockImplementation(async () => false)
            .mockResolvedValueOnce(true)
          expect(await send()).toEqual(noProject)
          expect(hintWarnings()).toHaveLength(1)
        })
      } finally {
        warn.mockRestore()
      }
    }
  )
})
