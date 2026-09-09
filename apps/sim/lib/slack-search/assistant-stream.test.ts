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
function setup() {
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
    }),
  }
}
describe('Slack Assistant delivery', () => {
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
      ]
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
