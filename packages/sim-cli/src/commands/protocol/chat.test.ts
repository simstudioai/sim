import { Command } from 'commander'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SimApiError } from '../../http/client.js'
import {
  type ChatDependencies,
  chatCommand,
  composeChatPrompt,
  readChatResponse,
  readChatTurn,
} from './chat.js'
import type { ChatAttachment } from './chat-attachments.js'
import type { ChatContext, ChatSuggestionCandidates } from './chat-suggestions.js'
import type {
  ChatActivity,
  ChatActivityUpdate,
  ChatTerminal,
  ChatTerminalInput,
  ChatTerminalInterruptListener,
  ChatTerminalInterruptReason,
  ChatTerminalQuestion,
  ChatTerminalQuestionResult,
  ChatTerminalSelect,
  ChatTerminalSelectResult,
  ChatTerminalWelcome,
} from './chat-terminal.js'

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  requestRaw: vi.fn(),
  requireWorkspace: vi.fn(() => 'ws_local'),
}))

vi.mock('../../context.js', () => ({
  clientFrom: () => ({ client: mocks, profile: { endpoint: 'https://sim.example' } }),
}))

beforeEach(() => {
  mocks.request.mockReset().mockResolvedValue({ data: [], nextCursor: null })
  mocks.requestRaw.mockReset()
  mocks.requireWorkspace.mockClear()
})

function sse(chunks: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk))
      controller.close()
    },
  })
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } })
}

function completed(content: string, token = 'continuation-1', deltas: string[] = []): Response {
  return sse([
    `event: session\ndata: ${JSON.stringify({
      type: 'session',
      continuationToken: token,
      requestId: 'req_1',
    })}\n\n`,
    ...deltas.map((delta) => `event: text\ndata: ${JSON.stringify({ type: 'text', delta })}\n\n`),
    `event: complete\ndata: ${JSON.stringify({
      type: 'complete',
      data: { content, continuationToken: token },
    })}\n\n`,
    'data: [DONE]\n\n',
  ])
}

function openSse(chunk: string): { response: Response; cancel: ReturnType<typeof vi.fn> } {
  const cancel = vi.fn()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(chunk))
    },
    cancel,
  })
  return {
    response: new Response(body, { headers: { 'content-type': 'text/event-stream' } }),
    cancel,
  }
}

function program(
  readInput: () => Promise<string>,
  writeOutput = vi.fn(),
  overrides: Partial<ChatDependencies> = {}
): Command {
  const root = new Command('sim').exitOverride()
  root.option('-P, --profile <name>')
  root.addCommand(
    chatCommand({
      readInput,
      writeOutput,
      isInteractive: () => false,
      ...overrides,
    })
  )
  return root
}

class FakeTerminal implements ChatTerminal {
  readonly welcomes: string[] = []
  readonly workspaceNames: string[] = []
  attachmentNotes = 0
  readonly chatTitles: string[] = []
  readonly userMessages: string[] = []
  readonly statuses: string[] = []
  readonly thinking: string[] = []
  readonly activities: ChatActivityUpdate[] = []
  readonly questions: ChatTerminalQuestion[] = []
  readonly selections: ChatTerminalSelect[] = []
  readonly reads: Array<{ prompt: string; initialValue: string }> = []
  readonly preloads: Array<{
    value: string
    queued: boolean
    pastes?: ReadonlyMap<number, string>
    contexts?: ChatContext[]
  }> = []
  readonly writes: string[] = []
  readonly suggestionUpdates: ChatSuggestionCandidates[] = []
  suggestionCandidates: ChatSuggestionCandidates | null = null
  clearedTranscripts = 0
  readonly listeners = new Set<ChatTerminalInterruptListener>()
  closed = false
  private stagedPreload = ''

  constructor(
    readonly inputs: ChatTerminalInput[],
    readonly questionResults: ChatTerminalQuestionResult[] = [],
    readonly selectionResults: ChatTerminalSelectResult[] = []
  ) {}

  welcome({ chatTitle }: ChatTerminalWelcome): void {
    this.welcomes.push(chatTitle)
  }

  setChatTitle(title: string): void {
    this.chatTitles.push(title)
  }

  setWorkspaceName(name: string): void {
    this.workspaceNames.push(name)
  }

  noteAttachment(): void {
    this.attachmentNotes += 1
  }

  userMessage(message: string): void {
    this.userMessages.push(message)
  }

  clearTranscript(): void {
    this.clearedTranscripts += 1
  }

  read(prompt: string): Promise<ChatTerminalInput> {
    this.reads.push({ prompt, initialValue: this.stagedPreload })
    this.stagedPreload = ''
    return Promise.resolve(this.inputs.shift() ?? { kind: 'eof' })
  }

  hasQueuedInput(): boolean {
    return (
      Boolean(this.stagedPreload) ||
      this.inputs.some((input) => input.kind === 'line' && input.queued === true)
    )
  }

  preload(
    value: string,
    options: {
      queued?: boolean
      pastes?: ReadonlyMap<number, string>
      contexts?: ChatContext[]
    } = {}
  ): boolean {
    this.preloads.push({
      value,
      queued: options.queued === true,
      ...(options.pastes ? { pastes: options.pastes } : {}),
      ...(options.contexts ? { contexts: options.contexts } : {}),
    })
    this.stagedPreload = value
    return true
  }

  setSuggestionCandidates(candidates: ChatSuggestionCandidates): void {
    this.suggestionCandidates = candidates
    this.suggestionUpdates.push(candidates)
  }

  status(message: string): void {
    this.statuses.push(message)
  }

  write(content: string): void {
    this.writes.push(content)
  }

  activity(_message: string): ChatActivity {
    return {
      update: () => {},
      thinking: (delta) => this.thinking.push(delta),
      event: (update) => this.activities.push(update),
      clear: () => {},
      complete: () => {},
      stop: () => {},
    }
  }

  askQuestion(question: ChatTerminalQuestion): Promise<ChatTerminalQuestionResult> {
    this.questions.push(question)
    return Promise.resolve(this.questionResults.shift() ?? { kind: 'cancel' })
  }

  select(menu: ChatTerminalSelect): Promise<ChatTerminalSelectResult> {
    this.selections.push(menu)
    return Promise.resolve(this.selectionResults.shift() ?? { kind: 'cancel' })
  }

