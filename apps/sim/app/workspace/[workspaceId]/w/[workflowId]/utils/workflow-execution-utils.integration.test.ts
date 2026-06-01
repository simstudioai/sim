/**
 * @vitest-environment node
 *
 * Integration tests that exercise `reconcileFinalBlockLogs` against the real
 * `useTerminalConsoleStore` to validate end-to-end matching behavior. The
 * sibling unit-test file mocks the store and only verifies call args, which
 * cannot catch identity-mismatch regressions of the kind that produced the
 * 34.57s wall-clock symptom.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.unmock('@/stores/terminal')
vi.unmock('@/stores/terminal/console/store')

import { reconcileFinalBlockLogs } from '@/app/workspace/[workspaceId]/w/[workflowId]/utils/workflow-execution-utils'
import { useExecutionStore } from '@/stores/execution'
import { useTerminalConsoleStore } from '@/stores/terminal/console/store'

describe('reconcileFinalBlockLogs (real store)', () => {
  beforeEach(() => {
    useTerminalConsoleStore.setState({
      workflowEntries: {},
      entryIdsByBlockExecution: {},
      entryLocationById: {},
      isOpen: false,
      _hasHydrated: true,
    })
    vi.mocked(useExecutionStore.getState).mockReturnValue({
      getCurrentExecutionId: vi.fn(() => 'exec-1'),
    } as any)
  })

  it('actually flips a child-workflow inner block from running to success', () => {
    const store = useTerminalConsoleStore.getState()
    store.addConsole({
      workflowId: 'wf-1',
      blockId: 'workflow-1',
      blockName: 'Workflow 1',
      blockType: 'workflow',
      executionId: 'exec-1',
      executionOrder: 1,
      isRunning: false,
      success: true,
      childWorkflowInstanceId: 'child-inst-1',
    })
    store.addConsole({
      workflowId: 'wf-1',
      blockId: 'set-projects',
      blockName: 'setProjects',
      blockType: 'variables',
      executionId: 'exec-1',
      executionOrder: 5,
      isRunning: true,
      childWorkflowBlockId: 'child-inst-1',
      childWorkflowName: 'Workflow 1',
    })

    const startedAt = new Date().toISOString()
    const endedAt = new Date(Date.now() + 27).toISOString()

    reconcileFinalBlockLogs(store.updateConsole, 'wf-1', 'exec-1', [
      {
        blockId: 'workflow-1',
        blockName: 'Workflow 1',
        blockType: 'workflow',
        startedAt,
        endedAt,
        durationMs: 100,
        success: true,
        executionOrder: 1,
        childTraceSpans: [
          {
            id: 'set-projects-span',
            name: 'setProjects',
            type: 'variables',
            blockId: 'set-projects',
            executionOrder: 5,
            status: 'success',
            duration: 27,
            startTime: startedAt,
            endTime: endedAt,
            output: { value: [{ id: 'p1' }] },
          },
        ],
      } as any,
    ])

    const innerEntry = useTerminalConsoleStore
      .getState()
      .getWorkflowEntries('wf-1')
      .find((e) => e.blockId === 'set-projects')

    expect(innerEntry).toBeDefined()
    expect(innerEntry?.isRunning).toBe(false)
    expect(innerEntry?.success).toBe(true)
    expect(innerEntry?.durationMs).toBe(27)
    expect(innerEntry?.output).toEqual({ value: [{ id: 'p1' }] })
  })

  it('targets the correct invocation when the same child nodeId runs twice', () => {
    const store = useTerminalConsoleStore.getState()
    store.addConsole({
      workflowId: 'wf-1',
      blockId: 'workflow-1',
      blockName: 'Workflow 1',
      blockType: 'workflow',
      executionId: 'exec-1',
      executionOrder: 1,
      isRunning: false,
      success: true,
      childWorkflowInstanceId: 'inst-A',
    })
    store.addConsole({
      workflowId: 'wf-1',
      blockId: 'workflow-1',
      blockName: 'Workflow 1',
      blockType: 'workflow',
      executionId: 'exec-1',
      executionOrder: 2,
      isRunning: false,
      success: true,
      childWorkflowInstanceId: 'inst-B',
    })
    store.addConsole({
      workflowId: 'wf-1',
      blockId: 'fn-inner',
      blockName: 'Inner',
      blockType: 'function',
      executionId: 'exec-1',
      executionOrder: 3,
      isRunning: true,
      childWorkflowBlockId: 'inst-A',
    })
    store.addConsole({
      workflowId: 'wf-1',
      blockId: 'fn-inner',
      blockName: 'Inner',
      blockType: 'function',
      executionId: 'exec-1',
      executionOrder: 4,
      isRunning: true,
      childWorkflowBlockId: 'inst-B',
    })

    const startedAt = new Date().toISOString()
    const endedAt = new Date(Date.now() + 5).toISOString()
    const baseLog = {
      blockName: 'Workflow 1',
      blockType: 'workflow',
      startedAt,
      endedAt,
      durationMs: 50,
      success: true,
    }

    reconcileFinalBlockLogs(store.updateConsole, 'wf-1', 'exec-1', [
      {
        ...baseLog,
        blockId: 'workflow-1',
        executionOrder: 1,
        childTraceSpans: [
          {
            id: 'a',
            name: 'Inner',
            type: 'function',
            blockId: 'fn-inner',
            executionOrder: 3,
            status: 'success',
            duration: 5,
            startTime: startedAt,
            endTime: endedAt,
            output: { result: 'A' },
          },
        ],
      } as any,
      {
        ...baseLog,
        blockId: 'workflow-1',
        executionOrder: 2,
        childTraceSpans: [
          {
            id: 'b',
            name: 'Inner',
            type: 'function',
            blockId: 'fn-inner',
            executionOrder: 4,
            status: 'success',
            duration: 5,
            startTime: startedAt,
            endTime: endedAt,
            output: { result: 'B' },
          },
        ],
      } as any,
    ])

    const entries = useTerminalConsoleStore.getState().getWorkflowEntries('wf-1')
    const a = entries.find((e) => e.blockId === 'fn-inner' && e.childWorkflowBlockId === 'inst-A')
    const b = entries.find((e) => e.blockId === 'fn-inner' && e.childWorkflowBlockId === 'inst-B')

    expect(a?.isRunning).toBe(false)
    expect(a?.output).toEqual({ result: 'A' })
    expect(b?.isRunning).toBe(false)
    expect(b?.output).toEqual({ result: 'B' })
  })

  it('propagates error state for spans with error status', () => {
    const store = useTerminalConsoleStore.getState()
    store.addConsole({
      workflowId: 'wf-1',
      blockId: 'workflow-1',
      blockName: 'Workflow 1',
      blockType: 'workflow',
      executionId: 'exec-1',
      executionOrder: 1,
      isRunning: false,
      success: true,
      childWorkflowInstanceId: 'inst-1',
    })
    store.addConsole({
      workflowId: 'wf-1',
      blockId: 'http-1',
      blockName: 'API',
      blockType: 'api',
      executionId: 'exec-1',
      executionOrder: 2,
      isRunning: true,
      childWorkflowBlockId: 'inst-1',
    })

    const startedAt = new Date().toISOString()
    const endedAt = new Date(Date.now() + 30).toISOString()

    reconcileFinalBlockLogs(store.updateConsole, 'wf-1', 'exec-1', [
      {
        blockId: 'workflow-1',
        blockName: 'Workflow 1',
        blockType: 'workflow',
        startedAt,
        endedAt,
        durationMs: 100,
        success: true,
        executionOrder: 1,
        childTraceSpans: [
          {
            id: 'http-span',
            name: 'API',
            type: 'api',
            blockId: 'http-1',
            executionOrder: 2,
            status: 'error',
            duration: 30,
            startTime: startedAt,
            endTime: endedAt,
            output: { error: 'Connection refused' },
          },
        ],
      } as any,
    ])

    const entry = useTerminalConsoleStore
      .getState()
      .getWorkflowEntries('wf-1')
      .find((e) => e.blockId === 'http-1')

    expect(entry?.isRunning).toBe(false)
    expect(entry?.success).toBe(false)
    expect(entry?.error).toBe('Connection refused')
  })

  it('matches the correct iteration row inside a child workflow loop', () => {
    const store = useTerminalConsoleStore.getState()
    store.addConsole({
      workflowId: 'wf-1',
      blockId: 'workflow-1',
      blockName: 'Workflow 1',
      blockType: 'workflow',
      executionId: 'exec-1',
      executionOrder: 1,
      isRunning: false,
      success: true,
      childWorkflowInstanceId: 'inst-1',
    })
    store.addConsole({
      workflowId: 'wf-1',
      blockId: 'fn-leaf',
      blockName: 'Leaf',
      blockType: 'function',
      executionId: 'exec-1',
      executionOrder: 2,
      isRunning: false,
      success: true,
      iterationCurrent: 0,
      iterationType: 'loop',
      iterationContainerId: 'loop-1',
      childWorkflowBlockId: 'inst-1',
      output: { i: 0 },
    })
    store.addConsole({
      workflowId: 'wf-1',
      blockId: 'fn-leaf',
      blockName: 'Leaf',
      blockType: 'function',
      executionId: 'exec-1',
      executionOrder: 3,
      isRunning: true,
      iterationCurrent: 1,
      iterationType: 'loop',
      iterationContainerId: 'loop-1',
      childWorkflowBlockId: 'inst-1',
    })

    const startedAt = new Date().toISOString()
    const endedAt = new Date(Date.now() + 12).toISOString()

    reconcileFinalBlockLogs(store.updateConsole, 'wf-1', 'exec-1', [
      {
        blockId: 'workflow-1',
        blockName: 'Workflow 1',
        blockType: 'workflow',
        startedAt,
        endedAt,
        durationMs: 100,
        success: true,
        executionOrder: 1,
        childTraceSpans: [
          {
            id: 'leaf-0',
            name: 'Leaf',
            type: 'function',
            blockId: 'fn-leaf',
            executionOrder: 2,
            loopId: 'loop-1',
            iterationIndex: 0,
            status: 'success',
            duration: 5,
            startTime: startedAt,
            endTime: endedAt,
            output: { i: 0 },
          },
          {
            id: 'leaf-1',
            name: 'Leaf',
            type: 'function',
            blockId: 'fn-leaf',
            executionOrder: 3,
            loopId: 'loop-1',
            iterationIndex: 1,
            status: 'success',
            duration: 12,
            startTime: startedAt,
            endTime: endedAt,
            output: { i: 1 },
          },
        ],
      } as any,
    ])

    const entries = useTerminalConsoleStore.getState().getWorkflowEntries('wf-1')
    const iter0 = entries.find((e) => e.blockId === 'fn-leaf' && e.iterationCurrent === 0)
    const iter1 = entries.find((e) => e.blockId === 'fn-leaf' && e.iterationCurrent === 1)

    expect(iter0?.isRunning).toBe(false)
    expect(iter0?.output).toEqual({ i: 0 })
    expect(iter1?.isRunning).toBe(false)
    expect(iter1?.output).toEqual({ i: 1 })
  })
})
