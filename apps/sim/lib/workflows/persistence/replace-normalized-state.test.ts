/**
 * @vitest-environment node
 */
import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  save: vi.fn(),
  extractCustomTools: vi.fn(),
}))

vi.mock('@/lib/workflows/persistence/prepare-state', () => ({
  prepareWorkflowStateForPersistence: mocks.prepare,
}))
vi.mock('@/lib/workflows/persistence/utils', () => ({
  saveWorkflowToNormalizedTables: mocks.save,
}))
vi.mock('@/lib/workflows/persistence/custom-tools-persistence', () => ({
  extractAndPersistCustomTools: mocks.extractCustomTools,
}))

import {
  replaceWorkflowNormalizedState,
  WorkflowStatePersistenceError,
} from '@/lib/workflows/persistence/replace-normalized-state'

const BLOCK = {
  id: 'block-1',
  type: 'starter',
  name: 'Start',
  position: { x: 0, y: 0 },
  subBlocks: {},
  outputs: {},
  enabled: true,
}

const PREPARED = {
  blocks: { 'block-1': BLOCK },
  edges: [],
  loops: {},
  parallels: {},
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    workflowId: 'workflow-1',
    workspaceId: 'workspace-1',
    attributedUserId: 'user-1',
    state: { blocks: { 'block-1': BLOCK }, edges: [] },
    ...overrides,
  } as Parameters<typeof replaceWorkflowNormalizedState>[0]
}

describe('replaceWorkflowNormalizedState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    // The lock select must find a live row in the caller's workspace; an empty
    // result is the archived / cross-workspace refusal, covered separately.
    dbChainMockFns.for.mockResolvedValue([{ id: 'workflow-1' }])
    mocks.prepare.mockReturnValue({ state: PREPARED, warnings: [] })
    mocks.save.mockResolvedValue({ success: true })
    mocks.extractCustomTools.mockResolvedValue({ saved: 0, errors: [] })
  })

  /**
   * The two-doors defect: the Copilot edit tool wrote through
   * `saveWorkflowToNormalizedTables` directly, so preparation never ran and an
   * inline agent-tool secret or a dangling edge reached the tables.
   */
  it('prepares the graph before writing it and returns the preparation warnings', async () => {
    mocks.prepare.mockReturnValue({
      state: PREPARED,
      warnings: ['Dropped edge "edge-9": target block does not exist'],
    })

    const result = await replaceWorkflowNormalizedState(input())

    expect(mocks.prepare).toHaveBeenCalledWith({
      blocks: { 'block-1': BLOCK },
      edges: [],
    })
    expect(mocks.save).toHaveBeenCalledWith(
      'workflow-1',
      expect.objectContaining({ blocks: PREPARED.blocks, edges: PREPARED.edges }),
      expect.anything()
    )
    expect(mocks.prepare).toHaveBeenCalledBefore(mocks.save)
    expect(result.warnings).toEqual(['Dropped edge "edge-9": target block does not exist'])
    expect(result.state).toBe(PREPARED)
  })

  it('locks the workflow row for update inside the write transaction', async () => {
    await replaceWorkflowNormalizedState(input())

    expect(dbChainMockFns.for).toHaveBeenCalledWith('update')
  })

  it('stamps lastSynced and leaves variables untouched when none are supplied', async () => {
    await replaceWorkflowNormalizedState(input())

    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ lastSynced: expect.any(Date), updatedAt: expect.any(Date) })
    )
    expect(dbChainMockFns.set.mock.calls[0][0]).not.toHaveProperty('variables')
  })

  it('writes variables in the same transaction when they are supplied', async () => {
    const variables = { 'var-1': { id: 'var-1', name: 'region', type: 'string', value: 'eu' } }

    await replaceWorkflowNormalizedState(input({ state: { blocks: {}, edges: [], variables } }))

    expect(dbChainMockFns.set).toHaveBeenCalledWith(expect.objectContaining({ variables }))
  })

  it('extracts custom tools after the transaction commits', async () => {
    await replaceWorkflowNormalizedState(input())

    expect(mocks.extractCustomTools).toHaveBeenCalledWith(
      expect.objectContaining({ blocks: PREPARED.blocks }),
      'workspace-1',
      'user-1'
    )
    expect(mocks.save).toHaveBeenCalledBefore(mocks.extractCustomTools)
  })

  /** Pre-existing, deliberate: a stale custom tool never fails a committed graph write. */
  it('keeps custom-tool extraction best-effort', async () => {
    mocks.extractCustomTools.mockRejectedValue(new Error('tool table unavailable'))

    await expect(replaceWorkflowNormalizedState(input())).resolves.toMatchObject({ warnings: [] })
  })

  it('skips custom-tool extraction for a workflow with no workspace', async () => {
    await replaceWorkflowNormalizedState(input({ workspaceId: null }))

    expect(mocks.extractCustomTools).not.toHaveBeenCalled()
  })

  it('throws and skips custom-tool extraction when the write fails', async () => {
    mocks.save.mockResolvedValue({ success: false, error: 'constraint violation' })

    await expect(replaceWorkflowNormalizedState(input())).rejects.toBeInstanceOf(
      WorkflowStatePersistenceError
    )
    expect(mocks.extractCustomTools).not.toHaveBeenCalled()
  })

  /**
   * The lock predicate is scoped, not just `id`: a workflow archived between the
   * caller's authorization check and this write is refused rather than written,
   * which is the predicate every pre-consolidation caller used.
   */
  it('refuses when the lock finds no live row in the workspace', async () => {
    dbChainMockFns.for.mockResolvedValue([])

    await expect(replaceWorkflowNormalizedState(input())).rejects.toThrow('Workflow not found')
    expect(mocks.save).not.toHaveBeenCalled()
  })
})
