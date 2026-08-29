/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { DaytonaBlock } from '@/blocks/blocks/daytona'
import { daytonaExecuteCommandTool } from '@/tools/daytona/execute_command'
import { daytonaGitCloneTool } from '@/tools/daytona/git_clone'
import { daytonaRunCodeTool } from '@/tools/daytona/run_code'
import { prepareToolRequest } from '@/tools/request-transport'

describe('Daytona execution timeout is not the transport deadline', () => {
  it('execute command sends executionTimeout as the sandbox timeout in seconds', () => {
    const request = prepareToolRequest(daytonaExecuteCommandTool, {
      apiKey: 'key',
      sandboxId: 'sandbox-1',
      command: 'ls',
      executionTimeout: 10,
    })

    expect(JSON.parse(request.body as string).timeout).toBe(10)
    expect(request.timeout).toBeUndefined()
  })

  it('run code sends executionTimeout as the sandbox timeout in seconds', () => {
    const request = prepareToolRequest(daytonaRunCodeTool, {
      apiKey: 'key',
      sandboxId: 'sandbox-1',
      code: 'print(1)',
      language: 'python',
      executionTimeout: 10,
    })

    expect(JSON.parse(request.body as string).timeout).toBe(10)
    expect(request.timeout).toBeUndefined()
  })

  it('declares executionTimeout and no reserved timeout param', () => {
    for (const tool of [daytonaExecuteCommandTool, daytonaRunCodeTool]) {
      expect(tool.params.executionTimeout).toBeDefined()
      expect(tool.params.timeout).toBeUndefined()
    }
  })

  it.each(['run_code', 'execute_command'])(
    'maps the timeout subBlock onto executionTimeout for %s and clears the reserved key',
    (operation) => {
      const params = DaytonaBlock.tools.config?.params?.({
        operation,
        apiKey: 'key',
        sandboxId: 'sandbox-1',
        command: 'ls',
        code: 'print(1)',
        language: 'python',
        timeout: '10',
      }) as Record<string, unknown>

      expect(params.executionTimeout).toBe(10)
      expect(Object.hasOwn(params, 'timeout')).toBe(true)
      expect(params.timeout).toBeUndefined()
    }
  )

  it('keeps the timeout subBlock id so saved workflows still resolve', () => {
    expect(DaytonaBlock.subBlocks.some((subBlock) => subBlock.id === 'timeout')).toBe(true)
  })
})

describe('the reserved timeout key is cleared for every Daytona operation', () => {
  /**
   * The `timeout` subBlock is `mode: 'advanced'`, and the serializer serializes an
   * advanced sub-block on stored value alone when the block is not in advanced mode
   * (`shouldSerializeSubBlock` returns `isNonEmptyValue(...)` before ever evaluating
   * the condition). A value left behind by an earlier `execute_command` selection
   * therefore still reaches `tools.config.params` after the operation is switched, and
   * the generic handler merges the raw block inputs over the transformed params — so an
   * operation that does not clear the key hands the transport a millisecond deadline.
   */
  it.each(['git_clone', 'create_sandbox', 'list_files'])(
    'clears the leftover timeout subBlock value for %s',
    (operation) => {
      const inputs = {
        operation,
        apiKey: 'key',
        sandboxId: 'sandbox-1',
        repoUrl: 'https://github.com/org/repo.git',
        clonePath: '/home/daytona/repo',
        timeout: '30',
      }
      const transformed = DaytonaBlock.tools.config?.params?.(inputs) as Record<string, unknown>
      const finalInputs = { ...inputs, ...transformed }

      expect(finalInputs.timeout).toBeUndefined()
    }
  )

  it('does not give git clone a 30ms transport deadline from a leftover timeout', () => {
    const inputs = {
      operation: 'git_clone',
      apiKey: 'key',
      sandboxId: 'sandbox-1',
      repoUrl: 'https://github.com/org/repo.git',
      clonePath: '/home/daytona/repo',
      timeout: '30',
    }
    const transformed = DaytonaBlock.tools.config?.params?.(inputs) as Record<string, unknown>
    const request = prepareToolRequest(daytonaGitCloneTool, { ...inputs, ...transformed })

    expect(request.timeout).toBeUndefined()
  })
})
