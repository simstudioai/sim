import { db } from '@sim/db'
import { user, workflow, workflowDeploymentVersion, workspace } from '@sim/db/schema'
import { createWorkspaceApiKeyPrincipal } from '@sim/testing/factories/principal.factory'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  type WorkflowStateContractOutput,
  workflowStateSchema,
} from '@/lib/api/contracts/workflows'
import { compareWorkflowVersions } from '@/lib/workflows/application/compare-workflow-versions'
import { loadWorkflowComparisonVersions } from '@/lib/workflows/persistence/compare-versions'
import { Serializer } from '@/serializer'
import type { WorkflowState } from '@/stores/workflows/workflow/types'
import { spotifyUpdatePlaylistTool } from '@/tools/spotify/update_playlist'

const ownerId = generateId()
const workspaceId = generateId()
const otherWorkspaceId = generateId()
const workflowId = generateId()
const otherWorkflowId = generateId()
const principal = createWorkspaceApiKeyPrincipal({ workspaceId, keyId: generateId() })

function state(value: string): WorkflowState {
  return {
    blocks: {
      fn: {
        id: 'fn',
        type: 'function',
        name: 'Function',
        enabled: true,
        position: { x: 0, y: 0 },
        outputs: {},
        subBlocks: {
          code: { id: 'code', type: 'code', value: `return ${value}` },
        },
      },
      convex: {
        id: 'convex',
        type: 'convex',
        name: 'Convex',
        enabled: true,
        position: { x: 300, y: 0 },
        outputs: {},
        subBlocks: {
          deployKey: { id: 'deployKey', type: 'short-input', value: `private-${value}` },
        },
      },
    },
    edges: [],
    loops: {},
    parallels: {},
    lastSaved: 0,
  }
}

function playlistState(includePublic: boolean): WorkflowStateContractOutput {
  return workflowStateSchema.parse({
    blocks: {
      playlist: {
        id: 'playlist',
        type: 'spotify',
        name: 'Update playlist',
        enabled: true,
        position: { x: 0, y: 0 },
        outputs: {},
        subBlocks: {
          operation: { id: 'operation', type: 'dropdown', value: 'spotify_update_playlist' },
          playlistId: { id: 'playlistId', type: 'short-input', value: 'playlist-fixture' },
          newName: { id: 'newName', type: 'short-input', value: 'Updated name' },
          ...(includePublic ? { public: { id: 'public', type: 'switch', value: true } } : {}),
        },
      },
    },
    edges: [],
    loops: {},
    parallels: {},
    lastSaved: 0,
  })
}

function jsonArgumentState(answer: number): WorkflowState {
  const argumentsValue = JSON.parse(`{"patch":{"__proto__":{"answer":${answer}},"x":1}}`)
  return {
    blocks: {
      mcp: {
        id: 'mcp',
        type: 'mcp',
        name: 'Run operation',
        enabled: true,
        position: { x: 0, y: 0 },
        outputs: {},
        subBlocks: {
          arguments: { id: 'arguments', type: 'mcp-dynamic-args', value: argumentsValue },
        },
      },
    },
    edges: [],
    loops: {},
    parallels: {},
    lastSaved: 0,
  }
}

function routingState(sourceHandle: string): WorkflowState {
  const snapshot = state('1')
  snapshot.blocks.fn = {
    ...snapshot.blocks.fn,
    type: 'condition',
    name: 'Decision',
    subBlocks: {
      conditions: {
        id: 'conditions',
        type: 'condition-input',
        value: JSON.stringify([
          { id: 'if', value: 'true' },
          { id: 'else', value: '' },
        ]),
      },
    },
  }
  snapshot.edges = [{ id: 'route', source: 'fn', target: 'convex', sourceHandle }]
  return snapshot
}

function expandedResultState(connected: boolean): WorkflowState {
  const snapshot = routingState('condition-if')
  snapshot.blocks.fn.name = 'x'.repeat(64 * 1024)
  const branches = Array.from({ length: 256 }, (_, index) => ({
    id: `branch-${index}`,
    value: index === 255 ? '' : 'true',
  }))
  snapshot.blocks.fn.subBlocks.conditions.value = JSON.stringify(branches)
  snapshot.edges = connected
    ? branches.map((branch) => ({
        id: branch.id,
        source: 'fn',
        target: 'convex',
        sourceHandle: `condition-${branch.id}`,
      }))
    : []
  return snapshot
}

