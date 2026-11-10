import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import {
  auditLog,
  member,
  organization,
  permissionGroup,
  permissionGroupWorkspace,
  permissions,
  user,
  webhook,
  workflow,
  workflowDeploymentVersion,
  workflowSchedule,
  workspace,
} from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import {
  createSessionPrincipal,
  createWorkspaceApiKeyPrincipal,
} from '@sim/testing/factories/principal.factory'
import { featureFlagsMock } from '@sim/testing/mocks/feature-flags.mock'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { v2WorkflowErrorPolicies } from '@/lib/workflows/api'
import {
  listWorkflowTriggers,
  setWorkflowTriggerEnabled,
} from '@/lib/workflows/application/triggers'

vi.mock('@/lib/core/config/feature-flags', () => featureFlagsMock)

const ownerId = generateId()
const writerId = generateId()
const readerId = generateId()
const outsiderId = generateId()
const organizationId = generateId()
const workspaceId = generateId()
const otherWorkspaceId = generateId()
const groupId = generateId()

const workflowId = generateId()
const lockedWorkflowId = generateId()
const undeployedWorkflowId = generateId()
const oldVersionId = generateId()
const activeVersionId = generateId()
const lockedVersionId = generateId()
const undeployedVersionId = generateId()

const liveScheduleId = generateId()
const oldScheduleId = generateId()
const completedScheduleId = generateId()
const badCronScheduleId = generateId()
const lockedScheduleId = generateId()
const undeployedScheduleId = generateId()
const liveWebhookId = generateId()
const candidateWebhookId = generateId()
const retiredWebhookId = generateId()
const oldWebhookId = generateId()
const pollingWebhookId = generateId()
const eventWebhookId = generateId()
const hookPath = `trigger-health-${generateId()}`

const writer = createSessionPrincipal({ userId: writerId })
const reader = createSessionPrincipal({ userId: readerId })
const outsider = createSessionPrincipal({ userId: outsiderId })
const workspaceKey = createWorkspaceApiKeyPrincipal({ workspaceId, keyId: generateId() })
const foreignKey = createWorkspaceApiKeyPrincipal({
  workspaceId: otherWorkspaceId,
  keyId: generateId(),
})

const checks: { name: string; status: string; durationMs: number; error?: string }[] = []

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

function setBlock(blockId: string, enabled: boolean, principal: Principal = writer) {
  return setWorkflowTriggerEnabled.execute({
    principal,
    input: { target: { kind: 'block', workflowId, blockId }, enabled },
  })
}

async function setWebhookTriggersWithheld(withheld: boolean) {
  await db
    .update(permissionGroup)
    .set({ config: withheld ? { disableWebhookTriggers: true } : {} })
    .where(eq(permissionGroup.id, groupId))
}

async function scheduleRow(id: string) {
  const [row] = await db.select().from(workflowSchedule).where(eq(workflowSchedule.id, id))
  return row
}

async function webhookRow(id: string) {
  const [row] = await db.select().from(webhook).where(eq(webhook.id, id))
  return row
}

function auditRows(resourceId: string) {
  return db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.workspaceId, workspaceId), eq(auditLog.resourceId, resourceId)))
}

async function surfaceStatus(run: () => Promise<unknown>): Promise<number> {
  const error = await run().then(
    () => null,
    (caught: unknown) => caught
  )
  expect(error).not.toBeNull()
  return v2WorkflowErrorPolicies.concealWorkflowAuthorization.render(error).status
}

const emptyState = { blocks: {}, edges: [], loops: {}, parallels: {} }

