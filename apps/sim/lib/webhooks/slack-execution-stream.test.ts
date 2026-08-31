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
  taskDisplayMode: 'plan',
}

function createLoggingSession() {
  return {
    projectLiveDisplayText: vi.fn(async (_key: string, text: string) => ({ chunk: text })),
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
    vi.clearAllMocks()
    mockGetSlackBotCredential.mockResolvedValue({
      botToken: 'xoxb-token',
      workspaceId: 'workspace-1',
    })
    mockStartSlackAgentStream.mockResolvedValue({ channel: 'C123', ts: '1700000001.000002' })
  })

  it('streams agent text and task events for each selected invocation', async () => {
    const { controller } = await createController()
    const events: AgentStreamEvent[] = [
      { type: 'thinking_delta', text: 'Checking context' },
      { type: 'tool_call_start', id: 'tool-1', name: 'Search' },
      { type: 'tool_call_end', id: 'tool-1', name: 'Search', status: 'success' },
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
        recipientUserId: 'U123',
        recipientTeamId: 'T123',
      },
      [
        {
          type: 'task_update',
          id: 'sim-execution-1-4',
          title: 'Generating agent',
          status: 'in_progress',
        },
      ],
      'plan',
      undefined
    )
    const appendedChunks = mockAppendSlackAgentStream.mock.calls.flatMap((call) => call[3])
    expect(appendedChunks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'task_update', title: 'Thinking', status: 'complete' }),
        expect.objectContaining({
          type: 'task_update',
          title: 'Search',
          status: 'in_progress',
        }),
        expect.objectContaining({ type: 'task_update', title: 'Search', status: 'complete' }),
        { type: 'markdown_text', text: 'Hello world' },
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

    await controller.finalize({ success: true, output: {}, status: 'completed' })
    controller.assertSucceeded()

    expect(mockSetSlackAgentSessionStatus).toHaveBeenLastCalledWith(
      'xoxb-token',
      {
        channel: 'C123',
        threadTs: '1700000000.000001',
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
        recipientUserId: 'U123',
        recipientTeamId: 'T123',
      },
      'execution-1'
    )
  })

  it('sends selected non-streaming outputs after block completion', async () => {
    const config: SlackStreamResponseConfig = {
      ...BASE_CONFIG,
      outputConfigs: [{ blockId: 'lookup', path: 'result.name' }],
    }
    const { controller } = await createController(config, {
      event: { channel: 'D123', timestamp: '1700000000.000001' },
    })

    await controller.callbacks.onBlockComplete?.('lookup', 'Lookup', 'generic', {
      output: { result: { name: 'Ada' } },
      executionTime: 10,
      startedAt: '2026-08-31T00:00:00.000Z',
      executionOrder: 7,
      endedAt: '2026-08-31T00:00:00.010Z',
    })

    expect(mockStartSlackAgentStream).toHaveBeenCalledWith(
      'xoxb-token',
      { channel: 'D123', threadTs: '1700000000.000001' },
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