  onInterrupt(listener: ChatTerminalInterruptListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  interrupt(reason: ChatTerminalInterruptReason = 'manual', input?: ChatTerminalInput): void {
    const submitted =
      input ??
      (reason === 'submit' ? this.inputs.find((entry) => entry.kind === 'line') : undefined)
    for (const listener of this.listeners) listener(reason, submitted)
  }

  close(): void {
    this.closed = true
  }
}

describe('chat print mode', () => {
  it('posts to the selected workspace and prints only the completed answer', async () => {
    const wire = [
      ': keepalive\n\n',
      `event: session\ndata: ${JSON.stringify({
        type: 'session',
        continuationToken: 'opaque-token',
        requestId: 'req_1',
      })}\n\n`,
      `event: text\ndata: ${JSON.stringify({ type: 'text', delta: 'Hello ' })}\n\n`,
      `event: text\ndata: ${JSON.stringify({ type: 'text', delta: 'world' })}\n\n`,
      `event: complete\ndata: ${JSON.stringify({
        type: 'complete',
        data: { content: 'Hello world', continuationToken: 'opaque-token' },
      })}\n\n`,
      'data: [DONE]\n\n',
    ].join('')
    mocks.requestRaw.mockResolvedValue(
      sse([wire.slice(0, 41), wire.slice(41, 137), wire.slice(137)])
    )
    const writeOutput = vi.fn()

    await program(async () => '', writeOutput).parseAsync([
      'node',
      'sim',
      'chat',
      '-p',
      'What',
      'is',
      'here?',
    ])

    expect(mocks.requireWorkspace).toHaveBeenCalledWith(undefined, { auth: 'optional' })
    expect(mocks.requestRaw).toHaveBeenCalledWith('/api/v2/chat', {
      method: 'POST',
      headers: { accept: 'text/event-stream' },
      body: { workspaceId: 'ws_local', prompt: 'What is here?' },
      signal: expect.any(AbortSignal),
      auth: 'optional',
    })
    expect(writeOutput).toHaveBeenCalledOnce()
    expect(writeOutput).toHaveBeenCalledWith('Hello world')
  })

  it('resumes an existing chat by ID for one print-mode turn', async () => {
    mocks.request.mockResolvedValueOnce({
      data: {
        id: 'chat-1',
        title: 'Existing chat',
        messages: [],
        continuationToken: 'resume-token',
        active: false,
      },
    })
    mocks.requestRaw.mockResolvedValue(completed('Continued answer', 'next-token'))
    const writeOutput = vi.fn()

    await program(async () => '', writeOutput).parseAsync([
      'node',
      'sim',
      'chat',
      '-p',
      '--chat',
      'chat-1',
      'Continue here',
    ])

    expect(mocks.request).toHaveBeenCalledWith('/api/v2/chats/chat-1', {
      query: { workspaceId: 'ws_local' },
      auth: 'optional',
    })
    expect(mocks.requestRaw.mock.calls[0][1].body).toEqual({
      workspaceId: 'ws_local',
      prompt: 'Continue here',
      continuationToken: 'resume-token',
    })
    expect(writeOutput).toHaveBeenCalledWith('Continued answer')
  })

  it('binds a resumed print-mode token to read-only mode', async () => {
    mocks.request.mockResolvedValueOnce({
      data: {
        id: 'chat-1',
        title: 'Existing chat',
        messages: [],
        continuationToken: 'read-only-token',
        active: false,
      },
    })
    mocks.requestRaw.mockResolvedValue(completed('Read-only answer'))

    await program(async () => '').parseAsync([
      'node',
      'sim',
      'chat',
      '-p',
      '--read-only',
      '--chat',
      'chat-1',
      'Continue safely',
    ])

    expect(mocks.request).toHaveBeenCalledWith('/api/v2/chats/chat-1', {
      query: { workspaceId: 'ws_local', readOnly: true },
      auth: 'optional',
    })
    expect(mocks.requestRaw.mock.calls[0][1].body).toEqual({
      workspaceId: 'ws_local',
      prompt: 'Continue safely',
      readOnly: true,
      continuationToken: 'read-only-token',
    })
  })

  it('rejects --chat outside print mode', async () => {
    await expect(
      program(async () => '', vi.fn(), { isInteractive: () => true }).parseAsync([
        'node',
        'sim',
        'chat',
        '--chat',
        'chat-1',
      ])
    ).rejects.toThrow('--chat can only be used with -p/--print')

    expect(mocks.request).not.toHaveBeenCalled()
    expect(mocks.requestRaw).not.toHaveBeenCalled()
  })

  it('does not race a print-mode turn into a chat active elsewhere', async () => {
    mocks.request.mockResolvedValueOnce({
      data: {
        id: 'chat-1',
        title: 'Existing chat',
        messages: [],
        continuationToken: 'resume-token',
        active: true,
      },
    })

    await expect(
      program(async () => '').parseAsync([
        'node',
        'sim',
        'chat',
        '-p',
        '--chat',
        'chat-1',
        'Continue here',
      ])
    ).rejects.toThrow('currently active in another client')

    expect(mocks.requestRaw).not.toHaveBeenCalled()
  })

  it('surfaces a conflict if the chat becomes active after lookup', async () => {
    mocks.request.mockResolvedValueOnce({
      data: {
        id: 'chat-1',
        title: 'Existing chat',
        messages: [],
        continuationToken: 'resume-token',
        active: false,
      },
    })
    mocks.requestRaw.mockRejectedValueOnce(
      new SimApiError('A response is already in progress for this chat', 409, 'CONFLICT')
    )
    const writeOutput = vi.fn()

    await expect(
      program(async () => '', writeOutput).parseAsync([
        'node',
        'sim',
        'chat',
        '-p',
        '--chat',
        'chat-1',
        'Continue here',
      ])
    ).rejects.toThrow('A response is already in progress for this chat')

    expect(mocks.requestRaw).toHaveBeenCalledOnce()
    expect(writeOutput).not.toHaveBeenCalled()
  })

  it('surfaces an inaccessible chat without starting a new one', async () => {
    mocks.request.mockRejectedValueOnce(new SimApiError('Chat not found', 404, 'NOT_FOUND'))

    await expect(
      program(async () => '').parseAsync([
        'node',
        'sim',
        'chat',
        '-p',
        '--chat',
        'missing-chat',
        'Continue here',
      ])
    ).rejects.toThrow('Chat not found')

    expect(mocks.requestRaw).not.toHaveBeenCalled()
  })

  it('keeps the profile shorthand distinct from chat -p', async () => {
    mocks.requestRaw.mockResolvedValue(completed('answer'))

    await program(async () => '').parseAsync(['node', 'sim', '-P', 'dev', 'chat', '-p', 'question'])

    expect(mocks.requestRaw.mock.calls[0][1].body).toEqual({
      workspaceId: 'ws_local',
      prompt: 'question',
    })
  })

  it('opts into query-only chat only when --read-only is passed', async () => {
    mocks.requestRaw.mockResolvedValue(completed('answer'))

    await program(async () => '').parseAsync([
      'node',
      'sim',
      'chat',
      '-p',
      '--read-only',
      'question',
    ])

    expect(mocks.requestRaw.mock.calls[0][1].body).toEqual({
      workspaceId: 'ws_local',
      prompt: 'question',
      readOnly: true,
    })
  })

  it('combines positional and piped input in Claude Code order', async () => {
    mocks.requestRaw.mockResolvedValue(completed('answer'))

    await program(async () => 'piped context\n').parseAsync([
      'node',
      'sim',
      'chat',
      '--print',
      'Explain',
      'this',
    ])

    expect(mocks.requestRaw.mock.calls[0][1].body.prompt).toBe('Explain this\npiped context\n')
  })

  it('accepts piped input without a positional prompt', async () => {
    mocks.requestRaw.mockResolvedValue(completed('answer'))

    await program(async () => 'question from stdin\n').parseAsync(['node', 'sim', 'chat', '-p'])

    expect(mocks.requestRaw.mock.calls[0][1].body.prompt).toBe('question from stdin\n')
  })

  it('accepts attachment-only turns and never sends local paths', async () => {
    const attachment: ChatAttachment = {
      name: 'notes.md',
      mediaType: 'text/markdown',
      data: 'IyBub3Rlcw==',
    }
    const loadAttachments = vi.fn(async (paths: string[]) => (paths.length ? [attachment] : []))
    mocks.requestRaw.mockResolvedValue(completed('Inspected'))

    await program(async () => '', vi.fn(), { loadAttachments }).parseAsync([
      'node',
      'sim',
      'chat',
      '-p',
      '--file',
      '/private/local/notes.md',
    ])

    expect(loadAttachments).toHaveBeenCalledWith(['/private/local/notes.md'])
    expect(mocks.requestRaw.mock.calls[0][1].body).toEqual({
      workspaceId: 'ws_local',
      prompt: '',
      attachments: [attachment],
    })
    expect(JSON.stringify(mocks.requestRaw.mock.calls[0][1].body)).not.toContain('/private/local')
  })

  it('requires a prompt, attachment, or stdin', async () => {
    await expect(program(async () => '').parseAsync(['node', 'sim', 'chat', '-p'])).rejects.toThrow(
      /Provide a prompt, attach a file, or pipe input/
    )
    expect(mocks.requestRaw).not.toHaveBeenCalled()
  })

  it('caps the combined prompt by UTF-8 bytes', async () => {
    const justOverTenMebibytes = 'é'.repeat(5 * 1024 * 1024 + 1)

    const result = program(async () => justOverTenMebibytes).parseAsync([
      'node',
      'sim',
      'chat',
      '-p',
    ])

    await expect(result).rejects.toMatchObject({
      message: 'Chat input exceeds the 10 MiB limit.',
      status: 0,
    })
    expect(mocks.requestRaw).not.toHaveBeenCalled()
  })

  it('fails clearly instead of blocking when bare chat has no interactive terminal', async () => {
    await expect(
      program(async () => '').parseAsync(['node', 'sim', 'chat', 'question'])
    ).rejects.toThrow(/Use sim chat -p/)
    expect(mocks.requestRaw).not.toHaveBeenCalled()
  })

  it('never constructs a terminal prompt in -p mode', async () => {
    mocks.requestRaw.mockResolvedValue(completed('answer'))
    const createTerminal = vi.fn(() => {
      throw new Error('must not prompt')
    })

    await program(async () => '', vi.fn(), {
      isInteractive: () => true,
      createTerminal,
    }).parseAsync(['node', 'sim', 'chat', '-p', 'question'])

    expect(createTerminal).not.toHaveBeenCalled()
  })

  it('sanitizes final plain text and strips suggested follow-up options', async () => {
    const terminalEscape = String.fromCharCode(27)
    mocks.requestRaw.mockResolvedValue(
      completed(
        `Safe${terminalEscape}]0;owned\u0007 text<options>{"1":{"title":"Next${terminalEscape}[2A","description":"Continue"}}</options>`
      )
    )
    const writeOutput = vi.fn()

    await program(async () => '', writeOutput).parseAsync(['node', 'sim', 'chat', '-p', 'question'])

    expect(writeOutput).toHaveBeenCalledWith('Safe text')
    expect(writeOutput.mock.calls[0][0]).not.toContain(terminalEscape)
  })

  it('trims whitespace owned by hidden options in print mode', async () => {
    const options = '<options>{"1":{"title":"Next","description":"Continue"}}</options>'
    mocks.requestRaw.mockResolvedValue(completed(`Answer\n\n${options}\n\n`))
    const writeOutput = vi.fn()

    await program(async () => '', writeOutput).parseAsync(['node', 'sim', 'chat', '-p', 'question'])

    expect(writeOutput).toHaveBeenCalledOnce()
    expect(writeOutput).toHaveBeenCalledWith('Answer')
  })

  it('renders a path-only file resource as its plain title without another API request', async () => {
    mocks.requestRaw.mockResolvedValue(
      completed(
        '<workspace_resource>{"type":"file","path":"files/Reports/Q4%20Report.csv","title":"Q4 report"}</workspace_resource>'
      )
    )
    const writeOutput = vi.fn()

    await program(async () => '', writeOutput).parseAsync([
      'node',
      'sim',
      'chat',
      '-p',
      'find file',
    ])

    expect(mocks.request).not.toHaveBeenCalled()
    expect(writeOutput).toHaveBeenCalledWith('Q4 report')
  })

  it('omits a trailing standalone workspace link in print mode', async () => {
    const resource =
      '<workspace_resource>{"type":"workflow","id":"wf-forceful","title":"forceful-arm"}</workspace_resource>'
    mocks.requestRaw.mockResolvedValue(completed(`Summary.\n\n${resource}`))
    const writeOutput = vi.fn()

    await program(async () => '', writeOutput).parseAsync([
      'node',
      'sim',
      'chat',
      '-p',
      'inspect forceful-arm',
    ])

    expect(writeOutput).toHaveBeenCalledWith('Summary.')
  })

  it('does not print a partial answer when the stream fails', async () => {
    mocks.requestRaw.mockResolvedValue(
      sse([
        'event: text\ndata: {"type":"text","delta":"partial"}\n\n',
        'event: error\ndata: {"type":"error","error":{"code":"FAILED","message":"No answer"}}\n\n',
      ])
    )
    const writeOutput = vi.fn()

    await expect(
      program(async () => '', writeOutput).parseAsync(['node', 'sim', 'chat', '-p', 'question'])
    ).rejects.toThrow('No answer')
    expect(writeOutput).not.toHaveBeenCalled()
  })

  it('keeps thinking and activity events silent in print mode', async () => {
    mocks.requestRaw.mockResolvedValue(
      sse([
        'event: thinking\ndata: {"type":"thinking","delta":"Checking the workspace"}\n\n',
        'event: activity\ndata: {"type":"activity","data":{"kind":"subagent","id":"agent-1","label":"Build Agent","state":"running"}}\n\n',
        'event: activity\ndata: {"type":"activity","data":{"kind":"narration","parentId":"agent-1","delta":"Inspecting files"}}\n\n',
        'event: activity\ndata: {"type":"activity","data":{"kind":"tool","id":"tool-1","label":"Read workflows","state":"running"}}\n\n',
        'event: text\ndata: {"type":"text","delta":"Answer"}\n\n',
        'event: complete\ndata: {"type":"complete","data":{"content":"Answer","continuationToken":"token-1"}}\n\n',
      ])
    )
    const writeOutput = vi.fn()
    await program(async () => '', writeOutput).parseAsync(['node', 'sim', 'chat', '-p', 'question'])

    expect(writeOutput).toHaveBeenCalledWith('Answer')
  })
})

describe('interactive chat', () => {
  it('shows the resolved workspace name in the terminal header', async () => {
    mocks.request.mockImplementation((path: string) => {
      if (path === '/api/v2/workspaces/ws_local') {
        return Promise.resolve({ data: { name: 'Product Operations' } })
      }
      return Promise.resolve({ data: [], nextCursor: null })
    })
    const terminal = new FakeTerminal([{ kind: 'line', value: '/exit' }])

    await program(async () => '', vi.fn(), {
      isInteractive: () => true,
      createTerminal: () => terminal,
    }).parseAsync(['node', 'sim', 'chat'])

    await vi.waitFor(() => expect(terminal.workspaceNames).toContain('Product Operations'))
  })

  it('renders Markdown in the fullscreen TUI when TERM is dumb', async () => {
    const originalTerm = process.env.TERM
    const originalIsTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: true })
    process.env.TERM = 'dumb'

    try {
      const content = '**Workflows (3)**\n- cobalt_cloud'
      mocks.requestRaw.mockResolvedValue(completed(content, 'token-1', [content]))
      const terminal = new FakeTerminal([{ kind: 'line', value: '/exit' }])

      await program(async () => '', vi.fn(), {
        isInteractive: () => true,
        createTerminal: () => terminal,
      }).parseAsync(['node', 'sim', 'chat', 'list workspace'])

      const esc = String.fromCharCode(27)
      const rendered = terminal.writes.join('')
      expect(rendered).toContain(`${esc}[1mWorkflows (3)`)
      expect(rendered).toContain(`${esc}[2m•${esc}[0m`)
      expect(rendered).not.toContain('**')
      expect(rendered).toContain('cobalt_cloud')
    } finally {
      if (originalIsTTY) {
        Object.defineProperty(process.stdout, 'isTTY', originalIsTTY)
      } else {
        Reflect.deleteProperty(process.stdout, 'isTTY')
      }
      if (originalTerm === undefined) Reflect.deleteProperty(process.env, 'TERM')
      else process.env.TERM = originalTerm
    }
  })

  it('aborts every background suggestion request when the terminal session closes', async () => {
    const signals: AbortSignal[] = []
    mocks.request.mockImplementation(
      (_path: string, options: { signal?: AbortSignal } = {}) =>
        new Promise((_resolve, reject) => {
          if (!options.signal) return
          signals.push(options.signal)
          options.signal.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          })
        })
    )
    const terminal = new FakeTerminal([{ kind: 'line', value: '/exit' }])

    await program(async () => '', vi.fn(), {
      isInteractive: () => true,
      createTerminal: () => terminal,
    }).parseAsync(['node', 'sim', 'chat'])

