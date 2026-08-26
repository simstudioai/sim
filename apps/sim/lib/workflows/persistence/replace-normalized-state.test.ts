/**
 * @vitest-environment node
 */
import { dbChainMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { and, inArray, ne } from 'drizzle-orm'
import { DrizzleQueryError } from 'drizzle-orm/errors'
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

/**
 * The shape production actually throws: Drizzle wraps every driver fault in a
 * `DrizzleQueryError` whose own message is the SQL text and which carries no
 * `code`, putting the driver error on `.cause`. A flat error object is a shape
 * the database layer never produces.
 */
function wrapDriverError(cause: Error): Error {
  return new DrizzleQueryError(
    'insert into "workflow_edges" ("id", "workflow_id") values ($1, $2)',
    ['edge-1', 'workflow-1'],
    cause
  )
}

function uniqueViolation(constraintName: string): Error {
  return Object.assign(new Error('duplicate key value violates unique constraint'), {
    code: '23505',
    constraint_name: constraintName,
  })
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
   * `workflow_blocks.id`, `workflow_edges.id`, and `workflow_subflows.id` are
   * GLOBAL primary keys while the replace deletes only this workflow's rows, so
   * an id owned elsewhere survives the delete and faults the insert. These pin
   * the refusal, the message, and — because `dbChainMock` resolves rows without
   * evaluating predicates — the predicate itself.
   */
  describe('ids claimed by another workflow', () => {
    const LOOP_BLOCK = { ...BLOCK, id: 'loop-1', type: 'loop', name: 'Loop' }
    const EDGE = { id: 'edge-1', source: 'block-1', target: 'block-1' }

    it('refuses a block id another workflow owns instead of faulting the insert', async () => {
      queueTableRows(schemaMock.workflowBlocks, [{ id: 'block-1' }])

      await expect(replaceWorkflowNormalizedState(input())).rejects.toMatchObject({
        code: 'conflict',
        message: 'Block ids already used by another workflow: block-1',
      })
      expect(mocks.save).not.toHaveBeenCalled()
    })

    /**
     * The `ne(workflowId)` half is load-bearing: without it every ordinary
     * round-trip — re-sending ids this workflow already holds — becomes a 409.
     * Asserted on the composed condition, because the chain mock resolves rows
     * regardless of what was passed to `where`.
     */
    it('scopes the lookup to ids held by a DIFFERENT workflow', async () => {
      await replaceWorkflowNormalizedState(input())

      expect(inArray).toHaveBeenCalledWith(schemaMock.workflowBlocks.id, ['block-1'])
      expect(ne).toHaveBeenCalledWith(schemaMock.workflowBlocks.workflowId, 'workflow-1')
      expect(and).toHaveBeenCalledWith(
        { type: 'inArray', column: schemaMock.workflowBlocks.id, values: ['block-1'] },
        { type: 'ne', left: schemaMock.workflowBlocks.workflowId, right: 'workflow-1' }
      )
      expect(dbChainMockFns.where).toHaveBeenCalledWith({
        type: 'and',
        conditions: [
          { type: 'inArray', column: schemaMock.workflowBlocks.id, values: ['block-1'] },
          { type: 'ne', left: schemaMock.workflowBlocks.workflowId, right: 'workflow-1' },
        ],
      })
      expect(mocks.save).toHaveBeenCalled()
    })

    it('refuses an edge id another workflow owns', async () => {
      mocks.prepare.mockReturnValue({
        state: { ...PREPARED, edges: [EDGE] },
        warnings: [],
      })
      queueTableRows(schemaMock.workflowEdges, [{ id: 'edge-1' }])

      await expect(replaceWorkflowNormalizedState(input())).rejects.toMatchObject({
        code: 'conflict',
        message: 'Edge ids already used by another workflow: edge-1',
      })
      expect(inArray).toHaveBeenCalledWith(schemaMock.workflowEdges.id, ['edge-1'])
      expect(ne).toHaveBeenCalledWith(schemaMock.workflowEdges.workflowId, 'workflow-1')
      expect(mocks.save).not.toHaveBeenCalled()
    })

    /**
     * `workflow_subflows` has its own global primary key, so a value free as a
     * block id can still be taken as a subflow id — reported under its own
     * label rather than folded into the block families.
     */
    it('reports a subflow id collision under its own label', async () => {
      mocks.prepare.mockReturnValue({
        state: {
          blocks: { 'block-1': BLOCK, 'loop-1': LOOP_BLOCK },
          edges: [],
          loops: { 'loop-1': { id: 'loop-1' } },
          parallels: {},
        },
        warnings: [],
      })
      queueTableRows(schemaMock.workflowBlocks, [])
      queueTableRows(schemaMock.workflowSubflows, [{ id: 'loop-1' }])

      await expect(replaceWorkflowNormalizedState(input())).rejects.toMatchObject({
        code: 'conflict',
        message: 'Subflow ids already used by another workflow: loop-1',
      })
      expect(inArray).toHaveBeenCalledWith(schemaMock.workflowSubflows.id, ['loop-1'])
      expect(mocks.save).not.toHaveBeenCalled()
    })

    /** Ids only — never the workflow or workspace that holds them. */
    it('names the offending ids and nothing about their owner', async () => {
      queueTableRows(schemaMock.workflowBlocks, [{ id: 'block-1' }])

      const error = await replaceWorkflowNormalizedState(input()).catch((thrown) => thrown)

      expect(error).toMatchObject({ code: 'conflict' })
      expect(error.message).toContain('block-1')
      expect(error.message).not.toMatch(/workspace|workflow-2/)
    })

    /**
     * The pre-check is the good-message path, not the correctness boundary: the
     * `FOR UPDATE` locks the target workflow row, not the workflow that would
     * claim the id, so two concurrent writes carrying the same fresh id can
     * both pass it under READ COMMITTED. The catch is what keeps that race a
     * 409 rather than an unclassified 500.
     */
    it('re-classifies a 23505 that races past the pre-check', async () => {
      mocks.save.mockRejectedValue(wrapDriverError(uniqueViolation('workflow_edges_pkey')))

      await expect(replaceWorkflowNormalizedState(input())).rejects.toMatchObject({
        code: 'conflict',
      })
    })

    /**
     * The constraint name is compared exactly: a unique index whose name merely
     * contains one of the graph-id constraints belongs to some other table and
     * must not be reported as a claimed graph id.
     */
    it('leaves a 23505 on an unrelated constraint unclassified', async () => {
      const failure = wrapDriverError(uniqueViolation('archive_workflow_blocks_pkey_backup'))
      mocks.save.mockRejectedValue(failure)

      await expect(replaceWorkflowNormalizedState(input())).rejects.toBe(failure)
    })

    it('leaves an unrelated database fault unclassified', async () => {
      const failure = wrapDriverError(
        Object.assign(new Error('deadlock detected'), { code: '40P01' })
      )
      mocks.save.mockRejectedValue(failure)

      await expect(replaceWorkflowNormalizedState(input())).rejects.toBe(failure)
    })
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
