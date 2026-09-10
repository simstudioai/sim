import { db } from '@sim/db'
import {
  customTools,
  outboxEvent,
  permissions,
  user,
  workflow,
  workflowBlocks,
  workflowEdges,
  workspace,
  workspaceOperationReceipt,
  workspaceSandbox,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { importWorkflow } from '@/lib/workflows/application/import-export'
import { previewWorkflowImport } from '@/lib/workflows/application/mapped-import'
import { buildWorkflowReferenceManifest } from '@/lib/workflows/references/manifest'
import { sanitizeForExport } from '@/lib/workflows/sanitization/json-sanitizer'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const userId = generateId()
const workspaceId = generateId()
const sandboxId = generateId()
const permissionId = generateId()
const principal = { kind: 'personal_api_key', userId, keyId: generateId() } as const

function input(name: string) {
  const state: WorkflowState = {
    blocks: {
      fn: {
        id: 'fn',
        type: 'function',
        name: 'Compute',
        position: { x: 0, y: 0 },
        enabled: true,
        outputs: {},
        subBlocks: {
          language: { id: 'language', type: 'dropdown', value: 'javascript' },
          code: { id: 'code', type: 'code', value: 'return 42' },
          sandboxId: { id: 'sandboxId', type: 'combobox', value: 'source-sandbox-label' },
        },
      },
      agent: {
        id: 'agent',
        type: 'agent',
        name: 'Agent',
        position: { x: 200, y: 0 },
        enabled: true,
        outputs: {},
        subBlocks: {
          tools: {
            id: 'tools',
            type: 'tool-input',
            value: JSON.stringify([
              {
                type: 'custom-tool',
                title: name,
                code: 'return 42',
                schema: {
                  type: 'function',
                  function: { name: 'answer', parameters: { type: 'object', properties: {} } },
                },
              },
            ]),
          },
        },
      },
    },
    edges: [{ id: 'source-edge', source: 'fn', target: 'agent' }],
    loops: {},
    parallels: {},
    variables: { answer: { id: 'answer', name: 'answer', type: 'number', value: 42 } },
  }
  return {
    workspaceId,
    name,
    workflow: {
      ...sanitizeForExport(state, { includeReferences: true }),
      referenceManifest: buildWorkflowReferenceManifest(state.blocks),
    },
    mappings: [{ kind: 'sandbox' as const, sourceId: 'source-sandbox-label', targetId: sandboxId }],
  }
}

async function countImports(name: string) {
  return db
    .select({ id: workflow.id })
    .from(workflow)
    .where(and(eq(workflow.workspaceId, workspaceId), eq(workflow.name, name)))
}

describe('authorized mapped imports against PostgreSQL', () => {
  beforeAll(async () => {
    const now = new Date()
    await db.insert(user).values({
      id: userId,
      name: 'Import fixture',
      email: `${userId}@workflow.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(workspace).values({
      id: workspaceId,
      name: 'Mapped import fixture',
      ownerId: userId,
      billedAccountUserId: userId,
      allowPersonalApiKeys: true,
    })
    await db.insert(permissions).values({
      id: permissionId,
      userId,
      entityType: 'workspace',
      entityId: workspaceId,
      permissionType: 'admin',
    })
    await db.insert(workspaceSandbox).values({
      id: sandboxId,
      workspaceId,
      name: 'Fixture JS',
      language: 'javascript',
      specHash: 'fixture-v1',
      createdBy: userId,
    })
  })
  afterAll(async () => {
    await db.delete(workspace).where(eq(workspace.id, workspaceId))
    await db.delete(user).where(eq(user.id, userId))
    await db.$client.end()
  })

  it('commits one graph, inline tool, variables, receipt and outbox entry for concurrent retries', async () => {
    const name = `import-${generateId()}`
    const request = input(name)
    const preview = await previewWorkflowImport.execute({ principal, input: request })
    expect(preview.ready).toBe(true)
    const mutation = {
      ...request,
      requestId: generateId(),
      previewFingerprint: preview.previewFingerprint,
    }
    const results = await Promise.all(
      Array.from({ length: 20 }, () => importWorkflow.execute({ principal, input: mutation }))
    )
    expect(new Set(results.map((result) => result.operation?.operationId)).size).toBe(1)
    const result = results[0]
    expect(await countImports(name)).toHaveLength(1)
    const [stored] = await db.select().from(workflow).where(eq(workflow.id, result.workflow.id))
    expect(stored.isDeployed).toBe(false)
    expect(stored.variables).toMatchObject({
      [result.operation!.idMap!.answer]: { name: 'answer', value: 42 },
    })
    expect(result.operation!.idMap!.answer).not.toBe('answer')
    const blocks = await db
      .select()
      .from(workflowBlocks)
      .where(eq(workflowBlocks.workflowId, result.workflow.id))
    expect(blocks).toHaveLength(2)
    const [edge] = await db
      .select()
      .from(workflowEdges)
      .where(eq(workflowEdges.workflowId, result.workflow.id))
    expect(edge.id).toBe(result.operation!.idMap!['source-edge'])
    expect(edge.id).not.toBe('source-edge')
    expect(edge.sourceBlockId).toBe(result.operation!.idMap!.fn)
    expect(edge.targetBlockId).toBe(result.operation!.idMap!.agent)
    expect(blocks.find((block) => block.type === 'function')?.subBlocks).toMatchObject({
      sandboxId: { value: sandboxId },
    })
    const tools = await db
      .select()
      .from(customTools)
      .where(and(eq(customTools.workspaceId, workspaceId), eq(customTools.title, name)))
    expect(tools).toHaveLength(1)
    expect(
      await db
        .select()
        .from(workspaceOperationReceipt)
        .where(eq(workspaceOperationReceipt.requestId, mutation.requestId))
    ).toHaveLength(1)
    expect(
      await db
        .select()
        .from(outboxEvent)
        .where(
          and(
            eq(outboxEvent.eventType, 'workspace.workflows.changed'),
            sql`${outboxEvent.payload}->>'workspaceId' = ${workspaceId}`
          )
        )
    ).toHaveLength(1)
    await db
      .update(workspaceSandbox)
      .set({ specHash: 'changed-after-commit' })
      .where(eq(workspaceSandbox.id, sandboxId))
    expect(
      (await importWorkflow.execute({ principal, input: mutation })).operation?.operationId
    ).toBe(result.operation?.operationId)
    await expect(
      importWorkflow.execute({ principal, input: { ...mutation, name: `${name}-changed` } })
    ).rejects.toThrow('different inputs')
    await db.delete(permissions).where(eq(permissions.id, permissionId))
    await expect(importWorkflow.execute({ principal, input: mutation })).rejects.toThrow()
    await db.insert(permissions).values({
      id: permissionId,
      userId,
      entityType: 'workspace',
      entityId: workspaceId,
      permissionType: 'admin',
    })
  })

  it('refuses stale or unresolved bindings without any business writes', async () => {
    const name = `stale-${generateId()}`
    const request = input(name)
    const preview = await previewWorkflowImport.execute({ principal, input: request })
    await db
      .update(workspaceSandbox)
      .set({ specHash: 'changed-before-apply' })
      .where(eq(workspaceSandbox.id, sandboxId))
    await expect(
      importWorkflow.execute({
        principal,
        input: {
          ...request,
          requestId: generateId(),
          previewFingerprint: preview.previewFingerprint,
        },
      })
    ).rejects.toThrow('stale')
    expect(await countImports(name)).toHaveLength(0)
    const unresolved = { ...request, mappings: [] }
    const next = await previewWorkflowImport.execute({ principal, input: unresolved })
    expect(next.ready).toBe(false)
    await expect(
      importWorkflow.execute({
        principal,
        input: {
          ...unresolved,
          requestId: generateId(),
          previewFingerprint: next.previewFingerprint,
        },
      })
    ).rejects.toThrow('configuration')
    expect(await countImports(name)).toHaveLength(0)
  })

  it('refuses a resource injected as a dependent value', async () => {
    const request = input(`invalid-${generateId()}`)
    await expect(
      previewWorkflowImport.execute({
        principal,
        input: {
          ...request,
          dependentValues: [{ blockId: 'fn', subBlockKey: 'sandboxId', value: 'foreign-sandbox' }],
        },
      })
    ).rejects.toThrow('not configurable')
  })
})
