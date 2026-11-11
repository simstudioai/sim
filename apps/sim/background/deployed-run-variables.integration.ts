/**
 * Scheduled and webhook runs against real PostgreSQL: each executes its deployed version with
 * the variables that version was deployed with, not the editor's saved ones, except for a
 * version deployed before deployments snapshotted variables, which keeps the saved ones.
 */
import { serializePrincipal } from '@sim/auth/principal'
import { db } from '@sim/db'
import {
  permissions,
  user,
  webhook,
  workflow,
  workflowDeploymentVersion,
  workflowExecutionLogs,
  workflowExecutionSnapshots,
  workflowSchedule,
  workspace,
} from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { resolveBillingAttribution } from '@/lib/billing/core/attribution'
import { createWebhookExecutionPrincipal } from '@/lib/webhooks/execution-principal'
import { getWorkflowExecutionStatus } from '@/lib/workflows/executor/execution-status'
import { executeScheduleJob } from '@/background/schedule-execution'
import { executeWebhookJob } from '@/background/webhook-execution'

const ownerId = generateId()
const workspaceId = generateId()
const workflowIds: string[] = []

function variables(workflowId: string, greeting: string) {
  return {
    greeting: { id: 'greeting', workflowId, name: 'greeting', type: 'plain', value: greeting },
  }
}

const SCHEDULE_TRIGGER = {
  id: 'trigger',
  type: 'schedule',
  name: 'Schedule',
  enabled: true,
  position: { x: 0, y: 0 },
  outputs: {},
  subBlocks: {
    scheduleType: { id: 'scheduleType', type: 'dropdown', value: 'custom' },
    cronExpression: { id: 'cronExpression', type: 'short-input', value: '0 0 * * *' },
  },
}

const WEBHOOK_TRIGGER = {
  id: 'trigger',
  type: 'generic_webhook',
  name: 'Webhook',
  enabled: true,
  position: { x: 0, y: 0 },
  outputs: {},
  subBlocks: {},
  triggerMode: true,
}

/** Trigger into a Response echoing the `greeting` variable; `variables` omitted for a legacy snapshot. */
function deployedState(
  trigger: typeof SCHEDULE_TRIGGER | typeof WEBHOOK_TRIGGER,
  snapshotVariables: Record<string, unknown> | undefined
) {
  return {
    blocks: {
      trigger,
      respond: {
        id: 'respond',
        type: 'response',
        name: 'Respond',
        enabled: true,
        position: { x: 300, y: 0 },
        outputs: {},
        subBlocks: {
          dataMode: { id: 'dataMode', type: 'dropdown', value: 'json' },
          data: { id: 'data', type: 'code', value: '{"greeting": "<variable.greeting>"}' },
          status: { id: 'status', type: 'short-input', value: '200' },
        },
      },
    },
    edges: [{ id: 'trigger-respond', source: 'trigger', target: 'respond' }],
    loops: {},
    parallels: {},
    ...(snapshotVariables ? { variables: snapshotVariables } : {}),
  }
}

/**
 * A workflow whose saved variables differ from the deployed ones. With `superseded`, the
 * returned version is no longer active: a later one with its own variables is.
 */
