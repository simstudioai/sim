import { db } from '@sim/db'
import { copilotChats, member, organization, permissions, user, workspace } from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRunSegment } from '@/lib/mothership/async-runs/repository'
import { createTrustedOrganizationCopilotPrincipal } from '@/lib/mothership/auth/application-delegation'
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
    const headers = {
      'content-type': 'application/json',
      'x-api-key': process.env.INTERNAL_API_SECRET!,
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

  it('does not turn original admission into an organization target grant for a now-personal chat', async () => {
    const run = await admitted()
    await db
      .update(copilotChats)
      .set({ organizationId: null })
      .where(eq(copilotChats.id, run.chatId))
    const workspaceId = generateId()
    await insertWorkspaceFixture(db, {
      id: workspaceId,
      name: 'Callback target',
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
    const request = {
      id: generateId(),
      scope: { userId, chatId: run.chatId, organizationId: originalOrg },
      executionStreamId: run.streamId,
      operation: { kind: 'workspace_context' as const, input: { workspaceId } },
      expiresAt: Date.now() + 60_000,
    }
    try {
      const personal = await executeSimControl(request)
      expect(personal.status).toBe(200)
      expect(JSON.parse(personal.body).workspaces[0].id).toBe(workspaceId)
      const orgWorkspaceId = generateId()
      await insertWorkspaceFixture(db, {
        id: orgWorkspaceId,
        name: 'Org callback target',
        ownerId: userId,
        billedAccountUserId: userId,
        organizationId: originalOrg,
      })
      try {
        expect(
          (
            await executeSimControl({
              ...request,
              operation: { kind: 'workspace_context', input: { workspaceId: orgWorkspaceId } },
            })
          ).status
        ).toBe(404)
      } finally {
        await deleteWorkspaceFixture(db, eq(workspace.id, orgWorkspaceId))
      }
    } finally {
      await deleteWorkspaceFixture(db, eq(workspace.id, workspaceId))
    }
  })
})
