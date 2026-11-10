/**
 * A deployed run that pauses at a human-in-the-loop block, executed in-process against real
 * PostgreSQL: the pause's reviewer content is stored and read back with the run's resolved
 * secret redacted, and the run detail withholds that content on the same terms as the run's
 * output, while the pause's input fields stay readable.
 */
import { db } from '@sim/db'
import {
  member,
  organization,
  pausedExecutions,
  permissionGroup,
  permissionGroupMember,
  permissionGroupWorkspace,
  permissions,
  user,
  workflow,
  workflowDeploymentVersion,
  workflowExecutionLogs,
  workspace,
  workspaceEnvironment,
} from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { encryptSecret } from '@/lib/core/security/encryption'
import { executeWorkflowOperation } from '@/lib/workflows/application/execute-workflow'
import { readWorkflowRun } from '@/lib/workflows/application/read-workflow-run'
import type { PausePoint } from '@/executor/types'

const organizationId = generateId()
const ownerId = generateId()
const restrictedId = generateId()
const workspaceId = generateId()
const workflowId = generateId()
const owner = createSessionPrincipal({ userId: ownerId, sessionId: generateId() })
const restricted = createSessionPrincipal({ userId: restrictedId, sessionId: generateId() })
const SECRET = `resolved-secret-${generateId()}`

const deployedState = {
  blocks: {
    start: {
      id: 'start',
      type: 'start_trigger',
      name: 'Start',
      enabled: true,
      position: { x: 0, y: 0 },
      outputs: {},
      subBlocks: {},
    },
    approval: {
      id: 'approval',
      type: 'human_in_the_loop',
      name: 'Approval',
      enabled: true,
      position: { x: 300, y: 0 },
      outputs: {},
      subBlocks: {
        builderData: {
          id: 'builderData',
          type: 'response-format',
          value: [
            { id: 'summary', name: 'summary', type: 'string', value: 'Token is {{API_KEY}}' },
          ],
        },
        inputFormat: {
          id: 'inputFormat',
          type: 'input-format',
          value: [{ id: 'approved', name: 'approved', type: 'boolean', required: true }],
        },
      },
    },
  },
  edges: [{ id: 'start-approval', source: 'start', target: 'approval' }],
  loops: {},
  parallels: {},
  variables: {},
}

async function pausedRun(): Promise<string> {
  const result = await executeWorkflowOperation.execute({
    principal: owner,
    input: {
      workflowId,
      requestId: generateId(),
      input: {},
      mode: 'sync',
      requestHeaders: new Headers(),
    },
  })
  expect(result).toMatchObject({ ok: true, status: 'paused' })
  if (!result.ok || !('status' in result)) throw new Error('Expected a settled sync run')
  const { executionId } = result
  await vi.waitFor(
    async () => {
      const [row] = await db
        .select({ id: pausedExecutions.id })
        .from(pausedExecutions)
        .where(eq(pausedExecutions.executionId, executionId))
      if (!row) throw new Error('Pause not yet published')
    },
    { timeout: 30_000, interval: 250 }
  )
  return executionId
}

function readRun(
  principal: typeof owner,
  runId: string,
  { includeOutput }: { includeOutput: boolean }
) {
  return readWorkflowRun.execute({
    principal,
    input: { workflowId, runId, includeOutput, selectedOutputs: [] },
  })
}

const REDACTED_DISPLAY = {
  responseStructure: [{ name: 'summary', type: 'string', value: 'Token is {{API_KEY}}' }],
}
const INPUT_FIELDS = [{ name: 'approved', label: 'approved', type: 'boolean', required: true }]

