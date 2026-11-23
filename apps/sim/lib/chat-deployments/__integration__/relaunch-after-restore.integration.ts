/**
 * A chat deployment whose workflow was deleted and then restored, against real PostgreSQL.
 *
 * Archiving a workflow sets its chat to `isActive: false`, and restore deliberately leaves it
 * that way: re-enabling is an explicit redeploy. These cases prove each explicit chat deploy
 * path — the editor's "Launch Chat" update and the create-or-update deploy shared by the
 * internal route, the v2 API, and Copilot — puts the restored chat back online, and that
 * nothing reactivates a chat whose workflow is still deleted.
 */
import assert from 'node:assert/strict'
import { db } from '@sim/db'
import { chat, permissions, project, user, workflow, workspace } from '@sim/db/schema'
import { insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { updateChatDeployment } from '@/lib/chat-deployments/application/update-chat-deployment'
import { readWorkflowChatDeploymentStatus } from '@/lib/chat-deployments/application/workflow-chat-deployment'
import { archiveWorkflow, restoreWorkflow } from '@/lib/workflows/lifecycle'
import { performChatDeploy } from '@/lib/workflows/orchestration/chat-deploy'
import { admitWorkflowState, saveAdmittedWorkflowState } from '@/lib/workflows/persistence/utils'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const userId = generateId()
const workspaceId = generateId()
const principal = {
  kind: 'personal_api_key' as const,
  userId,
  keyId: generateId(),
  access: 'write' as const,
}

/** A start → function graph; block ids are a global key, so each workflow gets its own. */
function graph(): WorkflowState {
  const start = generateId()
  const compute = generateId()
  return {
    blocks: {
      [start]: {
        id: start,
        type: 'start_trigger',
        name: 'Start',
        enabled: true,
        position: { x: 0, y: 0 },
        subBlocks: {},
        outputs: {},
      },
      [compute]: {
        id: compute,
        type: 'function',
        name: 'Compute',
        enabled: true,
        position: { x: 200, y: 0 },
        subBlocks: {
          language: { id: 'language', type: 'dropdown', value: 'javascript' },
          code: { id: 'code', type: 'code', value: 'return 42' },
        },
        outputs: {},
      },
    },
    edges: [
      {
        id: generateId(),
        source: start,
        target: compute,
        sourceHandle: 'source',
        targetHandle: 'target',
      },
    ],
    loops: {},
    parallels: {},
    variables: {},
  }
}

/** A saved workflow with a live chat deployment, created through the real deploy path. */
async function workflowWithLiveChat() {
  const workflowId = generateId()
  const now = new Date()
  await db.insert(workflow).values({
    id: workflowId,
    userId,
    workspaceId,
    name: `Chat relaunch fixture ${workflowId}`,
    lastSynced: now,
    createdAt: now,
    updatedAt: now,
  })
  const admitted = await admitWorkflowState(graph(), { subjectUserId: userId, workspaceId })
  await db.transaction((tx) => saveAdmittedWorkflowState(tx, workflowId, admitted))

  const identifier = `relaunch-${generateId().slice(0, 8)}`
  const deployed = await performChatDeploy({
    workflowId,
    userId,
    workspaceId,
    identifier,
    title: 'Support',
  })
  expect(deployed, deployed.error).toMatchObject({ success: true, isUpdate: false })
  assert(deployed.chatId)
  return { workflowId, chatId: deployed.chatId, identifier }
}

async function chatRow(chatId: string) {
  const [row] = await db.select().from(chat).where(eq(chat.id, chatId))
  assert(row)
  return row
}

async function editorChatStatus(workflowId: string) {
  return readWorkflowChatDeploymentStatus.execute({ principal, input: { workflowId } })
}

/** Deletes then restores the workflow, asserting the chat comes back present but offline. */
async function deleteAndRestore(workflowId: string, chatId: string) {
  expect((await archiveWorkflow(workflowId, { requestId: generateId() })).archived).toBe(true)
  expect((await restoreWorkflow(workflowId, { requestId: generateId() })).restored).toBe(true)
  const restored = await chatRow(chatId)
  expect(restored).toMatchObject({ archivedAt: null, isActive: false })
  expect(await editorChatStatus(workflowId)).toMatchObject({
    isDeployed: false,
    deployment: { id: chatId },
  })
}

describe('relaunching the chat of a restored workflow', () => {
  beforeAll(async () => {
    const now = new Date()
    await db.insert(user).values({
      id: userId,
      name: 'Chat relaunch fixture',
      email: `${userId}@chat-relaunch.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
    await insertWorkspaceFixture(db, {
      id: workspaceId,
      name: 'Chat relaunch fixture',
      ownerId: userId,
      billedAccountUserId: userId,
      allowPersonalApiKeys: true,
    })
    await db.insert(permissions).values({
      id: generateId(),
      userId,
      entityType: 'workspace',
      entityId: workspaceId,
      permissionType: 'admin',
    })
  })

  afterAll(async () => {
    await db.transaction(async (tx) => {
      await tx.delete(workspace).where(inArray(workspace.id, [workspaceId]))
      await tx.delete(project).where(eq(project.ownerId, userId))
      await tx.delete(user).where(eq(user.id, userId))
    })
    await db.$client.end()
  })

  it('puts the chat back online when the editor relaunches it', async () => {
    const { workflowId, chatId, identifier } = await workflowWithLiveChat()
    await deleteAndRestore(workflowId, chatId)

    const relaunched = await updateChatDeployment.execute({
      principal,
      input: { chatDeploymentId: chatId, workflowId, title: 'Support' },
    })

    expect(relaunched.deployment).toMatchObject({ id: chatId, identifier, isActive: true })
    expect(await chatRow(chatId)).toMatchObject({ isActive: true, archivedAt: null })
    expect(await editorChatStatus(workflowId)).toMatchObject({ isDeployed: true })
    const [restoredWorkflow] = await db
      .select({ isDeployed: workflow.isDeployed })
      .from(workflow)
      .where(eq(workflow.id, workflowId))
    expect(restoredWorkflow?.isDeployed).toBe(true)
  })

  it('puts the chat back online when it is redeployed through the shared deploy path', async () => {
    const { workflowId, chatId, identifier } = await workflowWithLiveChat()
    await deleteAndRestore(workflowId, chatId)

    const redeployed = await performChatDeploy({
      workflowId,
      userId,
      workspaceId,
      identifier,
      title: 'Support',
    })

    expect(redeployed, redeployed.error).toMatchObject({
      success: true,
      isUpdate: true,
      chatId,
    })
    expect(await chatRow(chatId)).toMatchObject({ isActive: true, archivedAt: null })
    expect(await editorChatStatus(workflowId)).toMatchObject({ isDeployed: true })
  })

  it('cannot reactivate the chat of a workflow that is still deleted', async () => {
    const { workflowId, chatId } = await workflowWithLiveChat()
    expect((await archiveWorkflow(workflowId, { requestId: generateId() })).archived).toBe(true)

    await expect(
      updateChatDeployment.execute({
        principal,
        input: { chatDeploymentId: chatId, workflowId, title: 'Support' },
      })
    ).rejects.toMatchObject({ code: 'not_found' })

    const archived = await chatRow(chatId)
    expect(archived.isActive).toBe(false)
    expect(archived.archivedAt).not.toBeNull()
  })
})
