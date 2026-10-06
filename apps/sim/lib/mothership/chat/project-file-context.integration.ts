import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { db } from '@sim/db'
import {
  copilotChats,
  permissions,
  projectWorkspace,
  user,
  workspace,
  workspaceFiles,
} from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { createRouteContext } from '@sim/testing/helpers/http'
import { authMock, authMockFns } from '@sim/testing/mocks/auth.mock'
import { featureFlagsMock, featureFlagsMockFns } from '@sim/testing/mocks/feature-flags.mock'
import { createMockRequest } from '@sim/testing/mocks/request.mock'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { toRecord } from '@sim/utils/object'
import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCopilotResourceAdmission } from '@/lib/mothership/auth/application-delegation'
import { changeChatResources } from '@/lib/mothership/chat/application/change-resources'
import { copyPersistedMessageContext } from '@/lib/mothership/chat/persisted-message'
import { processContextsServer } from '@/lib/mothership/chat/process-contents'
import { createEvent } from '@/lib/mothership/request/session/event'
import { encodeSSEEnvelope } from '@/lib/mothership/request/session/sse'
import { persistResourceEffect } from '@/lib/mothership/resources/persist-effect'
import type { MothershipResource } from '@/lib/mothership/resources/types'
import { executeTool, registerHandler } from '@/lib/mothership/tool-executor/executor'
import { createServerToolHandler } from '@/lib/mothership/tools/registry/server-tool-adapter'
import {
  POST as addCopilotResource,
  DELETE as removeCopilotResource,
} from '@/app/api/copilot/chat/resources/route'
import { DELETE as removeMothershipResource } from '@/app/api/mothership/chat/resources/route'
import { GET as readMothershipChat } from '@/app/api/mothership/chats/[chatId]/route'

vi.mock('@/lib/core/config/feature-flags', () => featureFlagsMock)

vi.mock('@/lib/auth', () => authMock)

const identityChecks: {
  name: string
  status: 'passed' | 'failed'
  durationMs: number
  error?: string
}[] = []

function identityCheck(name: string, run: () => Promise<void>) {
  it(name, async () => {
    const started = performance.now()
    try {
      await run()
      identityChecks.push({ name, status: 'passed', durationMs: performance.now() - started })
    } catch (error) {
      identityChecks.push({
        name,
        status: 'failed',
        durationMs: performance.now() - started,
        error: getErrorMessage(error),
      })
      throw error
    }
  })
}

