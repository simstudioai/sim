import assert from 'node:assert/strict'
import { AuditAction } from '@sim/audit'
import { db } from '@sim/db'
import {
  auditLog,
  document,
  embedding,
  folder,
  knowledgeBase,
  outboxEvent,
  permissions,
  user,
  userTableDefinitions,
  workflow,
  workflowBlocks,
  workflowDeploymentOperation,
  workflowDeploymentVersion,
  workspace,
  workspaceForkResourceMap,
  workspaceForkWorkflowSync,
  workspaceOperationReceipt,
  workspaceSandbox,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { withWorkspaceInvocationScope } from '@/lib/core/application/workspace-invocation-scope'
import { processOutboxEventById } from '@/lib/core/outbox/service'
import * as workflowMcpSync from '@/lib/mcp/workflow-mcp-sync'
import { createScopedCliTransport } from '@/lib/mothership/agent-cli/scoped-transport'
import { readWorkflowVersion } from '@/lib/workflows/application/read-workflow-version'
import { workflowDeploymentOutboxHandlers } from '@/lib/workflows/deployment-outbox'
import {
  finishPreparedWorkflowDeployment,
  performActivateVersion,
  performFullDeploy,
} from '@/lib/workflows/orchestration/deploy'
import { performCreateWorkflowTransition } from '@/lib/workflows/orchestration/workflow-lifecycle'
import { duplicateWorkflow } from '@/lib/workflows/persistence/duplicate'
import { admitWorkflowState, saveAdmittedWorkflowState } from '@/lib/workflows/persistence/utils'
import { getWorkspaceOperation } from '@/lib/workspaces/operations/application'
import { workspaceOperationOutboxHandlers } from '@/lib/workspaces/operations/outbox'
import type { WorkspaceOperationReport } from '@/lib/workspaces/operations/receipts'
import {
  forkWorkspace,
  previewWorkspaceFork,
  previewWorkspaceSync,
  syncWorkspace,
} from '@/ee/workspace-forking/application/create-and-sync'
import {
  rollbackWorkspaceFork,
  unlinkWorkspaceFork,
} from '@/ee/workspace-forking/application/recovery-and-mappings'
import { assertForkSourceVersions } from '@/ee/workspace-forking/application/revision'
import { setForkSyncDefault } from '@/ee/workspace-forking/application/sync-default'
import { getWorkspaceSyncDetails } from '@/ee/workspace-forking/application/sync-details'
import {
  copyForkResourceContainers,
  copyForkResourceContent,
  planForkMappedKbDocumentCopies,
} from '@/ee/workspace-forking/lib/copy/copy-resources'
import { loadSourceDeployedStates } from '@/ee/workspace-forking/lib/copy/deploy-bridge'
import type { ForkCopyProgress } from '@/ee/workspace-forking/lib/copy/progress'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const userId = generateId()
const sourceWorkspaceId = generateId()
const sourceWorkflowId = generateId()
const principal = { kind: 'personal_api_key' as const, userId, keyId: generateId() }
const createdWorkspaceIds: string[] = []
const graph: WorkflowState = {
  blocks: {
    start: {
      id: 'start',
      type: 'start_trigger',
      name: 'Start',
      enabled: true,
      position: { x: 0, y: 0 },
      subBlocks: {},
      outputs: {},
    },
    compute: {
      id: 'compute',
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
      id: 'edge',
      source: 'start',
      target: 'compute',
      sourceHandle: 'source',
      targetHandle: 'target',
    },
  ],
  loops: {},
  parallels: {},
  variables: {},
}

async function finishDeployments(report: WorkspaceOperationReport) {
  const registry = { ...workflowDeploymentOutboxHandlers, ...workspaceOperationOutboxHandlers }
  for (const id of report.effectEventIds ?? []) {
    const outcome = await processOutboxEventById(id, registry)
    const [storedEvent] = await db
      .select({ lastError: outboxEvent.lastError, status: outboxEvent.status })
      .from(outboxEvent)
      .where(eq(outboxEvent.id, id))
    expect(outcome, `Outbox effect ${id}: ${JSON.stringify(storedEvent)}`).toBe('completed')
  }
  return getWorkspaceOperation.execute({
    principal,
    input: { workspaceId: report.workspaceId, operationId: report.operationId },
  })
}

async function createChild(parentWorkspaceId = sourceWorkspaceId) {
  const input = { workspaceId: parentWorkspaceId, name: `Edge ${generateId()}` }
  const preview = await previewWorkspaceFork.execute({ principal, input })
  const result = await forkWorkspace.execute({
    principal,
    input: { ...input, requestId: generateId(), previewFingerprint: preview.previewFingerprint },
  })
  createdWorkspaceIds.push(result.workspace.id)
  return result.workspace.id
}

describe('authorized fork and sync against PostgreSQL', () => {
  beforeAll(async () => {
    const now = new Date()
    await db.insert(user).values({
      id: userId,
      name: 'Fork fixture',
      email: `${userId}@workflow.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(workspace).values({
      id: sourceWorkspaceId,
      name: 'Fork source fixture',
      ownerId: userId,
      billedAccountUserId: userId,
      allowPersonalApiKeys: true,
    })
    await db.insert(permissions).values({
      id: generateId(),
      userId,
      entityType: 'workspace',
      entityId: sourceWorkspaceId,
      permissionType: 'admin',
    })
    await db.insert(workflow).values({
      id: sourceWorkflowId,
      userId,
      workspaceId: sourceWorkspaceId,
      name: 'Deploy fixture',
      isDeployed: true,
      lastSynced: now,
      createdAt: now,
      updatedAt: now,
    })
    const admitted = await admitWorkflowState(graph, {
      subjectUserId: userId,
      workspaceId: sourceWorkspaceId,
    })
    await db.transaction((tx) => saveAdmittedWorkflowState(tx, sourceWorkflowId, admitted))
    await db.insert(workflowDeploymentVersion).values({
      id: generateId(),
      workflowId: sourceWorkflowId,
      version: 1,
      state: graph,
      isActive: true,
      createdBy: userId,
    })
  })
  afterAll(async () => {
    for (const id of createdWorkspaceIds) await db.delete(workspace).where(eq(workspace.id, id))
    await db.delete(workspace).where(eq(workspace.id, sourceWorkspaceId))
    await db.delete(user).where(eq(user.id, userId))
    await db.$client.end()
  })

  it('forks once under concurrent requests and creates only drafts', async () => {
    const input = { workspaceId: sourceWorkspaceId, name: 'Fork destination fixture' }
    const preview = await previewWorkspaceFork.execute({ principal, input })
    expect(preview.workflows).toHaveLength(1)
    const apply = {
      ...input,
      requestId: generateId(),
      previewFingerprint: preview.previewFingerprint,
    }
    const results = await Promise.all(
      Array.from({ length: 5 }, () => forkWorkspace.execute({ principal, input: apply }))
    )
    const childId = results[0].workspace.id
    createdWorkspaceIds.push(childId)
    expect(new Set(results.map((result) => result.workspace.id)).size).toBe(1)
    const rows = await db.select().from(workflow).where(eq(workflow.workspaceId, childId))
    expect(rows).toHaveLength(1)
    expect(rows[0].isDeployed).toBe(false)
    expect(
      await db
        .select()
        .from(workflowDeploymentVersion)
        .where(eq(workflowDeploymentVersion.workflowId, rows[0].id))
    ).toHaveLength(0)
    expect((await forkWorkspace.execute({ principal, input: apply })).operation?.operationId).toBe(
      results[0].operation?.operationId
    )
    await expect(
      forkWorkspace.execute({ principal, input: { ...apply, name: 'Different fork' } })
    ).rejects.toThrow('different inputs')
  })

  it('admits one immutable deployment when the parent pushes to its child', async () => {
    const childId = createdWorkspaceIds[0]
    expect(childId).toBeTruthy()
    const input = {
      workspaceId: sourceWorkspaceId,
      otherWorkspaceId: childId,
      direction: 'push' as const,
    }
    const preview = await previewWorkspaceSync.execute({ principal, input })
    expect(preview.ready).toBe(true)
    expect(preview.workflows[0]).toMatchObject({
      comparison: { status: 'unavailable', reason: 'no_baseline' },
    })
    const apply = {
      ...input,
      requestId: generateId(),
      previewFingerprint: preview.previewFingerprint,
    }
    const results = await Promise.all(
      Array.from({ length: 5 }, () => syncWorkspace.execute({ principal, input: apply }))
    )
    expect(new Set(results.map((result) => result.operation?.operationId)).size).toBe(1)
    const report = results[0].operation!
    expect(report.applied).toBe(true)
    expect(report.deploymentOperationIds).toHaveLength(1)
    const pending = await previewWorkspaceSync.execute({ principal, input })
    expect(pending.workflows[0]).toMatchObject({
      comparison: { status: 'unavailable', reason: 'no_baseline' },
    })
    const [attempt] = await db
      .select()
      .from(workflowDeploymentOperation)
      .where(eq(workflowDeploymentOperation.id, report.deploymentOperationIds![0]))
    const [version] = await db
      .select()
      .from(workflowDeploymentVersion)
      .where(eq(workflowDeploymentVersion.id, attempt.deploymentVersionId))
    await db
      .update(workflowBlocks)
      .set({ name: 'A later draft edit' })
      .where(
        and(eq(workflowBlocks.workflowId, attempt.workflowId), eq(workflowBlocks.type, 'function'))
      )
    const [unchanged] = await db
      .select()
      .from(workflowDeploymentVersion)
      .where(eq(workflowDeploymentVersion.id, attempt.deploymentVersionId))
    expect(unchanged.state).toEqual(version.state)
    const completed = await finishDeployments(report)
    expect(completed.status).toBe('completed')
    expect(completed.deployments).toEqual([
      expect.objectContaining({ ready: true, operationId: attempt.id }),
    ])
    const [active] = await db
      .select()
      .from(workflowDeploymentVersion)
      .where(eq(workflowDeploymentVersion.id, attempt.deploymentVersionId))
    expect(active.isActive).toBe(true)
    expect(active.state).toEqual(version.state)
    const synced = await previewWorkspaceSync.execute({ principal, input })
    const [sourceVersion] = await db
      .select({ id: workflowDeploymentVersion.id, version: workflowDeploymentVersion.version })
      .from(workflowDeploymentVersion)
      .where(
        and(
          eq(workflowDeploymentVersion.workflowId, sourceWorkflowId),
          eq(workflowDeploymentVersion.isActive, true)
        )
      )
    expect(synced.workflows[0]).toMatchObject({
      sourceWorkflowId,
      comparison: { status: 'available', base: sourceVersion, target: sourceVersion },
    })

    const [identity] = await db
      .select()
      .from(workspaceForkResourceMap)
      .where(
        and(
          eq(workspaceForkResourceMap.childWorkspaceId, childId),
          eq(workspaceForkResourceMap.resourceType, 'workflow')
        )
      )
    expect(identity.parentResourceId).toBe(sourceWorkflowId)
    expect(identity.childResourceId).toBe(attempt.workflowId)
    expect(
      await db
        .select()
        .from(workspaceOperationReceipt)
        .where(eq(workspaceOperationReceipt.requestId, apply.requestId))
    ).toHaveLength(1)
    expect((await syncWorkspace.execute({ principal, input: apply })).operation?.operationId).toBe(
      report.operationId
    )
    expect(
      await db
        .select({ id: workflowDeploymentOperation.id })
        .from(workflowDeploymentOperation)
        .where(eq(workflowDeploymentOperation.workflowId, attempt.workflowId))
    ).toEqual([{ id: attempt.id }])
    expect(
      await db
        .select({ id: workflowDeploymentVersion.id })
        .from(workflowDeploymentVersion)
        .where(eq(workflowDeploymentVersion.workflowId, attempt.workflowId))
    ).toEqual([{ id: attempt.deploymentVersionId }])
  })
  it('keeps exact directed baselines through activation, supersession, undo, retention, and source rollback', async () => {
    const childId = await createChild()
    const siblingId = await createChild()
    const input = {
      workspaceId: sourceWorkspaceId,
      otherWorkspaceId: childId,
      direction: 'push' as const,
    }
    const preview = () => previewWorkspaceSync.execute({ principal, input })
    const comparison = async () => {
      const [item] = (await preview()).workflows
      if (item.action === 'archive') throw new Error('Fixture source must remain deployed')
      return item.comparison
    }
    const admit = async () => {
      const current = await preview()
      const result = await syncWorkspace.execute({
        principal,
        input: {
          ...input,
          requestId: generateId(),
          previewFingerprint: current.previewFingerprint,
        },
      })
      assert(result.operation)
      return result.operation
    }
    const [initial] = await db
      .select()
      .from(workflowDeploymentVersion)
      .where(
        and(
          eq(workflowDeploymentVersion.workflowId, sourceWorkflowId),
          eq(workflowDeploymentVersion.isActive, true)
        )
      )
    const first = { id: initial.id, version: initial.version }
    const seeded = await admit()
    await finishDeployments(seeded)
    const targetId = seeded.resourceIds[0]
    const sibling = await previewWorkspaceSync.execute({
      principal,
      input: { ...input, otherWorkspaceId: siblingId },
    })
    expect(sibling.workflows[0]).toMatchObject({
      comparison: { status: 'unavailable', reason: 'no_baseline' },
    })
    const reverse = await previewWorkspaceSync.execute({
      principal,
      input: { workspaceId: childId, otherWorkspaceId: sourceWorkspaceId, direction: 'push' },
    })
    expect(reverse.workflows[0]).toMatchObject({
      comparison: { status: 'unavailable', reason: 'no_baseline' },
    })

    const sourceDeploy = await performFullDeploy({ workflowId: sourceWorkflowId, userId })
    expect(sourceDeploy.success).toBe(true)
    assert(sourceDeploy.deploymentVersionId && typeof sourceDeploy.version === 'number')
    const second = { id: sourceDeploy.deploymentVersionId, version: sourceDeploy.version }
    expect(second.id).not.toBe(first.id)
    expect(await comparison()).toEqual({
      status: 'available',
      base: first,
      target: second,
    })
    const pending = await admit()
    expect(await comparison()).toEqual({
      status: 'available',
      base: first,
      target: second,
    })
    expect((await performFullDeploy({ workflowId: targetId, userId })).success).toBe(true)
    await finishDeployments(pending)
    const pendingOperationId = pending.deploymentOperationIds?.[0]
    assert(pendingOperationId)
    const [superseded] = await db
      .select()
      .from(workflowDeploymentOperation)
      .where(eq(workflowDeploymentOperation.id, pendingOperationId))
    expect(superseded.status).toBe('superseded')
    expect(
      await finishPreparedWorkflowDeployment({ operation: superseded }, generateId())
    ).toMatchObject({ success: false, errorCode: 'conflict' })
    expect(await comparison()).toEqual({
      status: 'available',
      base: first,
      target: second,
    })

    const details = await getWorkspaceSyncDetails.execute({ principal, input })
    const synced = await syncWorkspace.execute({
      principal,
      input: { ...input, expectedSourceVersions: details.sourceVersions },
    })
    expect(synced.redeployed).toBe(1)
    expect(await comparison()).toEqual({
      status: 'available',
      base: second,
      target: second,
    })
    const blockedCutover = vi
      .spyOn(workflowMcpSync, 'syncMcpToolsForWorkflow')
      .mockRejectedValue(new Error('Rollback cutover temporarily unavailable'))
    try {
      const pendingUndo = await rollbackWorkspaceFork.execute({
        principal,
        input: { workspaceId: childId, otherWorkspaceId: sourceWorkspaceId },
      })
      expect(pendingUndo.pendingActivations).toEqual([targetId])
      expect(await comparison()).toEqual({
        status: 'available',
        base: second,
        target: second,
      })
    } finally {
      blockedCutover.mockRestore()
    }
    const undone = await rollbackWorkspaceFork.execute({
      principal,
      input: { workspaceId: childId, otherWorkspaceId: sourceWorkspaceId },
    })
    expect(undone.pendingActivations).toEqual([])
    expect(await comparison()).toEqual({
      status: 'available',
      base: first,
      target: second,
    })
    expect((await syncWorkspace.execute({ principal, input })).redeployed).toBe(1)
    expect(await comparison()).toEqual({
      status: 'available',
      base: second,
      target: second,
    })

    expect((await performFullDeploy({ workflowId: targetId, userId })).success).toBe(true)
    await db
      .delete(workflowDeploymentOperation)
      .where(
        and(
          eq(workflowDeploymentOperation.workflowId, targetId),
          sql`${workflowDeploymentOperation.generation} < (SELECT max(generation) FROM workflow_deployment_operation WHERE workflow_id = ${targetId})`
        )
      )
    expect(await comparison()).toEqual({
      status: 'available',
      base: second,
      target: second,
    })
    expect(
      (
        await performActivateVersion({
          workflowId: sourceWorkflowId,
          version: first.version,
          userId,
        })
      ).success
    ).toBe(true)
    expect(await comparison()).toEqual({
      status: 'available',
      base: second,
      target: first,
    })

    await db.delete(workflowDeploymentVersion).where(eq(workflowDeploymentVersion.id, second.id))
    expect(await comparison()).toEqual({
      status: 'unavailable',
      reason: 'missing_baseline',
      target: first,
    })
    const replacement = await performFullDeploy({ workflowId: sourceWorkflowId, userId })
    expect(replacement.success).toBe(true)
    expect(replacement.version).toBe(second.version)
    expect(replacement.deploymentVersionId).not.toBe(second.id)
    await expect(
      readWorkflowVersion.execute({
        principal,
        input: {
          workflowId: sourceWorkflowId,
          version: second.version,
          expectedDeploymentVersionId: second.id,
        },
      })
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(await comparison()).toMatchObject({
      status: 'unavailable',
      reason: 'missing_baseline',
    })
    expect((await syncWorkspace.execute({ principal, input })).redeployed).toBe(1)
    await db
      .delete(workflowDeploymentOperation)
      .where(eq(workflowDeploymentOperation.workflowId, targetId))
    const latest = await performFullDeploy({ workflowId: sourceWorkflowId, userId })
    expect(latest.success).toBe(true)
    expect((await syncWorkspace.execute({ principal, input })).redeployed).toBe(1)
    assert(latest.deploymentVersionId && typeof latest.version === 'number')
    const newest = { id: latest.deploymentVersionId, version: latest.version }
    expect(await comparison()).toEqual({
      status: 'available',
      base: newest,
      target: newest,
    })

    const syncHistory = () =>
      db
        .select({ id: workspaceForkWorkflowSync.deploymentOperationId })
        .from(workspaceForkWorkflowSync)
        .where(eq(workspaceForkWorkflowSync.childWorkspaceId, childId))
    expect((await syncHistory()).length).toBeGreaterThan(0)
    await unlinkWorkspaceFork.execute({
      principal,
      input: { workspaceId: childId, otherWorkspaceId: sourceWorkspaceId },
    })
    expect(await syncHistory()).toEqual([])
    expect(
      await db
        .select({ parent: workspace.forkedFromWorkspaceId })
        .from(workspace)
        .where(eq(workspace.id, childId))
    ).toEqual([{ parent: null }])
    expect(
      await db.select({ id: workflow.id }).from(workflow).where(eq(workflow.id, targetId))
    ).toEqual([{ id: targetId }])
  })

  it.each([
    { acting: 'child', direction: 'pull' as const },
    { acting: 'child', direction: 'push' as const },
    { acting: 'parent', direction: 'pull' as const },
  ])(
    'uses canonical source/target orientation for $acting $direction',
    async ({ acting, direction }) => {
      const childId = await createChild()
      const [childWorkflow] = await db
        .select()
        .from(workflow)
        .where(eq(workflow.workspaceId, childId))
      const seed = {
        workspaceId: sourceWorkspaceId,
        otherWorkspaceId: childId,
        direction: 'push' as const,
      }
      const seedPreview = await previewWorkspaceSync.execute({ principal, input: seed })
      const seeded = await syncWorkspace.execute({
        principal,
        input: {
          ...seed,
          requestId: generateId(),
          previewFingerprint: seedPreview.previewFingerprint,
        },
      })
      await finishDeployments(seeded.operation!)
      const input = {
        workspaceId: acting === 'child' ? childId : sourceWorkspaceId,
        otherWorkspaceId: acting === 'child' ? sourceWorkspaceId : childId,
        direction,
      }
      const preview = await previewWorkspaceSync.execute({ principal, input })
      const result = await syncWorkspace.execute({
        principal,
        input: {
          ...input,
          requestId: generateId(),
          previewFingerprint: preview.previewFingerprint,
        },
      })
      const targetId =
        (acting === 'child') === (direction === 'push') ? sourceWorkflowId : childWorkflow.id
      expect(result.operation?.resourceIds).toContain(targetId)
      expect((await finishDeployments(result.operation!)).status).toBe('completed')
      const [mapping] = await db
        .select()
        .from(workspaceForkResourceMap)
        .where(
          and(
            eq(workspaceForkResourceMap.childWorkspaceId, childId),
            eq(workspaceForkResourceMap.resourceType, 'workflow')
          )
        )
      expect(mapping.parentResourceId).toBe(sourceWorkflowId)
      expect(mapping.childResourceId).toBe(childWorkflow.id)
    }
  )

  it('refuses a changed target graph before committing a receipt or deployment', async () => {
    const childId = await createChild()
    const input = {
      workspaceId: sourceWorkspaceId,
      otherWorkspaceId: childId,
      direction: 'push' as const,
    }
    const preview = await previewWorkspaceSync.execute({ principal, input })
    const [target] = await db.select().from(workflow).where(eq(workflow.workspaceId, childId))
    await db
      .update(workflowBlocks)
      .set({ name: 'Concurrent edit' })
      .where(eq(workflowBlocks.workflowId, target.id))
    const requestId = generateId()
    await expect(
      syncWorkspace.execute({
        principal,
        input: { ...input, requestId, previewFingerprint: preview.previewFingerprint },
      })
    ).rejects.toMatchObject({
      details: expect.objectContaining({ applied: false, reason: 'stale_preview' }),
    })
    expect(
      await db
        .select()
        .from(workspaceOperationReceipt)
        .where(eq(workspaceOperationReceipt.requestId, requestId))
    ).toHaveLength(0)
    expect(
      await db
        .select()
        .from(workflowDeploymentOperation)
        .where(eq(workflowDeploymentOperation.workflowId, target.id))
    ).toHaveLength(0)
  })

  it('commits inline sandbox mappings with sync only after a fresh preview in parent-to-child orientation', async () => {
    const childId = await createChild()
    const [target] = await db.select().from(workflow).where(eq(workflow.workspaceId, childId))
    const [sourceVersion] = await db
      .select()
      .from(workflowDeploymentVersion)
      .where(
        and(
          eq(workflowDeploymentVersion.workflowId, sourceWorkflowId),
          eq(workflowDeploymentVersion.isActive, true)
        )
      )
    const sourceSandboxId = generateId()
    const childSandboxId = generateId()
    await db.insert(workspaceSandbox).values([
      {
        id: sourceSandboxId,
        workspaceId: sourceWorkspaceId,
        name: `Source sandbox ${sourceSandboxId}`,
        language: 'javascript',
        specHash: 'fork-source-fixture',
        createdBy: userId,
      },
      {
        id: childSandboxId,
        workspaceId: childId,
        name: 'Child sandbox',
        language: 'javascript',
        specHash: 'fork-child-fixture',
        createdBy: userId,
      },
    ])
    const sourceState = structuredClone(sourceVersion.state) as WorkflowState
    const sourceFunction = Object.values(sourceState.blocks).find(
      (block) => block.type === 'function'
    )
    if (!sourceFunction) throw new Error('The source fixture requires a Function block')
    sourceFunction.subBlocks.sandboxId = {
      id: 'sandboxId',
      type: 'combobox',
      value: sourceSandboxId,
    }
    const input = {
      workspaceId: sourceWorkspaceId,
      otherWorkspaceId: childId,
      direction: 'push' as const,
      mappings: [
        { resourceType: 'sandbox' as const, sourceId: sourceSandboxId, targetId: childSandboxId },
      ],
    }
    const readSandboxMappings = () =>
      db
        .select()
        .from(workspaceForkResourceMap)
        .where(
          and(
            eq(workspaceForkResourceMap.childWorkspaceId, childId),
            eq(workspaceForkResourceMap.resourceType, 'sandbox')
          )
        )
    try {
      await db
        .update(workflowDeploymentVersion)
        .set({ state: sourceState })
        .where(eq(workflowDeploymentVersion.id, sourceVersion.id))
      const preview = await previewWorkspaceSync.execute({ principal, input })
      expect(preview.ready).toBe(true)
      expect(await readSandboxMappings()).toHaveLength(0)

      await db
        .update(workflowBlocks)
        .set({ name: 'Concurrent sandbox draft edit' })
        .where(and(eq(workflowBlocks.workflowId, target.id), eq(workflowBlocks.type, 'function')))
      const requestId = generateId()
      await expect(
        syncWorkspace.execute({
          principal,
          input: { ...input, requestId, previewFingerprint: preview.previewFingerprint },
        })
      ).rejects.toMatchObject({
        details: expect.objectContaining({ applied: false, reason: 'stale_preview' }),
      })
      expect(await readSandboxMappings()).toHaveLength(0)
      expect(
        await db
          .select()
          .from(workspaceOperationReceipt)
          .where(eq(workspaceOperationReceipt.requestId, requestId))
      ).toHaveLength(0)
      const [unchangedTarget] = await db
        .select()
        .from(workflowBlocks)
        .where(and(eq(workflowBlocks.workflowId, target.id), eq(workflowBlocks.type, 'function')))
      expect(unchangedTarget.name).toBe('Concurrent sandbox draft edit')
      expect(unchangedTarget.subBlocks).not.toHaveProperty('sandboxId.value', childSandboxId)

      const fresh = await previewWorkspaceSync.execute({ principal, input })
      expect(fresh.ready).toBe(true)
      expect(fresh.previewFingerprint).not.toBe(preview.previewFingerprint)
      expect(await readSandboxMappings()).toHaveLength(0)
      await expect(
        syncWorkspace.execute({
          principal,
          input: {
            ...input,
            expectedSourceVersions: [
              { workflowId: sourceWorkflowId, deploymentVersionId: generateId() },
            ],
          },
        })
      ).rejects.toMatchObject({
        details: expect.objectContaining({ applied: false, reason: 'stale_preview' }),
      })
      expect(await readSandboxMappings()).toHaveLength(0)
      const [stillUnchanged] = await db
        .select()
        .from(workflowBlocks)
        .where(and(eq(workflowBlocks.workflowId, target.id), eq(workflowBlocks.type, 'function')))
      expect(stillUnchanged.name).toBe('Concurrent sandbox draft edit')
      const result = await syncWorkspace.execute({
        principal,
        input: { ...input, requestId, previewFingerprint: fresh.previewFingerprint },
      })
      expect(result.operation?.applied).toBe(true)
      expect(await readSandboxMappings()).toEqual([
        expect.objectContaining({
          childWorkspaceId: childId,
          parentResourceId: sourceSandboxId,
          childResourceId: childSandboxId,
        }),
      ])
      const [mappedTarget] = await db
        .select()
        .from(workflowBlocks)
        .where(and(eq(workflowBlocks.workflowId, target.id), eq(workflowBlocks.type, 'function')))
      expect(mappedTarget.subBlocks).toMatchObject({ sandboxId: { value: childSandboxId } })
      expect(
        await db
          .select()
          .from(workspaceOperationReceipt)
          .where(eq(workspaceOperationReceipt.requestId, requestId))
      ).toEqual([expect.objectContaining({ id: result.operation!.operationId })])
      expect((await finishDeployments(result.operation!)).status).toBe('completed')
      const [deployedTarget] = await db
        .select()
        .from(workflowDeploymentVersion)
        .where(
          and(
            eq(workflowDeploymentVersion.workflowId, target.id),
            eq(workflowDeploymentVersion.isActive, true)
          )
        )
      expect(
        Object.values((deployedTarget.state as WorkflowState).blocks).find(
          (block) => block.type === 'function'
        )?.subBlocks
      ).toMatchObject({ sandboxId: { value: childSandboxId } })
    } finally {
      await db
        .update(workflowDeploymentVersion)
        .set({ state: sourceVersion.state })
        .where(eq(workflowDeploymentVersion.id, sourceVersion.id))
    }
  })

  it('validates a mapped table dependent through a Copilot CLI push preview', async () => {
    const childId = await createChild()
    const [sourceVersion] = await db
      .select()
      .from(workflowDeploymentVersion)
      .where(
        and(
          eq(workflowDeploymentVersion.workflowId, sourceWorkflowId),
          eq(workflowDeploymentVersion.isActive, true)
        )
      )
    const sourceTableId = generateId()
    const childTableId = generateId()
    const schema = { columns: [{ id: 'col_key', name: 'key', type: 'string', unique: true }] }
    await db.insert(userTableDefinitions).values([
      {
        id: sourceTableId,
        workspaceId: sourceWorkspaceId,
        name: `Source table ${sourceTableId}`,
        schema,
        createdBy: userId,
      },
      { id: childTableId, workspaceId: childId, name: 'Child table', schema, createdBy: userId },
    ])
    const sourceState = structuredClone(sourceVersion.state) as WorkflowState
    sourceState.blocks.upsert = {
      id: 'upsert',
      type: 'table',
      name: 'Upsert',
      enabled: true,
      position: { x: 400, y: 0 },
      subBlocks: {
        operation: { id: 'operation', type: 'dropdown', value: 'upsert_row' },
        tableSelector: { id: 'tableSelector', type: 'table-selector', value: sourceTableId },
        conflictColumnSelector: {
          id: 'conflictColumnSelector',
          type: 'column-selector',
          value: 'col_key',
        },
      },
      outputs: {},
    }
    const transport = createScopedCliTransport('http://localhost:3000', {
      userId,
      workspaceId: sourceWorkspaceId,
      chatId: generateId(),
    })
    try {
      await db
        .update(workflowDeploymentVersion)
        .set({ state: sourceState })
        .where(eq(workflowDeploymentVersion.id, sourceVersion.id))
      const response = await withWorkspaceInvocationScope({ workspaceId: sourceWorkspaceId }, () =>
        transport(
          `http://localhost:3000/api/v2/workspaces/${sourceWorkspaceId}/fork/push/preview`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              otherWorkspaceId: childId,
              mappings: [
                { resourceType: 'table', sourceId: sourceTableId, targetId: childTableId },
              ],
              dependentValues: [
                {
                  sourceWorkflowId,
                  sourceBlockId: 'upsert',
                  subBlockKey: 'conflictColumnSelector',
                  value: 'col_key',
                },
              ],
            }),
          }
        )
      )
      const body = await response.json()
      expect(response.status, JSON.stringify(body)).toBe(200)
      expect(body.data.configuration).toContainEqual(
        expect.objectContaining({
          sourceBlockId: 'upsert',
          subBlockKey: 'conflictColumnSelector',
          currentValue: 'col_key',
          discoveryWorkspaceId: childId,
        })
      )
    } finally {
      await db
        .update(workflowDeploymentVersion)
        .set({ state: sourceVersion.state })
        .where(eq(workflowDeploymentVersion.id, sourceVersion.id))
    }
  })

  it('refuses inherited folder locks with no committed mutation', async () => {
    const childId = await createChild()
    const [target] = await db.select().from(workflow).where(eq(workflow.workspaceId, childId))
    const folderId = generateId()
    await db.insert(folder).values({
      id: folderId,
      workspaceId: childId,
      userId,
      name: 'Locked',
      resourceType: 'workflow',
      locked: true,
    })
    await db.update(workflow).set({ folderId }).where(eq(workflow.id, target.id))
    const input = {
      workspaceId: sourceWorkspaceId,
      otherWorkspaceId: childId,
      direction: 'push' as const,
    }
    const preview = await previewWorkspaceSync.execute({ principal, input })
    const requestId = generateId()
    await expect(
      syncWorkspace.execute({
        principal,
        input: { ...input, requestId, previewFingerprint: preview.previewFingerprint },
      })
    ).rejects.toThrow('locked')
    expect(
      await db
        .select()
        .from(workspaceOperationReceipt)
        .where(eq(workspaceOperationReceipt.requestId, requestId))
    ).toHaveLength(0)
  })

  it('checks source snapshot content as well as deployment identity under apply locks', async () => {
    const loaded = await loadSourceDeployedStates(sourceWorkspaceId)
    const expected = loaded.sourceVersionIds.get(sourceWorkflowId)!
    await db.transaction(async (tx) => {
      const [version] = await tx
        .select()
        .from(workflowDeploymentVersion)
        .where(eq(workflowDeploymentVersion.id, expected.id))
      const changed = structuredClone(version.state) as WorkflowState
      Object.values(changed.blocks)[0].name = 'Changed immutable source'
      await tx
        .update(workflowDeploymentVersion)
        .set({ state: changed })
        .where(eq(workflowDeploymentVersion.id, expected.id))
      await expect(
        assertForkSourceVersions(tx, sourceWorkspaceId, loaded.sourceVersionIds)
      ).rejects.toThrow('Source deployment changed')
      await tx
        .update(workflowDeploymentVersion)
        .set({ state: version.state })
        .where(eq(workflowDeploymentVersion.id, expected.id))
      await assertForkSourceVersions(tx, sourceWorkspaceId, loaded.sourceVersionIds)
    })
  })

  it('leaves undeployed source targets alone and archives mapped targets only after source deletion', async () => {
    const childId = await createChild()
    const [target] = await db.select().from(workflow).where(eq(workflow.workspaceId, childId))
    const input = {
      workspaceId: sourceWorkspaceId,
      otherWorkspaceId: childId,
      direction: 'push' as const,
    }
    try {
      await db.update(workflow).set({ isDeployed: false }).where(eq(workflow.id, sourceWorkflowId))
      let preview = await previewWorkspaceSync.execute({ principal, input })
      let result = await syncWorkspace.execute({
        principal,
        input: {
          ...input,
          requestId: generateId(),
          previewFingerprint: preview.previewFingerprint,
        },
      })
      expect(result.archived).toBe(0)
      let [stored] = await db.select().from(workflow).where(eq(workflow.id, target.id))
      expect(stored.archivedAt).toBeNull()
      await db
        .update(workflow)
        .set({ archivedAt: new Date() })
        .where(eq(workflow.id, sourceWorkflowId))
      preview = await previewWorkspaceSync.execute({ principal, input })
      result = await syncWorkspace.execute({
        principal,
        input: {
          ...input,
          requestId: generateId(),
          previewFingerprint: preview.previewFingerprint,
        },
      })
      expect(result.archived).toBe(1)
      ;[stored] = await db.select().from(workflow).where(eq(workflow.id, target.id))
      expect(stored.archivedAt).not.toBeNull()
    } finally {
      await db
        .update(workflow)
        .set({ isDeployed: true, archivedAt: null })
        .where(eq(workflow.id, sourceWorkflowId))
    }
  })

  it('preserves exclusions and refuses stale exclusion choices atomically', async () => {
    const childId = await createChild()
    const [target] = await db.select().from(workflow).where(eq(workflow.workspaceId, childId))
    const input = {
      workspaceId: sourceWorkspaceId,
      otherWorkspaceId: childId,
      direction: 'push' as const,
    }
    const oldPreview = await previewWorkspaceSync.execute({ principal, input })
    await db.update(workflow).set({ forkSyncExcluded: true }).where(eq(workflow.id, target.id))
    const refusedId = generateId()
    await expect(
      syncWorkspace.execute({
        principal,
        input: {
          ...input,
          requestId: refusedId,
          previewFingerprint: oldPreview.previewFingerprint,
        },
      })
    ).rejects.toThrow('stale')
    const preview = await previewWorkspaceSync.execute({ principal, input })
    expect(preview.excludedTargets).toContainEqual(expect.objectContaining({ id: target.id }))
    const applied = await syncWorkspace.execute({
      principal,
      input: { ...input, requestId: generateId(), previewFingerprint: preview.previewFingerprint },
    })
    expect(applied.operation!.resourceIds).not.toContain(target.id)
    expect(
      await db
        .select()
        .from(workflowDeploymentOperation)
        .where(eq(workflowDeploymentOperation.workflowId, target.id))
    ).toHaveLength(0)
    expect(
      await db
        .select()
        .from(workspaceOperationReceipt)
        .where(eq(workspaceOperationReceipt.requestId, refusedId))
    ).toHaveLength(0)
  })

  /**
   * The opt-in policy end to end: set from a fork, it reaches the parent and changes only
   * what differs, filing one audit entry in each changed workspace's own log; a genuinely
   * new workflow (created, duplicated, or a fork's starter) and a new fork take it; a forked
   * copy stays synced; no existing workflow moves; and an archived member is walked through
   * for the lineage root but never written.
   */
  it('gives new workflows the lineage fork-sync default while copies stay synced', async () => {
    const childId = await createChild()
    const excludedFor = async (workflowId: string) =>
      (
        await db
          .select({ excluded: workflow.forkSyncExcluded })
          .from(workflow)
          .where(eq(workflow.id, workflowId))
      )[0]?.excluded
    const policyOf = async (workspaceId: string) =>
      (
        await db
          .select({ excluded: workspace.forkSyncNewWorkflowsExcluded })
          .from(workspace)
          .where(eq(workspace.id, workspaceId))
      )[0]?.excluded
    const setDefault = (workspaceId: string, excludeNewWorkflows: boolean) =>
      setForkSyncDefault.execute({ principal, input: { workspaceId, excludeNewWorkflows } })
    /** Every audit entry a change issued from `originId` filed, whichever workspace it named. */
    const auditedFrom = (originId: string) =>
      db
        .select({
          workspaceId: auditLog.workspaceId,
          resourceId: auditLog.resourceId,
          resourceName: auditLog.resourceName,
          metadata: auditLog.metadata,
        })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.action, AuditAction.WORKSPACE_FORK_SYNC_DEFAULT_CHANGED),
            sql`${auditLog.metadata} ->> 'originWorkspaceId' = ${originId}`
          )
        )
    try {
      const first = await setDefault(childId, true)
      expect(first.changedWorkspaces.map((member) => member.id)).toEqual(
        expect.arrayContaining([sourceWorkspaceId, childId])
      )
      expect((await setDefault(childId, true)).changedWorkspaces).toEqual([])
      expect(await policyOf(sourceWorkspaceId)).toBe(true)

      // Each changed member's admins see the change in their own log, under that workspace's name.
      const changed = new Map(
        (
          await db
            .select({ id: workspace.id, name: workspace.name })
            .from(workspace)
            .where(
              inArray(
                workspace.id,
                first.changedWorkspaces.map((member) => member.id)
              )
            )
        ).map((member) => [member.id, member.name])
      )
      await vi.waitFor(
        async () => {
          const entries = await auditedFrom(childId)
          // Exactly the changed members, once each: no missing, duplicate, or extra entry,
          // including from the no-op repeat issued from the same workspace.
          expect(entries.map((entry) => entry.resourceId).sort()).toEqual(
            [...changed.keys()].sort()
          )
          for (const entry of entries) {
            expect(entry.workspaceId).toBe(entry.resourceId)
            expect(entry.resourceName).toBe(changed.get(entry.resourceId!))
            expect(entry.metadata).toMatchObject({
              forkSyncNewWorkflowsExcluded: true,
              originWorkspaceId: childId,
              originWorkspaceName: changed.get(childId),
            })
          }
        },
        { timeout: 5000 }
      )
      expect(await excludedFor(sourceWorkflowId)).toBe(false)

      const [copy] = await db
        .select({ id: workflow.id, excluded: workflow.forkSyncExcluded })
        .from(workflow)
        .where(eq(workflow.workspaceId, childId))
      expect(copy.excluded).toBe(false)

      const created = await performCreateWorkflowTransition({
        userId,
        workspaceId: childId,
        name: `New ${generateId()}`,
      })
      expect(await excludedFor(created.workflow!.id)).toBe(true)

      // Duplicating a SYNCED workflow still yields a new, excluded one.
      const duplicated = await duplicateWorkflow({
        sourceWorkflowId: copy.id,
        userId,
        name: `Duplicate ${generateId()}`,
        workspaceId: childId,
      })
      expect(await excludedFor(duplicated.id)).toBe(true)

      const newForkId = await createChild()
      expect(await policyOf(newForkId)).toBe(true)
      expect(
        await db
          .select({ excluded: workflow.forkSyncExcluded })
          .from(workflow)
          .where(eq(workflow.workspaceId, newForkId))
      ).toEqual([{ excluded: false }])

      // The child has nothing deployed, so its fork gets a starter workflow, written in the
      // same transaction that created the grandchild and its inherited policy.
      const grandchildId = await createChild(childId)
      expect(
        await db
          .select({ excluded: workflow.forkSyncExcluded })
          .from(workflow)
          .where(eq(workflow.workspaceId, grandchildId))
      ).toEqual([{ excluded: true }])

      await db.update(workspace).set({ archivedAt: new Date() }).where(eq(workspace.id, childId))
      const fromGrandchild = await setDefault(grandchildId, false)
      // Every live member flips back - the ones the first change covered and the two forks
      // created since - while the archived child is neither written nor audited.
      const expectedFromGrandchild = [
        ...[...changed.keys()].filter((id) => id !== childId),
        newForkId,
        grandchildId,
      ].sort()
      expect(fromGrandchild.changedWorkspaces.map((member) => member.id).sort()).toEqual(
        expectedFromGrandchild
      )
      for (const id of expectedFromGrandchild) expect(await policyOf(id)).toBe(false)
      expect(await policyOf(childId)).toBe(true)
      await vi.waitFor(
        async () => {
          const entries = await auditedFrom(grandchildId)
          expect(entries.map((entry) => entry.resourceId).sort()).toEqual(expectedFromGrandchild)
        },
        { timeout: 5000 }
      )
    } finally {
      await db.update(workspace).set({ archivedAt: null }).where(eq(workspace.id, childId))
      await setDefault(sourceWorkspaceId, false)
    }
  })
  async function seedKnowledgeCopy() {
    const childWorkspaceId = generateId()
    const sourceWorkspaceId = generateId()
    createdWorkspaceIds.push(sourceWorkspaceId, childWorkspaceId)
    await db.insert(workspace).values(
      [sourceWorkspaceId, childWorkspaceId].map((id) => ({
        id,
        name: 'Knowledge copy fixture',
        ownerId: userId,
        billedAccountUserId: userId,
      }))
    )
    const sourceId = generateId()
    const childId = generateId()
    await db.insert(knowledgeBase).values([
      { id: sourceId, workspaceId: sourceWorkspaceId, userId, name: `Source ${sourceId}` },
      { id: childId, workspaceId: childWorkspaceId, userId, name: 'Target fixture' },
    ])
    const [source] = await db
      .insert(document)
      .values({
        id: generateId(),
        knowledgeBaseId: sourceId,
        filename: 'Copy fixture',
        fileUrl: '',
        fileSize: 0,
        mimeType: 'text/plain',
        processingStatus: 'completed',
      })
      .returning()
    return { sourceWorkspaceId, childWorkspaceId, sourceId, childId, source }
  }

  it('copies ordinary knowledge containers but excludes retired Search containers', async () => {
    const fixture = await seedKnowledgeCopy()
    const retiredId = generateId()
    await db.insert(knowledgeBase).values({
      id: retiredId,
      workspaceId: fixture.sourceWorkspaceId,
      userId,
      name: 'Retired Search fixture',
      isSearchIndex: true,
    })
    const copied = await db.transaction((tx) =>
      copyForkResourceContainers({
        tx,
        sourceWorkspaceId: fixture.sourceWorkspaceId,
        childWorkspaceId: fixture.childWorkspaceId,
        userId,
        now: new Date(),
        selection: {
          customTools: [],
          skills: [],
          mcpServers: [],
          workflowMcpServers: [],
          tables: [],
          knowledgeBases: [fixture.sourceId, retiredId],
        },
        workflowIdMap: new Map(),
        documentMappingContext: {
          edgeChildWorkspaceId: fixture.childWorkspaceId,
          sourceIsParent: true,
        },
      })
    )
    expect(copied.contentPlan.knowledgeBases.map((entry) => entry.sourceId)).toEqual([
      fixture.sourceId,
    ])
    expect(
      await db
        .select()
        .from(knowledgeBase)
        .where(
          and(
            eq(knowledgeBase.workspaceId, fixture.childWorkspaceId),
            eq(knowledgeBase.isSearchIndex, true)
          )
        )
    ).toEqual([])
  })

  it.each(['source', 'target'] as const)(
    'does not plan document copies for a retired Search %s',
    async (retiredSide) => {
      const fixture = await seedKnowledgeCopy()
      const retiredId = retiredSide === 'source' ? fixture.sourceId : fixture.childId
      await db
        .update(knowledgeBase)
        .set({ isSearchIndex: true })
        .where(eq(knowledgeBase.id, retiredId))
      const plan = () =>
        db.transaction((tx) =>
          planForkMappedKbDocumentCopies({
            tx,
            resolver: (kind, id) =>
              kind === 'knowledge-base' && id === fixture.sourceId ? fixture.childId : null,
            referencedDocumentIds: [fixture.source.id],
            alreadyCopiedSourceDocIds: new Set(),
            now: new Date(),
          })
        )
      const refused = await plan()
      expect(refused.documents).toEqual([])
      expect(refused.mappingEntries).toEqual([])
      expect(
        await db.select().from(document).where(eq(document.knowledgeBaseId, fixture.childId))
      ).toEqual([])

      await db
        .update(knowledgeBase)
        .set({ isSearchIndex: false })
        .where(eq(knowledgeBase.id, retiredId))
      const allowed = await plan()
      expect(allowed.documents).toHaveLength(1)
      const [placeholder] = await db
        .select()
        .from(document)
        .where(eq(document.knowledgeBaseId, fixture.childId))
      expect(placeholder.archivedAt).not.toBeNull()
      expect(allowed.docIdMap.get(fixture.source.id)).toBe(placeholder.id)
    }
  )

  it.each(['source', 'target', 'target during copy', 'ordinary'] as const)(
    'checks retired Search admission for queued content with %s',
    async (retiredSide) => {
      const fixture = await seedKnowledgeCopy()
      const childDocId = generateId()
      await db.insert(document).values({
        ...fixture.source,
        id: childDocId,
        knowledgeBaseId: fixture.childId,
        archivedAt: new Date(),
      })
      if (retiredSide === 'source' || retiredSide === 'target') {
        await db
          .update(knowledgeBase)
          .set({ isSearchIndex: true })
          .where(
            eq(knowledgeBase.id, retiredSide === 'source' ? fixture.sourceId : fixture.childId)
          )
      }
      const progress: ForkCopyProgress = { completed: [], tables: {}, embeddings: {} }
      const result = await copyForkResourceContent({
        contentPlan: {
          sourceWorkspaceId: fixture.sourceWorkspaceId,
          childWorkspaceId: fixture.childWorkspaceId,
          userId,
          tables: [],
          knowledgeBases: [],
          skills: [],
          documents: [
            {
              sourceDocId: fixture.source.id,
              childDocId,
              childKnowledgeBaseId: fixture.childId,
              storageKey: null,
              fileUrl: '',
              fileSize: 0,
              filename: fixture.source.filename,
              mimeType: fixture.source.mimeType,
            },
          ],
        },
        control: {
          progress,
          checkpoint: async () => {
            if (retiredSide === 'target during copy')
              await db
                .update(knowledgeBase)
                .set({ isSearchIndex: true })
                .where(eq(knowledgeBase.id, fixture.childId))
          },
        },
      })
      const [copied] = await db.select().from(document).where(eq(document.id, childDocId))
      if (retiredSide === 'ordinary') {
        expect(result).toMatchObject({ copied: 1, failed: 0 })
        expect(copied.archivedAt).toBeNull()
      } else {
        expect(result).toMatchObject({ copied: 0, failed: 1 })
        expect(copied.archivedAt).not.toBeNull()
        expect(
          await db.select().from(embedding).where(eq(embedding.documentId, childDocId))
        ).toEqual([])
        if (retiredSide !== 'target during copy') expect(progress.embeddings).toEqual({})
      }
      const [targetWorkspace] = await db
        .select()
        .from(workspace)
        .where(eq(workspace.id, fixture.childWorkspaceId))
      expect(targetWorkspace.storageUsedBytes).toBe(0)
    }
  )
})
