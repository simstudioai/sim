/**
 * @vitest-environment node
 */
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { permissionsMock, permissionsMockFns } from '@sim/testing/mocks/permissions.mock'
import {
  workspaceAuthorizationMock,
  workspaceAuthorizationMockFns,
} from '@sim/testing/mocks/workspace-authorization.mock'
import { workspaceForkingAuthzMock } from '@sim/testing/mocks/workspace-forking-authz.mock'
import {
  workspaceForkingLineageMock,
  workspaceForkingLineageMockFns,
} from '@sim/testing/mocks/workspace-forking-lineage.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const mocks = vi.hoisted(() => ({
  loadSourceDeployedStates: vi.fn(),
  loadTargetDraftState: vi.fn(),
  readDeployedState: vi.fn(),
  loadForkBlockMap: vi.fn(),
  computeForkPromotePlan: vi.fn(),
}))

vi.mock('@/lib/core/application/workspace-authorization', () => workspaceAuthorizationMock)
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)
vi.mock('@/ee/workspace-forking/lib/lineage/authz', () => workspaceForkingAuthzMock)
vi.mock('@/ee/workspace-forking/lib/lineage/lineage', () => workspaceForkingLineageMock)
vi.mock('@/ee/workspace-forking/lib/copy/deploy-bridge', () => ({
  loadSourceDeployedStates: mocks.loadSourceDeployedStates,
  loadTargetDraftState: mocks.loadTargetDraftState,
  readDeployedState: mocks.readDeployedState,
}))
vi.mock('@/ee/workspace-forking/lib/mapping/block-map-store', () => ({
  loadForkBlockMap: mocks.loadForkBlockMap,
}))
vi.mock('@/ee/workspace-forking/lib/promote/promote-plan', () => ({
  computeForkPromotePlan: mocks.computeForkPromotePlan,
}))

import { getWorkspaceSyncWorkflowDiff } from '@/ee/workspace-forking/application/sync-workflow-diff'
import { deriveForkBlockId } from '@/ee/workspace-forking/lib/remap/block-identity'

const principal = createSessionPrincipal({ userId: 'actor' })
const edge = { parentWorkspaceId: 'parent', childWorkspaceId: 'child' }

function state(blocks: Record<string, { parentId?: string }>, edges: WorkflowState['edges'] = []) {
  return {
    blocks: Object.fromEntries(
      Object.entries(blocks).map(([id, { parentId }]) => [
        id,
        {
          id,
          type: 'function',
          name: id,
          position: { x: 0, y: 0 },
          subBlocks: {},
          outputs: {},
          enabled: true,
          ...(parentId ? { data: { parentId } } : {}),
        },
      ])
    ),
    edges,
    loops: {},
    parallels: {},
    variables: {},
  } as unknown as WorkflowState
}

function planItem(overrides: Record<string, unknown> = {}) {
  return {
    sourceWorkflowId: 'wf-src',
    targetWorkflowId: 'wf-tgt',
    mode: 'replace',
    sourceMeta: { name: 'Ask Biz' },
    targetName: 'Ask Biz (prod)',
    ...overrides,
  }
}

function run(
  input: Partial<{
    workspaceId: string
    otherWorkspaceId: string
    direction: 'push' | 'pull'
    sourceWorkflowId: string
  }> = {}
) {
  return getWorkspaceSyncWorkflowDiff.execute({
    principal,
    input: {
      workspaceId: 'child',
      otherWorkspaceId: 'parent',
      direction: 'push',
      sourceWorkflowId: 'wf-src',
      ...input,
    },
  })
}

