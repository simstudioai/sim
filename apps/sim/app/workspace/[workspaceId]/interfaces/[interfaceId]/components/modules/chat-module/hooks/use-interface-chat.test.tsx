/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockExecute, mockCancelExecute } = vi.hoisted(() => ({
  mockExecute: vi.fn(),
  mockCancelExecute: vi.fn(),
}))

vi.mock('@/hooks/use-execution-stream', () => ({
  useExecutionStream: () => ({
    execute: mockExecute,
    cancelExecute: mockCancelExecute,
    executeFromBlock: vi.fn(),
    reconnect: vi.fn(),
    cancel: vi.fn(),
    cancelReconnect: vi.fn(),
  }),
}))

import type { InterfaceOutputConfig } from '@/lib/interfaces'
import {
  type UseInterfaceChatArgs,
  type UseInterfaceChatResult,
  useInterfaceChat,
} from '@/app/workspace/[workspaceId]/interfaces/[interfaceId]/components/modules/chat-module/hooks/use-interface-chat'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const AGENT_BLOCK = 'block-agent'
const RESPONSE_BLOCK = 'block-response'
const MODULE_ID = 'module-1'

let container: HTMLDivElement
let root: Root
let latest: UseInterfaceChatResult

function Probe({ args }: { args: UseInterfaceChatArgs }) {
  latest = useInterfaceChat(args)
  return null
}

function render(args: Omit<UseInterfaceChatArgs, 'moduleId'> & { moduleId?: string }) {
  act(() => {
    root.render(<Probe args={{ moduleId: MODULE_ID, ...args }} />)
  })
}

