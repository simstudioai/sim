/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import { buildTraceSpans } from '@/lib/logs/execution/trace-spans/trace-spans'
import { DAGExecutor } from '@/executor/execution/executor'
import { hasExecutionResult } from '@/executor/utils/errors'
import type { SerializedWorkflow } from '@/serializer/types'

vi.mock('@/lib/execution/cancellation', () => ({
  subscribeToExecutionCancellation: vi.fn(async () => () => {}),
  isExecutionCancelled: vi.fn(async () => false),
}))
vi.mock('@/ee/access-control/utils/permission-check', () => ({
  validateBlockType: vi.fn(async () => {}),
}))

/**
 * Start → Call, where Call fails while its inputs resolve: `<start.nope>` is not
 * a Start output, so the executor raises `InvalidFieldError` before the block's
 * handler runs. No network, no sandbox — the failure is the executor's own.
 */
const workflow: SerializedWorkflow = {
  version: '1',
  blocks: [
    {
      id: 'start',
      position: { x: 0, y: 0 },
      config: { tool: 'start_trigger', params: {} },
      inputs: {},
      outputs: {},
      metadata: { id: 'start_trigger', name: 'Start', category: 'triggers' },
      enabled: true,
    },
    {
      id: 'api',
      position: { x: 0, y: 0 },
      config: { tool: 'http_request', params: { url: '<start.nope>', method: 'GET' } },
      inputs: {},
      outputs: {},
      metadata: { id: 'api', name: 'Call' },
      enabled: true,
    },
  ],
  connections: [{ source: 'start', target: 'api' }],
  loops: {},
  parallels: {},
}

describe('failed run trace', () => {
  it('carries every block that ran, with the failing block marked error', async () => {
    const executor = new DAGExecutor({
      workflow,
      contextExtensions: { workspaceId: 'ws', executionId: 'exec', userId: 'u' },
    })

    const thrown = await executor.execute('wf').then(
      () => undefined,
      (error: unknown) => error
    )
    expect(thrown).toBeInstanceOf(Error)
    /** The throw carries the run, so a failure can be traced like a success. */
    expect(hasExecutionResult(thrown)).toBe(true)
    if (!hasExecutionResult(thrown)) return

    const { traceSpans } = buildTraceSpans(thrown.executionResult)
    expect(traceSpans).toHaveLength(1)
    const [root] = traceSpans
    expect(root).toMatchObject({ name: 'Workflow Execution', status: 'error' })
    expect(root!.children?.map((span) => span.blockId)).toEqual(['start', 'api'])

    const failing = root!.children?.find((span) => span.blockId === 'api')
    expect(failing).toMatchObject({ status: 'error', name: 'Call' })
    expect(failing?.output?.error).toMatch(/"nope" doesn't exist on block "start"/)
    expect(thrown.executionResult.error).toBe(thrown.message)
  })
})
