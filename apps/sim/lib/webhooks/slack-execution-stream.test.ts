/**
 * @vitest-environment node
 */
import { toError } from '@sim/utils/errors'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockAppendSlackAgentStream,
  mockGetSlackBotCredential,
  mockRegisterSlackStreamSession,
  mockSetSlackAgentSessionStatus,
  mockStartSlackAgentStream,
  mockStopSlackAgentStream,
  mockUnregisterSlackStreamSession,
} = vi.hoisted(() => ({
  mockAppendSlackAgentStream: vi.fn(),
  mockGetSlackBotCredential: vi.fn(),
  mockRegisterSlackStreamSession: vi.fn(),
  mockSetSlackAgentSessionStatus: vi.fn(),
  mockStartSlackAgentStream: vi.fn(),
  mockStopSlackAgentStream: vi.fn(),
  mockUnregisterSlackStreamSession: vi.fn(),
}))

vi.mock('@/lib/oauth/credential-service', () => ({
  getSlackBotCredential: mockGetSlackBotCredential,
}))

vi.mock('@/lib/webhooks/slack-agent-api', () => ({
  appendSlackAgentStream: mockAppendSlackAgentStream,
  formatSlackApiFailure: (error: unknown) => toError(error),
  setSlackAgentSessionStatus: mockSetSlackAgentSessionStatus,
  startSlackAgentStream: mockStartSlackAgentStream,
  stopSlackAgentStream: mockStopSlackAgentStream,
}))

vi.mock('@/lib/webhooks/slack-stream-sessions', () => ({
  registerSlackStreamSession: mockRegisterSlackStreamSession,
  unregisterSlackStreamSession: mockUnregisterSlackStreamSession,
}))

import { SlackExecutionStreamController } from '@/lib/webhooks/slack-execution-stream'
import type { SlackStreamResponseConfig } from '@/lib/webhooks/slack-stream-config'
import type { AgentStreamEvent } from '@/providers/stream-events'

const BASE_CONFIG: SlackStreamResponseConfig = {
  enabled: true,
  outputConfigs: [{ blockId: 'agent', path: 'content' }],
  includeThinking: true,
  includeToolCalls: true,
  taskTitle: 'Running',
  taskDisplayMode: 'plan',
}

function createLoggingSession() {
  return {
    projectLiveDisplayText: vi.fn(async (_key: string, text: string) => ({
      chunk: text,
    })),
    projectDisplayContent: vi.fn(async (content: Record<string, unknown>) => content),
  }
}

function createByteStream(text = ''): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      if (text) controller.enqueue(new TextEncoder().encode(text))
      controller.close()
    },
  })
}

function createOpenByteStream(): {
  stream: ReadableStream<Uint8Array>
  close: () => void
} {
  let closeStream: (() => void) | undefined
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      closeStream = () => controller.close()
    },
  })
  return {
    stream,
    close: () => {
      if (!closeStream) throw new Error('Test stream was not initialized')
      closeStream()
    },
  }
}

async function createController(
  config: SlackStreamResponseConfig = BASE_CONFIG,
  triggerInput: Record<string, unknown> = {
    event: {
      channel: 'C123',
      thread_ts: '1700000000.000001',
      user: 'U123',
      user_team_id: 'T123',
    },
  },
  abortSignal?: AbortSignal
) {
  const loggingSession = createLoggingSession()
  const controller = await SlackExecutionStreamController.create({
    credentialId: 'cred-1',
    workspaceId: 'workspace-1',
    workflowId: 'workflow-1',
    executionId: 'execution-1',
    userId: 'user-1',
    triggerInput,
    config,
    loggingSession: loggingSession as never,
    abortSignal,
  })
  return { controller, loggingSession }
}