beforeAll(async () => {
  const now = new Date()
  await db.insert(user).values(
    [ownerId, restrictedId].map((id) => ({
      id,
      name: 'Paused run fixture',
      email: `${id}@paused-run.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    }))
  )
  await db.insert(organization).values({
    id: organizationId,
    name: 'Paused run fixture',
    slug: organizationId,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(member).values(
    [ownerId, restrictedId].map((userId) => ({
      id: generateId(),
      userId,
      organizationId,
      role: userId === ownerId ? 'owner' : 'member',
      createdAt: now,
    }))
  )
  await insertWorkspaceFixture(db, {
    id: workspaceId,
    name: 'Paused run fixture',
    ownerId,
    billedAccountUserId: ownerId,
    organizationId,
    workspaceMode: 'organization',
  })
  await db.insert(permissions).values([
    {
      id: generateId(),
      userId: ownerId,
      entityType: 'workspace',
      entityId: workspaceId,
      permissionType: 'admin',
    },
    {
      id: generateId(),
      userId: restrictedId,
      entityType: 'workspace',
      entityId: workspaceId,
      permissionType: 'read',
    },
  ])
  const restrictedGroupId = generateId()
  await db.insert(permissionGroup).values([
    {
      id: generateId(),
      organizationId,
      name: 'Everyone',
      createdBy: ownerId,
      isDefault: true,
      config: {},
    },
    {
      id: restrictedGroupId,
      organizationId,
      name: 'No execution data',
      createdBy: ownerId,
      config: { hideTraceSpans: true },
    },
  ])
  await db.insert(permissionGroupWorkspace).values({
    id: generateId(),
    permissionGroupId: restrictedGroupId,
    workspaceId,
    organizationId,
  })
  await db.insert(permissionGroupMember).values({
    id: generateId(),
    permissionGroupId: restrictedGroupId,
    organizationId,
    userId: restrictedId,
  })
  await db.insert(workspaceEnvironment).values({
    id: generateId(),
    workspaceId,
    variables: { API_KEY: (await encryptSecret(SECRET)).encrypted },
  })
  await db.insert(workflow).values({
    id: workflowId,
    userId: ownerId,
    workspaceId,
    name: 'Paused run fixture',
    isDeployed: true,
    deployedAt: now,
    lastSynced: now,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(workflowDeploymentVersion).values({
    id: generateId(),
    workflowId,
    version: 1,
    state: deployedState,
    isActive: true,
  })
})

afterAll(async () => {
  await db.delete(pausedExecutions).where(eq(pausedExecutions.workflowId, workflowId))
  await db.delete(workflowExecutionLogs).where(eq(workflowExecutionLogs.workflowId, workflowId))
  await deleteWorkspaceFixture(db, eq(workspace.id, workspaceId))
  await db.delete(organization).where(eq(organization.id, organizationId))
  await db.delete(user).where(inArray(user.id, [ownerId, restrictedId]))
  await db.$client.end()
})

describe('a deployed run paused at a human-in-the-loop block', () => {
  it('stores and returns its reviewer content with the resolved secret redacted', async () => {
    const runId = await pausedRun()

    const [row] = await db
      .select({ pausePoints: pausedExecutions.pausePoints })
      .from(pausedExecutions)
      .where(eq(pausedExecutions.executionId, runId))
    const [stored] = Object.values(row.pausePoints as Record<string, PausePoint>)
    expect(stored).toMatchObject({
      displayScrubbed: true,
      display: REDACTED_DISPLAY,
      inputFields: INPUT_FIELDS,
    })

    const run = await readRun(owner, runId, { includeOutput: true })
    expect(run.pausePoints).toEqual([
      expect.objectContaining({
        blockId: 'approval',
        blockName: 'Approval',
        kind: 'human',
        display: REDACTED_DISPLAY,
        inputFields: INPUT_FIELDS,
      }),
    ])
    expect(JSON.stringify(run)).not.toContain(SECRET)
  })

  it('withholds reviewer content unless output was asked for, keeping the input fields', async () => {
    const runId = await pausedRun()

    const run = await readRun(owner, runId, { includeOutput: false })
    expect(run.pausePoints).toEqual([
      expect.objectContaining({ display: null, inputFields: INPUT_FIELDS }),
    ])
  })

  it('withholds reviewer content from a viewer whose group hides execution data', async () => {
    const runId = await pausedRun()

    const run = await readRun(restricted, runId, { includeOutput: true })
    expect(run.pausePoints).toEqual([
      expect.objectContaining({ display: null, inputFields: INPUT_FIELDS }),
    ])
  })
})