const fixtures: { userId: string; workspaceId: string; fileId: string }[] = []
beforeEach(() => {
  featureFlagsMockFns.mockIsFeatureEnabled.mockImplementation(async (flag) => flag === 'projects')
  vi.stubEnv('PROJECT_FILES_ENABLED', 'true')
})
async function fixture() {
  const userId = generateId()
  const workspaceId = generateId()
  const chatId = generateId()
  const fileId = generateId()
  await db.insert(user).values({
    id: userId,
    name: 'Resource reader',
    email: `${userId}@project-context.invalid`,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  await insertWorkspaceFixture(db, {
    id: workspaceId,
    ownerId: userId,
    billedAccountUserId: userId,
    name: 'Context workspace',
  })
  await db.insert(permissions).values({
    id: generateId(),
    userId,
    entityType: 'workspace',
    entityId: workspaceId,
    permissionType: 'admin',
  })
  const [binding] = await db
    .select()
    .from(projectWorkspace)
    .where(eq(projectWorkspace.workspaceId, workspaceId))
  if (!binding) throw new Error('Project binding missing')
  const projectId = binding.projectId
  fixtures.push({ userId, workspaceId, fileId })
  await db.insert(copilotChats).values({ id: chatId, userId, workspaceId, type: 'mothership' })
  await db.insert(workspaceFiles).values({
    id: fileId,
    projectId: projectId,
    key: `project/${projectId}/context.md`,
    userId,
    originalCreatorUserId: userId,
    context: 'project',
    originalName: 'Canonical.md',
    contentType: 'text/markdown',
    sizeBytes: 8,
  })
  const owner = { entityType: 'project' as const, entityId: projectId }
  const context = {
    userId,
    chatId,
    workflowId: '',
    requestMode: 'agent',
    toolCallId: generateId(),
    copilotToolExecution: true,
    copilotResourceAdmission: createCopilotResourceAdmission({
      userId,
      invocation: { kind: 'chat', chatId },
    }),
  }
  return { userId, workspaceId, projectId, chatId, fileId, owner, context }
}

describe('Project resource context and opening use canonical metadata and current authority', () => {
  it('opens a Project file with resource-only admission and returns an owner without workspace inference', async () => {
    const f = await fixture()
    registerHandler('open_resource', createServerToolHandler('open_resource'))
    const result = await executeTool(
      'open_resource',
      { resources: [{ type: 'file', id: f.fileId, owner: f.owner }] },
      f.context
    )
    expect(result.success, result.error).toBe(true)
    expect(result.resources).toEqual([
      { type: 'file', id: f.fileId, title: 'Canonical.md', owner: f.owner },
    ])
    await db.delete(permissions).where(eq(permissions.userId, f.userId))
    const revoked = await executeTool(
      'open_resource',
      { resources: [{ type: 'file', id: f.fileId, owner: f.owner }] },
      f.context
    )
    expect(revoked.success).toBe(false)
    expect(revoked.resources).toBeUndefined()
  })

  it('file and selection context retain their owner through authorized resolution and message persistence', async () => {
    const f = await fixture()
    const selected = {
      kind: 'file_selection' as const,
      fileId: f.fileId,
      owner: f.owner,
      label: 'Selection',
      fileName: 'Forged.md',
      text: 'User-selected text',
      startLine: 2,
    }
    for (const requestMode of [undefined, 'execute', 'assistant', 'build'])
      expect(
        await processContextsServer(
          [selected],
          f.userId,
          '',
          f.workspaceId,
          f.chatId,
          undefined,
          undefined,
          requestMode
        )
      ).toEqual([])
    const planned = await processContextsServer(
      [selected],
      f.userId,
      '',
      f.workspaceId,
      f.chatId,
      undefined,
      undefined,
      'plan'
    )
    expect(planned).toHaveLength(1)
    const contexts = await processContextsServer(
      [{ kind: 'file', fileId: f.fileId, label: 'File', owner: f.owner }, selected],
      f.userId,
      '',
      f.workspaceId,
      f.chatId,
      undefined,
      undefined,
      'agent'
    )
    expect(contexts).toHaveLength(2)
    for (const context of contexts)
      expect(context).toMatchObject({
        resource: { type: 'file', id: f.fileId, title: 'Canonical.md', owner: f.owner },
      })
    expect(contexts[1]?.content).toContain('Canonical.md')
    expect(copyPersistedMessageContext(selected)).toMatchObject({ owner: f.owner })
    await db.delete(permissions).where(eq(permissions.userId, f.userId))
    expect(
      await processContextsServer(
        [selected],
        f.userId,
        '',
        f.workspaceId,
        f.chatId,
        undefined,
        undefined,
        'agent'
      )
    ).toEqual([])
  })

  it('persists Project effect identity and cannot remove it using another owner', async () => {
    const f = await fixture()
    const resource = { type: 'file' as const, id: f.fileId, title: 'Canonical.md', owner: f.owner }
    await persistResourceEffect(f.chatId, { op: 'upsert', effectId: 'open', resource })
    for (const wrongOwner of [
      { ...f.owner, entityId: generateId() },
      { entityType: 'workspace' as const, entityId: f.owner.entityId },
    ])
      await persistResourceEffect(f.chatId, {
        op: 'remove',
        effectId: `wrong-owner:${wrongOwner.entityType}`,
        resource: { ...resource, owner: wrongOwner },
      })
    const [stored] = await db
      .select({ resources: copilotChats.resources })
      .from(copilotChats)
      .where(eq(copilotChats.id, f.chatId))
    expect(stored?.resources).toEqual([resource])
    await persistResourceEffect(f.chatId, { op: 'remove', effectId: 'close', resource })
    await persistResourceEffect(f.chatId, { op: 'upsert', effectId: 'open', resource })
    const [replayed] = await db
      .select({ resources: copilotChats.resources })
      .from(copilotChats)
      .where(eq(copilotChats.id, f.chatId))
    expect(replayed?.resources).toEqual([])
  })

  it('rejects contradictory owners, mixed batches and caller-supplied canonical metadata', async () => {
    const f = await fixture()
    registerHandler('open_resource', createServerToolHandler('open_resource'))
    const resource = { type: 'file', id: f.fileId, owner: f.owner }
    for (const input of [
      { workspaceId: f.workspaceId, resources: [resource] },
      { resources: [resource, { type: 'workflow', id: 'other' }] },
      { resources: [{ ...resource, title: 'forged', path: '/secret' }] },
      { resources: [{ ...resource, owner: { entityType: 'user', entityId: f.userId } }] },
    ]) {
      const result = await executeTool('open_resource', input, f.context)
      expect(result.success).toBe(false)
      expect(result.resources).toBeUndefined()
    }
    const invalidSelection = {
      kind: 'file_selection' as const,
      fileId: f.fileId,
      owner: f.owner,
      workspaceId: f.workspaceId,
      label: 'bad',
      fileName: 'bad',
      text: 'text',
    }
    expect(
      await processContextsServer(
        [invalidSelection],
        f.userId,
        '',
        f.workspaceId,
        f.chatId,
        undefined,
        undefined,
        'agent'
      )
    ).toEqual([])
  })
})

describe('canonical file panel ownership compatibility', () => {
  for (const storedKind of ['legacy', 'explicit'] as const) {
    identityCheck(
      `removes a ${storedKind} workspace file address through its equivalent owner form`,
      async () => {
        const f = await fixture()
        const legacy: MothershipResource = {
          type: 'file',
          id: f.fileId,
          title: 'Workspace file',
          workspaceId: f.workspaceId,
        }
        const explicit: MothershipResource = {
          type: 'file',
          id: f.fileId,
          title: 'Workspace file',
          owner: { entityType: 'workspace', entityId: f.workspaceId },
        }
        const projectResource: MothershipResource = {
          type: 'file',
          id: f.fileId,
          title: 'Project file',
          owner: f.owner,
        }
        const table: MothershipResource = {
          type: 'table',
          id: f.fileId,
          title: 'Table',
          workspaceId: f.workspaceId,
        }
        await db
          .update(copilotChats)
          .set({ resources: [storedKind === 'legacy' ? legacy : explicit, projectResource, table] })
          .where(eq(copilotChats.id, f.chatId))
        const result = await changeChatResources.execute({
          principal: createSessionPrincipal({ userId: f.userId }),
          input: {
            chatId: f.chatId,
            change: { kind: 'remove', resources: [storedKind === 'legacy' ? explicit : legacy] },
          },
        })
        expect(result.resources).toEqual([projectResource, table])
        const [persisted] = await db
          .select({ resources: copilotChats.resources, workspaceId: copilotChats.workspaceId })
          .from(copilotChats)
          .where(eq(copilotChats.id, f.chatId))
        expect(persisted).toEqual({
          resources: [projectResource, table],
          workspaceId: f.workspaceId,
        })
      }
    )
  }

  identityCheck(
    'heals equivalent stored file aliases during upsert and reorder without inventing an owner',
    async () => {
      const f = await fixture()
      const principal = createSessionPrincipal({ userId: f.userId })
      const legacy: MothershipResource = {
        type: 'file',
        id: f.fileId,
        title: 'Notes',
        workspaceId: f.workspaceId,
      }
      const explicit: MothershipResource = {
        type: 'file',
        id: f.fileId,
        title: 'Notes',
        owner: { entityType: 'workspace', entityId: f.workspaceId },
      }
      const implicit: MothershipResource = {
        type: 'file',
        id: generateId(),
        title: 'Old unresolved panel',
      }
      const table: MothershipResource = {
        type: 'table',
        id: generateId(),
        title: 'Table',
        workspaceId: f.workspaceId,
        viewId: generateId(),
      }
      await db
        .update(copilotChats)
        .set({ resources: [legacy, implicit, table] })
        .where(eq(copilotChats.id, f.chatId))
      const added = await changeChatResources.execute({
        principal,
        input: { chatId: f.chatId, change: { kind: 'upsert', resources: [explicit] } },
      })
      expect(added.resources).toEqual([explicit, implicit, table])
      const reordered = await changeChatResources.execute({
        principal,
        input: {
          chatId: f.chatId,
          change: { kind: 'reorder', resources: [table, legacy, implicit] },
        },
      })
      expect(reordered.resources).toEqual([table, explicit, implicit])
      const [stored] = await db
        .select({ resources: copilotChats.resources })
        .from(copilotChats)
        .where(eq(copilotChats.id, f.chatId))
      expect(stored?.resources).toEqual([table, explicit, implicit])
    }
  )

  identityCheck(
    'rejects conflicting or unsupported file removal owners at both HTTP route boundaries',
    async () => {
      const f = await fixture()
      authMockFns.mockGetSession.mockResolvedValue({
        user: { id: f.userId },
        session: { id: generateId() },
      })
      const resource: MothershipResource = {
        type: 'file',
        id: f.fileId,
        title: 'Project file',
        owner: f.owner,
      }
      await db
        .update(copilotChats)
        .set({ resources: [resource] })
        .where(eq(copilotChats.id, f.chatId))
      for (const [path, handler] of [
        ['/api/copilot/chat/resources', removeCopilotResource],
        ['/api/mothership/chat/resources', removeMothershipResource],
      ] as const) {
        for (const address of [
          { owner: f.owner, workspaceId: f.workspaceId },
          {
            owner: { entityType: 'workspace', entityId: generateId() },
            workspaceId: f.workspaceId,
          },
          { owner: { entityType: 'organization', entityId: generateId() } },
          { owner: f.owner, resourceType: 'table' },
        ]) {
          const response = await handler(
            createMockRequest({
              method: 'DELETE',
              url: `http://localhost${path}`,
              body: {
                chatId: f.chatId,
                resourceType: 'file',
                resourceId: f.fileId,
                ...address,
              },
            }),
            undefined
          )
          expect(
            response.status,
            JSON.stringify({ path, address, body: await response.json() })
          ).toBe(400)
        }
      }
      const [stored] = await db
        .select({ resources: copilotChats.resources })
        .from(copilotChats)
        .where(eq(copilotChats.id, f.chatId))
      expect(stored?.resources).toEqual([resource])
    }
  )
})

describe('legacy browser file address compatibility', () => {
  identityCheck(
    'persists and hydrates owned file folders without mixing their owner addresses',
    async () => {
      const f = await fixture()
      authMockFns.mockGetSession.mockResolvedValue({
        user: { id: f.userId },
        session: { id: generateId() },
      })
      const folderId = generateId()
      const resources: MothershipResource[] = [
        {
          type: 'filefolder',
          id: folderId,
          title: 'Workspace folder',
          owner: { entityType: 'workspace', entityId: f.workspaceId },
        },
        { type: 'filefolder', id: folderId, title: 'Project folder', owner: f.owner },
      ]
      for (const resource of resources) {
        const response = await addCopilotResource(
          createMockRequest({
            method: 'POST',
            url: 'http://localhost/api/copilot/chat/resources',
            body: { chatId: f.chatId, resource },
          }),
          undefined
        )
        expect(response.status, JSON.stringify(await response.json())).toBe(200)
      }
      const history = await readMothershipChat(
        createMockRequest({
          method: 'GET',
          url: `http://localhost/api/mothership/chats/${f.chatId}`,
        }),
        createRouteContext({ chatId: f.chatId })
      )
      expect(history.status).toBe(200)
      expect(toRecord(toRecord(await history.json()).chat).resources).toEqual(resources)

      const removed = await removeMothershipResource(
        createMockRequest({
          method: 'DELETE',
          url: 'http://localhost/api/mothership/chat/resources',
          body: {
            chatId: f.chatId,
            resourceType: 'filefolder',
            resourceId: folderId,
            owner: f.owner,
          },
        }),
        undefined
      )
      expect(removed.status).toBe(200)
      const [stored] = await db
        .select({ resources: copilotChats.resources })
        .from(copilotChats)
        .where(eq(copilotChats.id, f.chatId))
      expect(stored.resources).toEqual([resources[0]])

      const conflicting = await addCopilotResource(
        createMockRequest({
          method: 'POST',
          url: 'http://localhost/api/copilot/chat/resources',
          body: { chatId: f.chatId, resource: { ...resources[1], workspaceId: f.workspaceId } },
        }),
        undefined
      )
      expect(conflicting.status).toBe(400)
    }
  )

  identityCheck(
    'projects Workspace aliases only in HTTP responses while keeping canonical storage',
    async () => {
      const f = await fixture()
      authMockFns.mockGetSession.mockResolvedValue({
        user: { id: f.userId },
        session: { id: generateId() },
      })
      const workspaceFile: MothershipResource = {
        type: 'file',
        id: generateId(),
        title: 'Workspace notes',
        owner: { entityType: 'workspace', entityId: f.workspaceId },
      }
      const projectFile: MothershipResource = {
        type: 'file',
        id: f.fileId,
        title: 'Project notes',
        owner: f.owner,
      }
      const ownerlessFile: MothershipResource = {
        type: 'file',
        id: generateId(),
        title: 'Legacy unresolved file',
      }
      const table: MothershipResource = {
        type: 'table',
        id: generateId(),
        title: 'Table',
        workspaceId: f.workspaceId,
      }
      const canonical = [workspaceFile, projectFile, ownerlessFile, table]
      await db
        .update(copilotChats)
        .set({ resources: canonical })
        .where(eq(copilotChats.id, f.chatId))
      const expectedWire = [
        { ...workspaceFile, workspaceId: f.workspaceId },
        projectFile,
        ownerlessFile,
        table,
      ]
      const history = await readMothershipChat(
        createMockRequest({
          method: 'GET',
          url: `http://localhost/api/mothership/chats/${f.chatId}`,
        }),
        createRouteContext({ chatId: f.chatId })
      )
      expect(history.status).toBe(200)
      const historyBody = toRecord(await history.json())
      expect(toRecord(historyBody.chat).resources).toEqual(expectedWire)
      const mutation = await addCopilotResource(
        createMockRequest({
          method: 'POST',
          url: 'http://localhost/api/copilot/chat/resources',
          body: { chatId: f.chatId, resource: workspaceFile },
        }),
        undefined
      )
      expect(mutation.status).toBe(200)
      expect(toRecord(await mutation.json()).resources).toEqual(expectedWire)
      const [stored] = await db
        .select({ resources: copilotChats.resources })
        .from(copilotChats)
        .where(eq(copilotChats.id, f.chatId))
      expect(stored?.resources).toEqual(canonical)
    }
  )

  identityCheck(
    'projects Workspace aliases in the shared live and replay encoder without mutating events',
    async () => {
      const workspaceId = generateId()
      const workspaceFile: MothershipResource = {
        type: 'file',
        id: generateId(),
        title: 'Workspace file',
        owner: { entityType: 'workspace', entityId: workspaceId },
      }
      const projectFile: MothershipResource = {
        type: 'file',
        id: generateId(),
        title: 'Project file',
        owner: { entityType: 'project', entityId: generateId() },
      }
      const ownerless: MothershipResource = { type: 'file', id: generateId(), title: 'Legacy file' }
      const table: MothershipResource = {
        type: 'table',
        id: generateId(),
        title: 'Table',
        workspaceId,
      }
      for (const resource of [workspaceFile, projectFile, ownerless, table]) {
        const event = createEvent({
          streamId: generateId(),
          cursor: '0',
          seq: 0,
          requestId: generateId(),
          type: 'resource',
          payload: { op: 'upsert', resource },
        })
        const canonical = structuredClone(event)
        const encoded = new TextDecoder().decode(encodeSSEEnvelope(event))
        expect(encoded.startsWith('data: ')).toBe(true)
        expect(encoded.endsWith('\n\n')).toBe(true)
        const frame = toRecord(JSON.parse(encoded.slice(6).trim()))
        const expected = resource === workspaceFile ? { ...resource, workspaceId } : resource
        expect(toRecord(frame.payload).resource).toEqual(expected)
        expect(event).toEqual(canonical)
      }
    }
  )
})

afterAll(async () => {
  const reportPath = process.env.CHAT_RESOURCE_IDENTITY_REPORT_PATH
  if (reportPath) {
    await mkdir(dirname(reportPath), { recursive: true })
    await writeFile(reportPath, JSON.stringify({ checks: identityChecks }, null, 2))
  }
  for (const f of fixtures) {
    await db.delete(workspaceFiles).where(eq(workspaceFiles.id, f.fileId))
    await deleteWorkspaceFixture(db, eq(workspace.id, f.workspaceId))
    await db.delete(user).where(eq(user.id, f.userId))
  }
  await db.$client.end()
})