describe('getWorkspaceSyncWorkflowDiff', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    workspaceAuthorizationMockFns.mockAuthorizeWorkspaceOperation.mockResolvedValue(undefined)
    permissionsMockFns.mockGetWorkspaceWithOwner.mockImplementation(async (id: string) => ({
      id,
      name: id,
      organizationId: 'org',
      allowPersonalApiKeys: false,
    }))
    workspaceForkingLineageMockFns.mockResolveForkEdge.mockResolvedValue(edge)
    mocks.loadForkBlockMap.mockResolvedValue({
      parentToChild: new Map(),
      childToParent: new Map([['b1', { targetBlockId: 'mapped-b1', targetWorkflowId: 'wf-tgt' }]]),
    })
    mocks.loadSourceDeployedStates.mockResolvedValue({
      deployedWorkflows: [{ id: 'wf-src' }],
      sourceStates: new Map([
        ['wf-src', state({ b1: {}, b2: {} }, [{ id: 'e', source: 'b1', target: 'b2' }])],
      ]),
    })
    mocks.computeForkPromotePlan.mockResolvedValue({ items: [planItem()], archivedTargets: [] })
    mocks.loadTargetDraftState.mockResolvedValue(state({ 'mapped-b1': {} }))
    mocks.readDeployedState.mockResolvedValue(null)
  })

  it('re-keys the source through the block map and derives ids for unmapped blocks', async () => {
    const result = await run()

    expect(Object.keys(result.after.blocks).sort()).toEqual(
      [deriveForkBlockId('wf-tgt', 'b2'), 'mapped-b1'].sort()
    )
    expect(result.after.edges[0]).toMatchObject({
      source: 'mapped-b1',
      target: deriveForkBlockId('wf-tgt', 'b2'),
    })
    expect(result).toMatchObject({
      targetWorkflowId: 'wf-tgt',
      beforeLabel: 'Ask Biz (prod) (current)',
      afterLabel: 'Ask Biz (deployed)',
    })
    expect(result.before).toEqual(state({ 'mapped-b1': {} }))
  })

  it('re-keys the source variables to the target ids by name so they compare as themselves', async () => {
    const source = state({ b1: {} })
    source.variables = { 'v-src': { id: 'v-src', name: 'region', type: 'string', value: 'eu' } }
    const target = state({ 'mapped-b1': {} })
    target.variables = { 'v-tgt': { id: 'v-tgt', name: 'region', type: 'string', value: 'us' } }
    mocks.loadSourceDeployedStates.mockResolvedValue({
      deployedWorkflows: [{ id: 'wf-src' }],
      sourceStates: new Map([['wf-src', source]]),
    })
    mocks.loadTargetDraftState.mockResolvedValue(target)

    const result = await run()

    expect(result.after.variables).toEqual({
      'v-tgt': { id: 'v-tgt', name: 'region', type: 'string', value: 'eu' },
    })
  })

  it('reports null before for a workflow the sync would create, without reading the target', async () => {
    mocks.computeForkPromotePlan.mockResolvedValue({
      items: [planItem({ mode: 'create', targetName: undefined })],
      archivedTargets: [],
    })

    const result = await run()

    expect(result.before).toBeNull()
    expect(result.beforeLabel).toBe('Ask Biz (current)')
    expect(mocks.loadTargetDraftState).not.toHaveBeenCalled()
    expect(mocks.readDeployedState).not.toHaveBeenCalled()
  })

  it('falls back to the live deployment when the target has no draft', async () => {
    const deployed = state({ 'mapped-b1': {}, extra: {} })
    mocks.loadTargetDraftState.mockResolvedValue(null)
    mocks.readDeployedState.mockResolvedValue(deployed)

    const result = await run()

    expect(result.before).toBe(deployed)
    expect(mocks.readDeployedState).toHaveBeenCalledWith('wf-tgt', 'parent')
  })

  it('rejects a workflow that is not in the sync plan before reading any target state', async () => {
    await expect(run({ sourceWorkflowId: 'foreign' })).rejects.toMatchObject({
      code: 'not_found',
    })
    expect(mocks.loadTargetDraftState).not.toHaveBeenCalled()
    expect(mocks.readDeployedState).not.toHaveBeenCalled()
  })

  it('reads the other side as the source on a pull and pairs through the child block map', async () => {
    await run({ workspaceId: 'parent', otherWorkspaceId: 'child', direction: 'pull' })

    expect(mocks.loadSourceDeployedStates).toHaveBeenCalledWith('child')
    expect(mocks.computeForkPromotePlan).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceWorkspaceId: 'child',
        targetWorkspaceId: 'parent',
        direction: 'pull',
      })
    )
    expect(mocks.loadForkBlockMap).toHaveBeenCalledWith(expect.anything(), 'child')
  })

  it('refuses when the caller is not an admin on the other side', async () => {
    workspaceAuthorizationMockFns.mockAuthorizeWorkspaceOperation.mockImplementation(
      async (_principal: unknown, _operation: unknown, scope: { workspaceId: string }) => {
        if (scope.workspaceId === 'parent') {
          throw new OrchestrationError('forbidden', 'Admin access required')
        }
      }
    )

    await expect(run()).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.loadSourceDeployedStates).not.toHaveBeenCalled()
  })
})