describe('SlackExecutionStreamController', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSlackBotCredential.mockResolvedValue({
      botToken: 'xoxb-token',
      workspaceId: 'workspace-1',
    })
    mockStartSlackAgentStream.mockResolvedValue({
      channel: 'C123',
      ts: '1700000001.000002',
    })
  })

  describe('custom block public fields', () => {
    const config: SlackStreamResponseConfig = {
      ...BASE_CONFIG,
      outputConfigs: [
        { blockId: 'custom', path: 'answer' },
        { blockId: 'custom', path: 'summary' },
      ],
    }
    const completion = {
      output: { success: true, answer: 'Live answer', summary: 'Final summary' },
      executionTime: 10,
      startedAt: '2026-01-01T00:00:00.000Z',
      endedAt: '2026-01-01T00:00:00.010Z',
      executionOrder: 4,
      childWorkflowInstanceId: 'custom-invocation',
    }

    it('waits for custom completion, then sends other selected fields without duplicating the answer', async () => {
      const { controller } = await createController(config)
      await controller.callbacks.onStream?.({
        blockId: 'custom',
        outputPath: 'answer',
        streamId: 'answer-stream',
        childWorkflowInstanceId: 'custom-invocation',
        executionOrder: 4,
        stream: createByteStream('Live answer'),
        streamFormat: 'text',
        execution: { success: true, output: {} },
      })
      expect(mockAppendSlackAgentStream.mock.calls.flatMap((call) => call[3])).toContainEqual({
        type: 'markdown_text',
        text: 'Live answer',
      })
      expect(mockStopSlackAgentStream).not.toHaveBeenCalled()

      await controller.callbacks.onBlockComplete?.(
        'custom',
        'Published block',
        'custom_block_abc',
        completion
      )
      const chunks = mockAppendSlackAgentStream.mock.calls.flatMap((call) => call[3])
      expect(chunks.filter((chunk) => chunk.type === 'markdown_text')).toEqual([
        { type: 'markdown_text', text: 'Live answer' },
        { type: 'markdown_text', text: 'Final summary' },
      ])
      expect(mockStopSlackAgentStream).toHaveBeenCalledTimes(2)
      controller.assertSucceeded()
    })

    it('keeps repeated source streams and custom invocations separate', async () => {
      const { controller } = await createController(config)
      for (const instance of ['first', 'second']) {
        for (const iteration of [1, 2]) {
          await controller.callbacks.onStream?.({
            blockId: 'custom',
            outputPath: 'answer',
            streamId: `${instance}-${iteration}`,
            childWorkflowInstanceId: instance,
            executionOrder: 4,
            stream: createByteStream(`${instance} ${iteration}`),
            execution: { success: true, output: {} },
          })
        }
        await controller.callbacks.onBlockComplete?.(
          'custom',
          'Published block',
          'custom_block_abc',
          { ...completion, childWorkflowInstanceId: instance }
        )
      }
      expect(mockStartSlackAgentStream).toHaveBeenCalledTimes(6)
      const taskIds = mockStartSlackAgentStream.mock.calls.map((call) => call[2][0].id)
      expect(new Set(taskIds).size).toBe(6)
      controller.assertSucceeded()
    })

    it('marks streamed output as failed if the custom block fails after the source ends', async () => {
      const { controller } = await createController(config)
      await controller.callbacks.onStream?.({
        blockId: 'custom',
        outputPath: 'answer',
        streamId: 'answer-stream',
        childWorkflowInstanceId: 'custom-invocation',
        executionOrder: 4,
        stream: createByteStream('Partial answer'),
        execution: { success: true, output: {} },
      })
      await controller.finalize({ success: false, output: {}, error: 'Custom block failed' })
      const tasks = mockAppendSlackAgentStream.mock.calls
        .flatMap((call) => call[3])
        .filter((chunk) => chunk.type === 'task_update')
      expect(tasks.map((task) => task.status)).toEqual(['error'])
      expect(mockStopSlackAgentStream).toHaveBeenCalledOnce()
    })

    it('settles an error-port completion as failed even without a success flag', async () => {
      const { controller } = await createController(config)
      await controller.callbacks.onStream?.({
        blockId: 'custom',
        outputPath: 'answer',
        streamId: 'answer-stream',
        childWorkflowInstanceId: 'custom-invocation',
        executionOrder: 4,
        stream: createByteStream('Partial answer'),
        execution: { success: true, output: {} },
      })
      await controller.callbacks.onBlockComplete?.(
        'custom',
        'Published block',
        'custom_block_abc',
        {
          ...completion,
          output: { error: 'Custom block execution failed', errorType: 'execution_failed' },
        }
      )
      const tasks = mockAppendSlackAgentStream.mock.calls
        .flatMap((call) => call[3])
        .filter((chunk) => chunk.type === 'task_update')
      expect(tasks.map((task) => task.status)).toEqual(['error'])
      expect(mockStopSlackAgentStream).toHaveBeenCalledOnce()
    })

    it('closes a partial message after a delivery failure while still reporting the failure', async () => {
      const { controller } = await createController(config)
      mockAppendSlackAgentStream.mockRejectedValueOnce(new Error('Slack unavailable'))
      await expect(
        controller.callbacks.onStream?.({
          blockId: 'custom',
          outputPath: 'answer',
          streamId: 'answer-stream',
          childWorkflowInstanceId: 'custom-invocation',
          executionOrder: 4,
          stream: createByteStream('Partial answer'),
          execution: { success: true, output: {} },
        })
      ).rejects.toThrow('Slack unavailable')
      await controller.finalize({ success: false, output: {} })
      expect(mockStopSlackAgentStream).toHaveBeenCalledOnce()
      expect(() => controller.assertSucceeded()).toThrow('Slack unavailable')
    })

    it('closes an already streamed message when the parent run is cancelled', async () => {
      const abortController = new AbortController()
      const { controller } = await createController(config, undefined, abortController.signal)
      await controller.callbacks.onStream?.({
        blockId: 'custom',
        outputPath: 'answer',
        streamId: 'answer-stream',
        childWorkflowInstanceId: 'custom-invocation',
        executionOrder: 4,
        stream: createByteStream('Partial answer'),
        execution: { success: true, output: {} },
      })
      abortController.abort()
      await controller.finalize({ success: false, status: 'cancelled', output: {} })
      expect(mockStopSlackAgentStream).toHaveBeenCalledWith(
        'xoxb-token',
        'C123',
        '1700000001.000002',
        'processing',
        undefined
      )
      controller.assertSucceeded()
    })

    it('rejects an unselected public field before opening a Slack message', async () => {
      const { controller } = await createController(config)
      await expect(
        controller.callbacks.onStream?.({
          blockId: 'custom',
          outputPath: 'private',
          streamId: 'answer-stream',
          childWorkflowInstanceId: 'custom-invocation',
          executionOrder: 4,
          stream: createByteStream('Hidden'),
          execution: { success: true, output: {} },
        })
      ).rejects.toThrow('unselected Slack output')
      expect(mockStartSlackAgentStream).not.toHaveBeenCalled()
    })
  })

  it('streams agent text and task events for each selected invocation', async () => {
    const { controller } = await createController()
    const events: AgentStreamEvent[] = [
      { type: 'thinking_delta', text: 'Checking context' },
      { type: 'tool_call_start', id: 'tool-1', name: 'slack_send_message' },
      {
        type: 'tool_call_end',
        id: 'tool-1',
        name: 'slack_send_message',
        status: 'success',
      },
      { type: 'tool_call_start', id: 'tool-2', name: 'mcp-6da535c1-ask_question' },
      {
        type: 'tool_call_end',
        id: 'tool-2',
        name: 'mcp-6da535c1-ask_question',
        status: 'success',
      },
      { type: 'text_delta', text: 'Hello ', turn: 'pending' },
      { type: 'text_delta', text: 'world', turn: 'pending' },
      { type: 'turn_end', turn: 'final' },
    ]

    await controller.callbacks.onStream?.({
      blockId: 'agent',
      executionOrder: 4,
      stream: createByteStream(),
      streamFormat: 'text',
      clientStreamTransformed: false,
      subscribe: ({ onEvent }) => {
        for (const event of events) void onEvent(event)
        return vi.fn()
      },
    })

    expect(controller.selectedOutputs).toEqual(['agent_content'])
    expect(mockRegisterSlackStreamSession).toHaveBeenCalledWith(
      'cred-1',
      {
        channel: 'C123',
        threadTs: '1700000000.000001',
        initiatorUserId: 'U123',
        recipientUserId: 'U123',
        recipientTeamId: 'T123',
      },
      {
        executionId: 'execution-1',
        workflowId: 'workflow-1',
        userId: 'user-1',
        workspaceId: 'workspace-1',
      }
    )
    expect(mockStartSlackAgentStream).toHaveBeenCalledWith(
      'xoxb-token',
      {
        channel: 'C123',
        threadTs: '1700000000.000001',
        initiatorUserId: 'U123',
        recipientUserId: 'U123',
        recipientTeamId: 'T123',
      },
      [
        {
          type: 'task_update',
          id: 'sim-execution-1-4',
          title: 'Running',
          status: 'in_progress',
        },
      ],
      'plan',
      undefined
    )
    const appendedChunks = mockAppendSlackAgentStream.mock.calls.flatMap((call) => call[3])
    expect(appendedChunks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'task_update',
          title: 'Thinking',
          status: 'complete',
        }),
        expect.objectContaining({
          type: 'task_update',
          title: 'Slack Send Message',
          status: 'in_progress',
        }),
        expect.objectContaining({
          type: 'task_update',
          title: 'Slack Send Message',
          status: 'complete',
        }),
        expect.objectContaining({
          type: 'task_update',
          title: 'Ask Question',
          status: 'in_progress',
        }),
        expect.objectContaining({
          type: 'task_update',
          title: 'Ask Question',
          status: 'complete',
        }),
        { type: 'markdown_text', text: 'Hello ' },
        { type: 'markdown_text', text: 'world' },
        expect.objectContaining({
          type: 'task_update',
          id: 'sim-execution-1-4',
          status: 'complete',
        }),
      ])
    )
    expect(mockStopSlackAgentStream).toHaveBeenCalledWith(
      'xoxb-token',
      'C123',
      '1700000001.000002',
      'processing',
      undefined
    )

    await controller.finalize({
      success: true,
      output: {},
      status: 'completed',
    })
    controller.assertSucceeded()

    expect(mockSetSlackAgentSessionStatus).toHaveBeenLastCalledWith(
      'xoxb-token',
      {
        channel: 'C123',
        threadTs: '1700000000.000001',
        initiatorUserId: 'U123',
        recipientUserId: 'U123',
        recipientTeamId: 'T123',
      },
      'active'
    )
    expect(mockUnregisterSlackStreamSession).toHaveBeenCalledWith(
      'cred-1',
      {
        channel: 'C123',
        threadTs: '1700000000.000001',
        initiatorUserId: 'U123',
        recipientUserId: 'U123',
        recipientTeamId: 'T123',
      },
      'execution-1'
    )
  })

  it('appends pending answer text before the model turn is classified', async () => {
    const { controller } = await createController()
    const { stream, close } = createOpenByteStream()
    const streaming = controller.callbacks.onStream?.({
      blockId: 'agent',
      executionOrder: 5,
      stream,
      streamFormat: 'text',
      clientStreamTransformed: false,
      subscribe: ({ onEvent }) => {
        void onEvent({
          type: 'text_delta',
          text: 'Once upon a time',
          turn: 'pending',
        })
        return vi.fn()
      },
    })

    await vi.waitFor(() => {
      expect(mockAppendSlackAgentStream).toHaveBeenCalledWith(
        'xoxb-token',
        'C123',
        '1700000001.000002',
        [{ type: 'markdown_text', text: 'Once upon a time' }],
        undefined
      )
    })
    expect(mockStopSlackAgentStream).not.toHaveBeenCalled()

    close()
    await streaming
  })

  it('streams transformed answer text with tool and thinking events from the event sink', async () => {
    const { controller } = await createController()
    const events: AgentStreamEvent[] = [
      { type: 'thinking_delta', text: 'Checking Gmail' },
      { type: 'tool_call_start', id: 'tool-1', name: 'gmail_send_email' },
      {
        type: 'tool_call_end',
        id: 'tool-1',
        name: 'gmail_send_email',
        status: 'success',
      },
      { type: 'text_delta', text: 'Unselected structured response', turn: 'pending' },
      { type: 'turn_end', turn: 'final' },
    ]

    const subscribe = vi.fn(({ onEvent }) => {
      for (const event of events) void onEvent(event)
      return vi.fn()
    })

    await controller.callbacks.onStream?.({
      blockId: 'agent',
      executionOrder: 6,
      stream: createByteStream('Selected answer'),
      streamFormat: 'text',
      clientStreamTransformed: true,
      subscribe,
    })

    expect(subscribe).toHaveBeenCalledOnce()
    const appendedChunks = mockAppendSlackAgentStream.mock.calls.flatMap((call) => call[3])
    expect(appendedChunks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'task_update',
          title: 'Thinking',
          status: 'complete',
        }),
        expect.objectContaining({
          type: 'task_update',
          title: 'Gmail Send Email',
          status: 'in_progress',
        }),
        expect.objectContaining({
          type: 'task_update',
          title: 'Gmail Send Email',
          status: 'complete',
        }),
        { type: 'markdown_text', text: 'Selected answer' },
      ])
    )
    expect(appendedChunks).not.toContainEqual({
      type: 'markdown_text',
      text: 'Unselected structured response',
    })
  })

  it('sends a selected nested non-streaming output after block completion', async () => {
    const config: SlackStreamResponseConfig = {
      ...BASE_CONFIG,
      outputConfigs: [{ workflowId: 'child-workflow', blockId: 'lookup', path: 'result.name' }],
    }
    const { controller } = await createController(config, {
      event: { channel: 'D123', timestamp: '1700000000.000001', user: 'U123' },
    })

    await controller.callbacks.onBlockComplete?.('lookup', 'Lookup', 'generic', {
      output: { result: { name: 'Ada' } },
      executionTime: 10,
      startedAt: '2026-08-31T00:00:00.000Z',
      executionOrder: 7,
      endedAt: '2026-08-31T00:00:00.010Z',
      outputBlockId: 'child-workflow.lookup',
      childWorkflowInstanceId: 'child-instance-1',
    })

    expect(mockStartSlackAgentStream).toHaveBeenCalledWith(
      'xoxb-token',
      {
        channel: 'D123',
        threadTs: '1700000000.000001',
        initiatorUserId: 'U123',
      },
      expect.any(Array),
      'plan',
      undefined
    )
    expect(mockAppendSlackAgentStream).toHaveBeenCalledWith(
      'xoxb-token',
      'C123',
      '1700000001.000002',
      [{ type: 'markdown_text', text: 'Ada' }],
      undefined
    )
  })

  it('keeps repeated invocations of the same child workflow distinct', async () => {
    const config: SlackStreamResponseConfig = {
      ...BASE_CONFIG,
      outputConfigs: [{ workflowId: 'child-workflow', blockId: 'agent', path: 'content' }],
    }
    const { controller } = await createController(config, {
      event: { channel: 'D123', timestamp: '1700000000.000001', user: 'U123' },
    })

    for (const childWorkflowInstanceId of ['child-instance-1', 'child-instance-2']) {
      await controller.callbacks.onStream?.({
        blockId: 'child-workflow.agent',
        childWorkflowInstanceId,
        executionOrder: 1,
        stream: createByteStream(childWorkflowInstanceId),
        execution: { success: true, output: {} },
      })
    }

    expect(mockStartSlackAgentStream).toHaveBeenCalledTimes(2)
    expect(() => controller.assertSucceeded()).not.toThrow()
  })

  it('rejects credentials that do not belong to the workflow workspace', async () => {
    mockGetSlackBotCredential.mockResolvedValue({
      botToken: 'xoxb-token',
      workspaceId: 'workspace-2',
    })

    await expect(createController()).rejects.toThrow(
      'Slack streaming credential is unavailable in this workspace'
    )
    expect(mockRegisterSlackStreamSession).not.toHaveBeenCalled()
  })
})
