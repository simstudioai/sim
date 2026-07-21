/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockExecute } = vi.hoisted(() => ({ mockExecute: vi.fn() }))

vi.mock('@/executor/handlers/workflow/workflow-handler', () => ({
  WorkflowBlockHandler: class {
    execute = mockExecute
  },
  aggregateChildCost: (spans: Array<{ cost?: { total?: number } }>) =>
    spans.reduce((sum, span) => sum + (span?.cost?.total ?? 0), 0),
}))

import { ChildWorkflowError } from '@/executor/errors/child-workflow-error'
import {
  buildCustomBlockExecutionContext,
  runCustomBlockTool,
} from '@/executor/handlers/workflow/custom-block-tool-runner'

describe('buildCustomBlockExecutionContext', () => {
  it('carries consumer identity, inherits the call chain, and is fully scaffolded', () => {
    const ctx = buildCustomBlockExecutionContext({
      workspaceId: 'ws-consumer',
      userId: 'u-consumer',
      workflowId: 'wf-parent',
      callChain: ['wf-parent'],
      billingAttribution: { actorUserId: 'u-consumer', workspaceId: 'ws-consumer' } as any,
    })

    expect(ctx.workspaceId).toBe('ws-consumer')
    expect(ctx.userId).toBe('u-consumer')
    // Inherited (not reset) so the handler's depth guard keeps bounding recursion.
    expect(ctx.callChain).toEqual(['wf-parent'])
    // metadata must be a real object — the handler reads it unconditionally.
    expect(ctx.metadata).toBeTypeOf('object')
    expect(ctx.metadata.billingAttribution).toEqual({
      actorUserId: 'u-consumer',
      workspaceId: 'ws-consumer',
    })
    expect(ctx.metadata.executionMode).toBe('sync')
    // Non-optional scaffolding present.
    expect(ctx.blockStates).toBeInstanceOf(Map)
    expect(ctx.executedBlocks).toBeInstanceOf(Set)
    expect(ctx.completedLoops).toBeInstanceOf(Set)
    expect(ctx.activeExecutionPath).toBeInstanceOf(Set)
    expect(ctx.decisions.router).toBeInstanceOf(Map)
    expect(ctx.decisions.condition).toBeInstanceOf(Map)
    expect(Array.isArray(ctx.blockLogs)).toBe(true)
    expect(ctx.executionId).toBeTruthy()
  })

  it('defaults the call chain to [] when none is provided', () => {
    expect(buildCustomBlockExecutionContext({}).callChain).toEqual([])
  })
})

describe('runCustomBlockTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('runs the handler with the synthetic ctx and returns its projected output', async () => {
    mockExecute.mockResolvedValue({ success: true, result: { answer: 'hi' }, cost: { total: 0.5 } })

    const res = await runCustomBlockTool({
      blockType: 'custom_block_abc',
      inputMapping: '{"field-question":"hi"}',
      _context: { workspaceId: 'ws-consumer', userId: 'u-consumer' },
    })

    expect(res.success).toBe(true)
    expect(res.output.cost).toEqual({ total: 0.5 })

    const [ctxArg, blockArg, inputsArg] = mockExecute.mock.calls[0]
    expect(ctxArg.workspaceId).toBe('ws-consumer')
    expect(blockArg.metadata.id).toBe('custom_block_abc')
    expect(inputsArg).toEqual({ inputMapping: '{"field-question":"hi"}' })
  })

  it('surfaces a handler failure as a clean tool error', async () => {
    mockExecute.mockRejectedValue(new Error('This block’s workflow is not deployed.'))

    const res = await runCustomBlockTool({ blockType: 'custom_block_abc', _context: {} })

    expect(res.success).toBe(false)
    expect(res.error).toContain('not deployed')
  })

  it('rolls up already-incurred child cost when the run fails', async () => {
    const err: any = new Error('child blew up')
    err.name = 'ChildWorkflowError'
    err.childTraceSpans = [{ id: 's1', name: 'child', type: 'agent', cost: { total: 0.25 } }]
    Object.setPrototypeOf(err, ChildWorkflowError.prototype)
    mockExecute.mockRejectedValue(err)

    const res = await runCustomBlockTool({ blockType: 'custom_block_abc', _context: {} })

    expect(res.success).toBe(false)
    // Partial spend must not be recorded as zero-cost.
    expect((res.output as any).cost.total).toBeGreaterThan(0)
  })

  it('rejects a missing block type without invoking the handler', async () => {
    const res = await runCustomBlockTool({ _context: {} })
    expect(res.success).toBe(false)
    expect(mockExecute).not.toHaveBeenCalled()
  })
})
