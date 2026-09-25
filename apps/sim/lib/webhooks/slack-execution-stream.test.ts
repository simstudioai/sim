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

import type { SlackStreamChunk } from '@/lib/webhooks/slack-agent-api'
import { SlackDeliveryError } from '@/lib/webhooks/slack-delivery-error'
import { SlackExecutionStreamController } from '@/lib/webhooks/slack-execution-stream'
import type { SlackStreamResponseConfig } from '@/lib/webhooks/slack-stream-config'
import { type AgentStreamEvent, createAgentEventReadableStream } from '@/providers/stream-events'
import { createAgentStreamPump } from '@/providers/stream-pump'

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
    projectLiveDisplayText: vi.fn(
      async (_key: string, text: string): Promise<Record<string, unknown>> => ({ chunk: text })
    ),
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

async function createController(
  config: SlackStreamResponseConfig = BASE_CONFIG,
  triggerInput: Record<string, unknown> = {
    event: {
      channel: 'C123',
      thread_ts: '1700000000.000001',
      user: 'U123',
      user_team_id: 'T123',
    },
  }
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
  })
  return { controller, loggingSession }
}

describe('SlackExecutionStreamController', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockGetSlackBotCredential.mockResolvedValue({
      botToken: 'xoxb-token',
      workspaceId: 'workspace-1',
    })
    mockStartSlackAgentStream.mockResolvedValue({
      channel: 'C123',
      ts: '1700000001.000002',
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
    await controller.finalize({ success: true, status: 'completed', output: {} })
    const appendedChunks = [
      ...mockAppendSlackAgentStream.mock.calls.flatMap((call) => call[3]),
      ...mockStopSlackAgentStream.mock.calls.flatMap((call) => call[6] ?? []),
    ]
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
      undefined,
      undefined,
      expect.any(Array)
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
    expect(() => controller.assertSucceeded()).toThrow('not been finalized')
    await controller.finalize({ success: true, output: {} })
    expect(() => controller.assertSucceeded()).not.toThrow()
  })

  async function deliver(events: AgentStreamEvent[], finalText: string, config = BASE_CONFIG) {
    const { controller, loggingSession } = await createController(config)
    const pump = createAgentStreamPump({
      source: createAgentEventReadableStream(events),
      streamFormat: 'agent-events-v1',
    })
    const streamed = controller.callbacks.onStream?.({
      blockId: 'agent',
      executionOrder: 1,
      stream: pump.textStream!,
      subscribe: pump.subscribe,
    })
    await Promise.all([streamed, pump.run()])
    await controller.callbacks.onBlockComplete?.('agent', 'Agent', 'agent', {
      output: { content: finalText },
      executionOrder: 1,
      executionTime: 1,
      startedAt: '2026-09-21T00:00:00Z',
      endedAt: '2026-09-21T00:00:01Z',
    })
    await controller.finalize({
      success: true,
      output: { content: finalText },
      status: 'completed',
    })
    return { controller, loggingSession }
  }

  function sentText(): string {
    return [
      ...mockStartSlackAgentStream.mock.calls.map((call, index) => ({
        order: mockStartSlackAgentStream.mock.invocationCallOrder[index],
        chunks: call[2],
      })),
      ...mockAppendSlackAgentStream.mock.calls.map((call, index) => ({
        order: mockAppendSlackAgentStream.mock.invocationCallOrder[index],
        chunks: call[3],
      })),
    ]
      .sort((a, b) => a.order - b.order)
      .flatMap((call) => call.chunks)
      .filter((chunk) => chunk.type === 'markdown_text')
      .map((chunk) => chunk.text)
      .join('')
  }

  function enforceSlackMessageLimit(limit = 12_000) {
    const messages = new Map<
      string,
      { text: string; chunks: SlackStreamChunk[]; stopped: boolean }
    >()
    mockStartSlackAgentStream.mockImplementation(async (_token, _target, chunks) => {
      const text = chunks
        .filter((chunk: SlackStreamChunk) => chunk.type === 'markdown_text')
        .map((chunk: SlackStreamChunk) => (chunk.type === 'markdown_text' ? chunk.text : ''))
        .join('')
      if (text.length > limit) {
        throw new SlackDeliveryError('chat.startStream', 'rejected', 'msg_too_long', 200)
      }
      expect(text.isWellFormed()).toBe(true)
      const ts = `message-${messages.size}`
      messages.set(ts, { text, chunks: [...chunks], stopped: false })
      return { channel: 'C123', ts }
    })
    mockAppendSlackAgentStream.mockImplementation(
      async (_token, _channel, ts: string, chunks: SlackStreamChunk[]) => {
        const message = messages.get(ts)!
        if (message.stopped) throw new Error('message_not_in_streaming_state')
        const text = chunks
          .filter((chunk) => chunk.type === 'markdown_text')
          .map((chunk) => chunk.text)
          .join('')
        if (message.text.length + text.length > limit) {
          throw new SlackDeliveryError('chat.appendStream', 'rejected', 'msg_too_long', 200)
        }
        expect(text.isWellFormed()).toBe(true)
        message.text += text
        message.chunks.push(...chunks)
      }
    )
    mockStopSlackAgentStream.mockImplementation(
      async (
        _token,
        _channel,
        ts: string,
        _status,
        _signal,
        _blocks,
        chunks: SlackStreamChunk[]
      ) => {
        const message = messages.get(ts)!
        expect(message.stopped).toBe(false)
        message.stopped = true
        message.chunks.push(...chunks)
      }
    )
    return messages
  }

  it.each(['live', 'settled'] as const)(
    'delivers a long %s answer across messages within Slack’s cumulative text limit',
    async (delivery) => {
      const answer = `${'x'.repeat(11_999)}🚀${'y'.repeat(17_000)}The complete ending.`
      const messages = enforceSlackMessageLimit()
      const { controller } = await deliver(
        delivery === 'live'
          ? [
              { type: 'text_delta', text: answer, turn: 'pending' },
              { type: 'turn_end', turn: 'final' },
            ]
          : [],
        answer
      )
      controller.assertSucceeded()
      expect(sentText()).toBe(answer)
      expect([...messages.values()].map((message) => message.text).join('')).toBe(answer)
      expect([...messages.values()].every((message) => message.stopped)).toBe(true)
      expect(mockStartSlackAgentStream).toHaveBeenCalledTimes(3)
      expect(mockStopSlackAgentStream).toHaveBeenCalledTimes(3)
      expect(mockStopSlackAgentStream.mock.calls.map((call) => call[2])).toEqual([
        ...messages.keys(),
      ])
      for (const call of mockStartSlackAgentStream.mock.calls) {
        expect(call[1]).toMatchObject({ channel: 'C123', threadTs: '1700000000.000001' })
      }
    }
  )

  it('continues a definitively rejected 11938 + 62 boundary append without replaying accepted text', async () => {
    const messages = enforceSlackMessageLimit(11_999)
    const prefix = `${'a'.repeat(11_937)} `
    const suffix = `${'b'.repeat(61)} ${'b'.repeat(2_938)}Complete ending.`
    const { controller } = await deliver(
      [
        { type: 'tool_call_start', id: 'read', name: 'read' },
        { type: 'text_delta', text: prefix, turn: 'pending' },
        { type: 'text_delta', text: suffix, turn: 'pending' },
        { type: 'tool_call_end', id: 'read', name: 'read', status: 'success' },
        { type: 'turn_end', turn: 'final' },
      ],
      prefix + suffix
    )
    controller.assertSucceeded()
    expect([...messages.values()].map((message) => message.text)).toEqual([prefix, suffix])
    const rejected = mockAppendSlackAgentStream.mock.calls.filter(
      (call) =>
        call[2] === 'message-0' &&
        call[3].some(
          (chunk: SlackStreamChunk) =>
            chunk.type === 'markdown_text' && chunk.text === suffix.slice(0, 62)
        )
    )
    expect(rejected).toHaveLength(1)
    expect([...messages.values()].every((message) => message.stopped)).toBe(true)
    const toolChunks = messages
      .get('message-0')!
      .chunks.filter((chunk) => chunk.type === 'task_update' && chunk.id.endsWith('-tool-read'))
    expect(toolChunks.map((chunk) => chunk.status)).toEqual(['in_progress', 'complete'])
  })

  it('keeps a word split across live deltas together when continuing to another reply', async () => {
    const messages = enforceSlackMessageLimit()
    const prefix = `${'Calm seas. '.repeat(1_090)}Mara `
    const { controller } = await deliver(
      [
        { type: 'tool_call_start', id: 'read', name: 'read' },
        { type: 'text_delta', text: `${prefix}lau`, turn: 'pending' },
        { type: 'text_delta', text: 'gh', turn: 'pending' },
        { type: 'text_delta', text: 'ed once, sharply, with relief.', turn: 'pending' },
        { type: 'tool_call_end', id: 'read', name: 'read', status: 'success' },
        { type: 'turn_end', turn: 'final' },
      ],
      `${prefix}laughed once, sharply, with relief.`
    )
    controller.assertSucceeded()
    const parts = [...messages.values()]
    expect(parts.map((part) => part.text)).toEqual([prefix, 'laughed once, sharply, with relief.'])
    expect(parts[1].chunks.every((chunk) => chunk.type === 'markdown_text')).toBe(true)
    expect(parts.every((part) => part.stopped)).toBe(true)
    expect(parts[0].chunks.filter((chunk) => chunk.type === 'task_update')).toEqual([
      expect.objectContaining({ title: 'Running', status: 'in_progress' }),
      expect.objectContaining({ id: 'sim-execution-1-1-tool-read', status: 'in_progress' }),
      expect.objectContaining({ id: 'sim-execution-1-1-tool-read', status: 'complete' }),
      expect.objectContaining({ title: 'Running', status: 'complete' }),
    ])
  })

  it('reduces a definitively oversized first append and still delivers all final-only text', async () => {
    const messages = enforceSlackMessageLimit(11_999)
    const answer = '🚀'.repeat(13_000)
    const { controller } = await deliver([], answer)
    controller.assertSucceeded()
    expect([...messages.values()].map((message) => message.text).join('')).toBe(answer)
    expect([...messages.values()].every((message) => message.text && message.stopped)).toBe(true)
  })

  it.each([
    new SlackDeliveryError('chat.appendStream', 'uncertain', 'msg_too_long'),
    new SlackDeliveryError('chat.appendStream', 'rejected', 'ratelimited', 429),
    new SlackDeliveryError('chat.appendStream', 'rejected', 'missing_scope', 200),
  ])('does not replay ambiguous or non-size append errors: %s', async (error) => {
    const messages = enforceSlackMessageLimit()
    mockAppendSlackAgentStream.mockRejectedValueOnce(error)
    const { controller } = await deliver([{ type: 'text_delta', text: 'answer' }], 'answer')
    expect(() => controller.assertSucceeded()).toThrow(error)
    expect(mockAppendSlackAgentStream).toHaveBeenCalledTimes(1)
    expect(mockStartSlackAgentStream).toHaveBeenCalledTimes(1)
    expect(messages.get('message-0')!.stopped).toBe(true)
  })

  it('bounds size recovery when even a single character is rejected', async () => {
    const messages = enforceSlackMessageLimit(0)
    const { controller } = await deliver([], 'abcd')
    expect(() => controller.assertSucceeded()).toThrow('msg_too_long')
    expect(mockAppendSlackAgentStream.mock.calls.map((call) => call[3])).toEqual([
      [{ type: 'markdown_text', text: 'abcd' }],
      [{ type: 'markdown_text', text: 'ab' }],
      [{ type: 'markdown_text', text: 'a' }],
    ])
    expect(mockStartSlackAgentStream).toHaveBeenCalledTimes(1)
    expect(messages.get('message-0')!.stopped).toBe(true)
  })

  it('stops recovery if the continuation start has an uncertain outcome', async () => {
    const messages = enforceSlackMessageLimit()
    const prefix = `${'a'.repeat(11_937)} `
    mockStartSlackAgentStream
      .mockImplementationOnce(mockStartSlackAgentStream.getMockImplementation()!)
      .mockRejectedValueOnce(
        new SlackDeliveryError('chat.startStream', 'uncertain', 'transport_failed')
      )
    mockAppendSlackAgentStream
      .mockImplementationOnce(async () => {
        messages.get('message-0')!.text = prefix
      })
      .mockRejectedValueOnce(
        new SlackDeliveryError('chat.appendStream', 'rejected', 'msg_too_long')
      )
    const suffix = `${'b'.repeat(61)} ${'b'.repeat(88)}`
    const { controller } = await deliver(
      [
        { type: 'text_delta', text: prefix, turn: 'pending' },
        { type: 'text_delta', text: suffix, turn: 'pending' },
      ],
      prefix + suffix
    )
    expect(() => controller.assertSucceeded()).toThrow('transport_failed')
    expect(mockAppendSlackAgentStream).toHaveBeenCalledTimes(2)
    expect(mockStartSlackAgentStream).toHaveBeenCalledTimes(2)
    expect([...messages.values()].every((message) => message.stopped)).toBe(true)
  })

  it('cleans up every continuation on cancellation and marks tools on the right message', async () => {
    const messages = enforceSlackMessageLimit()
    const { controller } = await createController()
    const pump = createAgentStreamPump({
      source: createAgentEventReadableStream([
        { type: 'tool_call_start', id: 'running', name: 'read' },
        { type: 'text_delta', text: 'a'.repeat(25_000), turn: 'pending' },
      ]),
      streamFormat: 'agent-events-v1',
    })
    await Promise.all([
      controller.callbacks.onStream?.({
        blockId: 'agent',
        executionOrder: 1,
        stream: pump.textStream!,
        subscribe: pump.subscribe,
      }),
      pump.run(),
    ])
    await controller.finalize({ success: false, status: 'cancelled', output: {} })
    expect(messages.size).toBe(3)
    expect([...messages.values()].every((message) => message.stopped)).toBe(true)
    const toolStops = mockStopSlackAgentStream.mock.calls.filter((call) =>
      call[6].some(
        (chunk: SlackStreamChunk) =>
          chunk.type === 'task_update' && chunk.id.endsWith('-tool-running')
      )
    )
    expect(toolStops).toHaveLength(1)
    expect(toolStops[0][2]).toBe('message-0')
    expect(toolStops[0][6][0].status).toBe('error')
    expect(mockUnregisterSlackStreamSession).toHaveBeenCalledTimes(1)
  })

  it('still stops the remaining messages when one continuation stop fails', async () => {
    const messages = enforceSlackMessageLimit()
    mockStopSlackAgentStream.mockRejectedValueOnce(new Error('stop outcome uncertain'))
    const { controller } = await deliver([], 'a'.repeat(25_000))
    expect(() => controller.assertSucceeded()).toThrow('stop outcome uncertain')
    expect(mockStopSlackAgentStream.mock.calls.map((call) => call[2])).toEqual([...messages.keys()])
    expect(messages.get('message-1')!.stopped).toBe(true)
    expect(messages.get('message-2')!.stopped).toBe(true)
    expect(mockSetSlackAgentSessionStatus.mock.calls.at(-1)?.[2]).toBe('suspended')
    await controller.finalize({ success: true, output: {} })
    expect(mockStopSlackAgentStream).toHaveBeenCalledTimes(3)
  })

  it('does not retry an uncertain continuation start or duplicate the first part', async () => {
    const messages = enforceSlackMessageLimit()
    mockStartSlackAgentStream
      .mockImplementationOnce(async (_token, _target, chunks) => {
        messages.set('message-0', { text: '', chunks, stopped: false })
        return { channel: 'C123', ts: 'message-0' }
      })
      .mockRejectedValueOnce(new Error('continuation start outcome uncertain'))
    const { controller } = await deliver([], 'a'.repeat(25_000))
    expect(() => controller.assertSucceeded()).toThrow('continuation start outcome uncertain')
    expect(mockStartSlackAgentStream).toHaveBeenCalledTimes(2)
    expect(messages.get('message-0')!.text).toBe('a'.repeat(12_000))
    expect(messages.get('message-0')!.stopped).toBe(true)
  })

  it('does not replay acknowledged long-answer chunks after a later append fails', async () => {
    const messages = enforceSlackMessageLimit()
    mockAppendSlackAgentStream.mockImplementationOnce(
      mockAppendSlackAgentStream.getMockImplementation()!
    )
    mockAppendSlackAgentStream.mockRejectedValueOnce(new Error('append acknowledgment lost'))
    const answer = `${'x'.repeat(25_000)}The complete ending.`
    const { controller } = await deliver(
      [
        { type: 'text_delta', text: answer, turn: 'pending' },
        { type: 'turn_end', turn: 'final' },
      ],
      answer
    )
    expect(() => controller.assertSucceeded()).toThrow('append acknowledgment lost')
    expect(mockAppendSlackAgentStream).toHaveBeenCalledTimes(2)
    expect(mockAppendSlackAgentStream.mock.calls.map((call) => call[3])).toEqual([
      [{ type: 'markdown_text', text: answer.slice(0, 12_000) }],
      [{ type: 'markdown_text', text: 'ending.' }],
    ])
    expect([...messages.values()].map((message) => message.text).join('')).toBe(
      answer.slice(0, -'ending.'.length)
    )
    expect(mockStartSlackAgentStream).toHaveBeenCalledTimes(3)
    expect(mockStopSlackAgentStream).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      'suspended',
      undefined,
      undefined,
      [expect.objectContaining({ status: 'error' })]
    )
  })

  it('reconciles a settled suffix without duplicating acknowledged text', async () => {
    const { controller } = await deliver(
      [
        { type: 'text_delta', text: 'Hello ', turn: 'pending' },
        { type: 'turn_end', turn: 'final' },
      ],
      'Hello world. The end.'
    )
    expect(sentText()).toBe('Hello world. The end.')
    expect(mockStartSlackAgentStream).toHaveBeenCalledTimes(1)
    controller.assertSucceeded()
  })

  it('preserves an append failure and stops outstanding tasks without replaying text or actions', async () => {
    const failure = new Error('acknowledgment unreadable')
    mockAppendSlackAgentStream.mockResolvedValueOnce(undefined).mockRejectedValueOnce(failure)
    const { controller } = await deliver(
      [
        { type: 'tool_call_start', id: 'a', name: 'read' },
        { type: 'text_delta', text: 'uncertain text', turn: 'pending' },
        { type: 'tool_call_end', id: 'a', name: 'read', status: 'success' },
        { type: 'text_delta', text: ' later text', turn: 'pending' },
        { type: 'turn_end', turn: 'final' },
      ],
      'uncertain text later text'
    )
    expect(mockAppendSlackAgentStream).toHaveBeenCalledTimes(2)
    expect(mockStartSlackAgentStream).toHaveBeenCalledTimes(1)
    expect(mockStopSlackAgentStream).toHaveBeenCalledExactlyOnceWith(
      'xoxb-token',
      'C123',
      '1700000001.000002',
      'suspended',
      undefined,
      undefined,
      [
        expect.objectContaining({ id: 'sim-execution-1-1-tool-a', status: 'error' }),
        expect.objectContaining({ id: 'sim-execution-1-1', status: 'error' }),
      ]
    )
    expect(() => controller.assertSucceeded()).toThrow(failure)
    expect(mockUnregisterSlackStreamSession).toHaveBeenCalledTimes(1)
    await controller.finalize({ success: true, output: {} })
    expect(mockStopSlackAgentStream).toHaveBeenCalledTimes(1)
  })

  it('settles a tool start whose append acknowledgment was lost', async () => {
    mockAppendSlackAgentStream.mockRejectedValueOnce(new Error('tool start outcome uncertain'))
    const { controller } = await deliver(
      [{ type: 'tool_call_start', id: 'uncertain', name: 'read' }],
      ''
    )
    expect(mockAppendSlackAgentStream).toHaveBeenCalledTimes(1)
    expect(mockStopSlackAgentStream.mock.calls[0][6]).toContainEqual(
      expect.objectContaining({ id: 'sim-execution-1-1-tool-uncertain', status: 'error' })
    )
    expect(() => controller.assertSucceeded()).toThrow('tool start outcome uncertain')
  })

  it('refuses a different settled answer instead of appending a duplicate replacement', async () => {
    const { controller } = await deliver(
      [{ type: 'text_delta', text: 'first answer' }],
      'different answer'
    )
    expect(sentText()).toBe('first answer')
    expect(() => controller.assertSucceeded()).toThrow('settled output differs')
    expect(mockStopSlackAgentStream).toHaveBeenCalledTimes(1)
  })

  it('reconciles only projected output when live provenance holds text for final redaction', async () => {
    const { controller, loggingSession } = await createController()
    loggingSession.projectLiveDisplayText.mockImplementation(async () => ({ chunk: undefined }))
    loggingSession.projectDisplayContent.mockResolvedValue({
      output: { content: 'Safe {{SECRET}}' },
    })
    await controller.callbacks.onStream?.({
      blockId: 'agent',
      executionOrder: 1,
      stream: createByteStream('Safe private-token'),
    })
    expect(mockAppendSlackAgentStream).not.toHaveBeenCalled()
    await controller.callbacks.onBlockComplete?.('agent', 'Agent', 'agent', {
      output: { content: 'Safe private-token' },
      executionOrder: 1,
      executionTime: 1,
      startedAt: 'start',
      endedAt: 'end',
    })
    await controller.finalize({ success: true, output: {} })
    expect(sentText()).toBe('Safe {{SECRET}}')
    expect(JSON.stringify(mockAppendSlackAgentStream.mock.calls)).not.toContain('private-token')
    controller.assertSucceeded()
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
