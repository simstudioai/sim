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
vi.mock('@/lib/mothership/chat/sim-key-redaction', () => ({
  redactSensitiveContent: (value: string) => value,
}))
vi.mock('@/executor/utils/resolved-secret-content-projection', () => ({
  projectResolvedSecretDiagnosticContent: api.project,
}))

import type {
  ToolCallStreamEvent,
  ToolResultStreamEvent,
} from '@/lib/mothership/request/session/contract'
import type { OrchestratorResult } from '@/lib/mothership/request/types'
import { publicSlackAnswer, SlackSearchAssistantStream } from '@/lib/slack-search/assistant-stream'
import type { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const result: OrchestratorResult = { success: true, content: '', contentBlocks: [], toolCalls: [] }
beforeEach(() => {
  api.start.mockResolvedValue({ channel: 'D1', ts: '1.2' })
  api.project.mockImplementation((value: unknown) => ({ safe: true, value }))
})

function deliveredChunks() {
  return [
    ...api.start.mock.calls.flatMap((call) => call[2]),
    ...api.append.mock.calls.flatMap((call) => call[3]),
  ]
}

function deliveredText() {
  return deliveredChunks()
    .flatMap((chunk) => (chunk.type === 'markdown_text' ? [chunk.text] : []))
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
function setup(
  deliverConnections = vi.fn().mockResolvedValue(undefined),
  integrationsUrl?: string
) {
  const controller = new AbortController()
  const beforeDelivery = vi.fn().mockResolvedValue(undefined)
  const beforeCleanup = vi.fn().mockResolvedValue(undefined)
  const registry = {
    isComplete: () => true,
    getActiveMatches: () => [],
  } as unknown as ResolvedSecretTraceRegistry
  return {
    controller,
    registry,
    beforeDelivery,
    beforeCleanup,
    stream: new SlackSearchAssistantStream({
      token: 'test-token',
      channel: 'D1',
      threadTs: '1.1',
      slackUserId: 'U1',
      integrationsUrl,
      controller,
      registry,
      beforeDelivery,
      beforeCleanup,
      deliverConnections,
    }),
  }
}

function toolCall(toolName = 'search_workspace', toolCallId = 'tool-1'): ToolCallStreamEvent {
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
  toolName = 'search_workspace',
  toolCallId = 'tool-1',
  success = true
): ToolResultStreamEvent {
  return {
    type: 'tool',
    payload: { phase: 'result', toolName, toolCallId, executor: 'sim', mode: 'sync', success },
  }
}

describe('Slack lazy stream lifecycle', () => {
  it.each(['', ' \n\t', '<thinking>private</thinking>', 'https://unverified.test '])(
    'settles an answer with no public text without creating a blank reply: %j',
    async (text) => {
      const { stream, controller } = setup()
      await stream.start()
      await stream.onEvent({ type: 'text', payload: { channel: 'assistant', text } })
      await stream.finish(result)
      await stream.terminateAfterFailure()
      expect(api.start).not.toHaveBeenCalled()
      expect(api.append).not.toHaveBeenCalled()
      expect(api.stop).not.toHaveBeenCalled()
      expect(api.status).toHaveBeenCalledTimes(2)
      expect(api.status).toHaveBeenLastCalledWith(
        'test-token',
        { channel: 'D1', threadTs: '1.1' },
        'active',
        controller.signal
      )
    }
  )

  it('rejects content and completion after Stop before the first visible chunk', async () => {
    const { stream, controller } = setup()
    await stream.start()
    controller.abort(new Error('stopped'))
    await expect(
      stream.onEvent({
        type: 'text',
        payload: { channel: 'assistant', text: 'Late answer. ' },
      })
    ).rejects.toThrow('stopped')
    await expect(stream.finish(result)).rejects.toThrow('stopped')
    expect(api.start).not.toHaveBeenCalled()
    expect(api.append).not.toHaveBeenCalled()
    expect(api.stop).not.toHaveBeenCalled()
  })

  it.each(['confirmed', 'thrown'])(
    'delivers a %s failure before content once and ends processing',
    async (kind) => {
      const { stream, controller, beforeCleanup } = setup()
      await stream.start()
      if (kind === 'thrown') {
        controller.abort(new Error('private backend error'))
        await stream.terminateAfterFailure()
      } else {
        await stream.finishWithError()
      }
      await stream.terminateAfterFailure()
      expect(api.start).toHaveBeenCalledOnce()
      expect(deliveredText()).toBe('I couldn’t complete this search. Please try again.')
      expect(api.append).not.toHaveBeenCalled()
      expect(api.stop).toHaveBeenCalledExactlyOnceWith(
        'test-token',
        'D1',
        '1.2',
        'active',
        expect.any(AbortSignal),
        [],
        []
      )
      const signal = api.start.mock.calls[0][4]
      expect(signal.aborted).toBe(false)
      if (kind === 'thrown') {
        expect(signal).not.toBe(controller.signal)
        expect(beforeCleanup).toHaveBeenCalledExactlyOnceWith(signal)
      }
    }
  )

  it('requires fresh authority before retrying a failed status reset', async () => {
    const { stream, beforeCleanup } = setup()
    await stream.start()
    api.start.mockRejectedValueOnce(new Error('notification response lost'))
    api.status.mockRejectedValueOnce(new Error('status response lost'))
    await expect(stream.finishWithError()).rejects.toThrow('status response lost')
    beforeCleanup.mockRejectedValueOnce(new Error('authority revoked'))
    await expect(stream.terminateAfterFailure()).rejects.toThrow('authority revoked')
    await stream.terminateAfterFailure()
    expect(api.status).toHaveBeenCalledTimes(2)
    expect(api.start).toHaveBeenCalledOnce()
    expect(api.stop).not.toHaveBeenCalled()
  })
})

describe('Slack tool progress', () => {
  it('withholds tasks and following text until preceding citation evidence arrives', async () => {
    const { stream } = setup()
    await stream.start()
    await stream.onEvent({
      type: 'text',
      payload: {
        channel: 'assistant',
        text: 'Checking <source>{"id":"late"}</source> for details.',
      },
    })
    await stream.onEvent(toolCall('search_workspace'))
    await stream.onEvent({
      type: 'text',
      payload: { channel: 'assistant', text: 'Found a result. ' },
    })
    expect(deliveredChunks()).toEqual([{ type: 'markdown_text', text: 'Checking ' }])
    const completed = toolResult('search_workspace')
    await stream.onEvent({
      ...completed,
      payload: {
        ...completed.payload,
        output: {
          data: {
            results: [
              {
                citationId: 'late',
                citationUrl: 'https://example.com/policy',
                documentName: 'Policy',
              },
            ],
          },
        },
      },
    })
    const chunks = deliveredChunks()
    expect(chunks).toEqual([
      { type: 'markdown_text', text: 'Checking ' },
      { type: 'markdown_text', text: '[Policy](<https://example.com/policy>) for details.\n\n' },
      {
        type: 'task_update',
        id: expect.any(String),
        title: 'Searching documents…',
        status: 'in_progress',
      },
      { type: 'task_update', id: chunks[2].id, title: 'Searching documents…', status: 'complete' },
      { type: 'markdown_text', text: 'Found a result. ' },
    ])
    await stream.finish(result)
    expect(deliveredChunks()).toEqual(chunks)
  })

  it('rejects a tool boundary whose prefix is unsafe in the complete secret projection', async () => {
    const { stream, registry } = setup()
    const secret = 'private-\n\ntoken'
    vi.spyOn(registry, 'getActiveMatches').mockReturnValue([
      { plaintext: secret, replacement: '[REDACTED_SECRET]' },
    ])
    api.project.mockImplementation((value: unknown) => ({
      safe: true,
      value: typeof value === 'string' ? value.replaceAll(secret, '[REDACTED_SECRET]') : value,
    }))
    await stream.start()
    await stream.onEvent({ type: 'text', payload: { channel: 'assistant', text: 'private-' } })
    await stream.onEvent(toolCall('search_workspace'))
    await stream.onEvent({ type: 'text', payload: { channel: 'assistant', text: 'token' } })
    await expect(stream.finish(result)).rejects.toThrow(
      'The safe answer changed at a tool boundary'
    )
    expect(api.start).not.toHaveBeenCalled()
    expect(api.append).not.toHaveBeenCalled()
  })

  it('never retries a deferred task after its append fails ambiguously', async () => {
    const { stream, registry, controller } = setup()
    vi.spyOn(registry, 'getActiveMatches').mockReturnValue([
      { plaintext: 'private-token', replacement: '[REDACTED_SECRET]' },
    ])
    await stream.start()
    await stream.onEvent({ type: 'text', payload: { channel: 'assistant', text: 'Checking.' } })
    await stream.onEvent(toolCall('search_workspace'))
    expect(api.start).not.toHaveBeenCalled()
    expect(api.append).not.toHaveBeenCalled()
    api.append.mockRejectedValueOnce(new Error('response lost'))
    await expect(stream.finish(result)).rejects.toThrow('response lost')
    expect(controller.signal.aborted).toBe(true)
    await stream.terminateAfterFailure()
    await stream.terminateAfterFailure()
    expect(api.append).toHaveBeenCalledOnce()
    expect(api.stop).toHaveBeenCalledOnce()
    expect(api.stop.mock.calls[0][6]).toEqual([
      { ...api.append.mock.calls[0][3][0], status: 'error' },
    ])
  })

  it('serializes concurrent text and tool events without duplicating buffered text', async () => {
    const { stream } = setup()
    await stream.start()
    let releaseStart!: (value: { channel: string; ts: string }) => void
    api.start.mockImplementationOnce(
      () =>
        new Promise<{ channel: string; ts: string }>((resolve) => {
          releaseStart = resolve
        })
    )
    const text = stream.onEvent({
      type: 'text',
      payload: { channel: 'assistant', text: "I'll search the connected sources. " },
    })
    await vi.waitFor(() => expect(api.start).toHaveBeenCalledOnce(), { interval: 1 })
    const call = stream.onEvent(toolCall('search_workspace'))
    const completed = stream.onEvent(toolResult('search_workspace'))
    const finished = stream.finish(result)
    expect(api.start).toHaveBeenCalledOnce()
    expect(api.append).not.toHaveBeenCalled()
    expect(api.stop).not.toHaveBeenCalled()
    releaseStart({ channel: 'D1', ts: '1.2' })
    await Promise.all([text, call, completed, finished])
    const chunks = deliveredChunks()
    expect(deliveredText()).toBe("I'll search the connected sources. \n\n")
    expect(chunks.map((chunk) => chunk.type)).toEqual([
      'markdown_text',
      'markdown_text',
      'task_update',
      'task_update',
    ])
    expect(chunks[3]).toEqual({ ...chunks[2], status: 'complete' })
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
    expect(api.start).not.toHaveBeenCalled()
    await stream.onEvent(toolCall())
    expect(api.start).toHaveBeenCalledOnce()
  })

  it('reports failed tools without exposing arguments, account labels, or backend errors', async () => {
    const { stream } = setup()
    await stream.start()
    const call = toolCall()
    await stream.onEvent({
      ...call,
      payload: { ...call.payload, arguments: { query: 'private argument' } },
    })
    const failed = toolResult('search_workspace', 'tool-1', false)
    await stream.onEvent({
      ...failed,
      payload: {
        ...failed.payload,
        error: 'private error',
        output: { accountLabel: 'private account' },
      },
    })
    const chunks = deliveredChunks()
    expect(chunks[1]).toEqual({ ...chunks[0], status: 'error' })
    expect(JSON.stringify(chunks)).not.toContain('private')
  })

  it('does not send task updates after cancellation or revoked delivery authority', async () => {
    const { stream, controller, beforeDelivery } = setup()
    await stream.start()
    beforeDelivery.mockRejectedValueOnce(new Error('authority revoked'))
    await expect(stream.onEvent(toolCall())).rejects.toThrow('authority revoked')
    expect(controller.signal.aborted).toBe(true)
    expect(api.start).not.toHaveBeenCalled()
    expect(api.append).not.toHaveBeenCalled()
    const cancelled = setup()
    await cancelled.stream.start()
    cancelled.controller.abort(new Error('stopped'))
    await expect(cancelled.stream.onEvent(toolCall())).rejects.toThrow('stopped')
    expect(api.start).not.toHaveBeenCalled()
    expect(api.append).not.toHaveBeenCalled()
  })
})

describe('Slack Assistant delivery', () => {
  it('never accepts another organization, origin, or query in account connection links', () => {
    const integrationsUrl = 'https://sim.example/o/org-1/integrations'
    for (const destination of [
      '/o/org-2/integrations',
      'https://sim.example/o/org-2/integrations',
      'https://evil.example/o/org-1/integrations',
      '//evil.example/o/org-1/integrations',
      `${integrationsUrl}?redirect=https://evil.example`,
    ]) {
      expect(
        publicSlackAnswer(
          `Open [Connected accounts](${destination}).`,
          true,
          new Map(),
          integrationsUrl
        )
      ).toBe('Open Connected accounts.')
    }
  })
  it('never exposes a partial terminal tag or model-authored connection URL', () => {
    expect(publicSlackAnswer('Next <cred', true)).toBe('Next ')
    expect(publicSlackAnswer('Connect [here](https://evil.test) <credential>{oops}', true)).toBe(
      'Connect here '
    )
  })
  it('aborts after an ambiguous append and closes the known stream without replaying text', async () => {
    const { stream, controller, beforeCleanup } = setup()
    api.append.mockRejectedValueOnce(new Error('connection closed'))
    await stream.start()
    await expect(
      stream.onEvent({
        type: 'text',
        payload: { channel: 'assistant', text: `${'a'.repeat(4000)} answer ` },
      })
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
    await stream.start()
    await expect(stream.onEvent(toolCall())).rejects.toThrow('start response lost')
    await stream.terminateAfterFailure()
    await stream.terminateAfterFailure()
    expect(api.start).toHaveBeenCalledOnce()
    expect(api.stop).not.toHaveBeenCalled()
    expect(api.status).toHaveBeenLastCalledWith(
      'test-token',
      { channel: 'D1', threadTs: '1.1' },
      'active',
      expect.any(AbortSignal)
    )
  })
  it('refuses cleanup delivery after installation, membership, or lease authority is revoked', async () => {
    const { stream, controller, beforeCleanup } = setup()
    await stream.start()
    controller.abort(new Error('Assistant failed'))
    beforeCleanup.mockRejectedValueOnce(new Error('authority revoked'))
    await expect(stream.terminateAfterFailure()).rejects.toThrow('authority revoked')
    expect(api.start).not.toHaveBeenCalled()
    expect(api.stop).not.toHaveBeenCalled()
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
