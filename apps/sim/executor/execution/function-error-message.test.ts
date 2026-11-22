import { permissionCheckMock } from '@sim/testing/mocks/permission-check.mock'
import { toolsMock, toolsMockFns } from '@sim/testing/mocks/tools.mock'
import type { Mock } from 'vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FunctionBlock } from '@/blocks/blocks/function'
import { ResponseBlock } from '@/blocks/blocks/response'
import { getBlock } from '@/blocks/registry'
import { DAGExecutor } from '@/executor/execution/executor'
import { hasExecutionResult } from '@/executor/utils/errors'
import type { SerializedConnection, SerializedWorkflow } from '@/serializer/types'

vi.mock('@/lib/execution/cancellation', () => ({
  subscribeToExecutionCancellation: vi.fn(async () => () => {}),
  isExecutionCancelled: vi.fn(async () => false),
}))
vi.mock('@/ee/access-control/utils/permission-check', () => permissionCheckMock)
vi.mock('@/tools', () => toolsMock)

const REAL_BLOCKS: Record<string, unknown> = { function: FunctionBlock, response: ResponseBlock }
const registryGetBlock = getBlock as Mock
const stubGetBlock = registryGetBlock.getMockImplementation()
registryGetBlock.mockImplementation((type: string) => REAL_BLOCKS[type] ?? stubGetBlock?.(type))

const LINE_ERROR = "Line 4: `throw new Error('invalid phone: 555')` - invalid phone: 555"

/** What `executeTool` returns when the Function route reports a thrown error. */
function failedFunction(output: Record<string, unknown> = { errorMessage: 'invalid phone: 555' }) {
  return { success: false, error: LINE_ERROR, output }
}

/** Start → Parse (a Function), and Parse → Reply, a Response echoing Parse's error outputs. */
function workflow(parseToReply: SerializedConnection['sourceHandle']): SerializedWorkflow {
  return {
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
        id: 'parse',
        position: { x: 0, y: 0 },
        config: { tool: 'function_execute', params: { code: 'return 1' } },
        inputs: {},
        outputs: {},
        metadata: { id: 'function', name: 'Parse' },
        enabled: true,
      },
      {
        id: 'reply',
        position: { x: 0, y: 0 },
        config: {
          tool: 'response',
          params: {
            dataMode: 'json',
            data: '{"message": "<parse.errorMessage>", "error": "<parse.error>"}',
          },
        },
        inputs: {},
        outputs: {},
        metadata: { id: 'response', name: 'Reply' },
        enabled: true,
      },
    ],
    connections: [
      { source: 'start', target: 'parse' },
      { source: 'parse', target: 'reply', sourceHandle: parseToReply },
    ],
    loops: {},
    parallels: {},
  }
}

async function run(parseToReply: SerializedConnection['sourceHandle']) {
  const executor = new DAGExecutor({
    workflow: workflow(parseToReply),
    contextExtensions: { workspaceId: 'ws', executionId: 'exec', userId: 'u' },
  })
  return executor.execute('wf').then(
    (result) => ({ result, thrown: undefined }),
    (thrown: unknown) => ({ result: undefined, thrown })
  )
}

function blockLog(logs: Array<{ blockId: string; output?: unknown }> | undefined, id: string) {
  return logs?.find((log) => log.blockId === id)
}

describe('a failed Function block', () => {
  beforeEach(() => {
    toolsMockFns.mockExecuteTool.mockReset()
  })

  it("hands an error edge's target the thrown message alone, and error unchanged", async () => {
    toolsMockFns.mockExecuteTool.mockResolvedValueOnce(failedFunction())

    const { result } = await run('error')

    expect(result?.output.data).toEqual({ message: 'invalid phone: 555', error: LINE_ERROR })
    expect(blockLog(result?.logs, 'parse')?.output).toEqual({
      error: LINE_ERROR,
      errorMessage: 'invalid phone: 555',
    })
  })

  it('repeats error when the route reported no thrown message of its own', async () => {
    toolsMockFns.mockExecuteTool.mockResolvedValueOnce(failedFunction({}))

    const { result } = await run('error')

    expect(result?.output.data).toEqual({ message: LINE_ERROR, error: LINE_ERROR })
  })

  it('records errorMessage on the failed block when no error edge catches it', async () => {
    toolsMockFns.mockExecuteTool.mockResolvedValueOnce(failedFunction())

    const { thrown } = await run('source')

    expect(hasExecutionResult(thrown)).toBe(true)
    if (!hasExecutionResult(thrown)) return
    expect(blockLog(thrown.executionResult.logs, 'parse')?.output).toEqual({
      error: LINE_ERROR,
      errorMessage: 'invalid phone: 555',
    })
  })

  it('resolves its error outputs empty after a successful run, as error does', async () => {
    toolsMockFns.mockExecuteTool.mockResolvedValueOnce({
      success: true,
      output: { result: 1, stdout: '', files: [] },
    })

    const { result, thrown } = await run('source')

    expect(thrown).toBeUndefined()
    expect(result?.output.data).toEqual({ message: '', error: '' })
  })
})
