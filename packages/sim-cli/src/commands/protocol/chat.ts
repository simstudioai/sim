import { Command } from 'commander'
import { clientFrom } from '../../context.js'
import type {
  ChatBody,
  GetChatResponse,
  GetWorkspaceResponse,
  ListChatsResponse,
  ListFilesResponse,
  ListKnowledgeBasesResponse,
  ListLogsResponse,
  ListMcpServersResponse,
  ListSkillsResponse,
  ListTablesResponse,
  ListWorkflowsResponse,
  RenameChatBody,
  RenameChatResponse,
} from '../../generated/v2-api.js'
import { V2_OPERATIONS } from '../../generated/v2-api.js'
import { requestAllPages, resolvePath, SimApiError, type SimClient } from '../../http/client.js'
import { safeOneLine, sanitize } from '../../output/render.js'
import {
  type ChatAttachment,
  combineChatAttachments,
  existingAttachmentPaths,
  loadChatAttachments,
  parseAttachmentPaths,
  readClipboardImage,
} from './chat-attachments.js'
import { ChatMarkdownStream } from './chat-markdown.js'
import {
  type ChatQuestion,
  ChatStructuredParser,
  type ChatStructuredSegment,
  parseChatStructured,
  type RenderPart,
  renderChatStructured,
} from './chat-structured.js'
import type { ChatContext, ChatSuggestionCandidates, SuggestionItem } from './chat-suggestions.js'
import {
  type ChatActivityUpdate,
  type ChatTerminal,
  type ChatTerminalInput,
  type ChatTerminalSelectResult,
  ReadlineChatTerminal,
} from './chat-terminal.js'

export interface ChatDependencies {
  readInput: (maxBytes: number) => Promise<string>
  writeOutput: (content: string) => void
  isInteractive: () => boolean
  createTerminal: () => ChatTerminal
  loadAttachments: (paths: string[]) => Promise<ChatAttachment[]>
  clipboardImage: () => Promise<ChatAttachment | null>
  pastedAttachmentPaths: (input: string) => Promise<string[] | null>
  formatMarkdown: () => boolean
}

interface ChatEvent {
  type?: unknown
  delta?: unknown
  data?: unknown
  error?: unknown
  continuationToken?: unknown
  chatId?: unknown
  title?: unknown
}

type ChatSummary = ListChatsResponse['data'][number]
type ChatHistoryMessage = GetChatResponse['data']['messages'][number]

export interface ChatTurn {
  content: string
  streamedContent: string
  continuationToken: string | null
}

export interface ReadChatTurnOptions {
  onDelta?: (delta: string) => void | Promise<void>
  onThinking?: (delta: string) => void | Promise<void>
  onActivity?: (activity: ChatActivityUpdate) => void | Promise<void>
  /** The opaque token arrives after turn acceptance and before assistant output. */
  onContinuationToken?: (token: string) => void | Promise<void>
  /** The shared chat identity arrives with the session event when available. */
  onChatId?: (chatId: string) => void | Promise<void>
  /** The persisted chat title may arrive with either session acceptance or title generation. */
  onTitle?: (title: string) => void | Promise<void>
}

type ChatRequest = ChatBody

const MAX_CHAT_PROMPT_BYTES = 10 * 1024 * 1024
const MAX_LOG_SUGGESTIONS = 50

function inputTooLarge(): SimApiError {
  return new SimApiError('Chat input exceeds the 10 MiB limit.', 0)
}

function utf8Bytes(value: string): number {
  return Buffer.byteLength(value, 'utf8')
}

/** Reads stdin only when the command is part of a pipe or redirection. */
async function readPipedInput(maxBytes: number): Promise<string> {
  if (process.stdin.isTTY) return ''

  process.stdin.setEncoding('utf8')
  let input = ''
  let inputBytes = 0
  for await (const chunk of process.stdin) {
    inputBytes += utf8Bytes(chunk)
    if (inputBytes > maxBytes) throw inputTooLarge()
    input += chunk
  }
  return input
}

/** Writes one completed answer, preserving its contents and adding a shell-friendly newline. */
function writeCompletedAnswer(content: string): void {
  if (!content) return
  process.stdout.write(content)
  if (!content.endsWith('\n')) process.stdout.write('\n')
}

/**
 * Matches Claude Code's print-mode input ordering: command-line prompt first,
 * then piped context separated by one newline.
 */
export function composeChatPrompt(promptParts: string[], pipedInput: string): string {
  return [promptParts.join(' '), pipedInput].filter(Boolean).join('\n')
}

