/** Chat's in-process CLI requesting withheld access for the member it acts for. */

import { db } from '@sim/db'
import {
  auditLog,
  member,
  organization,
  permissionAccessRequest,
  permissionGroup,
  permissionGroupWorkspace,
  permissions,
  user,
  workspace,
} from '@sim/db/schema'
import { envFlagsMock } from '@sim/testing/mocks/env-flags.mock'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/config/env-flags', () => ({ ...envFlagsMock, isAccessControlEnabled: true }))

import { withWorkspaceInvocationScope } from '@/lib/core/application/workspace-invocation-scope'
import { createScopedCliTransport } from '@/lib/mothership/agent-cli/scoped-transport'
import '@/app/api/v2/workspaces/[workspaceId]/access-requests/route'
import '@/app/api/v2/workspaces/[workspaceId]/access-requests/discovery/route'
import '@/app/api/v2/workspaces/[workspaceId]/access-requests/[requestId]/cancel/route'
import '@/app/api/v2/organizations/[organizationId]/access-requests/route'

const ORIGIN = 'http://localhost:3000'
const organizationId = generateId()
const workspaceId = generateId()
const otherWorkspaceId = generateId()
const requesterId = generateId()
const peerId = generateId()
const groupId = generateId()
const target = { kind: 'feature', configKey: 'hideTablesTab' } as const

function chat(userId: string, chatWorkspaceId = workspaceId) {
  const transport = createScopedCliTransport(ORIGIN, {
    userId,
    workspaceId: chatWorkspaceId,
    chatId: generateId(),
  })
  return (path: string, body?: unknown) =>
    withWorkspaceInvocationScope({ workspaceId: chatWorkspaceId, organizationId }, () =>
      transport(
        `${ORIGIN}${path}`,
        body === undefined
          ? undefined
          : {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(body),
            }
      )
    )
}

function requestsOf(userId: string) {
  return db
    .select({ id: permissionAccessRequest.id, status: permissionAccessRequest.status })
    .from(permissionAccessRequest)
    .where(eq(permissionAccessRequest.requesterId, userId))
}

describe('chat-delegated workspace access requests', () => {
  beforeAll(async () => {
    const now = new Date()
    await db.insert(user).values(
      [requesterId, peerId].map((id) => ({
        id,
        name: 'Access request fixture',
        email: `${id}@access-request.test`,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      }))
    )
    await db.insert(organization).values({
      id: organizationId,
      name: 'Access request fixture',
      slug: organizationId,
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(member).values(
      [requesterId, peerId].map((userId) => ({
        id: generateId(),
        userId,
        organizationId,
        role: 'member',
        createdAt: now,
      }))
    )
    await db.insert(workspace).values(
      [workspaceId, otherWorkspaceId].map((id) => ({
        id,
        name: 'Access request fixture',
        ownerId: peerId,
        billedAccountUserId: peerId,
        organizationId,
        workspaceMode: 'organization' as const,
      }))
    )
    await db.insert(permissions).values([
      ...[requesterId, peerId].map((userId) => ({
        id: generateId(),
        userId,
        entityType: 'workspace',
        entityId: workspaceId,
        permissionType: 'write' as const,
      })),
      {
        id: generateId(),
        userId: peerId,
        entityType: 'workspace',
        entityId: otherWorkspaceId,
        permissionType: 'write' as const,
      },
    ])
    await db.insert(permissionGroup).values({
      id: groupId,
      organizationId,
      name: 'Tables withheld',
      createdBy: peerId,
      config: { hideTablesTab: true },
    })
    await db.insert(permissionGroupWorkspace).values({
      id: generateId(),
      permissionGroupId: groupId,
      workspaceId,
      organizationId,
    })
  })

  afterAll(async () => {
    await db
      .delete(permissionAccessRequest)
      .where(eq(permissionAccessRequest.organizationId, organizationId))
    await db.delete(auditLog).where(eq(auditLog.workspaceId, workspaceId))
    await db.delete(workspace).where(inArray(workspace.id, [workspaceId, otherWorkspaceId]))
    await db.delete(organization).where(eq(organization.id, organizationId))
    await db.delete(user).where(inArray(user.id, [requesterId, peerId]))
  })

  it('discovers, requests, lists and cancels a withheld feature as the delegating member', async () => {
    const asRequester = chat(requesterId)
    const base = `/api/v2/workspaces/${workspaceId}/access-requests`

    const discovery = await asRequester(`${base}/discovery?targetKind=feature&state=requestable`)
    expect(discovery.status).toBe(200)
    expect((await discovery.json()).data).toContainEqual(
      expect.objectContaining({ target, state: 'requestable', pendingRequestId: null })
    )

    const created = await asRequester(base, { target, reason: 'Need tables for a report' })
    expect(created.status).toBe(200)
    const { data: request } = await created.json()
    expect(request).toMatchObject({ status: 'pending', requester: { id: requesterId } })
    await vi.waitFor(async () => {
      const [audit] = await db
        .select({ actorId: auditLog.actorId, metadata: auditLog.metadata })
        .from(auditLog)
        .where(and(eq(auditLog.workspaceId, workspaceId), eq(auditLog.resourceId, request.id)))
      expect(audit).toMatchObject({
        actorId: requesterId,
        metadata: {
          operation: 'access_requests.create',
          actor: { kind: 'delegated', serviceId: 'copilot' },
        },
      })
    })

    const mine = await asRequester(base)
    expect(mine.status).toBe(200)
    expect((await mine.json()).data.map((entry: { id: string }) => entry.id)).toEqual([request.id])

    const cancelled = await asRequester(`${base}/${request.id}/cancel`, {})
    expect(cancelled.status).toBe(200)
    expect(await cancelled.json()).toMatchObject({ data: { id: request.id, status: 'cancelled' } })
  })

  it("refuses cancelling another member's request", async () => {
    const base = `/api/v2/workspaces/${workspaceId}/access-requests`
    const created = await chat(peerId)(base, { target })
    expect(created.status).toBe(200)
    const { data: request } = await created.json()

    const response = await chat(requesterId)(`${base}/${request.id}/cancel`, {})

    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({
      error: { code: 'NOT_FOUND', message: 'Access request scope not found' },
    })
    expect(await requestsOf(peerId)).toEqual([{ id: request.id, status: 'pending' }])
  })

  it('refuses a chat pinned to another workspace', async () => {
    const response = await chat(peerId, otherWorkspaceId)(
      `/api/v2/workspaces/${workspaceId}/access-requests`,
      { target: { kind: 'feature', configKey: 'hideFilesTab' } }
    )

    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({
      error: { code: 'NOT_FOUND', message: 'Access request scope not found' },
    })
    expect(await requestsOf(peerId)).toHaveLength(1)
  })

  it('keeps organization access requests direct-only', async () => {
    const response = await chat(requesterId)(
      `/api/v2/organizations/${organizationId}/access-requests`,
      { target }
    )

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({
      error: { code: 'FORBIDDEN', message: 'This operation is unavailable through Mothership.' },
    })
  })
})
