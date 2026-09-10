/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  start: vi.fn(),
  append: vi.fn(),
  stop: vi.fn(),
  status: vi.fn(),
  project: vi.fn(),
}))
vi.mock('@/lib/webhooks/slack-agent-api', () => ({
  startSlackAgentStream: api.start,
  appendSlackAgentStream: api.append,
  stopSlackAgentStream: api.stop,
  setSlackAgentSessionStatus: api.status,
}))
vi.mock('@/lib/copilot/chat/sim-key-redaction', () => ({
  redactSensitiveContent: (value: string) => value,
}))
vi.mock('@/executor/utils/resolved-secret-content-projection', () => ({
  projectResolvedSecretDiagnosticContent: api.project,
}))

import type {
  ToolCallStreamEvent,
  ToolResultStreamEvent,
} from '@/lib/copilot/request/session/contract'
import type { OrchestratorResult } from '@/lib/copilot/request/types'
import { publicSlackAnswer, SlackSearchAssistantStream } from '@/lib/slack-search/assistant-stream'
import type { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const result: OrchestratorResult = { success: true, content: '', contentBlocks: [], toolCalls: [] }
beforeEach(() => {
  vi.clearAllMocks()
  api.start.mockResolvedValue({ channel: 'D1', ts: '1.2' })
  api.project.mockImplementation((value: unknown) => ({ safe: true, value }))
})

function deliveredText() {
  return api.append.mock.calls
    .flatMap((call) => call[3])
    .map((chunk) => chunk.text)
    .join('')
}

function retrieval(
  results: Record<string, unknown>[],
  name = 'search_workspace',
  success = true
): OrchestratorResult['contentBlocks'][number] {
  return {
    type: 'tool_call',
    timestamp: 1,
    toolCall: {
      id: 'tool-1',
      name,
      status: success ? 'success' : 'error',
      result: { success, output: { data: { results } } },
    },
  }
}
function setup(deliverConnections = vi.fn().mockResolvedValue(undefined)) {
  const controller = new AbortController()
  const beforeDelivery = vi.fn().mockResolvedValue(undefined)
  const beforeCleanup = vi.fn().mockResolvedValue(undefined)
  const registry = {
    isComplete: () => true,
    getActiveMatches: () => [],
  } as unknown as ResolvedSecretTraceRegistry
  return {
    controller,
    beforeDelivery,
    beforeCleanup,
    stream: new SlackSearchAssistantStream({
      token: 'test-token',
      channel: 'D1',
      threadTs: '1.1',
      slackUserId: 'U1',
      controller,
      registry,
      beforeDelivery,
      beforeCleanup,
      deliverConnections,
    }),
  }
}

function toolCall(toolName = 'list_integrations', toolCallId = 'tool-1'): ToolCallStreamEvent {
  return {
    type: 'tool',
    payload: {
      phase: 'call',
      toolName,
      toolCallId,
      executor: 'sim',
      mode: 'sync',
      status: 'executing',
    },
  }
}

function toolResult(
  toolName = 'list_integrations',
  toolCallId = 'tool-1',
  success = true
): ToolResultStreamEvent {
  return {
    type: 'tool',
    payload: { phase: 'result', toolName, toolCallId, executor: 'sim', mode: 'sync', success },
  }
}

describe('Slack tool progress', () => {
  it('flushes a batched sentence before starting tool progress', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000)
    try {
      const { stream } = setup()
      await stream.start()
      await stream.onEvent({
        type: 'text',
        payload: { channel: 'assistant', text: "I'll search " },
      })
      await stream.onEvent({
        type: 'text',
        payload: { channel: 'assistant', text: 'the connected sources for the handbook.' },
      })
      await stream.onEvent(toolCall('search_workspace'))
      const chunks = api.append.mock.calls.flatMap((call) => call[3])
      expect(chunks).toEqual([
        { type: 'markdown_text', text: "I'll search " },
        {
          type: 'markdown_text',
          text: 'the connected sources for the handbook.\n\n',
        },
        {
          type: 'task_update',
          id: expect.any(String),
          title: 'Searching documents…',
          status: 'in_progress',
        },
      ])
    } finally {
      vi.restoreAllMocks()
    }
  })

  it('keeps text contiguous across preparatory and hidden tool events', async () => {
    const { stream } = setup()
    await stream.start()
    await stream.onEvent({
      type: 'text',
      payload: { channel: 'assistant', text: "I'll search" },
    })
    for (const attributes of [
      { partial: true },
      { status: 'generating' as const },
      { ui: { hidden: true } },
      { ui: { internal: true } },
    ]) {
      const event = toolCall('search_workspace')
      await stream.onEvent({ ...event, payload: { ...event.payload, ...attributes } })
    }
    await stream.onEvent({
      type: 'text',
      payload: { channel: 'assistant', text: ' the connected sources.' },
    })
    await stream.finish(result)
    expect(deliveredText()).toBe("I'll search the connected sources.")
    expect(
      api.append.mock.calls
        .flatMap((call) => call[3])
        .every((chunk) => chunk.type === 'markdown_text')
    ).toBe(true)
  })

  it('serializes concurrent text and tool events without duplicating buffered text', async () => {
    const { stream } = setup()
    await stream.start()
    let releaseAppend!: () => void
    api.append.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseAppend = resolve
        })
    )
    const text = stream.onEvent({
      type: 'text',
      payload: { channel: 'assistant', text: "I'll search the connected sources. " },
    })
    await vi.waitFor(() => expect(api.append).toHaveBeenCalledOnce(), { interval: 1 })
    const call = stream.onEvent(toolCall('search_workspace'))
    const completed = stream.onEvent(toolResult('search_workspace'))
    const finished = stream.finish(result)
    expect(api.append).toHaveBeenCalledOnce()
    expect(api.stop).not.toHaveBeenCalled()
    releaseAppend()
    await Promise.all([text, call, completed, finished])
    const chunks = api.append.mock.calls.flatMap((call) => call[3])
    expect(deliveredText()).toBe("I'll search the connected sources. \n\n")
    expect(chunks.map((chunk) => chunk.type)).toEqual([
      'markdown_text',
      'markdown_text',
      'task_update',
      'task_update',
    ])
    expect(chunks[3]).toEqual({ ...chunks[2], status: 'complete' })
  })

  it.each([
    ['list_integrations', 'Listing connected integrations…'],
    ['search_workspace', 'Searching documents…'],
    ['read_document', 'Reading documents…'],
  ])('shows %s as a task and completes that same task once', async (name, title) => {
    const { stream } = setup()
    await stream.start()
    await stream.onEvent(toolCall(name))
    await stream.onEvent(toolCall(name))
    await stream.onEvent(toolResult(name))
    await stream.onEvent(toolResult(name))
    await stream.finish(result)
    const chunks = api.append.mock.calls.flatMap((call) => call[3])
    expect(chunks).toEqual([
      { type: 'task_update', id: expect.any(String), title, status: 'in_progress' },
      { type: 'task_update', id: chunks[0].id, title, status: 'complete' },
    ])
    expect(api.stop.mock.calls[0][6]).toEqual([])
  })

  it('keeps parallel calls separate when their results arrive out of order', async () => {
    const { stream } = setup()
    await stream.start()
    await stream.onEvent(toolCall('search_workspace', 'search-1'))
    await stream.onEvent(toolCall('search_workspace', 'search-2'))
    await stream.onEvent(toolResult('search_workspace', 'search-2'))
    await stream.onEvent(toolResult('search_workspace', 'search-1'))
    const chunks = api.append.mock.calls.flatMap((call) => call[3])
    expect(chunks[0].id).not.toBe(chunks[1].id)
    expect(chunks[2]).toEqual({ ...chunks[1], status: 'complete' })
    expect(chunks[3]).toEqual({ ...chunks[0], status: 'complete' })
  })

  it('withholds partial, hidden, internal, subagent, and unsupported tools', async () => {
    const { stream } = setup()
    await stream.start()
    for (const attributes of [
      { partial: true },
      { status: 'generating' as const },
      { ui: { hidden: true } },
      { ui: { internal: true } },
    ]) {
      const event = toolCall()
      await stream.onEvent({ ...event, payload: { ...event.payload, ...attributes } })
    }
    await stream.onEvent({ ...toolCall(), scope: { lane: 'subagent', agentId: 'private-agent' } })
    await stream.onEvent(toolCall('internal_tool'))
    await stream.onEvent(toolResult())
    expect(api.append).not.toHaveBeenCalled()
    await stream.onEvent(toolCall())
    expect(api.append).toHaveBeenCalledOnce()
  })

  it('reports failed tools without exposing arguments, account labels, or backend errors', async () => {
    const { stream } = setup()
    await stream.start()
    const call = toolCall()
    await stream.onEvent({
      ...call,
      payload: { ...call.payload, arguments: { query: 'private argument' } },
    })
    const failed = toolResult('list_integrations', 'tool-1', false)
    await stream.onEvent({
      ...failed,
      payload: {
        ...failed.payload,
        error: 'private error',
        output: { accountLabel: 'private account' },
      },
    })
    const chunks = api.append.mock.calls.flatMap((call) => call[3])
    expect(chunks[1]).toEqual({ ...chunks[0], status: 'error' })
    expect(JSON.stringify(chunks)).not.toContain('private')
  })

  it('marks unfinished tasks failed when the Assistant fails', async () => {
    const { stream } = setup()
    await stream.start()
    await stream.onEvent(toolCall())
    await stream.finishWithError()
    expect(api.stop.mock.calls[0][6]).toEqual([
      { ...api.append.mock.calls[0][3][0], status: 'error' },
    ])
  })

  it('aborts an ambiguous progress send and cleans up once without replaying it', async () => {
    const { stream, controller } = setup()
    await stream.start()
    api.append.mockRejectedValueOnce(new Error('progress response lost'))
    await expect(stream.onEvent(toolCall())).rejects.toThrow('progress response lost')
    expect(controller.signal.aborted).toBe(true)
    await expect(stream.onEvent(toolCall())).rejects.toThrow('progress response lost')
    await stream.terminateAfterFailure()
    await stream.terminateAfterFailure()
    expect(api.append).toHaveBeenCalledOnce()
    expect(api.stop).toHaveBeenCalledOnce()
    expect(api.stop.mock.calls[0][6]).toEqual([
      { ...api.append.mock.calls[0][3][0], status: 'error' },
    ])
  })

  it('does not send task updates after cancellation or revoked delivery authority', async () => {
    const { stream, controller, beforeDelivery } = setup()
    await stream.start()
    beforeDelivery.mockRejectedValueOnce(new Error('authority revoked'))
    await expect(stream.onEvent(toolCall())).rejects.toThrow('authority revoked')
    expect(controller.signal.aborted).toBe(true)
    expect(api.append).not.toHaveBeenCalled()
    const cancelled = setup()
    await cancelled.stream.start()
    cancelled.controller.abort(new Error('stopped'))
    await expect(cancelled.stream.onEvent(toolCall())).rejects.toThrow('stopped')
    expect(api.append).not.toHaveBeenCalled()
  })
})

