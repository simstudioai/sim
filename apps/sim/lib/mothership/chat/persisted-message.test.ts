import { describe, expect, it } from 'vitest'
import { copilotChatStopBodySchema } from '@/lib/api/contracts/copilot'
import { toDisplayMessage } from '@/lib/mothership/chat/display-message'
import type { OrchestratorResult } from '@/lib/mothership/request/types'
import { resolveMessageCitations } from '@/app/workspace/[workspaceId]/home/components/message-content/resolve-citations'
import {
  buildPersistedAssistantMessage,
  buildPersistedUserMessage,
  normalizeMessage,
  type PersistedMessage,
  stripToolResultOutput,
  withStoppedContentBlock,
} from './persisted-message'

describe('persisted-message', () => {
  it.each([
    { state: 'executing', alreadyStopped: false },
    { state: 'executing', alreadyStopped: true },
    { state: 'pending', alreadyStopped: false },
    { state: 'pending', alreadyStopped: true },
    { state: 'awaiting_approval', alreadyStopped: false },
    { state: 'awaiting_approval', alreadyStopped: true },
  ] as const)(
    'cancels $state tools (existing stopped marker: $alreadyStopped)',
    ({ state, alreadyStopped }) => {
      const message: PersistedMessage = {
        id: 'assistant',
        role: 'assistant',
        content: '',
        timestamp: '2026-09-24T19:00:00Z',
        contentBlocks: [
          {
            type: 'tool',
            toolCall: {
              id: 'unfinished',
              name: 'run_code',
              state,
              params: { code: 'keep me' },
            },
          },
          { type: 'tool', toolCall: { id: 'finished', name: 'read', state: 'success' } },
          ...(alreadyStopped ? [{ type: 'complete' as const, status: 'cancelled' as const }] : []),
        ],
      }
      const saved = withStoppedContentBlock(message)
      expect(saved.contentBlocks?.[0].toolCall).toMatchObject({
        state: 'cancelled',
        params: { code: 'keep me' },
        display: { title: 'Stopped by user' },
      })
      expect(saved.contentBlocks?.[1].toolCall?.state).toBe('success')
      expect(saved.contentBlocks?.filter((block) => block.type === 'complete')).toHaveLength(1)
      expect(message.contentBlocks?.[0].toolCall?.state).toBe(state)
    }
  )

  it.each(['success', 'cancelled'] as const)(
    'preserves model-authored activity metadata through persisted %s history and stop validation',
    (status) => {
      const result: OrchestratorResult = {
        success: true,
        content: '',
        toolCalls: [],
        contentBlocks: [
          {
            type: 'tool_call',
            timestamp: 1,
            toolCall: {
              id: 'activity-call',
              name: 'read',
              status,
              activityDescription: '  Checking   the project setup  ',
              displayTitle: 'Checking the project setup',
              params: { path: 'WORKSPACE.md' },
            },
          },
        ],
      }
      const persisted = buildPersistedAssistantMessage(result)
      const stopped = copilotChatStopBodySchema.parse({
        chatId: 'chat-1',
        streamId: 'stream-1',
        content: '',
        contentBlocks: persisted.contentBlocks,
      })
      expect(stopped.contentBlocks?.[0].toolCall?.activityDescription).toBe(
        'Checking the project setup'
      )
      const display = toDisplayMessage(
        normalizeMessage(persisted as unknown as Record<string, unknown>)
      )
      expect(display.contentBlocks?.[0].toolCall).toMatchObject({
        status,
        activityDescription: 'Checking the project setup',
        params: { path: 'WORKSPACE.md' },
      })
    }
  )

  it('preserves activity metadata on legacy tool blocks without inferring it from old titles', () => {
    const message = normalizeMessage({
      id: 'message-1',
      role: 'assistant',
      content: '',
      contentBlocks: [
        {
          type: 'tool_call',
          toolCall: {
            id: 'activity-call',
            name: 'read',
            state: 'success',
            activityDescription: 'Checking the project setup',
            display: { title: 'Checking the project setup' },
          },
        },
        {
          type: 'tool_call',
          toolCall: {
            id: 'legacy-call',
            name: 'gmail_read_v2',
            state: 'success',
            display: { title: 'Read recent emails' },
          },
        },
      ],
    })
    const display = toDisplayMessage(message)
    expect(display.contentBlocks?.[0].toolCall?.activityDescription).toBe(
      'Checking the project setup'
    )
    expect(display.contentBlocks?.[1].toolCall).toMatchObject({
      displayTitle: 'Read recent emails',
    })
    expect(display.contentBlocks?.[1].toolCall?.activityDescription).toBeUndefined()
  })
  it.each(['', 'partial answer'])(
    'retains the failure after storage and display projection for %j',
    (content) => {
      const persisted = buildPersistedAssistantMessage({
        success: false,
        content,
        contentBlocks: [],
        toolCalls: [],
        error: 'The worker connection was interrupted.',
      })
      const restored = normalizeMessage({ ...persisted })
      const displayed = toDisplayMessage(restored)
      const blocks = displayed.contentBlocks ?? []
      expect(restored.content).toBe(content)
      expect(restored.contentBlocks?.at(-1)?.type).toBe('error')
      expect(blocks.at(-1)?.content).toBe(
        '<mothership-error>{"message":"The worker connection was interrupted."}</mothership-error>'
      )
      if (content) expect(blocks[0]?.content).toBe(content)
    }
  )

  it.each([{ success: true }, { success: false, cancelled: true }])(
    'does not label a successful or stopped response as failed: %j',
    (outcome) => {
      const persisted = buildPersistedAssistantMessage({
        ...outcome,
        content: 'saved work',
        contentBlocks: [],
        toolCalls: [],
        errors: ['an earlier recovered failure'],
      })
      expect(persisted.contentBlocks?.some((block) => block.type === 'error')).not.toBe(true)
    }
  )

  it('keeps task blocks through normalizeMessage instead of flattening them to text', () => {
    const normalized = normalizeMessage({
      id: 'm-1',
      role: 'assistant',
      content: 'armed',
      contentBlocks: [
        {
          type: 'task',
          task: { taskId: 't-1', kind: 'timer', target: {}, note: 'nudge', status: 'pending' },
        },
        { type: 'text', channel: 'assistant', content: 'armed' },
      ],
    })
    expect(normalized.contentBlocks?.map((b) => b.type)).toEqual(['task', 'text'])
    expect(normalized.contentBlocks?.[0]?.task?.taskId).toBe('t-1')
  })

  it('round-trips canonical tool blocks through normalizeMessage', () => {
    const blockTimestamp = 1_700_000_000_000
    const result: OrchestratorResult = {
      success: true,
      content: 'done',
      requestId: 'req-1',
      contentBlocks: [
        {
          type: 'tool_call',
          timestamp: blockTimestamp,
          calledBy: 'workflow',
          toolCall: {
            id: 'tool-1',
            name: 'read',
            status: 'success',
            displayTitle: 'Reading foo.txt',
            params: { path: 'foo.txt' },
            result: { success: true, output: { ok: true } },
          },
        },
      ],
      toolCalls: [],
    }

    const persisted = buildPersistedAssistantMessage(result)
    const normalized = normalizeMessage(persisted as unknown as Record<string, unknown>)

    expect(normalized.contentBlocks).toEqual([
      {
        type: 'tool',
        phase: 'call',
        timestamp: blockTimestamp,
        toolCall: {
          id: 'tool-1',
          name: 'read',
          state: 'success',
          display: { title: 'Reading foo.txt' },
          params: { path: 'foo.txt' },
          result: { success: true, output: { ok: true } },
          calledBy: 'workflow',
        },
      },
      {
        type: 'text',
        channel: 'assistant',
        content: 'done',
      },
    ])
  })

  it('preserves Assistant mode and verified citations through save, compaction, and reload', () => {
    const result: OrchestratorResult = {
      success: true,
      requestId: 'request',
      toolCalls: [],
      content: 'Answer <source>{"id":"document:doc"}</source>',
      contentBlocks: [
        {
          type: 'tool_call',
          toolCall: {
            id: 'retrieval',
            name: 'read_document',
            status: 'success',
            result: {
              success: true,
              output: {
                success: true,
                data: {
                  citationId: 'document:doc',
                  citationUrl: 'https://source.test/doc',
                  documentName: 'Title',
                  chunks: [{ content: 'large passage' }],
                },
              },
            },
          },
        },
      ],
    }
    const persisted = stripToolResultOutput(
      buildPersistedAssistantMessage(result, undefined, 'assistant')
    )
    const normalized = normalizeMessage(persisted as unknown as Record<string, unknown>)
    const displayed = toDisplayMessage(normalized)
    expect(displayed.requestMode).toBe('assistant')
    expect(JSON.stringify(persisted)).not.toContain('large passage')
    const citations = resolveMessageCitations(
      displayed.contentBlocks ?? [],
      displayed.content,
      true
    )
    expect(citations.fallbackContent).toContain('https://source.test/doc')
    expect(citations.fallbackContent).toContain('Title')
  })

  it('prefers an explicit persisted request ID override', () => {
    const result: OrchestratorResult = {
      success: true,
      content: 'done',
      requestId: 'go-trace-1',
      contentBlocks: [],
      toolCalls: [],
    }

    const persisted = buildPersistedAssistantMessage(result, 'sim-request-1')

    expect(persisted.requestId).toBe('sim-request-1')
  })

  it('redacts sim_key credential tags so persisted assistant messages never re-expose the key', () => {
    const live = `Here is your key: <credential>${JSON.stringify({ value: 'sk-sim-secret-123', type: 'sim_key' })}</credential> save it.`
    const result: OrchestratorResult = {
      success: true,
      content: live,
      requestId: 'req-1',
      contentBlocks: [{ type: 'text', content: live, timestamp: 1_700_000_000_000 }],
      toolCalls: [],
    }

    const persisted = buildPersistedAssistantMessage(result)

    expect(persisted.content).not.toContain('sk-sim-secret-123')
    expect(persisted.content).toContain('{"type":"sim_key"}')
    const textBlock = persisted.contentBlocks?.find((b) => b.type === 'text')
    expect(textBlock?.content).not.toContain('sk-sim-secret-123')
    expect(textBlock?.content).toContain('{"type":"sim_key"}')
  })

  it('redacts sim_key credential tags split across streamed text chunks', () => {
    const chunks = [
      'Here\'s your key:\n\n<credential>{"value": "sk-',
      'sim-secret',
      '-12345',
      '", "type":',
      ' "sim_key"}</credential>',
      '\n\nDone.',
    ]
    const result: OrchestratorResult = {
      success: true,
      content: chunks.join(''),
      requestId: 'req-1',
      contentBlocks: chunks.map((c) => ({
        type: 'text',
        content: c,
        timestamp: 1_700_000_000_000,
      })),
      toolCalls: [],
    }

    const persisted = buildPersistedAssistantMessage(result)

    expect(persisted.content).not.toContain('sk-sim-secret-12345')
    expect(persisted.contentBlocks).toBeDefined()
    const joined = (persisted.contentBlocks ?? []).map((b) => b.content ?? '').join('')
    expect(joined).not.toContain('sk-sim-secret-12345')
    expect(joined).toContain('{"type":"sim_key"}')
  })

  it('redacts the api key from a persisted generate_api_key tool result output', () => {
    const result: OrchestratorResult = {
      success: true,
      content: '',
      requestId: 'req-1',
      contentBlocks: [
        {
          type: 'tool_call',
          timestamp: 1_700_000_000_000,
          toolCall: {
            id: 'tool-1',
            name: 'generate_api_key',
            status: 'success',
            params: { name: 'workspace-key' },
            result: {
              success: true,
              output: {
                id: 'k1',
                name: 'workspace-key',
                key: 'sk-sim-tool-output-secret',
              },
            },
          },
        },
      ],
      toolCalls: [],
    }

    const persisted = buildPersistedAssistantMessage(result)
    const toolBlock = persisted.contentBlocks?.find((b) => b.toolCall?.name === 'generate_api_key')
    const output = toolBlock?.toolCall?.result?.output as Record<string, unknown> | undefined

    expect(output?.key).toBe('[REDACTED]')
    expect(output?.redacted).toBe(true)
    expect(JSON.stringify(persisted)).not.toContain('sk-sim-tool-output-secret')
  })

  it('leaves non-sim_key credential tags untouched', () => {
    const live = `<credential>${JSON.stringify({ value: 'https://oauth.example/connect', type: 'link', provider: 'slack' })}</credential>`
    const result: OrchestratorResult = {
      success: true,
      content: live,
      requestId: 'req-1',
      contentBlocks: [{ type: 'text', content: live, timestamp: 1_700_000_000_000 }],
      toolCalls: [],
    }

    const persisted = buildPersistedAssistantMessage(result)

    expect(persisted.content).toContain('https://oauth.example/connect')
  })

  it('normalizes legacy tool_call and top-level toolCalls shapes', () => {
    const normalized = normalizeMessage({
      id: 'msg-1',
      role: 'assistant',
      content: 'hello',
      timestamp: '2024-01-01T00:00:00.000Z',
      contentBlocks: [
        {
          type: 'tool_call',
          toolCall: {
            id: 'tool-1',
            name: 'read',
            state: 'cancelled',
            display: { phaseLabel: 'Workspace' },
          },
        },
      ],
      toolCalls: [
        {
          id: 'tool-2',
          name: 'glob',
          status: 'success',
          result: { matches: [] },
        },
      ],
    })

    expect(normalized.contentBlocks).toEqual([
      {
        type: 'tool',
        phase: 'call',
        toolCall: {
          id: 'tool-1',
          name: 'read',
          state: 'cancelled',
          display: { title: 'Workspace' },
        },
      },
      {
        type: 'text',
        channel: 'assistant',
        content: 'hello',
      },
    ])
  })

  it('builds normalized user messages with stripped optional empties', () => {
    const msg = buildPersistedUserMessage({
      id: 'user-1',
      content: 'hello',
      fileAttachments: [],
      contexts: [],
    })

    expect(msg).toMatchObject({
      id: 'user-1',
      role: 'user',
      content: 'hello',
    })
    expect(msg.fileAttachments).toBeUndefined()
    expect(msg.contexts).toBeUndefined()
  })

  it('keeps the stable workspace address through storage and display', () => {
    const persisted = buildPersistedUserMessage({
      id: 'user-workspace',
      content: '@Planning Review the plan',
      contexts: [{ kind: 'workspace', label: 'Planning', workspaceId: 'ws-planning' }],
    })
    const normalized = normalizeMessage(persisted as unknown as Record<string, unknown>)

    expect(normalized.contexts).toEqual([
      { kind: 'workspace', label: 'Planning', workspaceId: 'ws-planning' },
    ])
    expect(toDisplayMessage(normalized).contexts).toEqual(normalized.contexts)
  })

  it('persists the source names a selection chip renders from, but not its payload', () => {
    const contexts = [
      {
        kind: 'file_selection',
        label: 'notes.md:12-40',
        fileId: 'f1',
        fileName: 'notes.md',
        // Send-time payload: resolved server-side, never re-read for display.
        text: 'the exact passage',
        startLine: 12,
        endLine: 40,
      },
      {
        kind: 'table_selection',
        label: 'Sales (2 rows)',
        tableId: 't1',
        tableName: 'Sales',
        rowIds: ['r1', 'r2'],
      },
    ]
    const msg = buildPersistedUserMessage({
      id: 'user-1',
      content: 'explain this',
      contexts,
    })

    // fileName must survive: the label carries a `:12-40` suffix, so the chip's
    // icon cannot recover an extension from it after a reload.
    expect(msg.contexts?.[0]).toEqual({
      kind: 'file_selection',
      label: 'notes.md:12-40',
      fileId: 'f1',
      fileName: 'notes.md',
    })
    expect(msg.contexts?.[1]).toEqual({
      kind: 'table_selection',
      label: 'Sales (2 rows)',
      tableId: 't1',
      tableName: 'Sales',
    })
  })

  it('round-trips browser and terminal selection snapshots', () => {
    const persisted = buildPersistedUserMessage({
      id: 'user-selection',
      content: '@Docs @Terminal',
      contexts: [
        {
          kind: 'browser_tab',
          label: 'Docs',
          tabId: 'tab-1',
          selection: {
            text: 'Selected browser text',
            url: 'https://example.com/docs',
            title: 'Example docs',
          },
        },
        {
          kind: 'terminal_tab',
          label: 'Terminal',
          terminalId: 'terminal-1',
          selection: {
            text: 'bun test',
            startLine: 12,
            endLine: 13,
          },
        },
      ],
    })

    const normalized = normalizeMessage(persisted as unknown as Record<string, unknown>)

    expect(normalized.contexts).toEqual([
      {
        kind: 'browser_tab',
        label: 'Docs',
        tabId: 'tab-1',
        selection: {
          text: 'Selected browser text',
          url: 'https://example.com/docs',
          title: 'Example docs',
        },
      },
      {
        kind: 'terminal_tab',
        label: 'Terminal',
        terminalId: 'terminal-1',
        selection: {
          text: 'bun test',
          startLine: 12,
          endLine: 13,
        },
      },
    ])
  })
})