beforeAll(async () => {
  const now = new Date()
  await db.insert(user).values(
    [ownerId, writerId, readerId, outsiderId].map((id) => ({
      id,
      name: 'Trigger health fixture',
      email: `${id}@trigger-health.invalid`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    }))
  )
  await db.insert(organization).values({
    id: organizationId,
    name: 'Trigger health',
    slug: organizationId,
    createdAt: now,
  })
  await db.insert(member).values([
    { id: generateId(), organizationId, userId: ownerId, role: 'owner', createdAt: now },
    { id: generateId(), organizationId, userId: writerId, role: 'member', createdAt: now },
    { id: generateId(), organizationId, userId: readerId, role: 'member', createdAt: now },
  ])
  await insertWorkspaceFixture(db, [
    {
      id: workspaceId,
      organizationId,
      ownerId,
      billedAccountUserId: ownerId,
      workspaceMode: 'organization',
      name: 'Trigger health',
    },
    {
      id: otherWorkspaceId,
      ownerId: outsiderId,
      billedAccountUserId: outsiderId,
      name: 'Trigger health elsewhere',
    },
  ])
  await db.insert(permissions).values([
    {
      id: generateId(),
      entityType: 'workspace',
      entityId: workspaceId,
      userId: writerId,
      permissionType: 'write',
    },
    {
      id: generateId(),
      entityType: 'workspace',
      entityId: workspaceId,
      userId: readerId,
      permissionType: 'read',
    },
  ])
  await db.insert(permissionGroup).values({
    id: groupId,
    organizationId,
    createdBy: ownerId,
    name: 'Trigger health fixture',
    config: {},
    membershipMode: 'inherit',
  })
  await db.insert(permissionGroupWorkspace).values({
    id: generateId(),
    permissionGroupId: groupId,
    workspaceId,
    organizationId,
  })

  await db.insert(workflow).values(
    [
      { id: workflowId, locked: false, isDeployed: true },
      { id: lockedWorkflowId, locked: true, isDeployed: true },
      { id: undeployedWorkflowId, locked: false, isDeployed: false },
    ].map((row) => ({
      ...row,
      userId: ownerId,
      workspaceId,
      name: 'Trigger health fixture',
      lastSynced: now,
      createdAt: now,
      updatedAt: now,
    }))
  )
  await db.insert(workflowDeploymentVersion).values([
    { id: oldVersionId, workflowId, version: 1, state: emptyState, isActive: false },
    { id: activeVersionId, workflowId, version: 2, state: emptyState, isActive: true },
    {
      id: lockedVersionId,
      workflowId: lockedWorkflowId,
      version: 1,
      state: emptyState,
      isActive: true,
    },
    {
      id: undeployedVersionId,
      workflowId: undeployedWorkflowId,
      version: 1,
      state: emptyState,
      isActive: false,
    },
  ])

  const disabledSchedule = {
    triggerType: 'schedule',
    cronExpression: '0 * * * *',
    timezone: 'UTC',
    status: 'disabled',
    failedCount: 100,
    infraRetryCount: 3,
    lastFailedAt: now,
    nextRunAt: null,
  }
  await db.insert(workflowSchedule).values([
    {
      ...disabledSchedule,
      id: liveScheduleId,
      workflowId,
      deploymentVersionId: activeVersionId,
      blockId: 'sched',
    },
    {
      ...disabledSchedule,
      id: oldScheduleId,
      workflowId,
      deploymentVersionId: oldVersionId,
      blockId: 'sched',
    },
    {
      ...disabledSchedule,
      id: completedScheduleId,
      workflowId,
      deploymentVersionId: activeVersionId,
      blockId: 'done',
      status: 'completed',
      failedCount: 0,
      endsAt: new Date(now.getTime() - 60_000),
    },
    {
      ...disabledSchedule,
      id: badCronScheduleId,
      workflowId,
      deploymentVersionId: activeVersionId,
      blockId: 'badcron',
      cronExpression: 'not a cron',
    },
    {
      ...disabledSchedule,
      id: lockedScheduleId,
      workflowId: lockedWorkflowId,
      deploymentVersionId: lockedVersionId,
      blockId: 'sched',
    },
    {
      ...disabledSchedule,
      id: undeployedScheduleId,
      workflowId: undeployedWorkflowId,
      deploymentVersionId: undeployedVersionId,
      blockId: 'sched',
    },
  ])

  const dormantWebhook = {
    workflowId,
    deploymentVersionId: activeVersionId,
    provider: 'generic',
    isActive: false,
    failedCount: 0,
  }
  await db.insert(webhook).values([
    {
      ...dormantWebhook,
      id: liveWebhookId,
      blockId: 'hook',
      path: hookPath,
      registrationStatus: 'active',
    },
    {
      ...dormantWebhook,
      id: candidateWebhookId,
      blockId: 'hook',
      path: `${hookPath}-candidate`,
      registrationStatus: 'candidate',
    },
    {
      ...dormantWebhook,
      id: retiredWebhookId,
      blockId: 'hook',
      path: `${hookPath}-retired`,
      registrationStatus: 'retired',
    },
    {
      ...dormantWebhook,
      id: oldWebhookId,
      deploymentVersionId: oldVersionId,
      blockId: 'hook',
      path: hookPath,
    },
    {
      ...dormantWebhook,
      id: pollingWebhookId,
      blockId: 'poll',
      provider: 'gmail',
      path: `${hookPath}-poll`,
      failedCount: 100,
      lastFailedAt: now,
      providerConfig: {
        labelIds: ['INBOX'],
        pollBackoffUntil: new Date(now.getTime() + 3_600_000).toISOString(),
        pollSourceFailures: 7,
      },
    },
    {
      ...dormantWebhook,
      id: eventWebhookId,
      blockId: 'evt',
      provider: 'table',
      path: `${hookPath}-evt`,
      isActive: true,
    },
  ])
})