describe('Slack Assistant delivery', () => {
  it('withholds split connection tags, delivers validated controls, and leaves a visible next step', async () => {
    const deliver = vi.fn().mockResolvedValue(undefined)
    const { stream } = setup(deliver)
    await stream.start()
    const target = { type: 'link', provider: 'google-email', connectorType: 'gmail' }
    for (const text of [
      'Connect Gmail. <cre',
      `dential>${JSON.stringify(target).slice(0, 10)}`,
      `${JSON.stringify(target).slice(10)}</credential>`,
    ]) {
      await stream.onEvent({ type: 'text', payload: { channel: 'assistant', text } })
    }
    await stream.finish(result)
    expect(deliver).toHaveBeenCalledExactlyOnceWith([target])
    expect(deliveredText()).toContain('connection buttons in our DM')
    expect(deliveredText()).not.toMatch(/credential|connectorType|google-email/)
  })
  it('aborts on connection-button delivery failure without a successful finish', async () => {
    const deliver = vi.fn().mockRejectedValue(new Error('ephemeral delivery failed'))
    const { stream, controller } = setup(deliver)
    await stream.start()
    await stream.onEvent({
      type: 'text',
      payload: {
        channel: 'assistant',
        text: '<credential>{"type":"link","provider":"gmail","connectorType":"gmail"}</credential>',
      },
    })
    await expect(stream.finish(result)).rejects.toThrow('ephemeral delivery failed')
    expect(controller.signal.aborted).toBe(true)
    expect(api.stop).not.toHaveBeenCalled()
  })
  it('never exposes a partial terminal tag or model-authored connection URL', () => {
    expect(publicSlackAnswer('Next <cred', true)).toBe('Next ')
    expect(publicSlackAnswer('Connect [here](https://evil.test) <credential>{oops}', true)).toBe(
      'Connect here '
    )
  })
  it('streams only main public answer text and preserves the original thread', async () => {
    const { stream } = setup()
    await stream.start()
    await stream.onEvent({
      type: 'text',
      payload: { channel: 'thinking', text: 'private reasoning' },
    })
    await stream.onEvent({ type: 'text', payload: { channel: 'assistant', text: 'Hello world. ' } })
    await stream.finish(result)
    expect(api.start).toHaveBeenCalledWith(
      'test-token',
      { channel: 'D1', threadTs: '1.1' },
      [],
      'timeline',
      expect.any(AbortSignal)
    )
    expect(
      api.append.mock.calls
        .flatMap((call) => call[3])
        .map((chunk) => chunk.text)
        .join('')
    ).toBe('Hello world. ')
    expect(api.stop).toHaveBeenCalledOnce()
  })
  it('aborts after an ambiguous append and closes the known stream without replaying text', async () => {
    const { stream, controller, beforeCleanup } = setup()
    api.append.mockRejectedValueOnce(new Error('connection closed'))
    await stream.start()
    await expect(
      stream.onEvent({ type: 'text', payload: { channel: 'assistant', text: 'answer ' } })
    ).rejects.toThrow('connection closed')
    expect(controller.signal.aborted).toBe(true)
    await expect(stream.finish(result)).rejects.toThrow('connection closed')
    await expect(stream.finishWithError()).rejects.toThrow('connection closed')
    await stream.terminateAfterFailure()
    await stream.terminateAfterFailure()
    expect(api.append).toHaveBeenCalledOnce()
    expect(api.stop).toHaveBeenCalledOnce()
    const cleanupSignal = api.stop.mock.calls[0][4]
    expect(cleanupSignal).not.toBe(controller.signal)
    expect(cleanupSignal.aborted).toBe(false)
    expect(beforeCleanup).toHaveBeenCalledWith(cleanupSignal)
    expect(api.stop.mock.calls[0][5][0].text.text).toBe(
      'I couldn’t complete this search. Please try again.'
    )
    expect(beforeCleanup.mock.invocationCallOrder[0]).toBeLessThan(
      api.stop.mock.invocationCallOrder[0]
    )
  })
  it('does not guess a stream identity after an ambiguous start', async () => {
    const { stream } = setup()
    api.start.mockRejectedValueOnce(new Error('start response lost'))
    await expect(stream.start()).rejects.toThrow('start response lost')
    await stream.terminateAfterFailure()
    expect(api.stop).not.toHaveBeenCalled()
  })
  it('does not retry an ambiguous stop during cleanup', async () => {
    const { stream } = setup()
    await stream.start()
    api.stop.mockRejectedValueOnce(new Error('stop response lost'))
    await expect(stream.finish(result)).rejects.toThrow('stop response lost')
    await stream.terminateAfterFailure()
    expect(api.stop).toHaveBeenCalledOnce()
  })
  it('propagates cleanup failures without repeating the stop request', async () => {
    const { stream, controller } = setup()
    await stream.start()
    controller.abort(new Error('Assistant failed'))
    api.stop.mockRejectedValueOnce(new Error('cleanup failed'))
    await expect(stream.terminateAfterFailure()).rejects.toThrow('cleanup failed')
    await stream.terminateAfterFailure()
    expect(api.stop).toHaveBeenCalledOnce()
  })
  it('refuses cleanup delivery after installation, membership, or lease authority is revoked', async () => {
    const { stream, controller, beforeCleanup } = setup()
    await stream.start()
    controller.abort(new Error('Assistant failed'))
    beforeCleanup.mockRejectedValueOnce(new Error('authority revoked'))
    await expect(stream.terminateAfterFailure()).rejects.toThrow('authority revoked')
    expect(api.stop).not.toHaveBeenCalled()
  })
  it('separates public text before and after a tool call', async () => {
    const { stream } = setup()
    await stream.start()
    await stream.onEvent({ type: 'text', payload: { channel: 'assistant', text: 'Searching.' } })
    await stream.onEvent({
      type: 'tool',
      payload: {
        phase: 'call',
        toolCallId: 'search-1',
        toolName: 'search_workspace',
        executor: 'sim',
        mode: 'sync',
      },
    })
    await stream.onEvent({ type: 'text', payload: { channel: 'assistant', text: 'Found it.' } })
    await stream.finish(result)
    expect(
      api.append.mock.calls
        .flatMap((call) => call[3])
        .map((chunk) => chunk.text)
        .join('')
    ).toBe('Searching.\n\nFound it.')
  })
  it.each(['options', 'question', 'thinking', 'usage_upgrade', 'credential', 'workspace_resource'])(
    'withholds %s payloads across every stream boundary',
    (tag) => {
      const input = `Answer. <${tag}>{"title":"Internal UI payload","description":"follow up"}</${tag}>`
      for (let end = 'Answer. '.length; end <= input.length; end++) {
        expect(publicSlackAnswer(input.slice(0, end), false)).toBe('Answer. ')
      }
      expect(publicSlackAnswer(`${input} More text.`, true)).toBe('Answer.  More text.')
    }
  )
  it('closes a confirmed Assistant failure with a safe error on the existing stream', async () => {
    const { stream, beforeDelivery } = setup()
    await stream.start()
    await stream.finishWithError()
    expect(beforeDelivery).toHaveBeenCalledTimes(2)
    expect(api.stop).toHaveBeenCalledWith(
      'test-token',
      'D1',
      '1.2',
      'active',
      expect.any(AbortSignal),
      [
        {
          type: 'section',
          text: { type: 'plain_text', text: 'I couldn’t complete this search. Please try again.' },
        },
      ],
      []
    )
    expect(api.append).not.toHaveBeenCalled()
  })
  it('refuses delivery when installation or member access changes', async () => {
    const { stream, beforeDelivery } = setup()
    await stream.start()
    beforeDelivery.mockRejectedValueOnce(new Error('membership revoked'))
    await expect(
      stream.onEvent({ type: 'text', payload: { channel: 'assistant', text: 'answer ' } })
    ).rejects.toThrow('membership revoked')
    expect(api.append).not.toHaveBeenCalled()
  })
  it('places cited source names beside the supported text without a source footer', async () => {
    const { stream } = setup()
    await stream.start()
    await stream.onEvent({
      type: 'text',
      payload: {
        channel: 'assistant',
        text: 'Approval is required.<source>{"id":"real","url":"https://evil.example","title":"Forged"}</source> Then submit the request.',
      },
    })
    await stream.finish({
      ...result,
      contentBlocks: [
        {
          type: 'tool_call',
          timestamp: 1,
          toolCall: {
            id: 't1',
            name: 'search_workspace',
            status: 'success',
            result: {
              success: true,
              output: {
                data: {
                  results: [
                    {
                      citationId: 'real',
                      citationUrl: 'https://docs.example.com/real',
                      documentName: 'Verified document',
                    },
                    {
                      citationId: 'unused',
                      citationUrl: 'https://docs.example.com/unused',
                      documentName: 'Unused search result',
                    },
                  ],
                },
              },
            },
          },
        },
        {
          type: 'tool_call',
          timestamp: 2,
          toolCall: {
            id: 't2',
            name: 'read_document',
            status: 'error',
            result: {
              success: false,
              output: { citationId: 'fake', citationUrl: 'https://evil.example' },
            },
          },
        },
      ],
    })
    expect(deliveredText()).toBe(
      'Approval is required. [Verified document](<https://docs.example.com/real>) Then submit the request.'
    )
    expect(api.stop.mock.calls[0][5]).toEqual([])
  })
  it('resolves tool-result citations during streaming before the final result', async () => {
    const { stream } = setup()
    await stream.start()
    await stream.onEvent({
      type: 'tool',
      payload: {
        phase: 'result',
        toolCallId: 'search-1',
        toolName: 'search_workspace',
        executor: 'sim',
        mode: 'sync',
        status: 'success',
        success: true,
        output: {
          data: {
            results: [
              {
                citationId: 'handbook',
                citationUrl: 'https://docs.example.com/handbook',
                documentName: 'Employee handbook',
              },
            ],
          },
        },
      },
    })
    await stream.onEvent({
      type: 'text',
      payload: {
        channel: 'assistant',
        text: 'Ask your manager. <source>{"id":"handbook"}</source> ',
      },
    })
    expect(deliveredText()).toBe(
      'Ask your manager. [Employee handbook](<https://docs.example.com/handbook>) '
    )
    expect(api.stop).not.toHaveBeenCalled()
    await stream.finish(result)
    expect(api.stop.mock.calls[0][5]).toEqual([])
  })
  it('keeps each inline citation stable across every text boundary', () => {
    const source = '<source>{"id":"handbook"}</source>'
    const input = `Ask your manager.${source} Submit it here.${source} Done.`
    const link = '[Employee handbook](<https://docs.example.com/handbook>)'
    const sources = new Map([['handbook', link]])
    const expected = `Ask your manager. ${link} Submit it here. ${link} Done.`
    let previous = ''
    for (let end = 0; end <= input.length; end++) {
      const current = publicSlackAnswer(input.slice(0, end), false, sources)
      expect(current.startsWith(previous)).toBe(true)
      expect(expected.startsWith(current)).toBe(true)
      previous = current
    }
    expect(publicSlackAnswer(input, true, sources)).toBe(expected)
  })
  it('withholds text after an unresolved citation until evidence is available', () => {
    const input = 'Answer. <source>{"id":"late"}</source> More text. '
    expect(publicSlackAnswer(input, false)).toBe('Answer. ')
    expect(
      publicSlackAnswer(input, false, new Map([['late', '[Policy](<https://example.com/policy>)']]))
    ).toBe('Answer. [Policy](<https://example.com/policy>) More text. ')
    expect(publicSlackAnswer(input, true)).toBe('Answer.  More text. ')
  })
  it.each([
    ['failed retrieval', 'search_workspace', false, 'https://example.com/document'],
    ['unrelated tool', 'web_search', true, 'https://example.com/document'],
    ['non-web URL', 'read_document', true, 'javascript:alert(1)'],
    ['embedded credentials', 'read_document', true, 'https://user:password@example.com/document'],
  ])('does not link %s', async (_name, tool, success, url) => {
    const { stream } = setup()
    await stream.start()
    await stream.onEvent({
      type: 'text',
      payload: {
        channel: 'assistant',
        text: 'Answer. <source>{"id":"invalid"}</source> End.',
      },
    })
    await stream.finish({
      ...result,
      contentBlocks: [
        retrieval(
          [{ citationId: 'invalid', citationUrl: url, documentName: 'Unsafe source' }],
          tool,
          success
        ),
      ],
    })
    expect(deliveredText()).toBe('Answer.  End.')
    expect(api.stop.mock.calls[0][5]).toEqual([])
  })
  it('omits source metadata that fails secret projection', async () => {
    const { stream } = setup()
    api.project.mockImplementation((value: unknown) =>
      typeof value === 'string' ? { safe: true, value } : { safe: false }
    )
    await stream.start()
    await stream.onEvent({
      type: 'text',
      payload: {
        channel: 'assistant',
        text: 'Answer. <source>{"id":"private"}</source> End.',
      },
    })
    await stream.finish({
      ...result,
      contentBlocks: [
        retrieval([
          {
            citationId: 'private',
            citationUrl: 'https://example.com/private',
            documentName: 'Secret',
          },
        ]),
      ],
    })
    expect(deliveredText()).toBe('Answer.  End.')
  })
  it('escapes source labels and bounds long titles without changing their destinations', async () => {
    const { stream } = setup()
    await stream.start()
    await stream.onEvent({
      type: 'text',
      payload: {
        channel: 'assistant',
        text: 'Answer. <source>{"id":"source"}</source>',
      },
    })
    await stream.finish({
      ...result,
      contentBlocks: [
        retrieval([
          {
            citationId: 'source',
            citationUrl: 'https://example.com/a_(b)?a=1&b=2',
            documentName: `[Policy] & <@everyone>\n${'a'.repeat(100)}`,
          },
        ]),
      ],
    })
    expect(deliveredText()).toContain('[\\[Policy\\] &amp; &lt;@everyone&gt; ')
    expect(deliveredText()).toContain('](<https://example.com/a_(b)?a=1&b=2>)')
    expect(deliveredText()).not.toContain('a'.repeat(60))
  })
  it('keeps an inline link intact when it crosses the append size boundary', async () => {
    const { stream } = setup()
    const prefix = `${'a'.repeat(3970)} `
    await stream.start()
    await stream.onEvent({
      type: 'tool',
      payload: {
        phase: 'result',
        toolCallId: 'search-1',
        toolName: 'search_workspace',
        executor: 'sim',
        mode: 'sync',
        success: true,
        output: {
          data: {
            results: [
              {
                citationId: 'policy',
                citationUrl: 'https://example.com/policy',
                documentName: 'Employee policy',
              },
            ],
          },
        },
      },
    })
    await stream.onEvent({
      type: 'text',
      payload: {
        channel: 'assistant',
        text: `${prefix}<source>{"id":"policy"}</source> Done.`,
      },
    })
    await stream.finish({
      ...result,
      contentBlocks: [
        retrieval([
          {
            citationId: 'policy',
            citationUrl: 'https://example.com/policy',
            documentName: 'Employee policy',
          },
        ]),
      ],
    })
    const link = '[Employee policy](<https://example.com/policy>)'
    expect(deliveredText()).toBe(`${prefix}${link} Done.`)
    const chunks = api.append.mock.calls.flatMap((call) => call[3])
    expect(chunks.some((chunk) => chunk.text.includes(link))).toBe(true)
    expect(chunks.every((chunk) => chunk.text.length <= 4000)).toBe(true)
  })
  it.each([
    ['Answer <source>{"id":"x","url":"https://evil.test"}</source> done ', 'Answer '],
    [
      'Read [untrusted](https://evil.test) and https://evil.test/x now ',
      'Read untrusted and  now ',
    ],
    ['Answer <sou', 'Answer '],
    ['Answer <source>{"id":"x"}', 'Answer '],
    ['Read [partially streamed', 'Read '],
    ['Read https://evil.te', 'Read '],
  ])('withholds fragmented markup and unverified links: %s', (input, output) => {
    expect(publicSlackAnswer(input, false)).toBe(output)
  })
})