    expect(signals).toHaveLength(7)
    expect(signals.every((signal) => signal === signals[0])).toBe(true)
    expect(signals[0]?.aborted).toBe(true)
    expect(terminal.closed).toBe(true)
  })

  it('loads workspace resources under @ and skills plus enabled MCP servers under /', async () => {
    mocks.request.mockImplementation((path: string) => {
      if (path === '/api/v2/workflows') {
        return Promise.resolve({ data: [{ id: 'wf-1', name: 'Release' }], nextCursor: null })
      }
      if (path === '/api/v2/tables') {
        return Promise.resolve({ data: [{ id: 'table-1', name: 'Leads' }], nextCursor: null })
      }
      if (path === '/api/v2/files') {
        return Promise.resolve({ data: [{ id: 'file-1', name: 'Brief.md' }], nextCursor: null })
      }
      if (path === '/api/v2/knowledge') {
        return Promise.resolve({ data: [{ id: 'kb-1', name: 'Handbook' }], nextCursor: null })
      }
      if (path === '/api/v2/logs') {
        return Promise.resolve({
          data: Array.from({ length: 55 }, (_, index) => ({
            id: `log-row-${index + 1}`,
            runId: `execution-${index + 1}`,
            workflowId: 'wf-1',
            startedAt: '2026-08-07T12:00:00.000Z',
          })),
          nextCursor: 'more-logs',
        })
      }
      if (path === '/api/v2/skills') {
        return Promise.resolve({
          data: [{ id: 'skill-1', name: 'review', description: 'Review the work' }],
          nextCursor: null,
        })
      }
      if (path === '/api/v2/mcp-servers') {
        return Promise.resolve({
          data: [
            { id: 'mcp-1', name: 'Docs', enabled: true },
            { id: 'mcp-2', name: 'Disabled', enabled: false },
          ],
          nextCursor: null,
        })
      }
      return Promise.resolve({ data: [], nextCursor: null })
    })
    const terminal = new FakeTerminal([{ kind: 'line', value: '/exit' }])

    await program(async () => '', vi.fn(), {
      isInteractive: () => true,
      createTerminal: () => terminal,
    }).parseAsync(['node', 'sim', 'chat'])
    await vi.waitFor(() => {
      expect(terminal.suggestionCandidates?.resources).toHaveLength(54)
      expect(terminal.suggestionCandidates?.slash).toHaveLength(2)
    })

    const resources = terminal.suggestionCandidates?.resources ?? []
    expect(resources.slice(0, 4).map((item) => item.context?.kind)).toEqual([
      'workflow',
      'table',
      'file',
      'knowledge',
    ])
    expect(resources.slice(4)).toHaveLength(50)
    expect(resources.slice(4).every((item) => item.context?.kind === 'logs')).toBe(true)
    expect(resources.at(-1)?.context).toMatchObject({
      kind: 'logs',
      executionId: 'execution-50',
      label: expect.stringContaining('Release'),
    })
    expect(terminal.suggestionCandidates?.slash.map((item) => item.context?.kind)).toEqual([
      'skill',
      'mcp',
    ])
    expect(terminal.suggestionCandidates?.slash.map((item) => item.displayText)).toEqual([
      '/review',
      '/Docs',
    ])
    expect(
      terminal.suggestionUpdates.some(
        (update) =>
          update.resources.length + update.slash.length > 0 && update.resources.length < 54
      )
    ).toBe(true)
    const logRequests = mocks.request.mock.calls.filter(([path]) => path === '/api/v2/logs')
    expect(logRequests).toHaveLength(1)
    expect(logRequests[0]?.[1]).toMatchObject({
      query: {
        workspaceId: 'ws_local',
        details: 'basic',
        order: 'desc',
        limit: 50,
      },
    })
  })

  it('publishes skills but does not fetch or suggest MCP servers in read-only chat', async () => {
    mocks.request.mockImplementation((path: string) => {
      if (path === '/api/v2/skills') {
        return Promise.resolve({
          data: [{ id: 'skill-1', name: 'review', description: 'Review the work' }],
          nextCursor: null,
        })
      }
      if (path === '/api/v2/mcp-servers') {
        return Promise.resolve({
          data: [{ id: 'mcp-1', name: 'Docs', enabled: true }],
          nextCursor: null,
        })
      }
      return Promise.resolve({ data: [], nextCursor: null })
    })
    const terminal = new FakeTerminal([{ kind: 'line', value: '/exit' }])

    await program(async () => '', vi.fn(), {
      isInteractive: () => true,
      createTerminal: () => terminal,
    }).parseAsync(['node', 'sim', 'chat', '--read-only'])
    await vi.waitFor(() => expect(terminal.suggestionCandidates?.slash).toHaveLength(1))

    expect(terminal.suggestionCandidates?.slash[0]?.context?.kind).toBe('skill')
    expect(mocks.request.mock.calls.some(([path]) => path === '/api/v2/mcp-servers')).toBe(false)
  })

  it('publishes each suggestion family without waiting for a slower list', async () => {
    let resolveWorkflows:
      | ((page: { data: Array<{ id: string; name: string }>; nextCursor: null }) => void)
      | undefined
    const workflows = new Promise<{ data: Array<{ id: string; name: string }>; nextCursor: null }>(
      (resolve) => {
        resolveWorkflows = resolve
      }
    )
    mocks.request.mockImplementation((path: string) => {
      if (path === '/api/v2/workflows') return workflows
      if (path === '/api/v2/files') {
        return Promise.resolve({ data: [{ id: 'file-1', name: 'Ready.md' }], nextCursor: null })
      }
      return Promise.resolve({ data: [], nextCursor: null })
    })
    const terminal = new FakeTerminal([{ kind: 'line', value: '/exit' }])

    await program(async () => '', vi.fn(), {
      isInteractive: () => true,
      createTerminal: () => terminal,
    }).parseAsync(['node', 'sim', 'chat'])
    await vi.waitFor(() =>
      expect(terminal.suggestionCandidates?.resources.map((item) => item.displayText)).toContain(
        'Ready.md'
      )
    )
    expect(terminal.suggestionCandidates?.resources.map((item) => item.displayText)).not.toContain(
      'Later workflow'
    )

    resolveWorkflows?.({ data: [{ id: 'workflow-1', name: 'Later workflow' }], nextCursor: null })
    await vi.waitFor(() =>
      expect(terminal.suggestionCandidates?.resources.map((item) => item.displayText)).toContain(
        'Later workflow'
      )
    )
  })

  it('sends selected resource and slash identities beside the prompt', async () => {
    const contexts: ChatContext[] = [
      { kind: 'workflow', workflowId: 'workflow-1', label: 'Release' },
      { kind: 'skill', skillId: 'skill-1', label: 'review' },
      { kind: 'mcp', serverId: 'mcp-1', label: 'Docs' },
    ]
    const terminal = new FakeTerminal([
      {
        kind: 'line',
        value: 'Use @Release with /review and /Docs',
        contexts,
      },
      { kind: 'line', value: '/exit' },
    ])
    mocks.requestRaw.mockResolvedValueOnce(completed('Done', 'token-1'))

    await program(async () => '', vi.fn(), {
      isInteractive: () => true,
      createTerminal: () => terminal,
    }).parseAsync(['node', 'sim', 'chat'])

    expect(mocks.requestRaw.mock.calls[0][1].body).toMatchObject({
      prompt: 'Use @Release with /review and /Docs',
      contexts,
    })
  })

  it('lists every chat page and refreshes an active choice before sending', async () => {
    let detailRequests = 0
    mocks.request.mockImplementation((path: string, options?: { query?: unknown }) => {
      if (path === '/api/v2/chats') {
        const cursor = (options?.query as { cursor?: string | null } | undefined)?.cursor
        if (cursor === 'older-chats') {
          return Promise.resolve({
            data: [
              {
                id: 'chat-older',
                title: 'Older investigation',
                updatedAt: '2026-07-01T12:00:00.000Z',
                pinned: false,
                active: false,
              },
            ],
            nextCursor: null,
          })
        }
        return Promise.resolve({
          data: [
            {
              id: 'chat-2',
              title: 'Release investigation',
              updatedAt: '2026-08-07T12:00:00.000Z',
              pinned: true,
              active: true,
            },
          ],
          nextCursor: 'older-chats',
        })
      }
      if (path === '/api/v2/chats/chat-2') {
        detailRequests += 1
        const active = detailRequests === 1
        return Promise.resolve({
          data: {
            id: 'chat-2',
            title: 'Release investigation',
            messages: [
              {
                id: 'message-1',
                role: 'user',
                content: 'What failed?',
                timestamp: '2026-08-07T11:59:00.000Z',
              },
              {
                id: 'message-2',
                role: 'assistant',
                content: active
                  ? 'The **release** is still running.'
                  : 'The **release** finished.\n\n<workspace_resource>{"type":"workflow","id":"wf-forceful","title":"forceful-arm"}</workspace_resource>',
                timestamp: '2026-08-07T12:00:00.000Z',
              },
            ],
            continuationToken: active ? 'resume-token' : 'refreshed-token',
            active,
          },
        })
      }
      return Promise.resolve({ data: [], nextCursor: null, options })
    })
    mocks.requestRaw.mockResolvedValueOnce(completed('Continuing', 'next-token'))
    const terminal = new FakeTerminal(
      [
        { kind: 'line', value: '/chats' },
        { kind: 'line', value: 'Continue here' },
        { kind: 'line', value: '/exit' },
      ],
      [],
      [{ kind: 'selected', id: 'chat-2' }]
    )

    await program(async () => '', vi.fn(), {
      isInteractive: () => true,
      createTerminal: () => terminal,
      formatMarkdown: () => false,
    }).parseAsync(['node', 'sim', 'chat'])

    expect(terminal.selections).toHaveLength(1)
    expect(terminal.selections[0]?.options).toEqual([
      {
        id: 'sim-cli:new-chat',
        label: 'New chat',
        description: 'start a blank conversation',
      },
      expect.objectContaining({
        id: 'chat-2',
        label: 'Release investigation',
        description: expect.stringContaining('pinned'),
      }),
      expect.objectContaining({
        id: 'chat-older',
        label: 'Older investigation',
      }),
    ])
    expect(detailRequests).toBe(2)
    expect(terminal.clearedTranscripts).toBe(2)
    expect(terminal.statuses).toContain(
      'Opened Release investigation. This chat is currently active elsewhere.'
    )
    expect(terminal.statuses).toContain('Resumed Release investigation.')
    expect(terminal.chatTitles).toContain('Release investigation')
    expect(terminal.userMessages).toContain('What failed?')
    expect(terminal.userMessages).toContain('Continue here')
    expect(terminal.writes.join('')).toContain('The **release** finished.\n')
    expect(terminal.writes.join('')).not.toContain('forceful-arm')
    expect(mocks.requestRaw.mock.calls[0][1].body).toMatchObject({
      workspaceId: 'ws_local',
      prompt: 'Continue here',
      continuationToken: 'refreshed-token',
    })
    const listRequests = mocks.request.mock.calls.filter(([path]) => path === '/api/v2/chats')
    expect(listRequests).toHaveLength(2)
    expect(listRequests[0]?.[1]).toMatchObject({
      query: { workspaceId: 'ws_local', limit: 100, cursor: null },
    })
    expect(listRequests[1]?.[1]).toMatchObject({
      query: { workspaceId: 'ws_local', limit: 100, cursor: 'older-chats' },
    })
  })

  it('refreshes a resumed chat before retrying after a send races with remote activity', async () => {
    let detailRequests = 0
    mocks.request.mockImplementation((path: string) => {
      if (path === '/api/v2/chats') {
        return Promise.resolve({
          data: [
            {
              id: 'chat-race',
              title: 'Race investigation',
              updatedAt: '2026-08-07T12:00:00.000Z',
              pinned: false,
              active: false,
            },
          ],
          nextCursor: null,
        })
      }
      if (path === '/api/v2/chats/chat-race') {
        detailRequests += 1
        return Promise.resolve({
          data: {
            id: 'chat-race',
            title: 'Race investigation',
            messages: [
              {
                id: `message-${detailRequests}`,
                role: 'assistant',
                content: detailRequests === 1 ? 'Ready.' : 'The remote response finished.',
                timestamp: '2026-08-07T12:00:00.000Z',
              },
            ],
            continuationToken: detailRequests === 1 ? 'initial-token' : 'refreshed-token',
            active: false,
          },
        })
      }
      return Promise.resolve({ data: [], nextCursor: null })
    })
    mocks.requestRaw
      .mockRejectedValueOnce(
        new SimApiError('A response is already in progress for this chat', 409, 'CONFLICT')
      )
      .mockResolvedValueOnce(completed('Retried', 'next-token'))
    const terminal = new FakeTerminal(
      [
        { kind: 'line', value: '/chats' },
        { kind: 'line', value: 'Retry this turn' },
        { kind: 'line', value: 'Retry this turn' },
        { kind: 'line', value: '/exit' },
      ],
      [],
      [{ kind: 'selected', id: 'chat-race' }]
    )

    await program(async () => '', vi.fn(), {
      isInteractive: () => true,
      createTerminal: () => terminal,
    }).parseAsync(['node', 'sim', 'chat'])

    expect(detailRequests).toBe(2)
    expect(terminal.clearedTranscripts).toBe(2)
    expect(terminal.preloads).toContainEqual({ value: 'Retry this turn', queued: true })
    expect(terminal.statuses).toContain(
      'Previous response is still settling. Press Enter to retry.'
    )
    expect(terminal.writes.join('')).toContain('The remote response finished.\n')
    expect(mocks.requestRaw).toHaveBeenCalledTimes(2)
    expect(mocks.requestRaw.mock.calls[1][1].body).toMatchObject({
      workspaceId: 'ws_local',
      prompt: 'Retry this turn',
      continuationToken: 'refreshed-token',
    })
  })

  it('repaints and restores the exact turn while a resumed chat remains active elsewhere', async () => {
    const attachment: ChatAttachment = {
      name: 'notes.txt',
      mediaType: 'text/plain',
      data: 'bm90ZXM=',
    }
    const pasted = 'p'.repeat(900)
    const display = 'Retry @Release [Pasted text #1]'
    const prompt = `Retry @Release ${pasted}`
    const pastes = new Map([[1, pasted]])
    const contexts: ChatContext[] = [
      { kind: 'workflow', workflowId: 'workflow-1', label: 'Release' },
    ]
    let detailRequests = 0
    mocks.request.mockImplementation((path: string) => {
      if (path === '/api/v2/chats') {
        return Promise.resolve({
          data: [
            {
              id: 'chat-active',
              title: 'Active investigation',
              updatedAt: '2026-08-07T12:00:00.000Z',
              pinned: false,
              active: true,
            },
          ],
          nextCursor: null,
        })
      }
      if (path === '/api/v2/chats/chat-active') {
        detailRequests += 1
        const active = detailRequests < 3
        return Promise.resolve({
          data: {
            id: 'chat-active',
            title: 'Active investigation',
            messages: [
              {
                id: 'message-1',
                role: 'assistant',
                content: active ? 'Still working.' : 'Finished now.',
                timestamp: '2026-08-07T12:00:00.000Z',
              },
            ],
            continuationToken: `resume-token-${detailRequests}`,
            active,
          },
        })
      }
      return Promise.resolve({ data: [], nextCursor: null })
    })
    mocks.requestRaw.mockResolvedValueOnce(completed('Retried', 'next-token'))
    const terminal = new FakeTerminal(
      [
        { kind: 'clipboard', value: '' },
        { kind: 'line', value: '/chats' },
        { kind: 'line', value: prompt, display, pastes, contexts },
        { kind: 'line', value: prompt, display, pastes, contexts },
        { kind: 'line', value: '/exit' },
      ],
      [],
      [{ kind: 'selected', id: 'chat-active' }]
    )

    await program(async () => '', vi.fn(), {
      isInteractive: () => true,
      createTerminal: () => terminal,
      clipboardAttachment: async () => attachment,
      extractAttachmentPaths: async () => null,
    }).parseAsync(['node', 'sim', 'chat'])

    expect(detailRequests).toBe(3)
    expect(terminal.statuses).toContain(
      'Refreshed Active investigation. This chat remains active elsewhere.'
    )
    expect(terminal.preloads).toContainEqual({
      value: display,
      queued: true,
      pastes,
      contexts,
    })
    expect(terminal.userMessages).toContain(display)
    expect(mocks.requestRaw).toHaveBeenCalledTimes(1)
    expect(mocks.requestRaw.mock.calls[0][1].body).toMatchObject({
      workspaceId: 'ws_local',
      prompt,
      continuationToken: 'resume-token-3',
      attachments: [attachment],
      contexts,
    })
  })

  it('visibly resets the transcript and continuation identity with /new', async () => {
    mocks.requestRaw
      .mockResolvedValueOnce(
        sse([
          'event: session\ndata: {"type":"session","chatId":"chat-1","continuationToken":"token-1"}\n\n',
          'event: complete\ndata: {"type":"complete","data":{"content":"First","continuationToken":"token-1"}}\n\n',
        ])
      )
      .mockResolvedValueOnce(completed('Second', 'token-2'))
    const terminal = new FakeTerminal([
      { kind: 'line', value: '/new' },
      { kind: 'line', value: 'Fresh question' },
      { kind: 'line', value: '/exit' },
    ])

    await program(async () => '', vi.fn(), {
      isInteractive: () => true,
      createTerminal: () => terminal,
    }).parseAsync(['node', 'sim', 'chat', 'Original question'])

    expect(terminal.clearedTranscripts).toBe(1)
    expect(terminal.statuses).toContain('Started a new conversation.')
    expect(terminal.chatTitles).toContain('New chat')
    expect(mocks.requestRaw.mock.calls[1][1].body).toEqual({
      workspaceId: 'ws_local',
      prompt: 'Fresh question',
    })
  })

  it('updates the welcome header when the server generates a chat title', async () => {
    mocks.requestRaw.mockResolvedValueOnce(
      sse([
        'event: session\ndata: {"type":"session","chatId":"chat-1","continuationToken":"token-1"}\n\n',
        'event: session\ndata: {"type":"session","title":"Release investigation"}\n\n',
        'event: complete\ndata: {"type":"complete","data":{"content":"Done","continuationToken":"token-1"}}\n\n',
      ])
    )
    const terminal = new FakeTerminal([{ kind: 'line', value: '/exit' }])

    await program(async () => '', vi.fn(), {
      isInteractive: () => true,
      createTerminal: () => terminal,
    }).parseAsync(['node', 'sim', 'chat', 'Investigate the release'])

    expect(terminal.welcomes).toEqual(['New chat'])
    expect(terminal.chatTitles).toContain('Release investigation')
  })

  it('renames the active synced chat and updates the terminal header', async () => {
    mocks.requestRaw.mockResolvedValueOnce(
      sse([
        'event: session\ndata: {"type":"session","chatId":"chat-1","continuationToken":"token-1"}\n\n',
        'event: complete\ndata: {"type":"complete","data":{"content":"Done","continuationToken":"token-1"}}\n\n',
      ])
    )
    mocks.request.mockImplementation((path: string) => {
      if (path === '/api/v2/chats/chat-1') {
        return Promise.resolve({
          data: { id: 'chat-1', title: 'Incident investigation' },
        })
      }
      return Promise.resolve({ data: [], nextCursor: null })
    })
    const terminal = new FakeTerminal([
      { kind: 'line', value: '/rename Incident investigation' },
      { kind: 'line', value: '/exit' },
    ])

    await program(async () => '', vi.fn(), {
      isInteractive: () => true,
      createTerminal: () => terminal,
    }).parseAsync(['node', 'sim', 'chat', 'Investigate the incident'])

    const renameRequest = mocks.request.mock.calls.find(
      ([path, options]) => path === '/api/v2/chats/chat-1' && options?.method === 'PATCH'
    )
    expect(renameRequest?.[1]).toEqual({
      method: 'PATCH',
      body: { workspaceId: 'ws_local', title: 'Incident investigation' },
      auth: 'optional',
    })
    expect(terminal.chatTitles).toContain('Incident investigation')
    expect(terminal.statuses).toContain('Renamed chat to Incident investigation.')
  })

  it('requires a synced chat before renaming', async () => {
    const terminal = new FakeTerminal([
      { kind: 'line', value: '/rename Draft title' },
      { kind: 'line', value: '/exit' },
    ])

    await program(async () => '', vi.fn(), {
      isInteractive: () => true,
      createTerminal: () => terminal,
    }).parseAsync(['node', 'sim', 'chat'])

    expect(terminal.statuses).toContain('Send a message before renaming this chat.')
    expect(mocks.request.mock.calls.some(([, options]) => options?.method === 'PATCH')).toBe(false)
  })

  it('validates rename titles locally', async () => {
    const terminal = new FakeTerminal([
      { kind: 'line', value: '/rename' },
      { kind: 'line', value: `/rename ${'x'.repeat(201)}` },
      { kind: 'line', value: '/exit' },
    ])

    await program(async () => '', vi.fn(), {
      isInteractive: () => true,
      createTerminal: () => terminal,
    }).parseAsync(['node', 'sim', 'chat'])

    expect(terminal.statuses).toContain('Usage: /rename <title>')
    expect(terminal.statuses).toContain('Error: Chat title cannot exceed 200 characters.')
    expect(mocks.request.mock.calls.some(([, options]) => options?.method === 'PATCH')).toBe(false)
  })

  it('keeps the current title when rename fails', async () => {
    mocks.requestRaw.mockResolvedValueOnce(
      sse([
        'event: session\ndata: {"type":"session","chatId":"chat-1","title":"Current title","continuationToken":"token-1"}\n\n',
        'event: complete\ndata: {"type":"complete","data":{"content":"Done","continuationToken":"token-1"}}\n\n',
      ])
    )
    mocks.request.mockImplementation((path: string) => {
      if (path === '/api/v2/chats/chat-1') return Promise.reject(new Error('Rename failed'))
      return Promise.resolve({ data: [], nextCursor: null })
    })
    const terminal = new FakeTerminal([
      { kind: 'line', value: '/rename New title' },
      { kind: 'line', value: '/exit' },
    ])

    await program(async () => '', vi.fn(), {
      isInteractive: () => true,
      createTerminal: () => terminal,
    }).parseAsync(['node', 'sim', 'chat', 'Start'])

    expect(terminal.chatTitles).toEqual(['Current title'])
    expect(terminal.statuses).toContain('Error: Rename failed')
  })

  it('sends only MCP contexts explicitly tagged on each turn', async () => {
    const mcp: ChatContext = { kind: 'mcp', serverId: 'mcp-1', label: 'Docs' }
    const terminal = new FakeTerminal([
      { kind: 'line', value: '/Docs search', contexts: [mcp] },
      { kind: 'line', value: 'Search again' },
      { kind: 'line', value: '/exit' },
    ])
    mocks.requestRaw
      .mockResolvedValueOnce(completed('First', 'token-1'))
      .mockResolvedValueOnce(completed('Second', 'token-2'))

    await program(async () => '', vi.fn(), {
      isInteractive: () => true,
      createTerminal: () => terminal,
    }).parseAsync(['node', 'sim', 'chat'])

    expect(mocks.requestRaw.mock.calls[0][1].body.contexts).toEqual([mcp])
    expect(mocks.requestRaw.mock.calls[1][1].body.contexts).toBeUndefined()
  })

  it('quietly clears on Ctrl+C and exits on a second empty Ctrl+C', async () => {
    const terminal = new FakeTerminal([
      { kind: 'interrupt', empty: true },
      { kind: 'interrupt', empty: true },
    ])

    await program(async () => '', vi.fn(), {
      isInteractive: () => true,
      createTerminal: () => terminal,
    }).parseAsync(['node', 'sim', 'chat'])

    expect(terminal.statuses).toEqual([])
    expect(terminal.welcomes).toEqual(['New chat'])
    expect(mocks.requestRaw).not.toHaveBeenCalled()
    expect(terminal.closed).toBe(true)
  })

  it('strips suggested follow-ups and keeps the next composer message free-form', async () => {
    const options =
      '<options>{"1":{"title":"First","description":"A"},"2":{"title":"Second","description":"B"}}</options>'
    mocks.requestRaw
      .mockResolvedValueOnce(
        completed(options, 'token-1', [options.slice(0, 31), options.slice(31)])
      )
      .mockResolvedValueOnce(completed('Done', 'token-2', ['Do', 'ne']))
    const terminal = new FakeTerminal([
      { kind: 'line', value: 'A different request' },
      { kind: 'line', value: '/exit' },
    ])
    await program(async () => '', vi.fn(), {
      isInteractive: () => true,
      createTerminal: () => terminal,
      formatMarkdown: () => false,
    }).parseAsync(['node', 'sim', 'chat', 'start'])

    expect(mocks.requestRaw).toHaveBeenCalledTimes(2)
    expect(mocks.requestRaw.mock.calls[1][1].body).toEqual({
      workspaceId: 'ws_local',
      prompt: 'A different request',
      continuationToken: 'token-1',
    })
    expect(terminal.writes.join('')).toBe('Done\n')
    expect(terminal.statuses.join('\n')).not.toContain('Suggested follow-ups')
    expect(terminal.statuses.join('\n')).not.toContain('First')
    expect(terminal.reads[0]).toEqual({ prompt: '❯ ', initialValue: '' })
    expect(terminal.userMessages).toEqual(['start'])
    expect(terminal.closed).toBe(true)
  })

  it.each([
    ['plain trailing whitespace', 'Answer\n\n'],
    [
      'whitespace before hidden options',
      'Answer\n\n<options>{"1":{"title":"Next","description":"Continue"}}</options>\n\n',
    ],
  ])('hands %s to the next composer with exactly one newline', async (_name, content) => {
    mocks.requestRaw.mockResolvedValue(completed(content, 'token-1', [content]))
    const terminal = new FakeTerminal([{ kind: 'line', value: '/exit' }])
    await program(async () => '', vi.fn(), {
      isInteractive: () => true,
      createTerminal: () => terminal,
    }).parseAsync(['node', 'sim', 'chat', 'start'])

    expect(terminal.writes.join('')).toBe('Answer\n')
    expect(terminal.reads).toEqual([{ prompt: '❯ ', initialValue: '' }])
  })

  it('renders tagged resource bullets as plain names without links or undefined prefixes', async () => {
    const content = [
      'Workflows\n',
      '- <workspace_resource>{"type":"workflow","id":"wf-1","title":"default-agent"}</workspace_resource>\n',
      '- <workspace_resource>{"type":"workflow","id":"wf-2","title":"forceful-arm"}</workspace_resource>',
    ].join('')
    mocks.requestRaw.mockResolvedValue(completed(content, 'token-1', [content]))
    const terminal = new FakeTerminal([{ kind: 'line', value: '/exit' }])

    await program(async () => '', vi.fn(), {
      isInteractive: () => true,
      createTerminal: () => terminal,
      formatMarkdown: () => true,
    }).parseAsync(['node', 'sim', 'chat', 'list resources'])

    const rendered = terminal.writes.join('')
    expect(rendered).toContain('default-agent')
    expect(rendered).toContain('forceful-arm')
    expect(rendered).not.toContain('undefined')
    expect(rendered).not.toContain('https://')
    expect(rendered).not.toContain(`${String.fromCharCode(27)}]8;;`)
  })

  it('omits a trailing standalone workspace link that has no terminal action', async () => {
    const resource =
      '<workspace_resource>{"type":"workflow","id":"wf-forceful","title":"forceful-arm"}</workspace_resource>'
    const content = [
      'Three blocks, mostly a stub:\n\n',
      '- Start — manual trigger.\n',
      '- Router 1 — always routes hi.\n',
      '- Agent 1 — replies to hi.\n\n',
      resource,
    ].join('')
    mocks.requestRaw.mockResolvedValue(
      completed(content, 'token-1', [
        content.slice(0, content.indexOf('<workspace_resource>') + 12),
        content.slice(content.indexOf('<workspace_resource>') + 12, -8),
        content.slice(-8),
      ])
    )
    const terminal = new FakeTerminal([{ kind: 'line', value: '/exit' }])

    await program(async () => '', vi.fn(), {
      isInteractive: () => true,
      createTerminal: () => terminal,
      formatMarkdown: () => false,
    }).parseAsync(['node', 'sim', 'chat', 'inspect forceful-arm'])

    const rendered = terminal.writes.join('')
    expect(rendered).toContain('Three blocks, mostly a stub:')
    expect(rendered).toContain('- Agent 1 — replies to hi.')
    expect(rendered).not.toContain('forceful-arm')
    expect(rendered.endsWith('\n')).toBe(true)
  })

  it('restores a deferred workspace link when a later chunk continues the answer', async () => {
    const resource =
      '<workspace_resource>{"type":"workflow","id":"wf-forceful","title":"forceful-arm"}</workspace_resource>'
    const first = `Summary.\n\n${resource}`
    const content = `${first}\nThen continue.`
    mocks.requestRaw.mockResolvedValue(completed(content, 'token-1', [first, '\nThen continue.']))
    const terminal = new FakeTerminal([{ kind: 'line', value: '/exit' }])

    await program(async () => '', vi.fn(), {
      isInteractive: () => true,
      createTerminal: () => terminal,
      formatMarkdown: () => false,
    }).parseAsync(['node', 'sim', 'chat', 'inspect forceful-arm'])

    expect(terminal.writes.join('')).toBe('Summary.\n\nforceful-arm\nThen continue.\n')
  })

  it('uses the dedicated question panel and sends its answer with the continuation token', async () => {
    const question =
      '<question>{"type":"single_select","prompt":"Which service should I inspect?","options":[{"id":"api","label":"API"},{"id":"worker","label":"Worker"}]}</question>'
    mocks.requestRaw
      .mockResolvedValueOnce(completed(question, 'token-1'))
      .mockResolvedValueOnce(completed('Done', 'token-2'))
    const terminal = new FakeTerminal(
      [{ kind: 'line', value: '/exit' }],
      [{ kind: 'answer', values: ['Worker'] }]
    )

    await program(async () => '', vi.fn(), {
      isInteractive: () => true,
      createTerminal: () => terminal,
    }).parseAsync(['node', 'sim', 'chat', 'start'])

    expect(terminal.questions).toEqual([
      {
        prompt: 'Which service should I inspect?',
        multi: false,
        options: [
          { id: 'api', label: 'API' },
          { id: 'worker', label: 'Worker' },
        ],
      },
    ])
    expect(mocks.requestRaw.mock.calls[1][1].body).toEqual({
      workspaceId: 'ws_local',
      prompt: 'Which service should I inspect? — Worker',
      continuationToken: 'token-1',
    })
  })

  it('runs queued local commands before presenting a retained structured question', async () => {
    const question =
      '<question>{"type":"single_select","prompt":"Proceed?","options":[{"id":"yes","label":"Yes"}]}</question>'
    mocks.requestRaw
      .mockResolvedValueOnce(completed(question, 'token-1'))
      .mockResolvedValueOnce(completed('Done', 'token-2'))
    const terminal = new FakeTerminal(
      [
        { kind: 'line', value: '/help', queued: true, display: '/help' },
        { kind: 'line', value: '/exit' },
      ],
      [{ kind: 'answer', values: ['Yes'] }]
    )

    await program(async () => '', vi.fn(), {
      isInteractive: () => true,
      createTerminal: () => terminal,
    }).parseAsync(['node', 'sim', 'chat', 'start'])

    expect(terminal.statuses.join('\n')).toContain('Commands:')
    expect(terminal.questions).toHaveLength(1)
    expect(mocks.requestRaw.mock.calls.map(([, options]) => options.body.prompt)).toEqual([
      'start',
      'Proceed? — Yes',
    ])
  })

  it('attaches a queued path without answering a retained question', async () => {
    const question =
      '<question>{"type":"single_select","prompt":"Proceed?","options":[{"id":"yes","label":"Yes"}]}</question>'
    const attachment: ChatAttachment = {
      name: 'report.txt',
      mediaType: 'text/plain',
      data: 'cmVwb3J0',
    }
    mocks.requestRaw
      .mockResolvedValueOnce(completed(question, 'token-1'))
      .mockResolvedValueOnce(completed('Done', 'token-2'))
    const terminal = new FakeTerminal(
      [
        {
          kind: 'line',
          value: '/private/tmp/report.txt',
          queued: true,
          display: '/private/tmp/report.txt',
        },
        { kind: 'line', value: '/exit' },
      ],
      [{ kind: 'answer', values: ['Yes'] }]
    )

    await program(async () => '', vi.fn(), {
      isInteractive: () => true,
      createTerminal: () => terminal,
      extractAttachmentPaths: async (value: string) =>
        value === '/private/tmp/report.txt'
          ? { paths: ['/private/tmp/report.txt'], text: '[File #1]' }
          : null,
      loadAttachments: async () => [attachment],
    }).parseAsync(['node', 'sim', 'chat', 'start'])

    expect(terminal.questions).toHaveLength(1)
    expect(mocks.requestRaw.mock.calls[1][1].body).toEqual({
      workspaceId: 'ws_local',
      prompt: 'Proceed? — Yes',
      continuationToken: 'token-1',
    })
  })

  it('honors a queued exit before opening a structured question', async () => {
    const question =
      '<question>{"type":"single_select","prompt":"Proceed?","options":[{"id":"yes","label":"Yes"}]}</question>'
    mocks.requestRaw.mockResolvedValueOnce(completed(question, 'token-1'))
    const terminal = new FakeTerminal([
      { kind: 'line', value: '/exit', queued: true, display: '/exit' },
    ])

    await program(async () => '', vi.fn(), {
      isInteractive: () => true,
      createTerminal: () => terminal,
    }).parseAsync(['node', 'sim', 'chat', 'start'])

    expect(terminal.questions).toEqual([])
    expect(mocks.requestRaw).toHaveBeenCalledTimes(1)
  })

  it('submits question arrays and multi-selects in the Mothership answer format', async () => {
    const questions =
      '<question>[{"type":"single_select","prompt":"Environment?","options":[{"id":"dev","label":"Dev"},{"id":"prod","label":"Prod"}]},{"type":"multi_select","prompt":"Services?","options":[{"id":"api","label":"API"},{"id":"worker","label":"Worker"}]}]</question>'
    mocks.requestRaw
      .mockResolvedValueOnce(completed(questions, 'token-1'))
      .mockResolvedValueOnce(completed('Done', 'token-2'))
    const terminal = new FakeTerminal(
      [{ kind: 'line', value: '/exit' }],
      [
        { kind: 'answer', values: ['Prod'] },
        { kind: 'answer', values: ['API', 'custom service'] },
      ]
    )

    await program(async () => '', vi.fn(), {
      isInteractive: () => true,
      createTerminal: () => terminal,
    }).parseAsync(['node', 'sim', 'chat', 'start'])

    expect(terminal.statuses).toEqual(['Question 1 of 2', 'Question 2 of 2'])
    expect(mocks.requestRaw.mock.calls[1][1].body.prompt).toBe(
      'Environment? — Prod\nServices? — API, custom service'
    )
  })

  it('never interprets a model-authored question answer as a local slash command', async () => {
    const question =
      '<question>{"type":"single_select","prompt":"Proceed?","options":[{"id":"bad","label":"/attach /secret"}]}</question>'
    mocks.requestRaw
      .mockResolvedValueOnce(completed(question, 'token-1'))
      .mockResolvedValueOnce(completed('Done', 'token-2'))
    const terminal = new FakeTerminal(
      [{ kind: 'line', value: '/exit' }],
      [{ kind: 'answer', values: ['/attach /secret'] }]
    )
    const loadAttachments = vi.fn(async () => [])

    await program(async () => '', vi.fn(), {
      isInteractive: () => true,
      createTerminal: () => terminal,
      loadAttachments,
    }).parseAsync(['node', 'sim', 'chat', 'start'])

    expect(loadAttachments).toHaveBeenCalledOnce()
    expect(loadAttachments).toHaveBeenCalledWith([])
    expect(mocks.requestRaw.mock.calls[1][1].body).toEqual({
      workspaceId: 'ws_local',
      prompt: 'Proceed? — /attach /secret',
      continuationToken: 'token-1',
    })
  })

  it('submits arbitrary composer text unchanged after stripped options', async () => {
    const options = '<options>{"1":{"title":"Inspect logs","description":"Find errors"}}</options>'
    mocks.requestRaw
      .mockResolvedValueOnce(completed(options, 'token-1'))
      .mockResolvedValueOnce(completed('Done', 'token-2'))
    const terminal = new FakeTerminal([
      { kind: 'line', value: 'Ask a completely different question' },
      { kind: 'line', value: '/exit' },
    ])

    await program(async () => '', vi.fn(), {
      isInteractive: () => true,
      createTerminal: () => terminal,
    }).parseAsync(['node', 'sim', 'chat', 'start'])

    expect(terminal.reads[0].prompt).toBe('❯ ')
    expect(mocks.requestRaw.mock.calls[1][1].body.prompt).toBe(
      'Ask a completely different question'
    )
  })

  it('attaches a pasted path inline and sends the surrounding text', async () => {
    const attachment: ChatAttachment = {
      name: 'report.txt',
      mediaType: 'text/plain',
      data: 'cmVwb3J0',
    }
    const absolutePath = '/private/tmp/report.txt'
    const terminal = new FakeTerminal([
      { kind: 'line', value: `Inspect ${absolutePath} closely` },
      { kind: 'line', value: '/exit' },
    ])
    mocks.requestRaw.mockResolvedValue(completed('Done'))
    const extractAttachmentPaths = vi.fn(async (value: string) =>
      value.includes(absolutePath)
        ? { paths: [absolutePath], text: value.replace(absolutePath, '[File #1]') }
        : null
    )
    const loadAttachments = vi.fn(async (paths: string[]) => (paths.length ? [attachment] : []))

    await program(async () => '', vi.fn(), {
      isInteractive: () => true,
      createTerminal: () => terminal,
      extractAttachmentPaths,
      loadAttachments,
    }).parseAsync(['node', 'sim', 'chat'])

    expect(loadAttachments).toHaveBeenCalledWith([absolutePath])
    expect(terminal.preloads).toEqual([])
    expect(terminal.statuses.some((status) => status.startsWith('Unknown command:'))).toBe(false)
    expect(mocks.requestRaw.mock.calls[0][1].body).toEqual({
      workspaceId: 'ws_local',
      prompt: 'Inspect [File #1] closely',
      attachments: [attachment],
    })
  })

  it('never reads a path out of a slash command', async () => {
    const absolutePath = '/private/tmp/private.txt'
    const terminal = new FakeTerminal([
      { kind: 'line', value: `/rename ${absolutePath}` },
      { kind: 'line', value: '/exit' },
    ])
    const extractAttachmentPaths = vi.fn(async () => ({
      paths: [absolutePath],
      text: '[File #1]',
    }))
    const loadAttachments = vi.fn(async () => [])

    await program(async () => '', vi.fn(), {
      isInteractive: () => true,
      createTerminal: () => terminal,
      extractAttachmentPaths,
      loadAttachments,
    }).parseAsync(['node', 'sim', 'chat'])

    expect(extractAttachmentPaths).not.toHaveBeenCalled()
    expect(loadAttachments).not.toHaveBeenCalledWith([absolutePath])
    expect(mocks.requestRaw).not.toHaveBeenCalled()
  })

  it('preserves draft text when Ctrl+V attaches a clipboard image', async () => {
    const attachment: ChatAttachment = {
      name: 'clipboard.png',
      mediaType: 'image/png',
      data: 'iVBORw0KGgo=',
    }
    const terminal = new FakeTerminal([
      { kind: 'clipboard', value: 'explain this' },
      { kind: 'line', value: 'explain this' },
      { kind: 'line', value: '/exit' },
    ])
    mocks.requestRaw.mockResolvedValue(completed('Done'))

    await program(async () => '', vi.fn(), {
      isInteractive: () => true,
      createTerminal: () => terminal,
      clipboardAttachment: async () => attachment,
      extractAttachmentPaths: async () => null,
    }).parseAsync(['node', 'sim', 'chat'])

    expect(terminal.reads[1].initialValue).toBe('')
    expect(mocks.requestRaw.mock.calls[0][1].body).toEqual({
      workspaceId: 'ws_local',
      prompt: 'explain this',
      attachments: [attachment],
    })
  })

  it('aborts an active HTTP turn on Ctrl+C and returns to the prompt', async () => {
    const terminal = new FakeTerminal([{ kind: 'line', value: '/exit' }])
    let requestSignal: AbortSignal | undefined
    mocks.requestRaw.mockImplementation(
      (_path: string, options: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          requestSignal = options.signal
          options.signal.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          })
          queueMicrotask(() => terminal.interrupt())
        })
    )

    await program(async () => '', vi.fn(), {
      isInteractive: () => true,
      createTerminal: () => terminal,
    }).parseAsync(['node', 'sim', 'chat', 'long request'])

    expect(requestSignal?.aborted).toBe(true)
    expect(terminal.statuses).toContain('Generation cancelled.')
    expect(terminal.reads.at(-1)?.prompt).toBe('❯ ')
  })

  it('steers an active turn with the early continuation token and no attachment replay', async () => {
    const attachment: ChatAttachment = {
      name: 'notes.txt',
      mediaType: 'text/plain',
      data: 'bm90ZXM=',
    }
    const terminal = new FakeTerminal([
      {
        kind: 'line',
        value: 'change direction',
        queued: true,
        display: 'change direction',
      },
      { kind: 'line', value: '/exit' },
    ])
    const order: string[] = []
    const interrupt = vi.spyOn(terminal, 'interrupt')
    let firstRequestSignal: AbortSignal | undefined

    mocks.requestRaw
      .mockImplementationOnce((_path: string, options: { signal: AbortSignal }) => {
        firstRequestSignal = options.signal
        return Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                order.push('session')
                controller.enqueue(
                  new TextEncoder().encode(
                    'event: session\ndata: {"type":"session","continuationToken":"token-before-complete"}\n\n'
                  )
                )
                options.signal.addEventListener(
                  'abort',
                  () => {
                    order.push('abort')
                    controller.error(new Error('aborted'))
                  },
                  { once: true }
                )
                setImmediate(() => {
                  order.push('submit')
                  terminal.interrupt('submit')
                })
              },
            })
          )
        )
      })
      .mockImplementationOnce(async () => {
        order.push('follow-up')
        return completed('Redirected', 'token-2')
      })

    await program(async () => '', vi.fn(), {
      isInteractive: () => true,
      createTerminal: () => terminal,
      loadAttachments: async () => [attachment],
    }).parseAsync(['node', 'sim', 'chat', '--file', '/local/notes.txt', 'inspect'])

    expect(mocks.requestRaw).toHaveBeenCalledTimes(2)
    expect(interrupt).toHaveBeenCalledTimes(1)
    expect(interrupt).toHaveBeenCalledWith('submit')
    expect(firstRequestSignal?.aborted).toBe(true)
    expect(order).toEqual(['session', 'submit', 'abort', 'follow-up'])
    expect(mocks.requestRaw.mock.calls[1][1].body).toEqual({
      workspaceId: 'ws_local',
      prompt: 'change direction',
      continuationToken: 'token-before-complete',
    })
    expect(terminal.statuses).not.toContain('Generation cancelled.')
    expect(terminal.preloads).toEqual([])
  })

  it('steers the active turn with a queued line carrying a file path', async () => {
    const pathInput = {
      kind: 'line' as const,
      value: 'report.txt',
      queued: true,
      display: 'report.txt',
    }
    const terminal = new FakeTerminal([pathInput, { kind: 'line', value: '/exit' }])
    let requestSignal: AbortSignal | undefined
    const extractAttachmentPaths = vi.fn(async (value: string) =>
      value === 'report.txt' ? { paths: ['report.txt'], text: '[File #1]' } : null
    )
    mocks.requestRaw.mockImplementationOnce(
      async (_path: string, options: { signal: AbortSignal }) => {
        requestSignal = options.signal
        terminal.interrupt('submit', pathInput)
        await new Promise((resolve) => setImmediate(resolve))
        return completed('Finished normally', 'token-1')
      }
    )

    await program(async () => '', vi.fn(), {
      isInteractive: () => true,
      createTerminal: () => terminal,
      extractAttachmentPaths,
    }).parseAsync(['node', 'sim', 'chat', 'original'])

    expect(requestSignal?.aborted).toBe(true)
    expect(terminal.preloads).toEqual([{ value: 'report.txt', queued: true }])
  })

  it('queues /chats without interrupting the active stream', async () => {
    const chatsInput = {
      kind: 'line' as const,
      value: '/chats',
      queued: true,
      display: '/chats',
    }
    const terminal = new FakeTerminal(
      [chatsInput, { kind: 'line', value: '/exit' }],
      [],
      [{ kind: 'cancel' }]
    )
    let requestSignal: AbortSignal | undefined
    mocks.requestRaw.mockImplementationOnce(
      async (_path: string, options: { signal: AbortSignal }) => {
        requestSignal = options.signal
        terminal.interrupt('submit', chatsInput)
        await new Promise((resolve) => setImmediate(resolve))
        return completed('Finished normally', 'token-1')
      }
    )

    await program(async () => '', vi.fn(), {
      isInteractive: () => true,
      createTerminal: () => terminal,
    }).parseAsync(['node', 'sim', 'chat', 'original'])

    expect(requestSignal?.aborted).toBe(false)
    expect(terminal.selections).toHaveLength(1)
    expect(mocks.requestRaw).toHaveBeenCalledTimes(1)
    const listRequest = mocks.request.mock.calls.find(([path]) => path === '/api/v2/chats')
    expect(listRequest?.[1]).toMatchObject({
      query: { workspaceId: 'ws_local', limit: 100, cursor: null },
    })
    expect(listRequest?.[1]?.query).not.toHaveProperty('search')
  })

  it('waits for the first session token before interrupting a fast queued steer', async () => {
    const attachment: ChatAttachment = {
      name: 'notes.txt',
      mediaType: 'text/plain',
      data: 'bm90ZXM=',
    }
    const terminal = new FakeTerminal([
      {
        kind: 'line',
        value: 'change direction',
        queued: true,
        display: 'change direction',
      },
      { kind: 'line', value: '/exit' },
    ])
    let abortedBeforeSession = false

    mocks.requestRaw
      .mockImplementationOnce(
        (_path: string, options: { signal: AbortSignal }) =>
          new Promise((resolve) => {
            queueMicrotask(() => {
              terminal.interrupt('submit')
              abortedBeforeSession = options.signal.aborted
              resolve(
                new Response(
                  new ReadableStream<Uint8Array>({
                    start(controller) {
                      controller.enqueue(
                        new TextEncoder().encode(
                          'data: {"type":"session","continuationToken":"first-token"}\n\n'
                        )
                      )
                      options.signal.addEventListener(
                        'abort',
                        () => controller.error(new Error('aborted')),
                        { once: true }
                      )
                    },
                  })
                )
              )
            })
          })
      )
      .mockResolvedValueOnce(completed('Redirected', 'token-2'))

    await program(async () => '', vi.fn(), {
      isInteractive: () => true,
      createTerminal: () => terminal,
      loadAttachments: async () => [attachment],
    }).parseAsync(['node', 'sim', 'chat', '--file', '/local/notes.txt', 'inspect'])

    expect(abortedBeforeSession).toBe(false)
    expect(mocks.requestRaw.mock.calls[1][1].body).toEqual({
      workspaceId: 'ws_local',
      prompt: 'change direction',
      continuationToken: 'first-token',
    })
    expect(terminal.statuses).not.toContain('Generation cancelled.')
  })

  it('keeps the original attachments when setup fails before a session is accepted', async () => {
    const attachment: ChatAttachment = {
      name: 'notes.txt',
      mediaType: 'text/plain',
      data: 'bm90ZXM=',
    }
    const followUp = {
      kind: 'line' as const,
      value: 'retry with context',
      queued: true,
      display: 'retry with context',
    }
    const terminal = new FakeTerminal([followUp, { kind: 'line', value: '/exit' }])
    mocks.requestRaw
      .mockImplementationOnce(() =>
        Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                terminal.interrupt('submit', followUp)
                controller.enqueue(
                  new TextEncoder().encode(
                    'data: {"type":"error","error":{"code":"INTERNAL_ERROR","message":"Chat request failed"}}\n\n'
                  )
                )
                controller.close()
              },
            })
          )
        )
      )
      .mockResolvedValueOnce(completed('Retried', 'token-2'))

    await program(async () => '', vi.fn(), {
      isInteractive: () => true,
      createTerminal: () => terminal,
      loadAttachments: async () => [attachment],
    }).parseAsync(['node', 'sim', 'chat', '--file', '/local/notes.txt', 'inspect'])

    expect(mocks.requestRaw.mock.calls[1][1].body).toEqual({
      workspaceId: 'ws_local',
      prompt: 'retry with context',
      attachments: [attachment],
    })
    expect(terminal.statuses).toContain('Error: Chat request failed (INTERNAL_ERROR)')
  })

  it('does not replay attachments after an accepted turn fails', async () => {
    const attachment: ChatAttachment = {
      name: 'notes.txt',
      mediaType: 'text/plain',
      data: 'bm90ZXM=',
    }
    const terminal = new FakeTerminal([
      { kind: 'line', value: 'continue without replaying it' },
      { kind: 'line', value: '/exit' },
    ])
    mocks.requestRaw
      .mockResolvedValueOnce(
        sse([
          'data: {"type":"session","continuationToken":"token-1"}\n\n',
          'data: {"type":"error","error":{"code":"INTERNAL_ERROR","message":"Chat request failed"}}\n\n',
        ])
      )
      .mockResolvedValueOnce(completed('Continued', 'token-2'))

    await program(async () => '', vi.fn(), {
      isInteractive: () => true,
      createTerminal: () => terminal,
      loadAttachments: async () => [attachment],
    }).parseAsync(['node', 'sim', 'chat', '--file', '/local/notes.txt', 'inspect'])

    expect(mocks.requestRaw.mock.calls[0][1].body.attachments).toEqual([attachment])
    expect(mocks.requestRaw.mock.calls[1][1].body).toEqual({
      workspaceId: 'ws_local',
      prompt: 'continue without replaying it',
      continuationToken: 'token-1',
    })
    expect(terminal.preloads).toEqual([])
  })

  it('drains already-submitted turns before presenting an earlier turn question', async () => {
    const question =
      '<question>{"type":"single_select","prompt":"Pause for this?","options":[{"id":"yes","label":"Yes"}]}</question>'
    const firstQueued = {
      kind: 'line' as const,
      value: 'first queued',
      queued: true,
      display: 'first queued',
    }
    const terminal = new FakeTerminal([
      firstQueued,
      { kind: 'line', value: 'second queued', queued: true, display: 'second queued' },
      { kind: 'line', value: '/exit' },
    ])

    mocks.requestRaw
      .mockImplementationOnce((_path: string, options: { signal: AbortSignal }) =>
        Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(
                  new TextEncoder().encode(
                    'data: {"type":"session","continuationToken":"token-1"}\n\n'
                  )
                )
                options.signal.addEventListener(
                  'abort',
                  () => controller.error(new Error('aborted')),
                  { once: true }
                )
                setImmediate(() => terminal.interrupt('submit', firstQueued))
              },
            })
          )
        )
      )
      .mockResolvedValueOnce(completed(question, 'token-2'))
      .mockResolvedValueOnce(completed('Done', 'token-3'))

    await program(async () => '', vi.fn(), {
      isInteractive: () => true,
      createTerminal: () => terminal,
    }).parseAsync(['node', 'sim', 'chat', 'original'])

    expect(mocks.requestRaw.mock.calls.map(([, options]) => options.body.prompt)).toEqual([
      'original',
      'first queued',
      'second queued',
    ])
    expect(terminal.questions).toEqual([])
  })

  it('does not move queued prompts into another conversation', async () => {
    const terminal = new FakeTerminal([
      { kind: 'line', value: 'first' },
      { kind: 'line', value: '/new', queued: true, display: '/new' },
      { kind: 'line', value: 'second', queued: true, display: 'second' },
      { kind: 'line', value: '/chats', queued: true, display: '/chats' },
      { kind: 'line', value: 'third', queued: true, display: 'third' },
      { kind: 'line', value: '/exit' },
    ])
    mocks.requestRaw
      .mockResolvedValueOnce(completed('First', 'token-1'))
      .mockResolvedValueOnce(completed('Second', 'token-2'))
      .mockResolvedValueOnce(completed('Third', 'token-3'))

    await program(async () => '', vi.fn(), {
      isInteractive: () => true,
      createTerminal: () => terminal,
    }).parseAsync(['node', 'sim', 'chat'])

    expect(mocks.requestRaw.mock.calls.map(([, options]) => options.body)).toEqual([
      { workspaceId: 'ws_local', prompt: 'first' },
      { workspaceId: 'ws_local', prompt: 'second', continuationToken: 'token-1' },
      { workspaceId: 'ws_local', prompt: 'third', continuationToken: 'token-2' },
    ])
    expect(terminal.statuses).toEqual([
      'Finish queued prompts before changing conversations.',
      'Finish queued prompts before changing conversations.',
    ])
    expect(mocks.request.mock.calls.some(([path]) => path === '/api/v2/chats')).toBe(false)
  })

  it('restores a queued head ahead of later input when the handoff lease is still busy', async () => {
    const terminal = new FakeTerminal([
      { kind: 'line', value: 'retry me', queued: true, display: 'retry me' },
      { kind: 'line', value: 'retry me' },
      { kind: 'line', value: '/exit' },
    ])
    mocks.requestRaw
      .mockRejectedValueOnce(
        new SimApiError('A response is already in progress for this chat', 409, 'CONFLICT')
      )
      .mockResolvedValueOnce(completed('Retried', 'token-2'))

    await program(async () => '', vi.fn(), {
      isInteractive: () => true,
      createTerminal: () => terminal,
    }).parseAsync(['node', 'sim', 'chat'])

    expect(terminal.preloads).toContainEqual({ value: 'retry me', queued: true })
    expect(terminal.statuses).toContain(
      'Previous response is still settling. Press Enter to retry.'
    )
    expect(mocks.requestRaw).toHaveBeenCalledTimes(2)
    expect(mocks.requestRaw.mock.calls[1][1].body.prompt).toBe('retry me')
  })

  it('restores a normally submitted prompt after a pre-session conflict', async () => {
    const terminal = new FakeTerminal([
      { kind: 'line', value: 'retry me' },
      { kind: 'line', value: 'retry me' },
      { kind: 'line', value: '/exit' },
    ])
    mocks.requestRaw
      .mockRejectedValueOnce(
        new SimApiError('A response is already in progress for this chat', 409, 'CONFLICT')
      )
      .mockResolvedValueOnce(completed('Retried', 'token-2'))

    await program(async () => '', vi.fn(), {
      isInteractive: () => true,
      createTerminal: () => terminal,
    }).parseAsync(['node', 'sim', 'chat'])

    expect(terminal.preloads).toContainEqual({ value: 'retry me', queued: true })
    expect(terminal.statuses).toContain(
      'Previous response is still settling. Press Enter to retry.'
    )
    expect(mocks.requestRaw).toHaveBeenCalledTimes(2)
  })

  it('automatically retries one queued continuation conflict', async () => {
    const contexts: ChatContext[] = [
      { kind: 'workflow', workflowId: 'workflow-1', label: 'Release' },
    ]
    const terminal = new FakeTerminal([
      {
        kind: 'line',
        value: 'retry @Release',
        queued: true,
        display: 'retry @Release',
        contexts,
      },
      { kind: 'line', value: '/exit' },
    ])
    mocks.requestRaw
      .mockResolvedValueOnce(completed('Original', 'token-1'))
      .mockRejectedValueOnce(
        new SimApiError('A response is already in progress for this chat', 409, 'CONFLICT')
      )
      .mockResolvedValueOnce(completed('Retried', 'token-2'))

    await program(async () => '', vi.fn(), {
      isInteractive: () => true,
      createTerminal: () => terminal,
    }).parseAsync(['node', 'sim', 'chat', 'original'])

    expect(mocks.requestRaw.mock.calls.map(([, options]) => options.body.prompt)).toEqual([
      'original',
      'retry @Release',
      'retry @Release',
    ])
    expect(mocks.requestRaw.mock.calls[2][1].body).toMatchObject({
      continuationToken: 'token-1',
      contexts,
    })
    expect(terminal.preloads).toEqual([])
    expect(terminal.statuses).toContain('Previous response is still settling. Retrying…')
    expect(terminal.statuses).not.toContain(
      'Previous response is still settling. Press Enter to retry.'
    )
  })

  it('bounds queued continuation conflict retries and restores the exact tagged input', async () => {
    const contexts: ChatContext[] = [{ kind: 'skill', skillId: 'skill-1', label: 'review' }]
    const terminal = new FakeTerminal([
      {
        kind: 'line',
        value: '/review this',
        queued: true,
        display: '/review this',
        contexts,
      },
      { kind: 'line', value: '/exit' },
    ])
    mocks.requestRaw
      .mockResolvedValueOnce(completed('Original', 'token-1'))
      .mockRejectedValueOnce(
        new SimApiError('A response is already in progress for this chat', 409, 'CONFLICT')
      )
      .mockRejectedValueOnce(
        new SimApiError('A response is already in progress for this chat', 409, 'CONFLICT')
      )

    await program(async () => '', vi.fn(), {
      isInteractive: () => true,
      createTerminal: () => terminal,
    }).parseAsync(['node', 'sim', 'chat', 'original'])

    expect(mocks.requestRaw).toHaveBeenCalledTimes(3)
    expect(terminal.preloads).toContainEqual({
      value: '/review this',
      queued: true,
      contexts,
    })
    expect(terminal.statuses).toContain(
      'Previous response is still settling. Press Enter to retry.'
    )
  })

  it('carries queued large-paste bodies into a conflict retry', async () => {
    const pasted = 'p'.repeat(900)
    const pastes = new Map([[1, pasted]])
    const terminal = new FakeTerminal([
      {
        kind: 'line',
        value: pasted,
        queued: true,
        display: '[Pasted text #1]',
        pastes,
      },
      { kind: 'line', value: pasted, queued: true, display: '[Pasted text #1]', pastes },
      { kind: 'line', value: '/exit' },
    ])
    mocks.requestRaw
      .mockRejectedValueOnce(
        new SimApiError('A response is already in progress for this chat', 409, 'CONFLICT')
      )
      .mockResolvedValueOnce(completed('Retried', 'token-2'))

    await program(async () => '', vi.fn(), {
      isInteractive: () => true,
      createTerminal: () => terminal,
    }).parseAsync(['node', 'sim', 'chat'])

    expect(terminal.preloads[0]).toMatchObject({
      value: '[Pasted text #1]',
      queued: true,
      pastes,
    })
    expect(mocks.requestRaw.mock.calls[1][1].body.prompt).toBe(pasted)
  })

  it('restores pending attachments after Ctrl+C so a retry can send them', async () => {
    const attachment: ChatAttachment = {
      name: 'notes.txt',
      mediaType: 'text/plain',
      data: 'bm90ZXM=',
    }
    const terminal = new FakeTerminal([
      { kind: 'line', value: 'retry' },
      { kind: 'line', value: '/exit' },
    ])
    mocks.requestRaw
      .mockImplementationOnce(
        (_path: string, options: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            options.signal.addEventListener('abort', () => reject(new Error('aborted')), {
              once: true,
            })
            queueMicrotask(() => terminal.interrupt())
          })
      )
      .mockResolvedValueOnce(completed('Retried'))

    await program(async () => '', vi.fn(), {
      isInteractive: () => true,
      createTerminal: () => terminal,
      loadAttachments: async () => [attachment],
    }).parseAsync(['node', 'sim', 'chat', '--file', '/local/notes.txt', 'inspect'])

    expect(mocks.requestRaw.mock.calls[1][1].body).toEqual({
      workspaceId: 'ws_local',
      prompt: 'retry',
      attachments: [attachment],
    })
  })

  it('reports a failed turn and restores its attachments for the next prompt', async () => {
    const attachment: ChatAttachment = {
      name: 'notes.txt',
      mediaType: 'text/plain',
      data: 'bm90ZXM=',
    }
    const terminal = new FakeTerminal([
      { kind: 'line', value: 'retry' },
      { kind: 'line', value: '/exit' },
    ])
    mocks.requestRaw
      .mockRejectedValueOnce(new SimApiError('Temporarily\nunavailable', 503, 'UNAVAILABLE'))
      .mockResolvedValueOnce(completed('Retried'))

    await program(async () => '', vi.fn(), {
      isInteractive: () => true,
      createTerminal: () => terminal,
      loadAttachments: async () => [attachment],
    }).parseAsync(['node', 'sim', 'chat', '--file', '/local/notes.txt', 'inspect'])

    expect(terminal.statuses).toContain('Error: Temporarily unavailable (UNAVAILABLE)')
    expect(mocks.requestRaw.mock.calls[1][1].body).toEqual({
      workspaceId: 'ws_local',
      prompt: 'retry',
      attachments: [attachment],
    })
  })

  it('parses an authoritative completion suffix omitted from text deltas', async () => {
    const options = '<options>{"1":{"title":"Continue","description":"Go"}}</options>'
    mocks.requestRaw
      .mockResolvedValueOnce(completed(`Hello${options}`, 'token-1', ['Hello']))
      .mockResolvedValueOnce(completed('Done', 'token-2'))
    const terminal = new FakeTerminal([
      { kind: 'line', value: 'Continue' },
      { kind: 'line', value: '/exit' },
    ])

    await program(async () => '', vi.fn(), {
      isInteractive: () => true,
      createTerminal: () => terminal,
    }).parseAsync(['node', 'sim', 'chat', 'start'])

    expect(mocks.requestRaw.mock.calls[1][1].body).toEqual({
      workspaceId: 'ws_local',
      prompt: 'Continue',
      continuationToken: 'token-1',
    })
  })

  it('sanitizes streamed plain deltas before stdout', async () => {
    const terminalEscape = String.fromCharCode(27)
    mocks.requestRaw.mockResolvedValue(
      completed(`Safe${terminalEscape}]0;owned\u0007 answer`, 'token', [
        `Safe${terminalEscape}]0;`,
        'owned\u0007 answer',
      ])
    )
    const terminal = new FakeTerminal([{ kind: 'line', value: '/exit' }])
    await program(async () => '', vi.fn(), {
      isInteractive: () => true,
      createTerminal: () => terminal,
    }).parseAsync(['node', 'sim', 'chat', 'question'])

    expect(terminal.writes.join('')).toBe('Safeowned answer\n')
    expect(terminal.writes.join('')).not.toContain(terminalEscape)
  })

  it('forwards sanitized thinking and ordered activity transitions to the terminal', async () => {
    const terminalEscape = String.fromCharCode(27)
    mocks.requestRaw.mockResolvedValue(
      sse([
        `event: thinking\ndata: ${JSON.stringify({
          type: 'thinking',
          delta: `Inspect${terminalEscape}]0;owned\u0007 workspace`,
        })}\n\n`,
        `event: activity\ndata: ${JSON.stringify({
          type: 'activity',
          data: {
            kind: 'subagent',
            id: 'agent-1',
            label: 'Research\nagent',
            state: 'running',
          },
        })}\n\n`,
        `event: activity\ndata: ${JSON.stringify({
          type: 'activity',
          data: {
            kind: 'subagent',
            id: 'agent-1',
            label: 'Research agent',
            state: 'complete',
          },
        })}\n\n`,
        'event: text\ndata: {"type":"text","delta":"Done"}\n\n',
        'event: complete\ndata: {"type":"complete","data":{"content":"Done","continuationToken":"token"}}\n\n',
      ])
    )
    const terminal = new FakeTerminal([{ kind: 'line', value: '/exit' }])

    await program(async () => '', vi.fn(), {
      isInteractive: () => true,
      createTerminal: () => terminal,
    }).parseAsync(['node', 'sim', 'chat', 'question'])

    expect(terminal.thinking).toEqual(['Inspect workspace'])
    expect(terminal.activities).toEqual([
      {
        kind: 'subagent',
        id: 'agent-1',
        label: 'Research agent',
        state: 'running',
      },
      {
        kind: 'subagent',
        id: 'agent-1',
        label: 'Research agent',
        state: 'complete',
      },
    ])
  })

  it('forwards nested subagent narration and tool seams without mixing them into the answer', async () => {
    const terminalEscape = String.fromCharCode(27)
    mocks.requestRaw.mockResolvedValue(
      sse([
        `event: activity\ndata: ${JSON.stringify({
          type: 'activity',
          data: {
            kind: 'subagent',
            id: 'agent-1',
            label: 'Build Agent',
            state: 'running',
          },
        })}\n\n`,
        `event: activity\ndata: ${JSON.stringify({
          type: 'activity',
          data: {
            kind: 'narration',
            parentId: 'agent-1',
            delta: `Inspect${terminalEscape}]0;owned\u0007ing `,
          },
        })}\n\n`,
        `event: activity\ndata: ${JSON.stringify({
          type: 'activity',
          data: { kind: 'narration', parentId: 'agent-1', delta: 'workspace' },
        })}\n\n`,
        `event: activity\ndata: ${JSON.stringify({
          type: 'activity',
          data: {
            kind: 'tool',
            id: 'tool-1',
            parentId: 'agent-1',
            label: 'Read file',
            state: 'complete',
          },
        })}\n\n`,
        `event: activity\ndata: ${JSON.stringify({
          type: 'activity',
          data: { kind: 'narration', parentId: 'agent-1', delta: 'After tool' },
        })}\n\n`,
        `event: activity\ndata: ${JSON.stringify({
          type: 'activity',
          data: {
            kind: 'subagent',
            id: 'agent-1',
            label: 'Build Agent',
            state: 'complete',
          },
        })}\n\n`,
        'event: text\ndata: {"type":"text","delta":"Final answer"}\n\n',
        'event: complete\ndata: {"type":"complete","data":{"content":"Final answer","continuationToken":"token"}}\n\n',
      ])
    )
    const terminal = new FakeTerminal([{ kind: 'line', value: '/exit' }])

    await program(async () => '', vi.fn(), {
      isInteractive: () => true,
      createTerminal: () => terminal,
      formatMarkdown: () => false,
    }).parseAsync(['node', 'sim', 'chat', 'question'])

    expect(terminal.activities).toEqual([
      {
        kind: 'subagent',
        id: 'agent-1',
        label: 'Build Agent',
        state: 'running',
      },
      { kind: 'narration', parentId: 'agent-1', delta: 'Inspecting ' },
      { kind: 'narration', parentId: 'agent-1', delta: 'workspace' },
      {
        kind: 'tool',
        id: 'tool-1',
        parentId: 'agent-1',
        label: 'Read file',
        state: 'complete',
      },
      { kind: 'narration', parentId: 'agent-1', delta: 'After tool' },
      {
        kind: 'subagent',
        id: 'agent-1',
        label: 'Build Agent',
        state: 'complete',
      },
    ])
    expect(terminal.writes.join('')).toBe('Final answer\n')
    expect(terminal.writes.join('')).not.toContain('Inspecting')
  })
})

