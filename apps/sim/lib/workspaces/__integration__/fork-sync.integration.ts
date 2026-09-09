import { db } from '@sim/db'
import {
  folder,
  outboxEvent,
  permissions,
  user,
  workflow,
  workflowBlocks,
  workflowDeploymentOperation,
  workflowDeploymentVersion,
  workspace,
  workspaceForkResourceMap,
  workspaceOperationReceipt,
  workspaceSandbox,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { processOutboxEventById } from '@/lib/core/outbox/service'
import { workflowDeploymentOutboxHandlers } from '@/lib/workflows/deployment-outbox'
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
import { assertForkSourceVersions } from '@/ee/workspace-forking/application/revision'
import { loadSourceDeployedStates } from '@/ee/workspace-forking/lib/copy/deploy-bridge'
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

async function createChild() {
  const input = { workspaceId: sourceWorkspaceId, name: `Edge ${generateId()}` }
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
})
