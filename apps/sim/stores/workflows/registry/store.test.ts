/**
 * @vitest-environment node
 *
 * Focused tests for the registry store's `loadWorkflowState` after the
 * workflow-state cache collapse: it hydrates the shared
 * `workflowKeys.state(id)` entry via `fetchQuery` (always-fresh,
 * `staleTime: 0`) and projects the envelope into the workflow / sub-block /
 * variables / deployment stores, guarding against superseded responses.
 */
import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRequestJson, sharedQueryClient } = vi.hoisted(() => ({
  mockRequestJson: vi.fn(),
  sharedQueryClient: { current: null as unknown },
}))

vi.mock('@/lib/api/client/request', () => ({
  requestJson: mockRequestJson,
}))

vi.mock('@/app/_shell/providers/get-query-client', () => ({
  getQueryClient: () => sharedQueryClient.current as QueryClient,
}))

const { replaceWorkflowState, initializeFromWorkflow, setVariablesState, clearError } = vi.hoisted(
  () => ({
    replaceWorkflowState: vi.fn(),
    initializeFromWorkflow: vi.fn(),
    setVariablesState: vi.fn(),
    clearError: vi.fn(),
  })
)

vi.mock('@/stores/workflows/workflow/store', () => ({
  useWorkflowStore: {
    getState: () => ({ replaceWorkflowState, blocks: {} }),
    setState: vi.fn(),
  },
}))

vi.mock('@/stores/workflows/subblock/store', () => ({
  useSubBlockStore: {
    getState: () => ({ initializeFromWorkflow }),
    setState: vi.fn(),
  },
}))

vi.mock('@/stores/variables/store', () => ({
  useVariablesStore: {
    getState: () => ({ variables: {} }),
    setState: (updater: unknown) => setVariablesState(updater),
  },
}))

vi.mock('@/stores/operation-queue/store', () => ({
  useOperationQueueStore: {
    getState: () => ({ clearError }),
  },
}))

vi.mock('@/hooks/queries/utils/invalidate-workflow-lists', () => ({
  invalidateWorkflowLists: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/stores/workflows/utils', () => ({
  getUniqueBlockName: vi.fn(),
  regenerateBlockIds: vi.fn(),
}))

vi.mock('@/lib/workflows/autolayout/constants', () => ({
  DEFAULT_DUPLICATE_OFFSET: { x: 0, y: 0 },
}))

vi.mock('@/hooks/queries/deployments', () => ({
  deploymentKeys: {
    infos: () => ['deployments', 'info'],
    info: (workflowId: string | null) => ['deployments', 'info', workflowId ?? ''],
  },
}))

import { workflowKeys } from '@/hooks/queries/utils/workflow-keys'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

function makeEnvelope(overrides: Record<string, unknown> = {}) {
  return {
    id: 'wf-1',
    isDeployed: true,
    deployedAt: new Date('2026-01-01T00:00:00.000Z'),
    isPublicApi: false,
    state: {
      blocks: { b1: { id: 'b1' } },
      edges: [],
      loops: {},
      parallels: {},
    },
    variables: { v1: { id: 'v1', workflowId: 'wf-1', name: 'x' } },
    ...overrides,
  }
}