async function* linesOf(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffered = ''
  let reachedEnd = false

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        reachedEnd = true
        break
      }
      buffered += decoder.decode(value, { stream: true })

      let newline = buffered.indexOf('\n')
      while (newline !== -1) {
        const raw = buffered.slice(0, newline)
        buffered = buffered.slice(newline + 1)
        yield raw.endsWith('\r') ? raw.slice(0, -1) : raw
        newline = buffered.indexOf('\n')
      }
    }

    buffered += decoder.decode()
    if (buffered) yield buffered.endsWith('\r') ? buffered.slice(0, -1) : buffered
  } finally {
    if (!reachedEnd) await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

function dataFromEvent(lines: string[]): string | null {
  const data: string[] = []
  for (const line of lines) {
    if (!line || line.startsWith(':')) continue
    const separator = line.indexOf(':')
    const field = separator === -1 ? line : line.slice(0, separator)
    if (field !== 'data') continue

    const raw = separator === -1 ? '' : line.slice(separator + 1)
    data.push(raw.startsWith(' ') ? raw.slice(1) : raw)
  }
  return data.length > 0 ? data.join('\n') : null
}

function streamError(event: ChatEvent): SimApiError {
  const detail = event.error
  if (!detail || typeof detail !== 'object') {
    return new SimApiError('Sim Chat failed.', 0)
  }

  const error = detail as { code?: unknown; message?: unknown }
  return new SimApiError(
    typeof error.message === 'string' ? sanitize(error.message) : 'Sim Chat failed.',
    0,
    typeof error.code === 'string' ? sanitize(error.code) : null
  )
}

function tokenFrom(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  const token = (value as { continuationToken?: unknown }).continuationToken
  return typeof token === 'string' && token ? token : null
}

function activityFrom(value: unknown): ChatActivityUpdate | null {
  if (!value || typeof value !== 'object') return null
  const data = value as Record<string, unknown>
  if (data.kind === 'narration') {
    if (typeof data.parentId !== 'string' || typeof data.delta !== 'string') return null
    const parentId = safeOneLine(data.parentId).slice(0, 160)
    const delta = sanitize(data.delta)
    return parentId && delta ? { kind: 'narration', parentId, delta } : null
  }
  if (data.kind !== 'tool' && data.kind !== 'subagent') return null
  if (data.state !== 'running' && data.state !== 'complete' && data.state !== 'error') return null
  if (typeof data.id !== 'string' || typeof data.label !== 'string') return null

  const id = safeOneLine(data.id).slice(0, 160)
  const label = safeOneLine(data.label).slice(0, 160)
  const parentId = typeof data.parentId === 'string' ? safeOneLine(data.parentId).slice(0, 160) : ''
  return id && label
    ? {
        kind: data.kind,
        id,
        label,
        state: data.state,
        ...(parentId && parentId !== id ? { parentId } : {}),
      }
    : null
}

/** Reads one public chat turn, optionally forwarding raw text deltas to a safe renderer. */
export async function readChatTurn(
  response: Response,
  options: ReadChatTurnOptions = {}
): Promise<ChatTurn> {
  if (!response.body) throw new SimApiError('Sim Chat returned an empty response.', 0)

  let deltas = ''
  let completedContent: string | null = null
  let continuationToken: string | null = null
  let sawComplete = false
  let eventLines: string[] = []

  const consume = async (): Promise<void> => {
    const raw = dataFromEvent(eventLines)
    eventLines = []
    if (raw === null || raw === '[DONE]') return

    let parsed: ChatEvent
    try {
      parsed = JSON.parse(raw) as ChatEvent
    } catch {
      throw new SimApiError('Sim Chat returned malformed streaming data.', 0)
    }

    if (parsed.type === 'session') {
      if (typeof parsed.chatId === 'string' && parsed.chatId) {
        await options.onChatId?.(parsed.chatId)
      }
      if (typeof parsed.title === 'string') {
        const title = safeOneLine(parsed.title).slice(0, 160)
        if (title) await options.onTitle?.(title)
      }
      const token = tokenFrom(parsed)
      if (token) {
        continuationToken = token
        await options.onContinuationToken?.(token)
      }
      return
    }
    if (parsed.type === 'text' && typeof parsed.delta === 'string') {
      deltas += parsed.delta
      await options.onDelta?.(parsed.delta)
      return
    }
    if (parsed.type === 'thinking' && typeof parsed.delta === 'string') {
      await options.onThinking?.(sanitize(parsed.delta))
      return
    }
    if (parsed.type === 'activity') {
      const activity = activityFrom(parsed.data)
      if (activity) await options.onActivity?.(activity)
      return
    }
    if (parsed.type === 'error') throw streamError(parsed)
    if (parsed.type !== 'complete') return

    sawComplete = true
    if (parsed.data && typeof parsed.data === 'object') {
      const content = (parsed.data as { content?: unknown }).content
      if (typeof content === 'string') completedContent = content
      continuationToken = tokenFrom(parsed.data) ?? continuationToken
    }
  }

  try {
    for await (const line of linesOf(response.body)) {
      if (line === '') await consume()
      else eventLines.push(line)
    }
    if (eventLines.length > 0) await consume()
  } catch (error) {
    if (error instanceof SimApiError) throw error
    const message = error instanceof Error ? error.message : String(error)
    throw new SimApiError(`Sim Chat stream failed: ${sanitize(message)}`, 0)
  }

  if (!sawComplete) throw new SimApiError('Sim Chat ended before completing.', 0)
  return {
    content: completedContent ?? deltas,
    streamedContent: deltas,
    continuationToken,
  }
}

/** Buffers the public chat SSE protocol and returns only the final assistant answer. */
export async function readChatResponse(response: Response): Promise<string> {
  return (await readChatTurn(response)).content
}

function requestChat(client: SimClient, body: ChatRequest, signal: AbortSignal): Promise<Response> {
  return client.requestRaw(V2_OPERATIONS.chat.path, {
    method: 'POST',
    headers: { accept: 'text/event-stream' },
    body,
    signal,
    auth: 'optional',
  })
}

function renderContext(interactive: boolean) {
  return { printMode: !interactive }
}

async function runOneShot(
  client: SimClient,
  workspaceId: string,
  prompt: string,
  attachments: ChatAttachment[],
  readOnly: boolean,
  dependencies: ChatDependencies
): Promise<void> {
  const controller = new AbortController()
  const cancel = () => controller.abort()
  process.once('SIGINT', cancel)

  try {
    const response = await requestChat(
      client,
      {
        workspaceId,
        prompt,
        ...(readOnly ? { readOnly: true } : {}),
        ...(attachments.length ? { attachments } : {}),
      },
      controller.signal
    )
    const result = await readChatTurn(response)
    const segments = withoutTrailingStandaloneResource(parseChatStructured(result.content))
    const rendered = renderChatStructured(segments, renderContext(false))
    // Print mode deliberately has no ANSI/OSC of its own, so a final defense at
    // the stdout boundary is safe and preserves shell composability.
    dependencies.writeOutput(sanitize(rendered.text))
  } catch (error) {
    if (controller.signal.aborted) throw new SimApiError('Sim Chat cancelled.', 0)
    throw error
  } finally {
    process.removeListener('SIGINT', cancel)
  }
}

type UserTurnResult =
  | {
      kind: 'turn'
      prompt: string
      attachments: ChatAttachment[]
      queued: boolean
      display?: string
      pastes?: ReadonlyMap<number, string>
      contexts?: ChatContext[]
    }
  | { kind: 'clear'; attachments: ChatAttachment[] }
  | { kind: 'chats'; attachments: ChatAttachment[] }
  | { kind: 'rename'; title: string; attachments: ChatAttachment[] }
  | { kind: 'idle'; attachments: ChatAttachment[] }
  | { kind: 'exit' }

function explainInteractiveCommands(terminal: ChatTerminal): void {
  terminal.status(
    [
      'Commands:',
      '  /attach <paths>  attach local files to the next turn',
      '  ctrl+v          attach an image from the clipboard (or cmd+v on macOS)',
      '  /clear           start a new conversation',
      '  /chats           view and switch chats',
      '  /rename <title>  rename the active chat',
      '  /help            show this help',
      '  /exit            leave Sim Chat (alias: /quit)',
    ].join('\n')
  )
}

function attachmentStatus(attachments: ChatAttachment[]): string {
  const names = attachments.map((attachment) => attachment.name).join(', ')
  return `Attached for the next turn (${attachments.length}/${5}): ${names}`
}

function attachmentCommand(paths: string[]): string | null {
  if (paths.some((path) => /[\u0000-\u001f\u007f]/u.test(path))) return null
  const quoted = paths.map((path) => `"${path.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)
  return `/attach ${quoted.join(' ')}`
}

async function addPaths(
  current: ChatAttachment[],
  paths: string[],
  terminal: ChatTerminal,
  dependencies: ChatDependencies
): Promise<ChatAttachment[]> {
  try {
    const additions = await dependencies.loadAttachments(paths)
    const combined = combineChatAttachments(current, additions)
    terminal.status(attachmentStatus(combined))
    return combined
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    terminal.status(`Error: ${message}`)
    return current
  }
}

async function addClipboardImage(
  current: ChatAttachment[],
  terminal: ChatTerminal,
  dependencies: ChatDependencies
): Promise<ChatAttachment[]> {
  const image = await dependencies.clipboardImage()
  /* Paste feedback is the `[Image #N]` tag in the composer, not a transcript
     line: the tag says what was attached and disappears when it is deleted. */
  if (!image) return current
  try {
    const combined = combineChatAttachments(current, [image])
    terminal.noteAttachment()
    return combined
  } catch {
    return current
  }
}

async function readUserTurn(
  terminal: ChatTerminal,
  initialAttachments: ChatAttachment[],
  dependencies: ChatDependencies,
  queuedOnly = false
): Promise<UserTurnResult> {
  let attachments = initialAttachments
  let lastEmptyInterrupt = 0

  while (true) {
    if (queuedOnly && !terminal.hasQueuedInput()) return { kind: 'idle', attachments }
    const input = await terminal.read('❯ ')
    if (input.kind === 'eof') return { kind: 'exit' }
    if (input.kind === 'interrupt') {
      const now = Date.now()
      if (input.empty && now - lastEmptyInterrupt < 1_200) return { kind: 'exit' }
      lastEmptyInterrupt = input.empty ? now : 0
      continue
    }
    if (input.kind === 'clipboard') {
      attachments = await addClipboardImage(attachments, terminal, dependencies)
      continue
    }
    if (input.kind === 'selection') continue

    const trimmed = input.value.trim()
    if (trimmed === '/exit' || trimmed === '/quit') return { kind: 'exit' }
    if (trimmed === '/help') {
      explainInteractiveCommands(terminal)
      continue
    }
    if (trimmed === '/clear') return { kind: 'clear', attachments }
    if (trimmed === '/chats') {
      return { kind: 'chats', attachments }
    }
    if (trimmed.startsWith('/chats ')) {
      terminal.status('Usage: /chats (search inside the chat list).')
      continue
    }
    if (trimmed === '/rename' || trimmed.startsWith('/rename ')) {
      const title = safeOneLine(trimmed.slice('/rename'.length).trim())
      if (!title) {
        terminal.status('Usage: /rename <title>')
        continue
      }
      if (title.length > 200) {
        terminal.status('Error: Chat title cannot exceed 200 characters.')
        continue
      }
      return { kind: 'rename', title, attachments }
    }
    if (trimmed === '/attach' || trimmed.startsWith('/attach ')) {
      const rawPaths = trimmed.slice('/attach'.length).trim()
      if (!rawPaths) {
        terminal.status('Usage: /attach <path> [more paths]')
        continue
      }
      try {
        attachments = await addPaths(
          attachments,
          parseAttachmentPaths(rawPaths),
          terminal,
          dependencies
        )
      } catch (error) {
        terminal.status(`Error: ${error instanceof Error ? error.message : String(error)}`)
      }
      continue
    }
    if (trimmed) {
      const pastedPaths = await dependencies.pastedAttachmentPaths(input.value)
      if (pastedPaths) {
        // A dragged path is still just user input. Preload an explicit command
        // so the next Enter is the user's confirmation before any bytes are read.
        const command = attachmentCommand(pastedPaths)
        if (!command) {
          terminal.status('The detected path cannot be safely preloaded. Use /attach manually.')
          continue
        }
        if (!terminal.preload(command)) {
          terminal.status(
            'File path detected, but newer composer input took priority. Use /attach to add it.'
          )
          continue
        }
        terminal.status('File path detected. Press Enter to attach it, or edit the command.')
        continue
      }
    }
    if (trimmed.startsWith('/')) {
      const taggedSlash = input.contexts?.some(
        (context) => context.kind === 'skill' || context.kind === 'mcp'
      )
      if (!taggedSlash) {
        terminal.status(`Unknown command: ${trimmed.split(/\s/, 1)[0]}. Use /help.`)
        continue
      }
    }
    if (!trimmed && attachments.length === 0) continue
    if (utf8Bytes(input.value) > MAX_CHAT_PROMPT_BYTES) {
      terminal.status('Error: Chat input exceeds the 10 MiB limit.')
      continue
    }
    return {
      kind: 'turn',
      prompt: input.value,
      attachments,
      queued: input.queued === true,
      ...(input.display === undefined ? {} : { display: input.display }),
      ...(input.pastes === undefined ? {} : { pastes: input.pastes }),
      ...(input.contexts?.length ? { contexts: input.contexts } : {}),
    }
  }
}

type QuestionAnswers = { kind: 'answer'; value: string } | { kind: 'cancel' } | { kind: 'exit' }

async function answerQuestions(
  terminal: ChatTerminal,
  questions: ChatQuestion[]
): Promise<QuestionAnswers> {
  const answers: string[] = []
  for (const [index, question] of questions.entries()) {
    if (questions.length > 1) terminal.status(`Question ${index + 1} of ${questions.length}`)
    const result = await terminal.askQuestion({
      prompt: question.prompt,
      multi: question.type === 'multi_select',
      options: question.options,
    })
    if (result.kind === 'eof') return { kind: 'exit' }
    if (result.kind === 'cancel') return { kind: 'cancel' }
    answers.push(`${safeOneLine(question.prompt)} — ${result.values.map(safeOneLine).join(', ')}`)
  }
  return { kind: 'answer', value: answers.join('\n') }
}

async function isChatTurnInput(
  input: Extract<ChatTerminalInput, { kind: 'line' }>,
  dependencies: Pick<ChatDependencies, 'pastedAttachmentPaths'>
): Promise<boolean> {
  const trimmed = input.value.trim()
  if (!trimmed) return false
  if (
    trimmed.startsWith('/') &&
    !input.contexts?.some((context) => context.kind === 'skill' || context.kind === 'mcp')
  ) {
    return false
  }
  return !(await dependencies.pastedAttachmentPaths(input.value))
}

function logSuggestionLabel(
  log: ListLogsResponse['data'][number],
  workflowNames: ReadonlyMap<string, string>
): string {
  const workflow =
    log.workflow?.name ||
    (log.workflowId ? workflowNames.get(log.workflowId) : undefined) ||
    log.workflowId ||
    'Unknown workflow'
  const started = new Date(log.startedAt)
  const time = Number.isNaN(started.getTime()) ? log.startedAt : started.toLocaleString()
  return `${workflow} · ${time}`.slice(0, 255)
}

/**
 * Builds the same two pools as the home composer from existing public lists:
 * workspace resources under `@`, then skills and enabled MCP servers under `/`.
 * Each request fails independently so one unavailable resource family does not
 * disable the rest of the composer.
 */
function loadSuggestionCandidates(
  client: SimClient,
  workspaceId: string,
  readOnly: boolean,
  signal: AbortSignal,
  publish: (candidates: ChatSuggestionCandidates) => void
): void {
  const query = { workspaceId }
  const resourceGroups = {
    workflows: [] as SuggestionItem[],
    tables: [] as SuggestionItem[],
    files: [] as SuggestionItem[],
    knowledge: [] as SuggestionItem[],
    logs: [] as SuggestionItem[],
  }
  const slashGroups = {
    skills: [] as SuggestionItem[],
    mcp: [] as SuggestionItem[],
  }
  let workflowsForLogs: ListWorkflowsResponse['data'] = []
  let loadedLogs: ListLogsResponse['data'] | null = null
  const publishCurrent = () => {
    publish({
      resources: [
        ...resourceGroups.workflows,
        ...resourceGroups.tables,
        ...resourceGroups.files,
        ...resourceGroups.knowledge,
        ...resourceGroups.logs,
      ],
      slash: [...slashGroups.skills, ...slashGroups.mcp],
    })
  }
  const publishLogs = () => {
    if (!loadedLogs) return
    const workflowNames = new Map(workflowsForLogs.map((workflow) => [workflow.id, workflow.name]))
    resourceGroups.logs = loadedLogs.slice(0, MAX_LOG_SUGGESTIONS).map((log) => {
      const label = logSuggestionLabel(log, workflowNames)
      return {
        id: `logs:${log.executionId}`,
        value: label,
        displayText: label,
        description: 'log',
        tag: 'logs',
        context: { kind: 'logs' as const, executionId: log.executionId, label },
      }
    })
    publishCurrent()
  }

  const workflowsRequest = requestAllPages<ListWorkflowsResponse['data'][number]>(
    client,
    V2_OPERATIONS.listWorkflows.path,
    {
      query,
      pageSize: 50,
      signal,
      auth: 'optional',
    }
  ).catch(() => [])
  void workflowsRequest.then((workflows) => {
    workflowsForLogs = workflows
    resourceGroups.workflows = workflows.map((workflow) => ({
      id: `workflow:${workflow.id}`,
      value: workflow.name,
      displayText: workflow.name,
      description: 'workflow',
      tag: 'workflow',
      context: {
        kind: 'workflow' as const,
        workflowId: workflow.id,
        label: workflow.name,
      },
    }))
    publishCurrent()
    publishLogs()
  })

  void requestAllPages<ListTablesResponse['data'][number]>(client, V2_OPERATIONS.listTables.path, {
    query,
    pageSize: 100,
    signal,
    auth: 'optional',
  })
    .catch(() => [])
    .then((tables) => {
      resourceGroups.tables = tables.map((table) => ({
        id: `table:${table.id}`,
        value: table.name,
        displayText: table.name,
        description: 'table',
        tag: 'table',
        context: { kind: 'table' as const, tableId: table.id, label: table.name },
      }))
      publishCurrent()
    })

  void requestAllPages<ListFilesResponse['data'][number]>(client, V2_OPERATIONS.listFiles.path, {
    query,
    pageSize: 100,
    signal,
    auth: 'optional',
  })
    .catch(() => [])
    .then((files) => {
      resourceGroups.files = files.map((file) => ({
        id: `file:${file.id}`,
        value: file.name,
        displayText: file.name,
        description: 'file',
        tag: 'file',
        context: { kind: 'file' as const, fileId: file.id, label: file.name },
      }))
      publishCurrent()
    })

  void client
    .request<ListKnowledgeBasesResponse>(V2_OPERATIONS.listKnowledgeBases.path, {
      query,
      signal,
      auth: 'optional',
    })
    .then((page) => page.data)
    .catch(() => [])
    .then((knowledge) => {
      resourceGroups.knowledge = knowledge.map((base) => ({
        id: `knowledge:${base.id}`,
        value: base.name,
        displayText: base.name,
        description: 'knowledge base',
        tag: 'knowledge',
        context: { kind: 'knowledge' as const, knowledgeId: base.id, label: base.name },
      }))
      publishCurrent()
    })

  const logsRequest = client
    .request<ListLogsResponse>(V2_OPERATIONS.listLogs.path, {
      query: { workspaceId, details: 'basic', order: 'desc', limit: MAX_LOG_SUGGESTIONS },
      signal,
      auth: 'optional',
    })
    .then((page) => page.data)
    .catch(() => [])
  void logsRequest.then((logs) => {
    loadedLogs = logs
    publishLogs()
  })

  void client
    .request<ListSkillsResponse>(V2_OPERATIONS.listSkills.path, { query, signal, auth: 'optional' })
    .catch(() => null)
    .then((skills) => {
      slashGroups.skills = (skills?.data ?? []).map((skill) => ({
        id: `skill:${skill.id}`,
        value: skill.name,
        displayText: `/${skill.name}`,
        description: skill.description,
        tag: 'skill',
        context: { kind: 'skill' as const, skillId: skill.id, label: skill.name },
      }))
      publishCurrent()
    })

  if (!readOnly) {
    void client
      .request<ListMcpServersResponse>(V2_OPERATIONS.listMcpServers.path, {
        query,
        signal,
        auth: 'optional',
      })
      .catch(() => null)
      .then((servers) => {
        slashGroups.mcp = (servers?.data ?? [])
          .filter((server) => server.enabled !== false)
          .map((server) => ({
            id: `mcp:${server.id}`,
            value: server.name,
            displayText: `/${server.name}`,
            description: server.description ?? 'MCP server',
            tag: 'mcp',
            context: { kind: 'mcp' as const, serverId: server.id, label: server.name },
          }))
        publishCurrent()
      })
  }
}

const NEW_CHAT_SELECTION_ID = 'sim-cli:new-chat'
const NEW_CHAT_TITLE = 'New chat'

function chatMenuDescription(chat: ChatSummary, currentChatId?: string): string {
  const labels: string[] = []
  if (chat.id === currentChatId) labels.push('current')
  if (chat.pinned) labels.push('pinned')
  if (chat.active) labels.push('active')
  const updated = new Date(chat.updatedAt)
  labels.push(
    Number.isNaN(updated.getTime())
      ? `updated ${safeOneLine(chat.updatedAt)}`
      : updated.toLocaleString()
  )
  return labels.join(' · ')
}

async function selectChat(
  client: SimClient,
  terminal: ChatTerminal,
  workspaceId: string,
  currentChatId?: string
): Promise<ChatTerminalSelectResult> {
  const chats = await requestAllPages<ChatSummary>(client, V2_OPERATIONS.listChats.path, {
    query: { workspaceId },
    pageSize: 100,
    auth: 'optional',
  })
  return terminal.select({
    prompt: 'Choose a chat',
    options: [
      {
        id: NEW_CHAT_SELECTION_ID,
        label: NEW_CHAT_TITLE,
        description: 'start a blank conversation',
      },
      ...chats.map((chat) => ({
        id: chat.id,
        label: chat.title?.trim() || 'Untitled chat',
        description: chatMenuDescription(chat, currentChatId),
      })),
    ],
  })
}

async function loadChat(
  client: SimClient,
  workspaceId: string,
  chatId: string,
  readOnly: boolean
): Promise<GetChatResponse['data']> {
  const response = await client.request<GetChatResponse>(
    resolvePath(V2_OPERATIONS.getChat.path, { chatId }),
    {
      query: { workspaceId, ...(readOnly ? { readOnly: true } : {}) },
      auth: 'optional',
    }
  )
  return response.data
}

async function renameChat(
  client: SimClient,
  workspaceId: string,
  chatId: string,
  title: string
): Promise<string> {
  const body: RenameChatBody = { workspaceId, title }
  const response = await client.request<RenameChatResponse>(
    resolvePath(V2_OPERATIONS.renameChat.path, { chatId }),
    { method: 'PATCH', body, auth: 'optional' }
  )
  return response.data.title
}

function renderStoredAssistantMessage(content: string, formatMarkdown: boolean): string {
  const rendered = renderChatStructured(
    withoutTrailingStandaloneResource(parseChatStructured(content)),
    renderContext(false)
  )
  const markdown = new ChatMarkdownStream(formatMarkdown)
  return `${markdown.push(rendered.text)}${markdown.finish()}`
}

/** Removes a terminal-dead resource pointer that the web UI renders as a clickable panel link. */
function withoutTrailingStandaloneResource(
  segments: readonly ChatStructuredSegment[]
): ChatStructuredSegment[] {
  let index = segments.length - 1
  let foundResource = false

  while (index >= 0) {
    const segment = segments[index]
    if (segment.kind === 'workspace_resource') {
      foundResource = true
      index -= 1
      continue
    }
    if (segment.kind === 'thinking' || segment.kind === 'options') {
      index -= 1
      continue
    }
    if (segment.kind === 'text' && !segment.text.trim()) {
      index -= 1
      continue
    }
    break
  }

  const boundary = segments[index]
  if (
    !foundResource ||
    boundary?.kind !== 'text' ||
    !boundary.text.trim() ||
    !/\n[^\S\n]*$/u.test(boundary.text)
  ) {
    return [...segments]
  }

  return [
    ...segments.slice(0, index),
    { ...boundary, text: boundary.text.trimEnd() },
    ...segments.slice(index + 1).filter((segment) => {
      if (segment.kind === 'workspace_resource') return false
      return segment.kind !== 'text' || Boolean(segment.text.trim())
    }),
  ]
}

function showChatHistory(
  terminal: ChatTerminal,
  title: string | null,
  messages: ChatHistoryMessage[],
  formatMarkdown: boolean,
  status: 'resumed' | 'active' | 'still-active'
): void {
  terminal.clearTranscript()
  const name = safeOneLine(title ?? '') || 'Untitled chat'
  terminal.setChatTitle(name)
  const message =
    status === 'active'
      ? `Opened ${name}. This chat is currently active elsewhere.`
      : status === 'still-active'
        ? `Refreshed ${name}. This chat remains active elsewhere.`
        : `Resumed ${name}.`
  terminal.status(message)
  for (const message of messages) {
    if (message.role === 'user') {
      terminal.userMessage(message.content)
      continue
    }
    const rendered = renderStoredAssistantMessage(message.content, formatMarkdown)
    if (!rendered) continue
    terminal.write(rendered)
    if (!rendered.endsWith('\n')) terminal.write('\n')
  }
}

/**
 * Best-effort workspace name lookup, unawaited so the header paints
 * immediately; a failure just leaves the row out.
 */
async function resolveWorkspaceName(
  client: SimClient,
  workspaceId: string
): Promise<string | null> {
  try {
    const response = await client.request<GetWorkspaceResponse>(
      resolvePath(V2_OPERATIONS.getWorkspace.path, { workspaceId }),
      { auth: 'optional' }
    )
    return response.data.workspace.name || null
  } catch {
    return null
  }
}

async function runInteractive(
  client: SimClient,
  workspaceId: string,
  initialPrompt: string,
  initialAttachments: ChatAttachment[],
  readOnly: boolean,
  dependencies: ChatDependencies,
  profileName?: string
): Promise<void> {
  const terminal = dependencies.createTerminal()
  const suggestionController = new AbortController()
  let continuationToken: string | undefined
  let currentChatId: string | undefined
  let resumedChatActive = false
  let pendingAttachments = initialAttachments
  let nextPrompt: string | null = initialPrompt || (initialAttachments.length ? '' : null)
  let nextPromptQueued = false
  let nextPromptDisplay: string | undefined
  let nextPromptPastes: ReadonlyMap<number, string> | undefined
  let nextPromptContexts: ChatContext[] = []
  let nextPromptConflictRetries = 0
  let pendingQuestions: ChatQuestion[] = []

  const startNewConversation = () => {
    pendingQuestions = []
    continuationToken = undefined
    currentChatId = undefined
    resumedChatActive = false
    terminal.clearTranscript()
    terminal.setChatTitle(NEW_CHAT_TITLE)
    terminal.status('Started a new conversation.')
  }

  try {
    terminal.welcome({ chatTitle: NEW_CHAT_TITLE, profile: profileName })
    void resolveWorkspaceName(client, workspaceId).then((name) => {
      if (name) terminal.setWorkspaceName(name)
    })
    loadSuggestionCandidates(
      client,
      workspaceId,
      readOnly,
      suggestionController.signal,
      (candidates) => {
        terminal.setSuggestionCandidates?.(candidates)
      }
    )
    if (initialPrompt.trim()) terminal.userMessage(initialPrompt)
    while (true) {
      if (nextPrompt === null) {
        const input = await readUserTurn(
          terminal,
          pendingAttachments,
          dependencies,
          pendingQuestions.length > 0
        )
        if (input.kind === 'exit') return
        pendingAttachments = input.attachments
        if (input.kind === 'idle') {
          const questions = pendingQuestions
          pendingQuestions = []
          const questionAnswers = await answerQuestions(terminal, questions)
          if (questionAnswers.kind === 'exit') return
          if (questionAnswers.kind === 'cancel') continue
          nextPrompt = questionAnswers.value
          nextPromptQueued = false
          nextPromptDisplay = undefined
          nextPromptPastes = undefined
          nextPromptContexts = []
          nextPromptConflictRetries = 0
          continue
        }
        if ((input.kind === 'clear' || input.kind === 'chats') && terminal.hasQueuedInput()) {
          terminal.status('Finish queued prompts before changing conversations.')
          continue
        }
        if (input.kind === 'clear') {
          startNewConversation()
          continue
        }
        if (input.kind === 'chats') {
          pendingQuestions = []
          let selection: ChatTerminalSelectResult
          try {
            selection = await selectChat(client, terminal, workspaceId, currentChatId)
          } catch (error) {
            terminal.status(
              `Error: ${safeOneLine(error instanceof Error ? error.message : String(error))}`
            )
            continue
          }
          if (selection.kind === 'eof') return
          if (selection.kind === 'cancel') continue
          if (selection.id === NEW_CHAT_SELECTION_ID) {
            startNewConversation()
            continue
          }
          try {
            const chat = await loadChat(client, workspaceId, selection.id, readOnly)
            if (!chat.continuationToken) {
              throw new SimApiError('Sim Chat did not return a continuation token.', 0)
            }
            continuationToken = chat.continuationToken
            currentChatId = chat.id
            resumedChatActive = chat.active
            showChatHistory(
              terminal,
              chat.title,
              chat.messages,
              dependencies.formatMarkdown(),
              chat.active ? 'active' : 'resumed'
            )
          } catch (error) {
            terminal.status(
              `Error: ${safeOneLine(error instanceof Error ? error.message : String(error))}`
            )
          }
          continue
        }
        if (input.kind === 'rename') {
          if (!currentChatId) {
            terminal.status('Send a message before renaming this chat.')
            continue
          }
          try {
            const title = await renameChat(client, workspaceId, currentChatId, input.title)
            terminal.setChatTitle(title)
            terminal.status(`Renamed chat to ${title}.`)
          } catch (error) {
            terminal.status(
              `Error: ${safeOneLine(error instanceof Error ? error.message : String(error))}`
            )
          }
          continue
        }
        pendingQuestions = []
        nextPrompt = input.prompt
        nextPromptQueued = input.queued
        nextPromptDisplay = input.display
        nextPromptPastes = input.pastes
        nextPromptContexts = input.contexts ?? []
        nextPromptConflictRetries = 0
      }

      if (resumedChatActive && currentChatId) {
        const retryDisplay = nextPromptDisplay ?? nextPrompt
        const restorePrompt = (): boolean =>
          terminal.preload(retryDisplay, {
            queued: true,
            pastes: nextPromptPastes,
            ...(nextPromptContexts.length ? { contexts: nextPromptContexts } : {}),
          })
        try {
          const chat = await loadChat(client, workspaceId, currentChatId, readOnly)
          continuationToken = chat.continuationToken
          currentChatId = chat.id
          resumedChatActive = chat.active
          showChatHistory(
            terminal,
            chat.title,
            chat.messages,
            dependencies.formatMarkdown(),
            chat.active ? 'still-active' : 'resumed'
          )
          if (!chat.active) {
            if (retryDisplay.trim()) terminal.userMessage(retryDisplay)
          } else {
            if (!restorePrompt()) {
              terminal.status('The pending prompt could not be restored. Please enter it again.')
            }
            nextPrompt = null
            nextPromptQueued = false
            nextPromptDisplay = undefined
            nextPromptPastes = undefined
            nextPromptContexts = []
            nextPromptConflictRetries = 0
            continue
          }
        } catch (error) {
          const restored = restorePrompt()
          const message = safeOneLine(error instanceof Error ? error.message : String(error))
          terminal.status(
            restored
              ? `Error: ${message}. Press Enter to retry.`
              : `Error: ${message}. Please enter the prompt again.`
          )
          nextPrompt = null
          nextPromptQueued = false
          nextPromptDisplay = undefined
          nextPromptPastes = undefined
          nextPromptContexts = []
          nextPromptConflictRetries = 0
          continue
        }
      }

      const sentPrompt = nextPrompt
      const sentPromptQueued = nextPromptQueued
      const sentPromptDisplay = nextPromptDisplay
      const sentPromptPastes = nextPromptPastes
      const sentContexts = nextPromptContexts
      const sentConflictRetries = nextPromptConflictRetries
      const sentAttachments = pendingAttachments
      pendingAttachments = []
      const controller = new AbortController()
      let sessionReady = false
      let submitRequested = false
      let submitChecks = Promise.resolve()
      const stopListening = terminal.onInterrupt((reason, input) => {
        if (reason === 'manual') {
          if (!controller.signal.aborted) controller.abort(reason)
          return
        }
        if (input?.kind !== 'line') return
        submitChecks = submitChecks.then(async () => {
          if (!(await isChatTurnInput(input, dependencies))) return
          if (!submitRequested) {
            submitRequested = true
            if (sessionReady && !controller.signal.aborted) controller.abort(reason)
          }
        })
      })
      const activity = terminal.activity('Thinking…')
      const parser = new ChatStructuredParser()
      const markdownEnabled = dependencies.formatMarkdown()
      const markdown = new ChatMarkdownStream(markdownEnabled)
      const narrationMarkdown = new Map<string, ChatMarkdownStream>()
      const questions: ChatQuestion[] = []
      let wroteOutput = false
      let pendingWhitespace = ''
      let previousWasBlock = false
      let outputFinalized = false
      let strippedOptions = false
      let deferredTrailingResourceParts: RenderPart[] | null = null

      const writePart = (value: string, block: boolean) => {
        if (!value) return
        let separator = ''
        if (wroteOutput && (block || previousWasBlock)) {
          const trailingNewlines = pendingWhitespace.match(/\n*$/u)?.[0].length ?? 0
          const leadingNewlines = value.match(/^\n*/u)?.[0].length ?? 0
          separator = '\n'.repeat(Math.max(0, 2 - trailingNewlines - leadingNewlines))
        }
        const output = `${pendingWhitespace}${separator}${value}`
        const trailing = output.match(/\s+$/u)?.[0] ?? ''
        const ready = trailing ? output.slice(0, -trailing.length) : output
        if (ready) {
          terminal.write(ready)
          wroteOutput = true
        }
        pendingWhitespace = trailing
        previousWasBlock = block
      }

      const flushDeferredTrailingResource = () => {
        if (!deferredTrailingResourceParts) return
        for (const part of deferredTrailingResourceParts) writePart(part.value, part.block)
        deferredTrailingResourceParts = null
      }

      const finishOutput = () => {
        if (outputFinalized) return
        outputFinalized = true
        if (deferredTrailingResourceParts) {
          if (wroteOutput) {
            deferredTrailingResourceParts = null
            pendingWhitespace = ''
          } else {
            flushDeferredTrailingResource()
          }
        }
        writePart(markdown.finish(), false)
        pendingWhitespace = ''
        if (wroteOutput) terminal.write('\n')
      }

      const finishNarration = (parentId: string) => {
        const stream = narrationMarkdown.get(parentId)
        if (!stream) return
        const delta = stream.finish()
        if (delta) activity.event({ kind: 'narration', parentId, delta })
        narrationMarkdown.delete(parentId)
      }

      const finishNarrations = () => {
        for (const parentId of [...narrationMarkdown.keys()]) finishNarration(parentId)
      }

      const renderActivity = (update: ChatActivityUpdate) => {
        if (update.kind === 'narration') {
          let stream = narrationMarkdown.get(update.parentId)
          if (!stream) {
            stream = new ChatMarkdownStream(markdownEnabled)
            narrationMarkdown.set(update.parentId, stream)
          }
          const delta = stream.push(update.delta)
          if (delta) activity.event({ ...update, delta })
          return
        }

        if (update.parentId) finishNarration(update.parentId)
        if (update.kind === 'subagent' && update.state !== 'running') finishNarration(update.id)
        activity.event(update)
      }

      const renderSegments = async (segments: Parameters<typeof renderChatStructured>[0]) => {
        const list = typeof segments === 'string' ? parseChatStructured(segments) : [...segments]
        for (const segment of list) {
          let displaySegment = segment
          if (segment.kind === 'options') {
            // Suggestions are hidden terminal metadata. Any whitespace the
            // model emitted immediately before them belongs to that hidden UI,
            // so do not leak it into the transcript or the next composer.
            if (!deferredTrailingResourceParts) pendingWhitespace = ''
            strippedOptions = true
          } else if (segment.kind === 'text' && strippedOptions) {
            const text = segment.text.replace(/^\s+/u, '')
            if (!text) continue
            displaySegment = { ...segment, text }
            strippedOptions = false
          } else if (segment.kind !== 'thinking') {
            strippedOptions = false
          }
          const rendered = renderChatStructured([displaySegment], renderContext(true))
          if (displaySegment.kind === 'text') {
            const value = markdown.push(rendered.text)
            if (deferredTrailingResourceParts && !rendered.text.trim()) {
              if (value) deferredTrailingResourceParts.push({ value, block: false })
              continue
            }
            flushDeferredTrailingResource()
            writePart(value, false)
          } else {
            const inline = markdown.flushInline()
            if (deferredTrailingResourceParts && !inline.trim()) {
              if (inline) deferredTrailingResourceParts.push({ value: inline, block: false })
            } else {
              flushDeferredTrailingResource()
              writePart(inline, false)
            }
            /* Reuse the renderer's own block classification rather than
               re-deriving it by segment kind, so the streaming and one-shot
               paths cannot disagree about spacing. */
            if (displaySegment.kind === 'workspace_resource') {
              if (deferredTrailingResourceParts) {
                deferredTrailingResourceParts.push(...rendered.parts)
              } else if (wroteOutput && pendingWhitespace.includes('\n')) {
                deferredTrailingResourceParts = [...rendered.parts]
              } else {
                for (const part of rendered.parts) writePart(part.value, part.block)
              }
            } else {
              if (
                deferredTrailingResourceParts &&
                (rendered.parts.length > 0 || rendered.interactions.length > 0)
              ) {
                flushDeferredTrailingResource()
              }
              for (const part of rendered.parts) writePart(part.value, part.block)
            }
          }
          for (const interaction of rendered.interactions) {
            if (interaction.kind === 'question') questions.push(...interaction.questions)
          }
        }
      }

      try {
        const response = await requestChat(
          client,
          {
            workspaceId,
            prompt: nextPrompt,
            ...(readOnly ? { readOnly: true } : {}),
            ...(continuationToken ? { continuationToken } : {}),
            ...(sentAttachments.length ? { attachments: sentAttachments } : {}),
            ...(sentContexts.length ? { contexts: sentContexts } : {}),
          },
          controller.signal
        )
        const result = await readChatTurn(response, {
          onDelta: (delta) => {
            finishNarrations()
            activity.clear()
            return renderSegments(parser.push(delta))
          },
          onThinking: (delta) => activity.thinking(delta),
          onActivity: renderActivity,
          onContinuationToken: (token) => {
            continuationToken = token
            sessionReady = true
            if (submitRequested && !controller.signal.aborted) controller.abort('submit')
          },
          onChatId: (chatId) => {
            currentChatId = chatId
          },
          onTitle: (title) => terminal.setChatTitle(title),
        })
        if (result.streamedContent) {
          // The completion is authoritative. Upstream normally mirrors every
          // byte as a delta, but a proxy can omit the last buffered suffix; feed
          // that suffix through the same parser before finalizing its state.
          if (
            result.content.length > result.streamedContent.length &&
            result.content.startsWith(result.streamedContent)
          ) {
            await renderSegments(parser.push(result.content.slice(result.streamedContent.length)))
          }
          await renderSegments(parser.finish())
        } else {
          finishNarrations()
          activity.clear()
          await renderSegments(result.content)
        }
        if (!result.continuationToken) {
          throw new SimApiError('Sim Chat did not return a continuation token.', 0)
        }
        finishNarrations()
        finishOutput()
        activity.complete()
        continuationToken = result.continuationToken
        nextPromptQueued = false
        nextPromptDisplay = undefined
        nextPromptPastes = undefined
        nextPromptContexts = []
        nextPromptConflictRetries = 0
        await submitChecks
        if (submitRequested || questions.length === 0) {
          pendingQuestions = []
          nextPrompt = null
        } else if (terminal.hasQueuedInput()) {
          pendingQuestions = questions
          nextPrompt = null
        } else {
          const questionAnswers = await answerQuestions(terminal, questions)
          if (questionAnswers.kind === 'exit') return
          nextPrompt = questionAnswers.kind === 'answer' ? questionAnswers.value : null
        }
      } catch (error) {
        await submitChecks
        const queuedSubmit = controller.signal.aborted && controller.signal.reason === 'submit'
        if (!queuedSubmit && !sessionReady) {
          pendingAttachments = combineChatAttachments(sentAttachments, pendingAttachments)
        }
        finishNarrations()
        finishOutput()
        activity.stop()
        if (controller.signal.aborted) {
          if (!queuedSubmit) terminal.status('Generation cancelled.')
        } else {
          const message = error instanceof Error ? error.message : String(error)
          const code =
            error instanceof SimApiError && error.code ? ` (${safeOneLine(error.code)})` : ''
          const conflict =
            error instanceof SimApiError && error.status === 409 && error.code === 'CONFLICT'
          if (conflict && currentChatId) resumedChatActive = true
          if (
            conflict &&
            !sessionReady &&
            sentPromptQueued &&
            continuationToken &&
            sentConflictRetries < 1
          ) {
            nextPrompt = sentPrompt
            nextPromptQueued = true
            nextPromptDisplay = sentPromptDisplay
            nextPromptPastes = sentPromptPastes
            nextPromptContexts = sentContexts
            nextPromptConflictRetries = sentConflictRetries + 1
            terminal.status('Previous response is still settling. Retrying…')
            continue
          }
          const restored =
            !sessionReady &&
            (sentPromptQueued || conflict) &&
            terminal.preload(sentPromptDisplay ?? sentPrompt, {
              queued: true,
              pastes: sentPromptPastes,
              ...(sentContexts.length ? { contexts: sentContexts } : {}),
            })
          if (conflict && restored) {
            terminal.status('Previous response is still settling. Press Enter to retry.')
          } else {
            terminal.status(`Error: ${safeOneLine(message)}${code}`)
          }
        }
        nextPrompt = null
        nextPromptQueued = false
        nextPromptDisplay = undefined
        nextPromptPastes = undefined
        nextPromptContexts = []
        nextPromptConflictRetries = 0
      } finally {
        activity.stop()
        stopListening()
      }
    }
  } finally {
    suggestionController.abort()
    terminal.close()
  }
}

function collectFile(value: string, previous: string[] = []): string[] {
  return [...previous, value]
}

/** Creates print-mode and interactive workspace chat. */
export function chatCommand(overrides: Partial<ChatDependencies> = {}): Command {
  const dependencies: ChatDependencies = {
    readInput: readPipedInput,
    writeOutput: writeCompletedAnswer,
    isInteractive: () =>
      Boolean(process.stdin.isTTY && process.stdout.isTTY && process.stderr.isTTY),
    createTerminal: () => new ReadlineChatTerminal(),
    loadAttachments: loadChatAttachments,
    clipboardImage: readClipboardImage,
    pastedAttachmentPaths: existingAttachmentPaths,
    // The fullscreen chat already requires a TTY and uses ANSI throughout. A
    // propagated TERM=dumb value must not leave model Markdown visible inside
    // an otherwise fully rendered TUI.
    formatMarkdown: () => Boolean(process.stdout.isTTY),
    ...overrides,
  }

  return new Command('chat')
    .description('Ask Sim Chat about the active workspace')
    .argument('[prompt...]', 'Question to ask')
    .option('-p, --print', 'Print the final response and exit')
    .option('-f, --file <path>', 'Attach a local file (repeatable)', collectFile, [])
    .option('--read-only', 'Restrict Sim Chat to read-only workspace tools')
    .action(
      async (
        promptParts: string[],
        options: { print?: boolean; file: string[]; readOnly?: boolean },
        command: Command
      ) => {
        const positionalPrompt = promptParts.join(' ')
        const positionalBytes = utf8Bytes(positionalPrompt)
        if (positionalBytes > MAX_CHAT_PROMPT_BYTES) throw inputTooLarge()

        const interactive = !options.print && dependencies.isInteractive()
        if (!options.print && !interactive) {
          throw new SimApiError(
            'Interactive Sim Chat requires a terminal. Use sim chat -p for pipelines or redirected output.',
            0
          )
        }
        const separatorBytes = positionalPrompt ? 1 : 0
        const pipedInput = interactive
          ? ''
          : await dependencies.readInput(MAX_CHAT_PROMPT_BYTES - positionalBytes - separatorBytes)
        const prompt = composeChatPrompt(promptParts, pipedInput)
        if (utf8Bytes(prompt) > MAX_CHAT_PROMPT_BYTES) throw inputTooLarge()

        const attachments = await dependencies.loadAttachments(options.file ?? [])
        if (!interactive && !prompt.trim() && attachments.length === 0) {
          throw new SimApiError('Provide a prompt, attach a file, or pipe input to sim chat -p.', 0)
        }

        const { client, profile } = clientFrom(command)
        const workspaceId = client.requireWorkspace(undefined, { auth: 'optional' })
        if (interactive) {
          await runInteractive(
            client,
            workspaceId,
            prompt,
            attachments,
            options.readOnly === true,
            dependencies,
            profile.name
          )
          return
        }
        await runOneShot(
          client,
          workspaceId,
          prompt,
          attachments,
          options.readOnly === true,
          dependencies
        )
      }
    )
}