beforeAll(async () => {
  const now = new Date()
  await db.insert(user).values({
    id: ownerId,
    name: 'Comparison fixture',
    email: `${ownerId}@comparison.test`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(workspace).values(
    [workspaceId, otherWorkspaceId].map((id) => ({
      id,
      name: 'Comparison fixture',
      ownerId,
      billedAccountUserId: ownerId,
    }))
  )
  await db.insert(workflow).values(
    [workflowId, otherWorkflowId].map((id) => ({
      id,
      userId: ownerId,
      workspaceId,
      name: id,
      lastSynced: now,
      createdAt: now,
      updatedAt: now,
    }))
  )
  await db.insert(workflowDeploymentVersion).values([
    { id: generateId(), workflowId, version: 1, state: state('1') },
    { id: generateId(), workflowId, version: 2, state: state('2') },
    { id: generateId(), workflowId: otherWorkflowId, version: 3, state: state('3') },
    { id: generateId(), workflowId, version: 4, state: state('x'.repeat(17 * 1024 * 1024)) },
    { id: generateId(), workflowId, version: 5, state: playlistState(false) },
    { id: generateId(), workflowId, version: 6, state: playlistState(true) },
    { id: generateId(), workflowId, version: 7, state: jsonArgumentState(1) },
    { id: generateId(), workflowId, version: 8, state: jsonArgumentState(2) },
    { id: generateId(), workflowId, version: 9, state: routingState('condition-if') },
    { id: generateId(), workflowId, version: 10, state: routingState('condition-else') },
    { id: generateId(), workflowId, version: 11, state: expandedResultState(false) },
    { id: generateId(), workflowId, version: 12, state: expandedResultState(true) },
  ])
})

afterAll(async () => {
  await db.delete(workspace).where(inArray(workspace.id, [workspaceId, otherWorkspaceId]))
  await db.delete(user).where(eq(user.id, ownerId))
  await db.$client.end()
})

const compare = (base: number, target: number) =>
  compareWorkflowVersions.execute({ principal, input: { workflowId, base, target } })

describe('compare deployment versions through the authorized application boundary', () => {
  it('identifies the exact ports when a connection changes branch between the same blocks', async () => {
    const result = await compare(9, 10)
    expect(result.diff.edgeChanges.removedDetails).toEqual([
      {
        source: 'fn',
        target: 'convex',
        sourceHandle: 'condition-if',
        sourceName: 'Decision',
        targetName: 'Convex',
      },
    ])
    expect(result.diff.edgeChanges.addedDetails).toEqual([
      {
        source: 'fn',
        target: 'convex',
        sourceHandle: 'condition-else',
        sourceName: 'Decision',
        targetName: 'Convex',
      },
    ])
  })

  it('rejects a delta that expands past the output budget even when both snapshots fit', async () => {
    expect(
      Buffer.byteLength(JSON.stringify([expandedResultState(false), expandedResultState(true)]))
    ).toBeLessThan(1024 * 1024)
    await expect(compare(11, 12).then(() => undefined)).rejects.toMatchObject({
      code: 'payload_too_large',
    })
  })

  it('reports an action default when setting it changes the outgoing operation', async () => {
    const versions = await loadWorkflowComparisonVersions(workflowId, workspaceId, 5, 6)
    const outgoingBody = (snapshot: WorkflowState) => {
      const serialized = new Serializer().serializeWorkflow(snapshot.blocks, snapshot.edges)
      const params = serialized.blocks.find((block) => block.id === 'playlist')!.config.params
      return spotifyUpdatePlaylistTool.request.body?.({
        ...params,
        accessToken: 'test-only-token',
        playlistId: 'playlist-fixture',
      })
    }
    expect(outgoingBody(versions.base)).toEqual({ name: 'Updated name' })
    expect(outgoingBody(versions.target)).toEqual({ name: 'Updated name', public: true })

    const forward = await compare(5, 6)
    const reverse = await compare(6, 5)
    expect(forward.diff.hasChanges).toBe(true)
    expect(forward.diff.modifiedBlocks.find((block) => block.id === 'playlist')?.changes).toEqual([
      {
        scope: 'subblock',
        field: 'public',
        oldValue: { kind: 'unset' },
        newValue: { kind: 'value', value: true },
      },
    ])
    expect(reverse.diff.modifiedBlocks.find((block) => block.id === 'playlist')?.changes).toEqual([
      {
        scope: 'subblock',
        field: 'public',
        oldValue: { kind: 'value', value: true },
        newValue: { kind: 'unset' },
      },
    ])
  })

  it('preserves changed own JSON properties named __proto__ through stored version comparison', async () => {
    const result = await compare(7, 8)
    expect(result.diff.hasChanges).toBe(true)
    expect(result.diff.modifiedBlocks.find((block) => block.id === 'mcp')?.changes).toEqual([
      {
        scope: 'subblock',
        field: 'arguments',
        oldValue: {
          kind: 'value',
          value: JSON.parse('{"patch":{"__proto__":{"answer":1},"x":1}}'),
        },
        newValue: {
          kind: 'value',
          value: JSON.parse('{"patch":{"__proto__":{"answer":2},"x":1}}'),
        },
      },
    ])
  })

  it('reads the requested immutable versions and reverses field values when the direction changes', async () => {
    const forward = await compare(1, 2)
    const reverse = await compare(2, 1)
    const field = (result: typeof forward) =>
      result.diff.modifiedBlocks
        .find((block) => block.id === 'fn')!
        .changes.find((change) => change.field === 'code')!
    expect(field(forward)).toMatchObject({
      oldValue: { kind: 'value', value: 'return 1' },
      newValue: { kind: 'value', value: 'return 2' },
    })
    expect(field(reverse)).toMatchObject({
      oldValue: field(forward).newValue,
      newValue: field(forward).oldValue,
    })
    expect(JSON.stringify(forward)).not.toContain('private-')
    expect(
      forward.diff.modifiedBlocks.find((block) => block.id === 'convex')?.changes
    ).toContainEqual({
      scope: 'subblock',
      field: 'deployKey',
      oldValue: { kind: 'redacted' },
      newValue: { kind: 'redacted' },
    })
    expect((await compare(1, 1)).diff.hasChanges).toBe(false)
  })

  it('rejects another workspace principal', async () => {
    await expect(
      compareWorkflowVersions.execute({
        principal: createWorkspaceApiKeyPrincipal({
          workspaceId: otherWorkspaceId,
          keyId: generateId(),
        }),
        input: { workflowId, base: 1, target: 2 },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('cannot satisfy a version reference with a version from another workflow', async () => {
    await expect(compare(1, 3)).rejects.toMatchObject({ code: 'not_found' })
  })

  it('rejects oversized snapshots before materializing the comparison', async () => {
    await expect(compare(1, 4)).rejects.toMatchObject({ code: 'payload_too_large' })
  })
})