describe('chat SSE reader', () => {
  it('delivers thinking, activity, and text callbacks in wire order', async () => {
    const callbacks: string[] = []
    const response = sse([
      'event: thinking\ndata: {"type":"thinking","delta":"Planning"}\n\n',
      'event: activity\ndata: {"type":"activity","data":{"kind":"tool","id":"tool-1","label":"Read\\nworkflow","state":"running"}}\n\n',
      'event: activity\ndata: {"type":"activity","data":{"kind":"tool","id":"tool-1","label":"Read workflow","state":"complete"}}\n\n',
      'event: text\ndata: {"type":"text","delta":"Answer"}\n\n',
      'event: complete\ndata: {"type":"complete","data":{"content":"Answer","continuationToken":"token"}}\n\n',
    ])

    const result = await readChatTurn(response, {
      onThinking: (delta) => {
        callbacks.push(`thinking:${delta}`)
      },
      onActivity: (activity) => {
        callbacks.push(
          activity.kind === 'narration'
            ? `${activity.kind}:${activity.parentId}:${activity.delta}`
            : `${activity.kind}:${activity.label}:${activity.state}`
        )
      },
      onDelta: (delta) => {
        callbacks.push(`text:${delta}`)
      },
    })

    expect(callbacks).toEqual([
      'thinking:Planning',
      'tool:Read workflow:running',
      'tool:Read workflow:complete',
      'text:Answer',
    ])
    expect(result.content).toBe('Answer')
  })

  it('parses parented narration and nested tools without adding scoped text to content', async () => {
    const terminalEscape = String.fromCharCode(27)
    const activities: ChatActivityUpdate[] = []
    const response = sse([
      `event: activity\ndata: ${JSON.stringify({
        type: 'activity',
        data: {
          kind: 'subagent',
          id: 'agent-1',
          label: 'Build\nAgent',
          state: 'running',
        },
      })}\n\n`,
      `event: activity\ndata: ${JSON.stringify({
        type: 'activity',
        data: {
          kind: 'narration',
          parentId: 'agent-1',
          delta: `Line one\n\nLine${terminalEscape}]0;owned\u0007 two`,
        },
      })}\n\n`,
      `event: activity\ndata: ${JSON.stringify({
        type: 'activity',
        data: {
          kind: 'tool',
          id: 'tool-1',
          parentId: 'agent-1',
          label: 'Read file',
          state: 'complete',
        },
      })}\n\n`,
      'event: text\ndata: {"type":"text","delta":"Answer"}\n\n',
      'event: complete\ndata: {"type":"complete","data":{"content":"Answer","continuationToken":"token"}}\n\n',
    ])

    const result = await readChatTurn(response, {
      onActivity: (activity) => {
        activities.push(activity)
      },
    })

    expect(activities).toEqual([
      {
        kind: 'subagent',
        id: 'agent-1',
        label: 'Build Agent',
        state: 'running',
      },
      {
        kind: 'narration',
        parentId: 'agent-1',
        delta: 'Line one\n\nLine two',
      },
      {
        kind: 'tool',
        id: 'tool-1',
        parentId: 'agent-1',
        label: 'Read file',
        state: 'complete',
      },
    ])
    expect(result).toEqual({
      content: 'Answer',
      streamedContent: 'Answer',
      continuationToken: 'token',
    })
  })

  it('falls back to text deltas and uses the completion continuation token', async () => {
    const response = sse([
      'event: session\ndata: {"type":"session","continuationToken":"session-token"}\n\n',
      'event: text\r\ndata: {"type":"text","delta":"one"}\r\n\r\n',
      'event: text\ndata: {"type":"text","delta":" two"}\n\n',
      'event: complete\ndata: {"type":"complete","data":{"continuationToken":"complete-token"}}\n\n',
      'data: [DONE]\n\n',
    ])

    await expect(readChatTurn(response)).resolves.toEqual({
      content: 'one two',
      streamedContent: 'one two',
      continuationToken: 'complete-token',
    })
  })

  it('exposes the session continuation token before completion', async () => {
    const tokens: string[] = []
    const response = sse([
      'event: session\ndata: {"type":"session","continuationToken":"session-token"}\n\n',
      'event: complete\ndata: {"type":"complete","data":{"content":"Done","continuationToken":"complete-token"}}\n\n',
    ])

    await readChatTurn(response, {
      onContinuationToken: (token) => {
        tokens.push(token)
      },
    })

    expect(tokens).toEqual(['session-token'])
  })

  it('exposes the shared chat id from the session event', async () => {
    const chatIds: string[] = []
    const response = sse([
      'event: session\ndata: {"type":"session","chatId":"chat-1","continuationToken":"session-token"}\n\n',
      'event: complete\ndata: {"type":"complete","data":{"content":"Done","continuationToken":"complete-token"}}\n\n',
    ])

    await readChatTurn(response, {
      onChatId: (chatId) => {
        chatIds.push(chatId)
      },
    })

    expect(chatIds).toEqual(['chat-1'])
  })

  it('exposes a sanitized generated title from session events', async () => {
    const titles: string[] = []
    const response = sse([
      'event: session\ndata: {"type":"session","title":"Release\\u001b]0;owned\\u0007 investigation"}\n\n',
      'event: complete\ndata: {"type":"complete","data":{"content":"Done","continuationToken":"complete-token"}}\n\n',
    ])

    await readChatTurn(response, {
      onTitle: (title) => {
        titles.push(title)
      },
    })

    expect(titles).toEqual(['Release investigation'])
  })

  it('turns a streamed error into a sanitized structured CLI error', async () => {
    const terminalEscape = String.fromCharCode(27)
    const response = sse([
      `event: error\ndata: ${JSON.stringify({
        type: 'error',
        error: {
          code: `CHAT${terminalEscape}[2A_FAILED`,
          message: `Model${terminalEscape}]0;x\u0007 unavailable`,
        },
      })}\n\n`,
    ])

    const result = readChatResponse(response)
    await expect(result).rejects.toBeInstanceOf(SimApiError)
    await expect(result).rejects.toMatchObject({
      message: 'Model unavailable',
      code: 'CHAT_FAILED',
    })
  })

  it('rejects malformed and incomplete streams', async () => {
    await expect(readChatResponse(sse(['data: not-json\n\n']))).rejects.toThrow(
      /malformed streaming data/
    )
    await expect(
      readChatResponse(sse(['data: {"type":"text","delta":"partial"}\n\ndata: [DONE]\n\n']))
    ).rejects.toThrow(/ended before completing/)
  })

  it.each([
    [
      'an error event',
      'event: error\ndata: {"type":"error","error":{"code":"FAILED","message":"No answer"}}\n\n',
    ],
    ['malformed data', 'data: not-json\n\n'],
  ])('cancels the response body after %s', async (_name, wire) => {
    const { response, cancel } = openSse(wire)

    await expect(readChatResponse(response)).rejects.toBeInstanceOf(SimApiError)
    expect(cancel).toHaveBeenCalledOnce()
  })
})

describe('composeChatPrompt', () => {
  it('does not add a separator when only one source is present', () => {
    expect(composeChatPrompt(['hello'], '')).toBe('hello')
    expect(composeChatPrompt([], 'hello\n')).toBe('hello\n')
  })
})