describe('stripToolResultOutput', () => {
  it('keeps the partial-coverage marker of an empty search through save and reload', () => {
    const message: PersistedMessage = {
      id: 'msg-search',
      role: 'assistant',
      content: '',
      timestamp: '2026-01-01T00:00:00.000Z',
      contentBlocks: [
        {
          type: 'tool',
          phase: 'call',
          toolCall: {
            id: 'search',
            name: 'search_workspace',
            state: 'success',
            result: {
              success: true,
              output: {
                success: true,
                data: {
                  query: 'q',
                  results: [],
                  retrieval: { status: 'partial', timedOutLegs: ['vector'] },
                },
              },
            },
          },
        },
      ],
    }
    const reloaded = stripToolResultOutput(stripToolResultOutput(message))

    expect(reloaded.contentBlocks?.[0].toolCall?.result?.output).toEqual({
      success: true,
      data: { results: [], retrieval: { status: 'partial' } },
    })
  })

  it('drops result.output but keeps success and error', () => {
    const message: PersistedMessage = {
      id: 'msg-1',
      role: 'assistant',
      content: '',
      timestamp: '2026-01-01T00:00:00.000Z',
      contentBlocks: [
        {
          type: 'tool',
          phase: 'call',
          toolCall: {
            id: 'tool-1',
            name: 'get_workflow_logs',
            state: 'error',
            params: { workflowId: 'wf-1' },
            display: { title: 'Reading logs' },
            result: { success: false, output: { huge: 'x'.repeat(1000) }, error: 'boom' },
          },
        },
      ],
    }

    const stripped = stripToolResultOutput(message)

    expect(stripped.contentBlocks?.[0].toolCall).toEqual({
      id: 'tool-1',
      name: 'get_workflow_logs',
      state: 'error',
      params: { workflowId: 'wf-1' },
      display: { title: 'Reading logs' },
      result: { success: false, error: 'boom' },
    })
    expect(message.contentBlocks?.[0].toolCall?.result).toHaveProperty('output')
  })

  it('omits error when the original result had none', () => {
    const message: PersistedMessage = {
      id: 'msg-1',
      role: 'assistant',
      content: '',
      timestamp: '2026-01-01T00:00:00.000Z',
      contentBlocks: [
        {
          type: 'tool',
          phase: 'call',
          toolCall: {
            id: 't',
            name: 'read',
            state: 'success',
            result: { success: true, output: [1, 2, 3] },
          },
        },
      ],
    }

    expect(stripToolResultOutput(message).contentBlocks?.[0].toolCall?.result).toEqual({
      success: true,
    })
  })

  it('keeps only the answered browser takeover instruction for its question recap', () => {
    const message: PersistedMessage = {
      id: 'msg-takeover',
      role: 'assistant',
      content: '',
      timestamp: '2026-01-01T00:00:00.000Z',
      contentBlocks: [
        {
          type: 'tool',
          phase: 'call',
          toolCall: {
            id: 'takeover-1',
            name: 'browser_request_takeover',
            state: 'success',
            result: {
              success: true,
              output: {
                completed: true,
                elapsedMs: 5_000,
                userInstruction: '  Open the second match  ',
              },
            },
          },
        },
      ],
    }

    const stripped = stripToolResultOutput(message)
    expect(stripped.contentBlocks?.[0].toolCall?.result).toEqual({
      success: true,
      output: { userInstruction: 'Open the second match' },
    })
    expect(stripToolResultOutput(stripped)).toBe(stripped)
  })

  it('returns the same reference when there is nothing to strip', () => {
    const noBlocks: PersistedMessage = {
      id: 'u',
      role: 'user',
      content: 'hi',
      timestamp: '2026-01-01T00:00:00.000Z',
    }
    expect(stripToolResultOutput(noBlocks)).toBe(noBlocks)

    const noOutput: PersistedMessage = {
      id: 'msg',
      role: 'assistant',
      content: 'done',
      timestamp: '2026-01-01T00:00:00.000Z',
      contentBlocks: [
        { type: 'text', channel: 'assistant', content: 'done' },
        { type: 'tool', phase: 'call', toolCall: { id: 't', name: 'read', state: 'pending' } },
        {
          type: 'tool',
          phase: 'call',
          toolCall: {
            id: 't2',
            name: 'read',
            state: 'error',
            result: { success: false, error: 'x' },
          },
        },
      ],
    }
    expect(stripToolResultOutput(noOutput)).toBe(noOutput)
  })

  it('strips every tool block while leaving text/thinking blocks intact', () => {
    const message: PersistedMessage = {
      id: 'msg',
      role: 'assistant',
      content: '',
      timestamp: '2026-01-01T00:00:00.000Z',
      contentBlocks: [
        { type: 'text', channel: 'thinking', content: 'hmm' },
        {
          type: 'tool',
          phase: 'call',
          toolCall: {
            id: 'a',
            name: 'run_workflow',
            state: 'success',
            result: { success: true, output: { big: 1 } },
          },
        },
        { type: 'text', channel: 'assistant', content: 'answer' },
        {
          type: 'tool',
          phase: 'call',
          toolCall: {
            id: 'b',
            name: 'read',
            state: 'success',
            result: { success: true, output: 'file contents' },
          },
        },
      ],
    }

    const blocks = stripToolResultOutput(message).contentBlocks ?? []
    expect(blocks[0]).toEqual({ type: 'text', channel: 'thinking', content: 'hmm' })
    expect(blocks[1].toolCall?.result).toEqual({ success: true })
    expect(blocks[2]).toEqual({ type: 'text', channel: 'assistant', content: 'answer' })
    expect(blocks[3].toolCall?.result).toEqual({ success: true })
    expect(JSON.stringify(blocks)).not.toContain('file contents')
  })
})