describe('registry store loadWorkflowState (collapsed cache)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // The store dispatches an `active-workflow-changed` CustomEvent on the
    // window; provide a minimal stub under the node environment.
    vi.stubGlobal('window', { dispatchEvent: vi.fn() })
    sharedQueryClient.current = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    // Reset store to a clean state with a workspace scope so loadWorkflowState
    // does not bail on the missing-workspace guard.
    useWorkflowRegistry.setState({
      activeWorkflowId: null,
      error: null,
      hydration: {
        phase: 'idle',
        workspaceId: 'ws-1',
        workflowId: null,
        requestId: null,
        error: null,
      },
    })
  })

  it('projects envelope state, variables, and deployment info into the stores', async () => {
    mockRequestJson.mockResolvedValue({ data: makeEnvelope() })

    await useWorkflowRegistry.getState().loadWorkflowState('wf-1')

    expect(replaceWorkflowState).toHaveBeenCalledTimes(1)
    expect(replaceWorkflowState.mock.calls[0][0]).toMatchObject({
      currentWorkflowId: 'wf-1',
      blocks: { b1: { id: 'b1' } },
      edges: [],
    })
    expect(initializeFromWorkflow).toHaveBeenCalledWith('wf-1', { b1: { id: 'b1' } })
    expect(setVariablesState).toHaveBeenCalledTimes(1)

    const deploymentInfo = (sharedQueryClient.current as QueryClient).getQueryData([
      'deployments',
      'info',
      'wf-1',
    ])
    expect(deploymentInfo).toMatchObject({
      isDeployed: true,
      isPublicApi: false,
      deployedAt: '2026-01-01T00:00:00.000Z',
    })

    expect(useWorkflowRegistry.getState().activeWorkflowId).toBe('wf-1')
    expect(useWorkflowRegistry.getState().hydration.phase).toBe('ready')
  })

  it('preserves the cached in-flight deployment attempt across envelope hydration', async () => {
    const client = sharedQueryClient.current as QueryClient
    const preparingAttempt = {
      id: 'op-1',
      deploymentVersionId: 'dv-1',
      version: 2,
      action: 'deploy',
      status: 'preparing',
      readiness: { webhooks: 'pending', schedules: 'pending', mcp: 'pending' },
      requestedAt: '2026-07-14T00:00:00.000Z',
      activatedAt: null,
      error: null,
    }
    client.setQueryData(['deployments', 'info', 'wf-1'], {
      isDeployed: false,
      deployedAt: null,
      apiKey: 'Workspace API keys',
      needsRedeployment: true,
      isPublicApi: false,
      warnings: ['Deployment preparation is queued'],
      activeDeployment: null,
      latestDeploymentAttempt: preparingAttempt,
    })
    mockRequestJson.mockResolvedValue({ data: makeEnvelope({ isDeployed: false }) })

    await useWorkflowRegistry.getState().loadWorkflowState('wf-1')

    const deploymentInfo = client.getQueryData(['deployments', 'info', 'wf-1'])
    expect(deploymentInfo).toMatchObject({
      isDeployed: false,
      apiKey: 'Workspace API keys',
      needsRedeployment: true,
      warnings: ['Deployment preparation is queued'],
      latestDeploymentAttempt: { id: 'op-1', status: 'preparing' },
    })
  })

  it('hydrates the SAME workflowKeys.state(id) cache entry the hooks read', async () => {
    const envelope = makeEnvelope()
    mockRequestJson.mockResolvedValue({ data: envelope })

    await useWorkflowRegistry.getState().loadWorkflowState('wf-1')

    const client = sharedQueryClient.current as QueryClient
    const cached = client.getQueryData(workflowKeys.state('wf-1'))
    expect(cached).toBeDefined()
    expect((cached as { id: string }).id).toBe('wf-1')

    // Exactly one cache entry exists for this endpoint — the shared one.
    const stateEntries = client
      .getQueryCache()
      .findAll({ queryKey: workflowKeys.states() })
      .filter((q) => q.queryKey[2] === 'wf-1')
    expect(stateEntries).toHaveLength(1)
  })

  it('re-fetches on every call (staleTime: 0, never served stale)', async () => {
    mockRequestJson.mockResolvedValue({ data: makeEnvelope() })

    await useWorkflowRegistry.getState().loadWorkflowState('wf-1')
    await useWorkflowRegistry.getState().loadWorkflowState('wf-1')

    expect(mockRequestJson).toHaveBeenCalledTimes(2)
  })

  it('discards a superseded response via the staleness guard', async () => {
    // First load (wf-1) is in-flight; a second load (wf-2) supersedes the
    // hydration workflowId, then wf-1 finally resolves. The guard compares the
    // current hydration workflowId/requestId against the resolving request and
    // must discard the now-stale wf-1 projection.
    let resolveFirst: (value: unknown) => void = () => {}
    const firstPending = new Promise((resolve) => {
      resolveFirst = resolve
    })

    mockRequestJson
      .mockImplementationOnce(() => firstPending)
      .mockImplementationOnce(() => Promise.resolve({ data: makeEnvelope({ id: 'wf-2' }) }))

    const firstLoad = useWorkflowRegistry.getState().loadWorkflowState('wf-1')
    const secondLoad = useWorkflowRegistry.getState().loadWorkflowState('wf-2')
    await secondLoad

    expect(useWorkflowRegistry.getState().activeWorkflowId).toBe('wf-2')
    const projectionsAfterSecond = replaceWorkflowState.mock.calls.length

    resolveFirst({ data: makeEnvelope({ id: 'wf-1' }) })
    await firstLoad

    // The stale wf-1 result must not project again — hydration is now wf-2.
    expect(replaceWorkflowState.mock.calls.length).toBe(projectionsAfterSecond)
    expect(useWorkflowRegistry.getState().activeWorkflowId).toBe('wf-2')
  })
})
