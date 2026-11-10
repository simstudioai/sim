/**
 * The worker's run-control read against real PostgreSQL, for a run whose chat changed scope after
 * the run was admitted (a workspace chat moved into its organization). Failure modes: the worker's
 * own delegation is refused as a caller error it can only retry, so the run never learns to stop;
 * and a delegation for a workspace the run was never admitted under is answered at all.
 */
import { db } from '@sim/db'
import {
  copilotChats,
  copilotRuns,
  member,
  organization,
  permissions,
  user,
  workspace,
} from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTrustedCopilotPrincipal } from '@/lib/mothership/auth/application-delegation'
import {
  RUN_CONTROL_AUDIENCE,
  readRunControl,
} from '@/lib/mothership/request/application/read-control'

const ids = {
  owner: generateId(),
  organization: generateId(),
  admittedWorkspace: generateId(),
  otherWorkspace: generateId(),
}

function delegation(workspaceId: string, chatId: string) {
  return createTrustedCopilotPrincipal(
    { userId: ids.owner, workspaceId, chatId, delegationId: generateId() },
    { audience: RUN_CONTROL_AUDIENCE, ttlMs: 60_000 }
  )
}

/** A run admitted under the workspace, on a chat that is (or no longer is) a workspace chat. */
async function runOnChat(scope: 'workspace' | 'organization') {
  const [chat] = await db
    .insert(copilotChats)
    .values(
      scope === 'workspace'
        ? { userId: ids.owner, workspaceId: ids.admittedWorkspace, type: 'mothership' }
        : { userId: ids.owner, organizationId: ids.organization, type: 'mothership' }
    )
    .returning({ id: copilotChats.id })
  const streamId = generateId()
  await db.insert(copilotRuns).values({
    executionId: generateId(),
    chatId: chat.id,
    userId: ids.owner,
    workspaceId: ids.admittedWorkspace,
    streamId,
    status: 'active',
  })
  return { chatId: chat.id, streamId }
}

beforeAll(async () => {
  const now = new Date()
  await db.insert(user).values({
    id: ids.owner,
    name: 'Run control fixture',
    email: `${ids.owner}@run-control.test`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  await db
    .insert(organization)
    .values({ id: ids.organization, name: 'Run control fixture', slug: ids.organization })
  await db.insert(member).values({
    id: generateId(),
    organizationId: ids.organization,
    userId: ids.owner,
    role: 'owner',
  })
  await insertWorkspaceFixture(
    db,
    [ids.admittedWorkspace, ids.otherWorkspace].map((id) => ({
      id,
      name: 'Run control fixture',
      organizationId: ids.organization,
      ownerId: ids.owner,
      billedAccountUserId: ids.owner,
    }))
  )
  await db.insert(permissions).values(
    [ids.admittedWorkspace, ids.otherWorkspace].map((entityId) => ({
      id: generateId(),
      userId: ids.owner,
      entityId,
      entityType: 'workspace' as const,
      permissionType: 'admin' as const,
    }))
  )
})

afterAll(async () => {
  await db.delete(copilotChats).where(eq(copilotChats.userId, ids.owner))
  await deleteWorkspaceFixture(
    db,
    inArray(workspace.id, [ids.admittedWorkspace, ids.otherWorkspace])
  )
  await db.delete(organization).where(eq(organization.id, ids.organization))
  await db.delete(user).where(eq(user.id, ids.owner))
})

describe('run control for a run whose chat changed scope', () => {
  it('keeps answering a run whose chat is still where it was admitted', async () => {
    const run = await runOnChat('workspace')

    expect(
      await readRunControl.execute({
        principal: delegation(ids.admittedWorkspace, run.chatId),
        input: run,
      })
    ).toEqual({ stopped: false })
  })

  it('answers Stop to the delegation the run was admitted under, not a retryable refusal', async () => {
    const run = await runOnChat('organization')

    expect(
      await readRunControl.execute({
        principal: delegation(ids.admittedWorkspace, run.chatId),
        input: run,
      })
    ).toEqual({ stopped: true })
  })

  it('refuses a delegation for a workspace the run was never admitted under', async () => {
    const run = await runOnChat('organization')

    await expect(
      readRunControl.execute({ principal: delegation(ids.otherWorkspace, run.chatId), input: run })
    ).rejects.toMatchObject({ code: 'forbidden' })
  })
})