function blockCompleted(blockId: string, output: unknown, executionOrder = 1) {
  return {
    blockId,
    blockName: blockId,
    blockType: 'agent',
    output,
    durationMs: 1,
    startedAt: '',
    endedAt: '',
    executionOrder,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('useInterfaceChat', () => {
  it('serializes outputConfigs onto the execute payload the way a chat deployment does', async () => {
    mockExecute.mockResolvedValue(undefined)
    const outputConfigs: InterfaceOutputConfig[] = [
      { blockId: AGENT_BLOCK, path: 'content' },
      { blockId: RESPONSE_BLOCK, path: '' },
      { blockId: RESPONSE_BLOCK, path: 'data.answer' },
    ]
    render({ workflowId: 'wf-1', outputConfigs, showThinking: false })

    await act(async () => {
      latest.send('hello')
    })

    expect(mockExecute).toHaveBeenCalledTimes(1)
    const options = mockExecute.mock.calls[0][0]
    expect(options.workflowId).toBe('wf-1')
    expect(options.triggerType).toBe('chat')
    expect(options.input.input).toBe('hello')
    expect(typeof options.input.conversationId).toBe('string')
    expect(options.selectedOutputs).toEqual([
      `${AGENT_BLOCK}_content`,
      `${RESPONSE_BLOCK}_content`,
      `${RESPONSE_BLOCK}_data.answer`,
    ])
  })

  it('keys the stream per module so two modules on one workflow do not abort each other', async () => {
    mockExecute.mockResolvedValue(undefined)
    render({ moduleId: 'module-b', workflowId: 'wf-1', outputConfigs: [], showThinking: false })

    await act(async () => {
      latest.send('hello')
    })

    expect(mockExecute.mock.calls[0][0].streamKey).toBe('module-b')
  })

  it('accumulates streamed chunks into the assistant turn and settles on completion', async () => {
    mockExecute.mockImplementation(async ({ callbacks }: any) => {
      await callbacks.onStreamChunk({ blockId: AGENT_BLOCK, chunk: 'Hel' })
      await callbacks.onStreamChunk({ blockId: AGENT_BLOCK, chunk: 'lo!' })
      await callbacks.onExecutionCompleted({ success: true, output: {}, duration: 5 })
    })
    render({
      workflowId: 'wf-1',
      outputConfigs: [{ blockId: AGENT_BLOCK, path: 'content' }],
      showThinking: false,
    })

    await act(async () => {
      latest.send('hi')
    })

    expect(latest.messages).toHaveLength(2)
    expect(latest.messages[0]).toMatchObject({ type: 'user', content: 'hi' })
    expect(latest.messages[1]).toMatchObject({
      type: 'assistant',
      content: 'Hello!',
      isStreaming: false,
    })
    expect(latest.isRunning).toBe(false)
  })

  it('does not duplicate a selected output whose block already streamed', async () => {
    mockExecute.mockImplementation(async ({ callbacks }: any) => {
      await callbacks.onStreamChunk({ blockId: AGENT_BLOCK, chunk: 'Streamed answer' })
      await callbacks.onBlockCompleted(blockCompleted(AGENT_BLOCK, { content: 'Streamed answer' }))
      await callbacks.onExecutionCompleted({ success: true, output: {}, duration: 5 })
    })
    render({
      workflowId: 'wf-1',
      outputConfigs: [{ blockId: AGENT_BLOCK, path: 'content' }],
      showThinking: false,
    })

    await act(async () => {
      latest.send('hi')
    })

    expect(latest.messages[1].content).toBe('Streamed answer')
  })

  it('reads a non-streaming selected output out of the block that produced it', async () => {
    mockExecute.mockImplementation(async ({ callbacks }: any) => {
      await callbacks.onBlockCompleted(
        blockCompleted(RESPONSE_BLOCK, { data: { answer: 'From the response block' } })
      )
      await callbacks.onExecutionCompleted({
        success: true,
        output: { ignored: true },
        duration: 5,
      })
    })
    render({
      workflowId: 'wf-1',
      outputConfigs: [{ blockId: RESPONSE_BLOCK, path: 'data.answer' }],
      showThinking: false,
    })

    await act(async () => {
      latest.send('hi')
    })

    expect(latest.messages[1].content).toBe('From the response block')
  })

  it('falls back to the execution output when nothing streamed and nothing was selected', async () => {
    mockExecute.mockImplementation(async ({ callbacks }: any) => {
      await callbacks.onExecutionCompleted({
        success: true,
        output: { content: 'Final output' },
        duration: 5,
      })
    })
    render({ workflowId: 'wf-1', outputConfigs: [], showThinking: false })

    await act(async () => {
      latest.send('hi')
    })

    expect(latest.messages[1].content).toBe('Final output')
  })

  it('surfaces a workflow-produced file as a download instead of raw JSON', async () => {
    const file = {
      id: 'file-1',
      name: 'report.pdf',
      url: 'https://example.com/report.pdf',
      key: 'ws/report.pdf',
      size: 1024,
      type: 'application/pdf',
      base64: 'AAAA',
    }
    mockExecute.mockImplementation(async ({ callbacks }: any) => {
      await callbacks.onBlockCompleted(blockCompleted(RESPONSE_BLOCK, { content: file }))
      await callbacks.onExecutionCompleted({ success: true, output: {}, duration: 5 })
    })
    render({
      workflowId: 'wf-1',
      outputConfigs: [{ blockId: RESPONSE_BLOCK, path: 'content' }],
      showThinking: false,
    })

    await act(async () => {
      latest.send('hi')
    })

    expect(latest.messages[1].files).toEqual([
      {
        id: 'file-1',
        name: 'report.pdf',
        url: 'https://example.com/report.pdf',
        key: 'ws/report.pdf',
        size: 1024,
        type: 'application/pdf',
        context: undefined,
      },
    ])
  })

  it('reports a succeeded run that produced nothing without calling it an error', async () => {
    mockExecute.mockImplementation(async ({ callbacks }: any) => {
      await callbacks.onExecutionCompleted({ success: true, output: null, duration: 5 })
    })
    render({ workflowId: 'wf-1', outputConfigs: [], showThinking: false })

    await act(async () => {
      latest.send('hi')
    })

    expect(latest.messages[1].content).toBe('_The workflow returned no output._')
  })

  it('appends an execution error below whatever already streamed', async () => {
    mockExecute.mockImplementation(async ({ callbacks }: any) => {
      await callbacks.onStreamChunk({ blockId: AGENT_BLOCK, chunk: 'Partial' })
      await callbacks.onExecutionError({ error: 'Workflow is not deployed', duration: 1 })
    })
    render({ workflowId: 'wf-1', outputConfigs: [], showThinking: false })

    await act(async () => {
      latest.send('hi')
    })

    expect(latest.messages[1].content).toBe('Partial\n\nWorkflow is not deployed')
  })

  it('closes out an aborted run with the stop marker', async () => {
    mockExecute.mockImplementation(async ({ callbacks }: any) => {
      await callbacks.onStreamChunk({ blockId: AGENT_BLOCK, chunk: 'Half a sen' })
    })
    render({ workflowId: 'wf-1', outputConfigs: [], showThinking: false })

    await act(async () => {
      latest.send('hi')
    })

    expect(latest.messages[1]).toMatchObject({
      content: 'Half a sen\n\n_Response stopped by user._',
      isStreaming: false,
    })
  })

  it('tracks per-block progress only when showThinking is on', async () => {
    mockExecute.mockImplementation(async ({ callbacks }: any) => {
      await callbacks.onBlockStarted({
        blockId: AGENT_BLOCK,
        blockName: 'Agent',
        blockType: 'agent',
        executionOrder: 1,
      })
      await callbacks.onBlockCompleted(blockCompleted(AGENT_BLOCK, { content: 'x' }))
      await callbacks.onExecutionCompleted({ success: true, output: {}, duration: 5 })
    })

    render({ workflowId: 'wf-1', outputConfigs: [], showThinking: false })
    await act(async () => {
      latest.send('hi')
    })
    expect(latest.steps).toEqual([])

    render({ workflowId: 'wf-1', outputConfigs: [], showThinking: true })
    await act(async () => {
      latest.send('again')
    })
    expect(latest.steps).toEqual([{ id: `${AGENT_BLOCK}:1`, label: 'Agent', status: 'completed' }])
  })

  it('never sends without a wired workflow', async () => {
    render({ workflowId: null, outputConfigs: [], showThinking: false })

    await act(async () => {
      latest.send('hi')
    })

    expect(mockExecute).not.toHaveBeenCalled()
    expect(latest.messages).toEqual([])
  })

  it('aborts the in-flight run through the shared stream registry', async () => {
    let release: (() => void) | undefined
    mockExecute.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        })
    )
    render({ workflowId: 'wf-1', outputConfigs: [], showThinking: false })

    await act(async () => {
      latest.send('hi')
    })
    expect(latest.isRunning).toBe(true)

    act(() => {
      latest.stop()
    })
    expect(mockCancelExecute).toHaveBeenCalledWith('wf-1', MODULE_ID)

    await act(async () => {
      release?.()
    })
    expect(latest.isRunning).toBe(false)
  })
})
