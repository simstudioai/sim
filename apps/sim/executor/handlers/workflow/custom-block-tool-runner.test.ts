/**
 * @vitest-environment node
 */
import { createLogger } from '@sim/logger'
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
import type { PiiBlockOutputRedaction } from '@/executor/execution/types'
import {
  buildCustomBlockExecutionContext,
  runCustomBlockTool,
} from '@/executor/handlers/workflow/custom-block-tool-runner'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const PII_POLICY: PiiBlockOutputRedaction = {
  enabled: true,
  entityTypes: ['EMAIL_ADDRESS'],
  language: 'en',
}

const mockRunnerLogger =
  vi.mocked(createLogger).mock.results[
    vi.mocked(createLogger).mock.calls.findIndex(([name]) => name === 'CustomBlockToolRunner')
  ].value

describe('buildCustomBlockExecutionContext', () => {
  it('carries consumer identity, inherits the call chain, and is fully scaffolded', () => {
    const ctx = buildCustomBlockExecutionContext(
      {
        workspaceId: 'ws-consumer',
        userId: 'u-consumer',
        workflowId: 'wf-parent',
        callChain: ['wf-parent'],
        billingAttribution: { actorUserId: 'u-consumer', workspaceId: 'ws-consumer' } as any,
      },
      { environmentVariables: {} }
    )

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
    expect(buildCustomBlockExecutionContext({}, { environmentVariables: {} }).callChain).toEqual([])
  })

  it('carries the caller-supplied env map and redaction policy verbatim', () => {
    const ctx = buildCustomBlockExecutionContext(
      { workspaceId: 'ws-1' },
      {
        environmentVariables: { MY_API_KEY: 'secret-value' },
        piiBlockOutputRedaction: PII_POLICY,
      }
    )

    expect(ctx.environmentVariables).toEqual({ MY_API_KEY: 'secret-value' })
    expect(ctx.piiBlockOutputRedaction).toBe(PII_POLICY)
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

  it('does not log a secret-bearing child workflow error with or without provenance', async () => {
    const secret = 'custom-block-child-secret-value'
    const message = `${secret} __var_API_KEY __sim_code_0_binding_0`
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'API_KEY', plaintext: secret, encryptedValue: 'ciphertext' },
    ])
    registry.recordResolved('API_KEY', secret)
    mockExecute.mockRejectedValue(new Error(message))

    const projected = await runCustomBlockTool(
      { blockType: 'custom_block_abc', _context: {} },
      { resolvedSecretTraceRegistry: registry }
    )
    const structural = await runCustomBlockTool({ blockType: 'custom_block_abc', _context: {} })

    expect(projected.error).toBe(message)
    expect(structural.error).toBe(message)
    const logged = JSON.stringify(mockRunnerLogger.info.mock.calls)
    expect(logged).not.toContain(secret)
    expect(logged).not.toContain('__var_')
    expect(logged).not.toContain('__sim_')
    expect(mockRunnerLogger.info).toHaveBeenLastCalledWith(
      'Custom block tool execution failed',
      expect.objectContaining({ errorName: 'Error', redacted: true })
    )
  })

  it('reports no cost on failure — the child session billed its own run', async () => {
    const err: any = new Error('child blew up')
    err.name = 'ChildWorkflowError'
    err.childTraceSpans = [{ id: 's1', name: 'child', type: 'agent', cost: { total: 0.25 } }]
    Object.setPrototypeOf(err, ChildWorkflowError.prototype)
    mockExecute.mockRejectedValue(err)

    const res = await runCustomBlockTool({ blockType: 'custom_block_abc', _context: {} })

    expect(res.success).toBe(false)
    expect(res.output).toEqual({})
  })

  it('runs the child with no env and no redaction policy — the custom branch re-derives both', async () => {
    mockExecute.mockResolvedValue({ success: true })

    await runCustomBlockTool({ blockType: 'custom_block_abc', _context: {} })

    const [ctxArg] = mockExecute.mock.calls[0]
    expect(ctxArg.environmentVariables).toEqual({})
    expect(ctxArg.piiBlockOutputRedaction).toBeUndefined()
  })

  it('rejects a missing block type without invoking the handler', async () => {
    const res = await runCustomBlockTool({ _context: {} })
    expect(res.success).toBe(false)
    expect(mockExecute).not.toHaveBeenCalled()
  })
})

describe('buildCustomBlockExecutionContext invoker identity', () => {
  it("adopts the invoking run's ids so correlation names a real execution", () => {
    const ctx = buildCustomBlockExecutionContext(
      {
        workspaceId: 'ws-1',
        executionId: 'agent-execution-id',
        requestId: 'agent-request-id',
      },
      { environmentVariables: {} }
    )

    expect(ctx.executionId).toBe('agent-execution-id')
    expect(ctx.metadata.executionId).toBe('agent-execution-id')
    expect(ctx.metadata.requestId).toBe('agent-request-id')
  })

  it('falls back to generated ids when the caller supplies none', () => {
    const ctx = buildCustomBlockExecutionContext(
      { workspaceId: 'ws-1' },
      { environmentVariables: {} }
    )

    expect(ctx.executionId).toBeTruthy()
    expect(ctx.metadata.requestId).toBeTruthy()
    expect(ctx.executionId).not.toBe(ctx.metadata.requestId)
  })
})

describe('buildCustomBlockExecutionContext cancellation', () => {
  it("adopts the agent tool loop's abort signal so the bridge has something to watch", () => {
    const controller = new AbortController()
    const ctx = buildCustomBlockExecutionContext(
      { workspaceId: 'ws-1' },
      { environmentVariables: {}, abortSignal: controller.signal }
    )

    expect(ctx.abortSignal).toBe(controller.signal)
  })

  it('leaves the signal undefined when the caller has none', () => {
    expect(
      buildCustomBlockExecutionContext({ workspaceId: 'ws-1' }, { environmentVariables: {} })
        .abortSignal
    ).toBeUndefined()
  })
})

describe('buildCustomBlockExecutionContext secret provenance', () => {
  it('carries the server-only parent registry without putting it in model parameters', () => {
    const registry = new ResolvedSecretTraceRegistry()

    const ctx = buildCustomBlockExecutionContext(
      { workspaceId: 'ws-1' },
      { environmentVariables: {}, resolvedSecretTraceRegistry: registry }
    )

    expect(ctx.resolvedSecretTraceRegistry).toBe(registry)
  })
})