async function deployWorkflow(
  trigger: typeof SCHEDULE_TRIGGER | typeof WEBHOOK_TRIGGER,
  { snapshotsVariables, superseded = false }: { snapshotsVariables: boolean; superseded?: boolean }
) {
  const workflowId = generateId()
  const versionId = generateId()
  workflowIds.push(workflowId)
  const now = new Date()
  await db.insert(workflow).values({
    id: workflowId,
    userId: ownerId,
    workspaceId,
    name: `Deployed variables fixture ${workflowId}`,
    isDeployed: true,
    deployedAt: now,
    variables: variables(workflowId, 'saved'),
    lastSynced: now,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(workflowDeploymentVersion).values({
    id: versionId,
    workflowId,
    version: 1,
    state: deployedState(
      trigger,
      snapshotsVariables ? variables(workflowId, 'deployed') : undefined
    ),
    isActive: !superseded,
  })
  if (superseded) {
    await db.insert(workflowDeploymentVersion).values({
      id: generateId(),
      workflowId,
      version: 2,
      state: deployedState(trigger, variables(workflowId, 'active')),
      isActive: true,
    })
  }
  return { workflowId, versionId }
}

async function settledOutput(workflowId: string, executionId: string) {
  return vi.waitFor(
    async () => {
      const status = await getWorkflowExecutionStatus({
        workflowId,
        executionId,
        includeOutput: true,
        selectedOutputs: [],
        workspaceId,
        viewerUserId: ownerId,
      })
      if (status?.status !== 'completed') {
        throw new Error(`Run ${executionId} has not completed: ${status?.status} ${status?.error}`)
      }
      return status.finalOutput
    },
    { timeout: 20_000, interval: 250 }
  )
}

async function runSchedule(workflowId: string, versionId: string) {
  const scheduleId = generateId()
  const executionId = generateId()
  const now = new Date()
  await db.insert(workflowSchedule).values({
    id: scheduleId,
    workflowId,
    deploymentVersionId: versionId,
    blockId: 'trigger',
    cronExpression: '0 0 * * *',
    triggerType: 'schedule',
    lastQueuedAt: now,
    createdAt: now,
    updatedAt: now,
  })
  await executeScheduleJob({
    scheduleId,
    workflowId,
    workspaceId,
    billingAttribution: await resolveBillingAttribution({ actorUserId: ownerId, workspaceId }),
    executionId,
    blockId: 'trigger',
    deploymentVersionId: versionId,
    cronExpression: '0 0 * * *',
    now: now.toISOString(),
  })
  return settledOutput(workflowId, executionId)
}

async function runWebhook(workflowId: string, versionId: string) {
  const webhookId = generateId()
  const executionId = generateId()
  await db.insert(webhook).values({
    id: webhookId,
    workflowId,
    deploymentVersionId: versionId,
    blockId: 'trigger',
    path: `deployed-variables-${webhookId}`,
    provider: 'generic',
    providerConfig: {},
  })
  await executeWebhookJob({
    webhookId,
    workflowId,
    principal: serializePrincipal(
      createWebhookExecutionPrincipal({ webhookId, workflowId, workspaceId, provider: 'generic' })
    ),
    userId: ownerId,
    billingAttribution: await resolveBillingAttribution({ actorUserId: ownerId, workspaceId }),
    executionId,
    provider: 'generic',
    body: { event: 'ping' },
    headers: {},
    method: 'POST',
    path: `deployed-variables-${webhookId}`,
    blockId: 'trigger',
    deploymentVersionId: versionId,
    workspaceId,
  })
  return settledOutput(workflowId, executionId)
}

beforeAll(async () => {
  const now = new Date()
  await db.insert(user).values({
    id: ownerId,
    name: 'Deployed variables fixture',
    email: `${ownerId}@deployed-variables.test`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  await insertWorkspaceFixture(db, {
    id: workspaceId,
    name: 'Deployed variables fixture',
    ownerId,
    billedAccountUserId: ownerId,
  })
  await db.insert(permissions).values({
    id: generateId(),
    userId: ownerId,
    entityType: 'workspace',
    entityId: workspaceId,
    permissionType: 'admin',
  })
})

afterAll(async () => {
  if (workflowIds.length > 0) {
    await db
      .delete(workflowExecutionLogs)
      .where(inArray(workflowExecutionLogs.workflowId, workflowIds))
    await db
      .delete(workflowExecutionSnapshots)
      .where(inArray(workflowExecutionSnapshots.workflowId, workflowIds))
  }
  await deleteWorkspaceFixture(db, eq(workspace.id, workspaceId))
  await db.delete(user).where(eq(user.id, ownerId))
  await db.$client.end()
})

describe('variables a queued deployed run executes with', () => {
  it('runs a schedule with its deployed variables, not the saved ones', async () => {
    const { workflowId, versionId } = await deployWorkflow(SCHEDULE_TRIGGER, {
      snapshotsVariables: true,
    })
    await expect(runSchedule(workflowId, versionId)).resolves.toMatchObject({
      data: { greeting: 'deployed' },
    })
  })

  it('runs a webhook delivery admitted on an earlier version with that version variables', async () => {
    const { workflowId, versionId } = await deployWorkflow(WEBHOOK_TRIGGER, {
      snapshotsVariables: true,
      superseded: true,
    })
    await expect(runWebhook(workflowId, versionId)).resolves.toMatchObject({
      data: { greeting: 'deployed' },
    })
  })

  it('keeps the saved variables for a version deployed before variables were snapshotted', async () => {
    const { workflowId, versionId } = await deployWorkflow(SCHEDULE_TRIGGER, {
      snapshotsVariables: false,
    })
    await expect(runSchedule(workflowId, versionId)).resolves.toMatchObject({
      data: { greeting: 'saved' },
    })
  })
})