afterAll(async () => {
  const reportPath =
    process.env.TRIGGER_HEALTH_REPORT_PATH ?? resolve('test-results/trigger-health.json')
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(reportPath, JSON.stringify({ checks }, null, 2))
  await db.delete(auditLog).where(eq(auditLog.workspaceId, workspaceId))
  await deleteWorkspaceFixture(db, inArray(workspace.id, [workspaceId, otherWorkspaceId]))
  await db.delete(organization).where(eq(organization.id, organizationId))
  await db.delete(user).where(inArray(user.id, [ownerId, writerId, readerId, outsiderId]))
})

check('lists only the live deployment’s rows, disabled ones included', async () => {
  const { triggers } = await listWorkflowTriggers.execute({
    principal: reader,
    input: { workflowId },
  })
  expect(triggers.map((trigger) => [trigger.blockId, trigger.kind, trigger.status])).toEqual([
    ['badcron', 'schedule', 'disabled'],
    ['done', 'schedule', 'completed'],
    ['evt', 'event', 'active'],
    ['hook', 'webhook', 'disabled'],
    ['poll', 'polling', 'disabled'],
    ['sched', 'schedule', 'disabled'],
  ])
  const hook = triggers.find((trigger) => trigger.blockId === 'hook')
  expect(hook?.url).toContain(`/api/webhooks/trigger/${hookPath}`)
  expect(triggers.find((trigger) => trigger.blockId === 'evt')?.url).toBeNull()
  expect(triggers.find((trigger) => trigger.blockId === 'sched')).toMatchObject({
    enabled: false,
    failedCount: 100,
    cronExpression: '0 * * * *',
    timezone: 'UTC',
  })

  const undeployed = await listWorkflowTriggers.execute({
    principal: reader,
    input: { workflowId: undeployedWorkflowId },
  })
  expect(undeployed.triggers).toEqual([])
})

check('enabling a schedule resets its counters and arms the next run', async () => {
  const before = Date.now()
  const result = await setBlock('sched', true)
  expect(result.changed).toBe(true)
  expect(result.trigger).toMatchObject({ enabled: true, status: 'active', failedCount: 0 })

  const live = await scheduleRow(liveScheduleId)
  expect(live).toMatchObject({ status: 'active', failedCount: 0, infraRetryCount: 0 })
  expect(live.nextRunAt?.getTime()).toBeGreaterThan(before)

  const old = await scheduleRow(oldScheduleId)
  expect(old).toMatchObject({ status: 'disabled', failedCount: 100, infraRetryCount: 3 })
})

check('a no-op write records no audit, a real change records one', async () => {
  await expect.poll(async () => (await auditRows(liveScheduleId)).length).toBe(1)
  const [enabled] = await auditRows(liveScheduleId)
  expect(enabled).toMatchObject({ action: 'schedule.updated', actorId: writerId })

  const noop = await setBlock('sched', true)
  expect(noop.changed).toBe(false)

  const disabled = await setBlock('sched', false)
  expect(disabled.changed).toBe(true)
  expect(await scheduleRow(liveScheduleId)).toMatchObject({
    status: 'disabled',
    nextRunAt: null,
    lastQueuedAt: null,
  })
  await expect.poll(async () => (await auditRows(liveScheduleId)).length).toBe(2)
})

