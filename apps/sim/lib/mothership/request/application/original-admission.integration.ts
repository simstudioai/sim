import { db } from '@sim/db'
import {
  copilotChats,
  member,
  organization,
  permissionGroup,
  permissionGroupWorkspace,
  permissions,
  user,
  workflow,
  workflowExecutionLogs,
  workflowExecutionSnapshots,
  workspace,
} from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { executeAgentCliRequest } from '@/lib/mothership/agent-cli'
import { createRunSegment } from '@/lib/mothership/async-runs/repository'
import {
  createCopilotChatPrincipal,
  createTrustedOrganizationCopilotPrincipal,
} from '@/lib/mothership/auth/application-delegation'
import {
  authorizeChatWorkspaceTarget,
  WORKSPACE_TARGET_AUDIENCE,
} from '@/lib/mothership/chat/application/workspace-target'
import {
  RUN_CONTROL_AUDIENCE,
  readRunControl,
} from '@/lib/mothership/request/application/read-control'
import { executeSimControl } from '@/lib/mothership/transport/control'
import { POST as runControlRoute } from '@/app/api/mothership/runs/control/route'

/** A current chat owner and an original execution owner are independent authorization facts. */
describe('Original execution admission', () => {
  const userId = generateId()
  const originalOrg = generateId()
  const currentOrg = generateId()
  beforeAll(async () => {
    const now = new Date()
    await db.insert(user).values({
      id: userId,
      name: 'Admission fixture',
      email: `${userId}@admission.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
    for (const id of [originalOrg, currentOrg]) {
      await db.insert(organization).values({ id, name: 'Admission fixture', slug: id })
    }
  })
  afterAll(async () => {
    await db.delete(user).where(eq(user.id, userId))
    await db.delete(organization).where(inArray(organization.id, [originalOrg, currentOrg]))
  })
  async function admitted() {
    const chatId = generateId()
    const streamId = generateId()
    await db
      .insert(copilotChats)
      .values({ id: chatId, userId, organizationId: originalOrg, type: 'mothership' })
    await createRunSegment({
      userId,
      chatId,
      streamId,
      organizationId: originalOrg,
      executionId: generateId(),
    })
    await db.delete(member).where(eq(member.userId, userId))
    await db
      .insert(member)
      .values({ id: generateId(), userId, organizationId: originalOrg, role: 'owner' })
    const principal = {
      ...createTrustedOrganizationCopilotPrincipal(
        { userId, chatId, organizationId: originalOrg, delegationId: generateId() },
        { audience: RUN_CONTROL_AUDIENCE, ttlMs: 60_000 }
      ),
      executionStreamId: streamId,
    }
    return { chatId, streamId, principal }
  }
  it('authorizes the original admission after current ownership changes, then stops on current access loss', async () => {
    const run = await admitted()
    await db
      .update(copilotChats)
      .set({ organizationId: currentOrg })
      .where(eq(copilotChats.id, run.chatId))
    await db.update(member).set({ organizationId: currentOrg }).where(eq(member.userId, userId))
    expect(
      await readRunControl.execute({
        principal: run.principal,
        input: { chatId: run.chatId, streamId: run.streamId },
      })
    ).toEqual({ stopped: false })
    await db
      .delete(member)
      .where(and(eq(member.userId, userId), eq(member.organizationId, currentOrg)))
    expect(
      await readRunControl.execute({
        principal: run.principal,
        input: { chatId: run.chatId, streamId: run.streamId },
      })
    ).toEqual({ stopped: true })
  })
  it('refuses conflicting execution correlation even when actor and chat match', async () => {
    const run = await admitted()
    await expect(
      readRunControl.execute({
        principal: { ...run.principal, executionStreamId: generateId() },
        input: { chatId: run.chatId, streamId: run.streamId },
      })
    ).rejects.toThrow()
  })
  it('accepts personal callbacks on both transports and rejects wrong credentials and duplicate identity', async () => {
    const chatId = generateId()
    const streamId = `personal-stream-${generateId()}`
    await db.insert(copilotChats).values({ id: chatId, userId, type: 'mothership' })
    await createRunSegment({
      userId,
      chatId,
      streamId,
      workspaceId: null,
      organizationId: null,
      executionId: generateId(),
    })
    const input = { chatId, streamId }
    const request = {
      id: generateId(),
      scope: { userId, chatId },
      executionStreamId: streamId,
      operation: { kind: 'run_control' as const, input },
      expiresAt: Date.now() + 60_000,
    }
    const checkpoint = await executeSimControl(request)
    expect(checkpoint.status).toBe(200)
    expect(JSON.parse(checkpoint.body)).toEqual({ stopped: false })
    const internalSecret = process.env.INTERNAL_API_SECRET
    if (!internalSecret) throw new Error('Integration internal secret is required')
    const headers = {
      'content-type': 'application/json',
      'x-api-key': internalSecret,
      'x-mothership-user-id': userId,
      'x-mothership-chat-id': chatId,
      'x-mothership-execution-stream-id': streamId,
    }
    const direct = (values = headers) =>
      runControlRoute(
        new NextRequest('http://localhost/api/mothership/runs/control', {
          method: 'POST',
          headers: values,
          body: JSON.stringify(input),
        })
      )
    const response = await direct()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ stopped: false })
    expect((await direct({ ...headers, 'x-api-key': 'wrong' })).status).toBe(401)
    expect(
      (await direct({ ...headers, 'x-mothership-execution-stream-id': 'another-stream' })).status
    ).toBe(403)
    expect(
      (await executeSimControl({ ...request, executionStreamId: 'another-stream' })).status
    ).toBe(403)
    expect((await executeSimControl({ ...request, expiresAt: 0 })).status).toBe(410)
  })

  it('keeps an old workspace admission bounded after synthetic organization conversion', async () => {
    const ownerId = generateId()
    const x = generateId()
    const y = generateId()
    const chatId = generateId()
    const streamId = generateId()
    const now = new Date()
    await db.insert(user).values({
      id: ownerId,
      name: 'Target owner',
      email: `${ownerId}@admission.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
    await db.delete(member).where(eq(member.userId, userId))
    await db
      .insert(member)
      .values({ id: generateId(), userId, organizationId: currentOrg, role: 'member' })
    for (const id of [x, y]) {
      await insertWorkspaceFixture(db, {
        id,
        name: id === x ? 'Original target' : 'Other target',
        ownerId,
        billedAccountUserId: ownerId,
        organizationId: currentOrg,
      })
      await db.insert(permissions).values({
        id: generateId(),
        userId,
        entityType: 'workspace',
        entityId: id,
        permissionType: 'admin',
      })
    }
    await db.insert(copilotChats).values({
      id: chatId,
      userId,
      workspaceId: x,
      type: 'mothership',
      config: { conversationMode: 'agent' },
    })
    await createRunSegment({ userId, chatId, streamId, workspaceId: x, executionId: generateId() })
    // Synthetic storage transition: public canonical activation is a later slice.
    await db
      .update(copilotChats)
      .set({ workspaceId: null, organizationId: currentOrg })
      .where(eq(copilotChats.id, chatId))
    const request = (workspaceId: string, originalStream = streamId, canonical = false) =>
      executeSimControl({
        id: generateId(),
        scope: {
          userId,
          chatId,
          ...(canonical ? { organizationId: currentOrg } : { workspaceId: x }),
        },
        executionStreamId: originalStream,
        operation: { kind: 'workspace_context', input: { workspaceId } },
        expiresAt: Date.now() + 60_000,
      })
    try {
      const original = await request(x)
      expect(original.status).toBe(200)
      expect(JSON.parse(original.body).workspaces.map((w: { id: string }) => w.id)).toEqual([x])
      const outside = await request(y)
      expect(outside.status, 'old workspace admission must not discover Y').toBe(404)
      expect(JSON.parse(outside.body).error).toBe('Workspace not found in the admitted execution')
      const freshStream = generateId()
      await createRunSegment({
        userId,
        chatId,
        streamId: freshStream,
        organizationId: currentOrg,
        executionId: generateId(),
      })
      const fresh = await request(y, freshStream, true)
      expect(fresh.status).toBe(200)
      expect(JSON.parse(fresh.body).workspaces.map((w: { id: string }) => w.id)).toEqual([y])
      const originalPrincipal = {
        ...createCopilotChatPrincipal(
          { userId, chatId, workspaceId: x },
          WORKSPACE_TARGET_AUDIENCE
        ),
        executionStreamId: streamId,
      }
      expect(
        (
          await authorizeChatWorkspaceTarget.execute({
            principal: originalPrincipal,
            input: { chatId, workspaceId: x },
          })
        ).workspaceId
      ).toBe(x)
      await expect(
        authorizeChatWorkspaceTarget.execute({
          principal: originalPrincipal,
          input: { chatId, workspaceId: y },
        })
      ).rejects.toThrow('Workspace not found in the admitted execution')
      const cli = await executeAgentCliRequest(
        { invocation: { kind: 'cli', argv: ['workspaces', 'get'] } },
        { userId, chatId, workspaceId: x, messageId: streamId, copilotToolExecution: true }
      )
      expect(cli.exitCode, 'same admitted CLI read of X survives owner representation change').toBe(
        0
      )
      expect(JSON.parse(cli.stdout).id).toBe(x)
      await expect(
        executeAgentCliRequest(
          { workspaceId: y, invocation: { kind: 'cli', argv: ['workspaces', 'get'] } },
          { userId, chatId, workspaceId: x, messageId: streamId, copilotToolExecution: true }
        )
      ).rejects.toThrow('Workspace not found in this conversation')
      await expect(
        executeAgentCliRequest(
          { invocation: { kind: 'cli', argv: ['workspaces', 'get'] } },
          { userId, chatId, workspaceId: x, messageId: freshStream, copilotToolExecution: true }
        )
      ).rejects.toThrow('Run delegation is no longer valid')
      await expect(
        executeAgentCliRequest(
          { invocation: { kind: 'cli', argv: ['workspaces', 'get'] } },
          { userId, chatId, workspaceId: x, messageId: generateId(), copilotToolExecution: true }
        )
      ).rejects.toThrow('Stream not found')
      const scope = { userId, chatId, workspaceId: x }
      const canonicalScope = { userId, chatId, organizationId: currentOrg }
      const catalog = (workspaceId?: string, canonical = false) =>
        executeSimControl({
          id: generateId(),
          scope: canonical ? canonicalScope : scope,
          executionStreamId: canonical ? freshStream : streamId,
          operation: {
            kind: 'integration_catalog',
            input: {
              mode: 'agent',
              mcpServerIds: [],
              limit: 1,
              ...(workspaceId ? { workspaceId } : {}),
            },
          },
          expiresAt: Date.now() + 60_000,
        })
      const groupId = generateId()
      await db.insert(permissionGroup).values({
        id: groupId,
        organizationId: currentOrg,
        createdBy: ownerId,
        name: groupId,
        config: { allowedIntegrations: [] },
        membershipMode: 'inherit',
      })
      await db.insert(permissionGroupWorkspace).values({
        id: generateId(),
        permissionGroupId: groupId,
        workspaceId: x,
        organizationId: currentOrg,
      })
      try {
        const implicit = await catalog()
        expect(implicit.status).toBe(200)
        expect(
          JSON.parse(implicit.body).total,
          'implicit catalog retains original X restrictions'
        ).toBe(0)
        const otherCatalog = await catalog(y)
        expect(otherCatalog.status, 'explicit catalog cannot widen to Y').toBe(404)
        const freshCatalog = await catalog(y, true)
        expect(freshCatalog.status).toBe(200)
        expect(JSON.parse(freshCatalog.body).total).toBeGreaterThan(0)
      } finally {
        await db.delete(permissionGroup).where(eq(permissionGroup.id, groupId))
      }
      const workflowId = generateId()
      const snapshotId = generateId()
      const executionId = generateId()
      await db.insert(workflow).values({
        id: workflowId,
        workspaceId: y,
        userId: ownerId,
        name: 'Scoped execution',
        lastSynced: now,
        createdAt: now,
        updatedAt: now,
      })
      await db
        .insert(workflowExecutionSnapshots)
        .values({ id: snapshotId, workflowId, stateHash: snapshotId, stateData: {} })
      await db.insert(workflowExecutionLogs).values({
        id: generateId(),
        workflowId,
        workspaceId: y,
        executionId,
        stateSnapshotId: snapshotId,
        level: 'info',
        status: 'completed',
        trigger: 'manual',
        startedAt: now,
        endedAt: now,
      })
      try {
        const status = (canonical: boolean) =>
          executeSimControl({
            id: generateId(),
            scope: canonical ? canonicalScope : scope,
            executionStreamId: canonical ? freshStream : streamId,
            operation: { kind: 'workflow_status', input: { chatId, workspaceId: y, executionId } },
            expiresAt: Date.now() + 60_000,
          })
        const freshStatus = await status(true)
        expect(freshStatus.status).toBe(200)
        expect(JSON.parse(freshStatus.body).status).toBe('completed')
        const originalStatus = await status(false)
        expect(originalStatus.status, 'old run cannot observe workflow status in Y').toBe(404)
        expect(JSON.parse(originalStatus.body).error).toBe(
          'Workspace not found in the admitted execution'
        )
      } finally {
        await db
          .delete(workflowExecutionLogs)
          .where(eq(workflowExecutionLogs.executionId, executionId))
        await db
          .delete(workflowExecutionSnapshots)
          .where(eq(workflowExecutionSnapshots.id, snapshotId))
        await db.delete(workflow).where(eq(workflow.id, workflowId))
      }
      await db
        .delete(permissions)
        .where(and(eq(permissions.userId, userId), eq(permissions.entityId, x)))
      expect((await request(x)).status, 'revoked original workspace must be denied').toBe(403)
      await db.insert(permissions).values({
        id: generateId(),
        userId,
        entityType: 'workspace',
        entityId: x,
        permissionType: 'admin',
      })
      expect((await request(x)).status).toBe(200)
      await db.update(workspace).set({ archivedAt: now }).where(eq(workspace.id, x))
      expect((await request(x)).status, 'archived source must be denied').toBe(404)
      await db.update(workspace).set({ archivedAt: null }).where(eq(workspace.id, x))
      expect((await request(x)).status).toBe(200)
      await deleteWorkspaceFixture(db, eq(workspace.id, x))
      expect((await request(x)).status, 'deleted source must be denied').toBe(404)
    } finally {
      await db.delete(copilotChats).where(eq(copilotChats.id, chatId))
      for (const id of [x, y]) await deleteWorkspaceFixture(db, eq(workspace.id, id))
      await db.delete(user).where(eq(user.id, ownerId))
    }
  })

  it('does not broaden an old organization admission into personal targets', async () => {
    const run = await admitted()
    await db
      .update(copilotChats)
      .set({ organizationId: null })
      .where(eq(copilotChats.id, run.chatId))
    const workspaceId = generateId()
    await insertWorkspaceFixture(db, {
      id: workspaceId,
      name: 'Personal target',
      ownerId: userId,
      billedAccountUserId: userId,
    })
    await db.insert(permissions).values({
      id: generateId(),
      userId,
      entityType: 'workspace',
      entityId: workspaceId,
      permissionType: 'admin',
    })
    try {
      const result = await executeSimControl({
        id: generateId(),
        scope: { userId, chatId: run.chatId, organizationId: originalOrg },
        executionStreamId: run.streamId,
        operation: { kind: 'workspace_context', input: { workspaceId } },
        expiresAt: Date.now() + 60_000,
      })
      const catalog = await executeSimControl({
        id: generateId(),
        scope: { userId, chatId: run.chatId, organizationId: originalOrg },
        executionStreamId: run.streamId,
        operation: {
          kind: 'integration_catalog',
          input: { mode: 'agent', mcpServerIds: [], limit: 1 },
        },
        expiresAt: Date.now() + 60_000,
      })
      expect(catalog.status, 'implicit catalog cannot become personal').toBe(404)
      expect(JSON.parse(catalog.body).error).toBe(
        'Integration catalog not found in the admitted execution'
      )
      expect(result.status).toBe(404)
      expect(JSON.parse(result.body).error).toBe('Workspace not found in the admitted execution')
    } finally {
      await deleteWorkspaceFixture(db, eq(workspace.id, workspaceId))
    }
  })
})