check('legacy row ids never revive a row the live deployment does not serve', async () => {
  await expect(
    setWorkflowTriggerEnabled.execute({
      principal: writer,
      input: { target: { kind: 'schedule_row', scheduleId: oldScheduleId }, enabled: true },
    })
  ).rejects.toMatchObject({ code: 'not_found', message: 'Schedule not found' })
  for (const webhookId of [candidateWebhookId, retiredWebhookId, oldWebhookId]) {
    await expect(
      setWorkflowTriggerEnabled.execute({
        principal: writer,
        input: { target: { kind: 'webhook_row', webhookId }, enabled: true },
      })
    ).rejects.toMatchObject({ code: 'not_found', message: 'Webhook not found' })
  }
  expect((await scheduleRow(oldScheduleId)).status).toBe('disabled')

  const viaRow = await setWorkflowTriggerEnabled.execute({
    principal: writer,
    input: { target: { kind: 'schedule_row', scheduleId: liveScheduleId }, enabled: true },
  })
  expect(viaRow.changed).toBe(true)
  expect(viaRow.record.row.id).toBe(liveScheduleId)
})

check('an invalid cron is a 400 and an exhausted schedule is a 409', async () => {
  await expect(setBlock('badcron', true)).rejects.toMatchObject({ code: 'validation' })
  await expect(setBlock('done', true)).rejects.toMatchObject({ code: 'conflict' })
  expect((await scheduleRow(badCronScheduleId)).status).toBe('disabled')
  expect((await scheduleRow(completedScheduleId)).status).toBe('completed')
})

check('a locked workflow refuses the change', async () => {
  await expect(
    setWorkflowTriggerEnabled.execute({
      principal: writer,
      input: {
        target: { kind: 'block', workflowId: lockedWorkflowId, blockId: 'sched' },
        enabled: true,
      },
    })
  ).rejects.toMatchObject({ code: 'locked' })
  expect((await scheduleRow(lockedScheduleId)).status).toBe('disabled')
})

check('read access lists but cannot write; other tenants see not found', async () => {
  expect(await surfaceStatus(() => setBlock('sched', false, reader))).toBe(403)
  expect(
    await surfaceStatus(() =>
      listWorkflowTriggers.execute({ principal: outsider, input: { workflowId } })
    )
  ).toBe(404)
  expect(await surfaceStatus(() => setBlock('sched', false, outsider))).toBe(404)
  expect(await surfaceStatus(() => setBlock('sched', false, foreignKey))).toBe(404)
  expect((await scheduleRow(liveScheduleId)).status).toBe('active')
})

check('the webhook capability gates enabling only, and only governed callers', async () => {
  await setWebhookTriggersWithheld(true)
  try {
    await expect(setBlock('hook', true)).rejects.toMatchObject({
      detailCode: 'PERMISSION_GROUP_CAPABILITY_BLOCKED',
    })
    expect((await webhookRow(liveWebhookId)).isActive).toBe(false)

    const byKey = await setBlock('hook', true, workspaceKey)
    expect(byKey.changed).toBe(true)
    expect((await webhookRow(liveWebhookId)).isActive).toBe(true)

    const disabled = await setBlock('hook', false)
    expect(disabled.changed).toBe(true)
    expect((await webhookRow(liveWebhookId)).isActive).toBe(false)
  } finally {
    await setWebhookTriggersWithheld(false)
  }

  const enabled = await setWorkflowTriggerEnabled.execute({
    principal: writer,
    input: { target: { kind: 'webhook_row', webhookId: liveWebhookId }, enabled: true },
  })
  expect(enabled.trigger).toMatchObject({ kind: 'webhook', enabled: true })
  for (const id of [candidateWebhookId, retiredWebhookId, oldWebhookId]) {
    expect((await webhookRow(id)).isActive).toBe(false)
  }
  await expect.poll(async () => (await auditRows(liveWebhookId)).length).toBe(3)
  expect((await auditRows(liveWebhookId)).every((row) => row.action === 'webhook.updated')).toBe(
    true
  )
})

check('enabling a poller clears its failures and backoff but keeps its config', async () => {
  const result = await setBlock('poll', true)
  expect(result.trigger).toMatchObject({ kind: 'polling', enabled: true, failedCount: 0 })
  const row = await webhookRow(pollingWebhookId)
  expect(row).toMatchObject({ isActive: true, failedCount: 0 })
  expect(row.providerConfig).toEqual({ labelIds: ['INBOX'] })
})

check('an unknown block is not found', async () => {
  await expect(setBlock('missing', true)).rejects.toMatchObject({
    code: 'not_found',
    message: 'Trigger not found',
  })
})
