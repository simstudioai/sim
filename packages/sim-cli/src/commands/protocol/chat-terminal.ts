import { emitKeypressEvents, type Key } from 'node:readline'
import type { Readable, Writable } from 'node:stream'
import { safeOneLine, sanitize } from '../../output/render.js'
import {
  artPad,
  displayWidth,
  firstGrapheme,
  graphemes,
  graphemeWidth,
  lineEnd,
  lineStart,
  nextGraphemeIndex,
  previousGraphemeIndex,
  tailToWidth,
  truncateDisplay,
} from '../../output/terminal-text.js'

export type ChatTerminalInput =
  | {
      kind: 'line'
      value: string
      queued?: boolean
      display?: string
      /** Large-paste bodies retained only so a failed queued turn can be retried losslessly. */
      pastes?: ReadonlyMap<number, string>
      /** Identity-bearing `@` and `/` tags present in this submitted line. */
      contexts?: ChatContext[]
    }
  | { kind: 'clipboard'; value: string }
  | { kind: 'selection'; values: string[] }
  | { kind: 'interrupt'; empty?: boolean }
  | { kind: 'eof' }

type ChatActivityState = 'running' | 'complete' | 'error'

export type ChatActivityUpdate =
  | {
      kind: 'tool' | 'subagent'
      id: string
      label: string
      state: ChatActivityState
      /** Opaque public id of the subagent lane that owns this row. */
      parentId?: string
    }
  | {
      kind: 'narration'
      /** Opaque public id of the subagent lane that owns this text. */
      parentId: string
      delta: string
    }

export interface ChatActivity {
  update(message: string): void
  thinking(delta: string): void
  event(update: ChatActivityUpdate): void
  clear(): void
  complete(): void
  stop(): void
}

export interface ChatTerminalQuestion {
  prompt: string
  multi: boolean
  options: Array<{ id: string; label: string }>
}

export interface ChatTerminalSelect {
  prompt: string
  options: Array<{ id: string; label: string; description?: string }>
}

export interface ChatTerminalWelcome {
  chatTitle: string
  profile?: string
  workspaceName?: string
}

export type ChatTerminalQuestionResult =
  | { kind: 'answer'; values: string[] }
  | { kind: 'cancel' }
  | { kind: 'eof' }

export type ChatTerminalSelectResult =
  | { kind: 'selected'; id: string }
  | { kind: 'cancel' }
  | { kind: 'eof' }

export type ChatTerminalInterruptReason = 'manual' | 'submit'
export type ChatTerminalInterruptListener = (
  reason: ChatTerminalInterruptReason,
  input?: ChatTerminalInput
) => void

export interface ChatTerminal {
  welcome(context: ChatTerminalWelcome): void
  /** Updates the active conversation title after resume or server-side title generation. */
  setChatTitle(title: string): void
  /** Fills in the workspace name once the lookup resolves. */
  setWorkspaceName(name: string): void
  /** Inserts an `[Image #N]` tag at the cursor for a just-attached image. */
  noteAttachment(): void
  /** Supplies the home-composer `@` resource and `/` skill/MCP pools. */
  setSuggestionCandidates?(candidates: ChatSuggestionCandidates): void
  /** Clears the visible conversation while preserving the active terminal session. */
  clearTranscript(): void
  userMessage(message: string): void
  read(prompt: string): Promise<ChatTerminalInput>
  /** Whether deferred input, a control, or a priority preload is waiting to be consumed. */
  hasQueuedInput(): boolean
  /** Temporarily stages text ahead of queued turns without discarding the live draft. */
  preload(
    value: string,
    options?: {
      queued?: boolean
      pastes?: ReadonlyMap<number, string>
      contexts?: ChatContext[]
    }
  ): boolean
  status(message: string): void
  /** Writes trusted, already-rendered assistant output into the coordinated transcript viewport. */
  write(content: string): void
  activity(message: string): ChatActivity
  askQuestion(question: ChatTerminalQuestion): Promise<ChatTerminalQuestionResult>
  /** Opens a searchable, single-choice menu above the bottom-pinned search composer. */
  select(menu: ChatTerminalSelect): Promise<ChatTerminalSelectResult>
  onInterrupt(listener: ChatTerminalInterruptListener): () => void
  close(): void
}

interface TerminalInput extends Readable {
  isTTY?: boolean
  isRaw?: boolean
  setRawMode?: (mode: boolean) => void
}

interface TerminalOutput extends Writable {
  isTTY?: boolean
  columns?: number
  rows?: number
}

interface CursorPoint {
  index: number
  row: number
  column: number
}

interface DraftLayout {
  rows: string[]
  points: CursorPoint[]
  cursor: CursorPoint
}

interface DraftLayoutOptions {
  continuationPrefix?: string
  normalTextStyle?: string
}

interface RenderPanel {
  lines: string[]
  focusRow?: number
  centerFocus?: boolean
  cursor?: { row: number; column: number }
}

interface QuestionState {
  question: ChatTerminalQuestion
  active: number
  selected: Set<number>
  previousDraft: string
  previousCursor: number
  previousContexts: ChatContext[]
  resolve: (result: ChatTerminalQuestionResult) => void
}

interface SelectState {
  menu: ChatTerminalSelect
  active: number
  previousDraft: string
  previousCursor: number
  previousContexts: ChatContext[]
  resolve: (result: ChatTerminalSelectResult) => void
}

interface QueuedTerminalInput {
  input: ChatTerminalInput
  /** Composer text that has not already been committed to the transcript. */
  display?: string
}

interface PreloadState {
  initialDraft: string
  previousDraft: string
  previousCursor: number
  previousPastes: Map<number, string>
  previousContexts: ChatContext[]
  queued: boolean
}

interface RecalledQueueState {
  index: number
  initialDraft: string
  /** Undefined when the original queue row was already committed. */
  commitDisplay?: string
}

type ChatActivityStatusUpdate = Exclude<ChatActivityUpdate, { kind: 'narration' }>

type ActivityTreeChild = { kind: 'node'; id: string } | { kind: 'narration'; content: string }

interface ActivityTreeNode extends ChatActivityStatusUpdate {
  children: ActivityTreeChild[]
}

import {
  applySuggestion,
  type ChatContext,
  type ChatSuggestionCandidates,
  type CompletionToken,
  contextSpans,
  extractCompletionToken,
  formatMention,
  presentContexts,
  rankSuggestions,
  resolveSlashContexts,
  SLASH_COMMANDS,
  type SuggestionItem,
  suggestionWindow,
} from './chat-suggestions.js'

const ESC = '\u001b'
const RESET = `${ESC}[0m`
const DIM = `${ESC}[2m`
const HIDE_CURSOR = `${ESC}[?25l`
const SHOW_CURSOR = `${ESC}[?25h`
const ENTER_ALTERNATE_SCREEN = `${ESC}[?1049h`
const EXIT_ALTERNATE_SCREEN = `${ESC}[?1049l`
const ENABLE_BRACKETED_PASTE = `${ESC}[?2004h`
const DISABLE_BRACKETED_PASTE = `${ESC}[?2004l`
const BEGIN_SYNCHRONIZED_OUTPUT = `${ESC}[?2026h`
const END_SYNCHRONIZED_OUTPUT = `${ESC}[?2026l`
const CLEAR_SCREEN = `${ESC}[2J`
const RESET_SCROLL_REGION = `${ESC}[r`
const BOLD = `${ESC}[1m`
const BRIGHT_WHITE = `${ESC}[97m`
/** Sim green — marks a mention that currently resolves to a candidate. */
const MENTION_TEXT = `${ESC}[38;2;51;196;130m`
const USER_MESSAGE_BACKGROUND = `${ESC}[48;2;58;60;70m`
const USER_MESSAGE_TEXT = `${ESC}[38;2;242;242;242m`
const USER_MESSAGE_POINTER = `${ESC}[38;2;160;160;160m`
const USER_PANEL_OUTER_MARGIN = ' '
const USER_TURN_PREFIX = `${USER_PANEL_OUTER_MARGIN}❯ `
const ASSISTANT_TURN_PREFIX = '● '
const DEFAULT_CHAT_TITLE = 'New chat'
const CONTINUATION_PREFIX = '  '
const MAX_TRANSCRIPT_CHARACTERS = 256 * 1024
const MAX_HISTORY_ENTRIES = 500
const MAX_DRAFT_CHARACTERS = 10 * 1024 * 1024
/** Above this, or across multiple lines, a paste collapses to a placeholder. */
const PASTE_PLACEHOLDER_CHARACTERS = 800
const PASTE_PLACEHOLDER_LINES = 3
const PASTED_TEXT_REF = /\[Pasted text #(\d+)(?: \+\d+ lines)?\]/g
const BLIMP_ART = [
  '   ⣀⣀⣀',
  '   ⡇  ⢳⡀⣀⣀⣀⠤⢤⣤⣤⣤⠤⠤⠤⣀⣀⣀',
  '   ⢻⣀⡴⠂⠉⢹⠤⠤⣜⠁  ⢘⡦⠤⠤⡞⠉⠉⠙⠻⡖⠢⢄⡀',
  '⠤⠶⠶⠮⣤⣽⠤⠴⡋  ⢘⡦⠤⢤⡏   ⠹⣄⣀⣀⡴⠋⠉⢹⢺⡄',
  '    ⠈⠓⠤⢄⣹⡤⠤⢜   ⠳⣄⣀⣀⡞   ⢙⣦⣖⠾⠋',
  '         ⠈⠉⠉⣝⣀⣀⣚⣀⡔⠒⠛⠓⠊⠉⠉',
] as const

/** Frames and cadence for the airship sliding in from the left on first paint. */
const WELCOME_FLY_IN_FRAMES = 20
const WELCOME_FLY_IN_INTERVAL_MS = 22
/** Columns the detail box needs beside the art before it is worth drawing. */
const WELCOME_MIN_BOX_COLUMNS = 26
/** Blank columns between the detail box and the airship. */
const WELCOME_GUTTER = 2

function formatActivityDuration(elapsedMs: number): string {
  let seconds = Math.max(1, Math.round(Math.max(0, elapsedMs) / 1000))
  const hours = Math.floor(seconds / 3600)
  seconds %= 3600
  const minutes = Math.floor(seconds / 60)
  seconds %= 60
  return [hours ? `${hours}h` : '', minutes ? `${minutes}m` : '', seconds ? `${seconds}s` : '']
    .filter(Boolean)
    .join(' ')
}

/** Shared row treatment for the editable composer and its committed user turn. */
function userPanelRow(content = ''): string {
  return `${USER_PANEL_OUTER_MARGIN}${USER_MESSAGE_BACKGROUND}${content}${RESET}`
}

/** A fullscreen terminal chat with a durable transcript and a bottom-pinned composer. */
export class ReadlineChatTerminal implements ChatTerminal {
  private pending: ((input: ChatTerminalInput) => void) | null = null
  private readonly queued: QueuedTerminalInput[] = []
  private recalledQueue: RecalledQueueState | null = null
  private readonly interruptListeners = new Set<ChatTerminalInterruptListener>()
  private readonly history: string[] = []
  private historyIndex = 0
  private historyDraft = ''
  private preferredColumn: number | null = null
  private prompt = '❯ '
  private draft = ''
  private cursor = 0
  private preloadState: PreloadState | null = null
  private composerVisible = false
  private busy = false
  private questionState: QuestionState | null = null
  private selectState: SelectState | null = null
  private welcomeVisible = false
  private welcomeProfile: string | null = null
  private welcomeChatTitle = DEFAULT_CHAT_TITLE
  private welcomeWorkspaceName: string | null = null
  private suggestionIndex = 0
  private suggestionQueryKey: string | null = null
  private suggestionDismissed: string | null = null
  private resourceCandidates: SuggestionItem[] = []
  private slashCandidates: SuggestionItem[] = []
  private selectedContexts: ChatContext[] = []
  private nextAttachmentNumber = 1
  private pasting = false
  private pasteBuffer = ''
  private pastedText = new Map<number, string>()
  private nextPasteId = 1
  private transcriptEpoch = 0
  private wrapCache: {
    width: number
    epoch: number
    consumed: number
    rows: string[]
    state: WrapState
  } | null = null
  private welcomeRevealFrame = WELCOME_FLY_IN_FRAMES
  private welcomeTimer: ReturnType<typeof setInterval> | null = null
  private transcript = ''
  private assistantPrefixPending = false
  private assistantPrefixBuffer = ''
  private assistantTurnActive = false
  private assistantContinuationPending = false
  private transcriptScrollTopRow: number | null = null
  private viewportActive = false
  private renderedScreen: string[] | null = null
  private renderedColumns = 0
  private renderedRows = 0
  private restoredRawMode = false
  private readonly inputWasRaw: boolean
  private readonly inputWasFlowing: boolean
  private ended = false
  private closed = false
  private activityActive = false
  private activityThinking = ''
  private activityStartedAt = 0
  private activityGeneration = 0
  private readonly activityNodes = new Map<string, ActivityTreeNode>()
  private readonly activityRoots: string[] = []
  private readonly committedActivityRoots = new Set<string>()
  private activityFrame = 0
  private activityTimer: ReturnType<typeof setInterval> | null = null

  constructor(
    private readonly input: Readable = process.stdin,
    private readonly output: Writable = process.stdout
  ) {
    this.inputWasFlowing = input.readableFlowing === true
    this.inputWasRaw = Boolean((input as TerminalInput).isRaw)
    emitKeypressEvents(input)
    input.on('keypress', this.handleKeypress)
    input.once('end', this.handleInputEnd)
    output.on('resize', this.handleResize)
  }

  welcome(context: ChatTerminalWelcome): void {
    if (!this.isInteractiveTTY() || this.closed) return
    this.welcomeVisible = true
    this.welcomeProfile = context.profile ? safeOneLine(context.profile).slice(0, 80) : null
    this.welcomeChatTitle = safeOneLine(context.chatTitle).slice(0, 160) || DEFAULT_CHAT_TITLE
    this.welcomeWorkspaceName = context.workspaceName
      ? safeOneLine(context.workspaceName).slice(0, 80)
      : null
    this.startWelcomeFlyIn()
    this.ensureViewport()
    this.renderScreen()
  }

  userMessage(message: string): void {
    if (!message.trim()) return
    this.commitUserLine(message)
    this.renderScreen()
  }

  clearTranscript(): void {
    this.stopActivity()
    this.transcript = ''
    this.transcriptEpoch += 1
    this.wrapCache = null
    this.assistantPrefixPending = false
    this.assistantPrefixBuffer = ''
    this.assistantTurnActive = false
    this.assistantContinuationPending = false
    this.transcriptScrollTopRow = null
    this.history.length = 0
    this.historyIndex = 0
    this.historyDraft = ''
    this.renderScreen()
  }

  read(prompt: string): Promise<ChatTerminalInput> {
    if (this.closed) return Promise.resolve({ kind: 'eof' })
    const queued = this.preloadState ? undefined : this.queued.shift()
    if (queued) {
      if (this.recalledQueue && this.recalledQueue.index > 0) {
        this.recalledQueue.index--
      }
      const { input } = queued
      if (input.kind === 'line') {
        for (const [id, body] of input.pastes ?? []) this.pastedText.set(id, body)
        if (queued.display?.trim()) this.commitUserLine(queued.display)
      }
      this.renderScreen()
      return Promise.resolve(input)
    }
    if (this.ended) return Promise.resolve({ kind: 'eof' })
    if (this.pending || this.questionState || this.selectState) {
      throw new Error('Chat terminal already has a pending read')
    }

    this.prompt = sanitize(prompt)
      .replace(/[\n\r\t]+/gu, ' ')
      .slice(0, 80)
    this.draft = sanitize(this.draft).slice(0, MAX_DRAFT_CHARACTERS)
    this.cursor = Math.min(this.cursor, this.draft.length)
    this.preferredColumn = null
    this.historyIndex = this.history.length
    this.historyDraft = this.draft
    this.composerVisible = true
    this.busy = false
    this.ensureViewport()

    if (!this.isInteractiveTTY()) this.output.write(this.prompt)
    this.renderScreen()
    return new Promise((resolve) => {
      this.pending = resolve
      this.renderScreen()
    })
  }

  hasQueuedInput(): boolean {
    return this.preloadState !== null || this.queued.length > 0
  }

  preload(
    value: string,
    options: {
      queued?: boolean
      pastes?: ReadonlyMap<number, string>
      contexts?: ChatContext[]
    } = {}
  ): boolean {
    if (
      this.closed ||
      this.ended ||
      this.pending ||
      this.busy ||
      this.questionState ||
      this.selectState ||
      this.preloadState
    ) {
      return false
    }
    const next = sanitize(value).slice(0, MAX_DRAFT_CHARACTERS)
    if (!next) return false

    this.preloadState = {
      initialDraft: next,
      previousDraft: this.draft,
      previousCursor: this.cursor,
      previousPastes: this.pastesFor(this.draft),
      previousContexts: this.selectedContexts,
      queued: options.queued === true,
    }
    for (const [id, body] of options.pastes ?? []) this.pastedText.set(id, body)
    this.draft = next
    this.cursor = next.length
    this.selectedContexts = [...(options.contexts ?? [])]
    this.preferredColumn = null
    this.composerVisible = true
    this.renderScreen()
    return true
  }

  status(message: string): void {
    const safe = sanitize(message)
    if (!this.isInteractiveTTY()) {
      this.output.write(safe)
      if (!safe.endsWith('\n')) this.output.write('\n')
      return
    }

    this.ensureViewport()
    this.assistantTurnActive = false
    this.assistantContinuationPending = false
    this.appendTranscript(safe)
    if (!safe.endsWith('\n')) this.appendTranscript('\n')
    this.renderScreen()
  }

  write(content: string): void {
    if (!content) return
    if (!this.isInteractiveTTY()) {
      this.output.write(content)
      return
    }

    this.ensureViewport()
    let rendered = content.replace(/\r/gu, '')
    if (this.assistantPrefixPending) {
      this.assistantPrefixBuffer += rendered
      const prefixed = prefixAssistantTurn(this.assistantPrefixBuffer)
      if (prefixed === null) return
      rendered = prefixed
      this.assistantPrefixPending = false
      this.assistantPrefixBuffer = ''
      this.assistantTurnActive = true
      this.assistantContinuationPending = rendered.endsWith('\n')
    } else if (this.assistantTurnActive) {
      rendered = indentAssistantFragment(rendered, this.assistantContinuationPending)
      this.assistantContinuationPending = rendered.endsWith('\n')
    }
    this.appendTranscript(rendered)
    this.renderScreen()
  }

  activity(message: string): ChatActivity {
    this.stopActivity()
    this.assistantPrefixPending = true
    this.assistantPrefixBuffer = ''
    this.assistantTurnActive = false
    this.assistantContinuationPending = false
    this.activityActive = true
    this.activityThinking = safeOneLine(message) || 'Thinking…'
    this.activityStartedAt = Date.now()
    const generation = ++this.activityGeneration
    this.activityNodes.clear()
    this.activityRoots.length = 0
    this.committedActivityRoots.clear()
    this.activityFrame = 0
    this.busy = true
    this.composerVisible = true
    this.ensureViewport()
    this.renderScreen()

    if (this.isInteractiveTTY()) {
      this.activityTimer = setInterval(() => {
        this.activityFrame += 1
        this.renderScreen()
      }, 90)
      this.activityTimer.unref()
    }

    let stopped = false
    const isCurrent = () =>
      !stopped && this.activityActive && generation === this.activityGeneration
    const finish = (completed: boolean) => {
      if (!isCurrent()) return
      stopped = true
      this.stopActivity(completed)
    }
    return {
      update: (next) => {
        if (!isCurrent()) return
        this.activityThinking = safeOneLine(next) || this.activityThinking
        this.renderScreen()
      },
      thinking: (_delta) => {
        if (!isCurrent()) return
        // Match the web client: raw reasoning is not rendered; the stable
        // turn-level label remains visible in the tail instead.
      },
      event: (update) => {
        if (!isCurrent()) return
        this.recordActivityEvent(update)
        this.renderScreen()
      },
      clear: () => {
        if (!isCurrent()) return
        this.commitActivityEvents(false)
        this.renderScreen()
      },
      complete: () => finish(true),
      stop: () => finish(false),
    }
  }

  askQuestion(question: ChatTerminalQuestion): Promise<ChatTerminalQuestionResult> {
    if (this.pending || this.questionState || this.selectState) {
      throw new Error('Chat terminal already has a pending read')
    }
    if (this.ended || this.closed) return Promise.resolve({ kind: 'eof' })

    const safeQuestion: ChatTerminalQuestion = {
      prompt: safeOneLine(question.prompt).slice(0, 500),
      multi: question.multi,
      options: question.options.slice(0, 20).map((option) => ({
        id: safeOneLine(option.id).slice(0, 160),
        label: safeOneLine(option.label).slice(0, 160),
      })),
    }
    const previousDraft = this.draft
    const previousCursor = this.cursor
    const previousContexts = this.selectedContexts
    this.draft = ''
    this.cursor = 0
    this.selectedContexts = []
    this.preferredColumn = null
    this.composerVisible = true
    this.busy = false
    this.ensureViewport()

    return new Promise((resolve) => {
      this.questionState = {
        question: safeQuestion,
        active: 0,
        selected: new Set(),
        previousDraft,
        previousCursor,
        previousContexts,
        resolve,
      }
      this.renderScreen()
    })
  }

  select(menu: ChatTerminalSelect): Promise<ChatTerminalSelectResult> {
    if (this.pending || this.questionState || this.selectState) {
      throw new Error('Chat terminal already has a pending read')
    }
    if (this.ended || this.closed) return Promise.resolve({ kind: 'eof' })

    const safeMenu: ChatTerminalSelect = {
      prompt: safeOneLine(menu.prompt).slice(0, 500),
      options: menu.options.map((option) => ({
        id: safeOneLine(option.id).slice(0, 160),
        label: safeOneLine(option.label).slice(0, 255),
        ...(option.description
          ? { description: safeOneLine(option.description).slice(0, 255) }
          : {}),
      })),
    }
    const previousDraft = this.draft
    const previousCursor = this.cursor
    const previousContexts = this.selectedContexts
    this.draft = ''
    this.cursor = 0
    this.selectedContexts = []
    this.preferredColumn = null
    this.composerVisible = true
    this.busy = false
    this.ensureViewport()

    return new Promise((resolve) => {
      this.selectState = {
        menu: safeMenu,
        active: 0,
        previousDraft,
        previousCursor,
        previousContexts,
        resolve,
      }
      this.renderScreen()
    })
  }

  onInterrupt(listener: ChatTerminalInterruptListener): () => void {
    this.interruptListeners.add(listener)
    return () => this.interruptListeners.delete(listener)
  }

  close(): void {
    if (this.closed) return
    this.stopActivity()
    this.stopWelcomeFlyIn()
    this.closed = true

    const pending = this.pending
    this.pending = null
    pending?.({ kind: 'eof' })
    const question = this.questionState
    this.questionState = null
    question?.resolve({ kind: 'eof' })
    const select = this.selectState
    this.selectState = null
    select?.resolve({ kind: 'eof' })

    this.input.removeListener('keypress', this.handleKeypress)
    this.input.removeListener('end', this.handleInputEnd)
    this.output.removeListener('resize', this.handleResize)

    if (this.viewportActive) {
      this.output.write(
        `${BEGIN_SYNCHRONIZED_OUTPUT}${RESET}${RESET_SCROLL_REGION}${DISABLE_BRACKETED_PASTE}${SHOW_CURSOR}${EXIT_ALTERNATE_SCREEN}${END_SYNCHRONIZED_OUTPUT}`
      )
      this.viewportActive = false
    }
    this.restoreInputMode()
  }

  private readonly handleResize = (): void => {
    this.renderScreen()
  }

  private readonly handleInputEnd = (): void => {
    this.ended = true
    const pending = this.pending
    this.pending = null
    pending?.({ kind: 'eof' })
    const question = this.questionState
    this.questionState = null
    question?.resolve({ kind: 'eof' })
    const select = this.selectState
    this.selectState = null
    select?.resolve({ kind: 'eof' })
    this.renderScreen()
  }

  private readonly handleKeypress = (character: string, key: Key | undefined): void => {
    if (this.closed) return
    if (key?.name === 'paste-start') {
      this.pasting = true
      this.pasteBuffer = ''
      return
    }
    if (key?.name === 'paste-end') {
      const pasted = this.pasteBuffer
      this.pasting = false
      this.pasteBuffer = ''
      this.commitPaste(pasted)
      return
    }
    if (this.pasting) {
      if (character) this.pasteBuffer += character
      return
    }

    if (this.selectState) {
      this.handleSelectKey(character, key)
      return
    }

    if (this.handleTranscriptNavigationKey(key)) return

    if (key?.ctrl && key.name === 'v') {
      this.resolveClipboard()
      return
    }
    if (this.questionState) {
      this.handleQuestionKey(character, key)
      return
    }

    this.handleEditorKey(character, key)
  }

  private handleEditorKey(character: string, key: Key | undefined): void {
    if (!this.isComposerEditable() && this.isInteractiveTTY()) return
    if (key?.ctrl && key.name === 'c') {
      if (!this.pending && this.busy) {
        for (const listener of this.interruptListeners) listener('manual')
        return
      }
      const wasEmpty = this.draft.length === 0
      this.draft = ''
      this.cursor = 0
      this.preferredColumn = null
      this.resolveInput({ kind: 'interrupt', empty: wasEmpty })
      return
    }
    if (key?.ctrl && key.name === 'd' && this.draft.length === 0) {
      this.resolveInput({ kind: 'eof' })
      return
    }
    const open = this.openSuggestions()
    if (open) {
      if (key?.name === 'up' || (key?.ctrl && key.name === 'p')) {
        this.moveSuggestion(open.items.length, -1)
        return
      }
      if (key?.name === 'down' || (key?.ctrl && key.name === 'n')) {
        this.moveSuggestion(open.items.length, 1)
        return
      }
      if (key?.name === 'escape') {
        this.suggestionDismissed = this.draft
        this.renderScreen()
        return
      }
      if (key?.name === 'tab' || isEnter(key)) {
        const chosen = open.items[Math.min(this.suggestionIndex, open.items.length - 1)]
        const submitExactSlash =
          isEnter(key) &&
          chosen?.tag === 'command' &&
          open.token.trigger === '/' &&
          chosen.value === open.token.token
        if (!submitExactSlash) {
          this.acceptSuggestion(open)
          return
        }
      }
    }
    if (key?.name === 'escape') {
      if (!this.pending && this.busy) {
        for (const listener of this.interruptListeners) listener('manual')
        return
      }
      const wasEmpty = this.draft.length === 0
      this.draft = ''
      this.cursor = 0
      this.resolveInput({ kind: 'interrupt', empty: wasEmpty })
      return
    }

    if (isEnter(key)) {
      const beforeCursor = this.draft.slice(0, this.cursor)
      if (key?.shift || key?.meta || beforeCursor.endsWith('\\')) {
        if (beforeCursor.endsWith('\\')) {
          this.draft = `${beforeCursor.slice(0, -1)}\n${this.draft.slice(this.cursor)}`
          this.cursor = beforeCursor.length
        } else {
          this.insertText('\n')
        }
        this.renderScreen()
        return
      }
      this.submitDraft()
      return
    }
    if (key?.name === 'backspace') {
      this.deleteBackward()
      return
    }
    if (key?.name === 'delete') {
      this.deleteForward()
      return
    }
    if (key?.name === 'left' || (key?.ctrl && key.name === 'b')) {
      this.cursor = previousGraphemeIndex(this.draft, this.cursor)
      this.preferredColumn = null
      this.renderScreen()
      return
    }
    if (key?.name === 'right' || (key?.ctrl && key.name === 'f')) {
      this.cursor = nextGraphemeIndex(this.draft, this.cursor)
      this.preferredColumn = null
      this.renderScreen()
      return
    }
    if (key?.name === 'up' || (key?.ctrl && key.name === 'p')) {
      if (this.draft.length === 0 && this.recallQueuedDraft()) return
      this.moveVertically(-1)
      return
    }
    if (key?.name === 'down' || (key?.ctrl && key.name === 'n')) {
      this.moveVertically(1)
      return
    }
    if (key?.name === 'home' || (key?.ctrl && key.name === 'a')) {
      this.cursor = lineStart(this.draft, this.cursor)
      this.preferredColumn = null
      this.renderScreen()
      return
    }
    if (key?.name === 'end' || (key?.ctrl && key.name === 'e')) {
      this.cursor = lineEnd(this.draft, this.cursor)
      this.preferredColumn = null
      this.renderScreen()
      return
    }
    if (key?.ctrl && key.name === 'u') {
      this.draft = this.draft.slice(this.cursor)
      this.cursor = 0
      this.preferredColumn = null
      this.renderScreen()
      return
    }
    if (key?.ctrl && key.name === 'k') {
      this.draft = this.draft.slice(0, this.cursor)
      this.preferredColumn = null
      this.renderScreen()
      return
    }
    if (key?.ctrl && key.name === 'w') {
      const before = this.draft.slice(0, this.cursor)
      const start = before.search(/\S+\s*$/u)
      if (start >= 0) {
        this.draft = `${before.slice(0, start)}${this.draft.slice(this.cursor)}`
        this.cursor = start
      }
      this.preferredColumn = null
      this.renderScreen()
      return
    }

    const printable = printableText(character, key)
    if (printable) {
      this.insertText(printable)
      this.renderScreen()
    }
  }

  private handleQuestionKey(character: string, key: Key | undefined): void {
    const state = this.questionState
    if (!state) return
    const otherIndex = state.question.options.length
    const submitIndex = state.question.multi ? otherIndex + 1 : otherIndex
    const choiceCount = submitIndex + 1

    if (key?.name === 'escape' || (key?.ctrl && key.name === 'c')) {
      this.finishQuestion({ kind: 'cancel' })
      return
    }
    if (key?.name === 'up' || (key?.ctrl && key.name === 'p')) {
      state.active = (state.active - 1 + choiceCount) % choiceCount
      this.renderScreen()
      return
    }
    if (key?.name === 'down' || key?.name === 'tab' || (key?.ctrl && key.name === 'n')) {
      state.active = (state.active + 1) % choiceCount
      this.renderScreen()
      return
    }
    if (state.question.multi && key?.name === 'space' && state.active < otherIndex) {
      this.toggleQuestionSelection(state.active)
      return
    }
    if (/^[1-9]$/u.test(character) && this.draft.length === 0) {
      const index = Number(character) - 1
      if (index < state.question.options.length) {
        state.active = index
        this.renderScreen()
        return
      }
    }
    if (isEnter(key)) {
      if (state.active < otherIndex) {
        if (state.question.multi) this.toggleQuestionSelection(state.active)
        else {
          const selected = state.question.options[state.active]
          if (selected) this.finishQuestion({ kind: 'answer', values: [selected.label] })
        }
        return
      }

      const custom = safeOneLine(this.draft)
      if (state.active === otherIndex && custom) {
        const values = state.question.multi ? [...this.selectedQuestionLabels(), custom] : [custom]
        this.finishQuestion({ kind: 'answer', values: [...new Set(values)] })
        return
      }
      if (state.question.multi && state.active === submitIndex) {
        const values = this.selectedQuestionLabels()
        if (custom) values.push(custom)
        if (values.length > 0) {
          this.finishQuestion({ kind: 'answer', values: [...new Set(values)] })
        }
      }
      return
    }

    if (state.active === otherIndex) {
      if (key?.name === 'backspace') {
        this.deleteBackward()
        return
      }
      if (key?.name === 'delete') {
        this.deleteForward()
        return
      }
      if (key?.name === 'left') {
        this.cursor = previousGraphemeIndex(this.draft, this.cursor)
        this.renderScreen()
        return
      }
      if (key?.name === 'right') {
        this.cursor = nextGraphemeIndex(this.draft, this.cursor)
        this.renderScreen()
        return
      }
    }

    const printable = printableText(character, key)
    if (printable) {
      state.active = otherIndex
      this.insertText(printable)
      this.renderScreen()
    }
  }

  private handleSelectKey(character: string, key: Key | undefined): void {
    const state = this.selectState
    if (!state) return
    const options = this.filteredSelectOptions()

    if (key?.name === 'escape' || (key?.ctrl && key.name === 'c')) {
      this.finishSelect({ kind: 'cancel' })
      return
    }
    if (key?.name === 'up' || (key?.ctrl && key.name === 'p')) {
      if (options.length > 0) state.active = (state.active - 1 + options.length) % options.length
      this.renderScreen()
      return
    }
    if (key?.name === 'down' || key?.name === 'tab' || (key?.ctrl && key.name === 'n')) {
      if (options.length > 0) state.active = (state.active + 1) % options.length
      this.renderScreen()
      return
    }
    if (isEnter(key)) {
      if (this.selectOptionCapacity() <= 0) return
      const selected = options[Math.min(state.active, options.length - 1)]
      if (selected) this.finishSelect({ kind: 'selected', id: selected.id })
      return
    }
    if (key?.name === 'backspace') {
      state.active = 0
      this.deleteBackward()
      return
    }
    if (key?.name === 'delete') {
      state.active = 0
      this.deleteForward()
      return
    }
    if (key?.name === 'left' || (key?.ctrl && key.name === 'b')) {
      this.cursor = previousGraphemeIndex(this.draft, this.cursor)
      this.renderScreen()
      return
    }
    if (key?.name === 'right' || (key?.ctrl && key.name === 'f')) {
      this.cursor = nextGraphemeIndex(this.draft, this.cursor)
      this.renderScreen()
      return
    }
    if (key?.name === 'home' || (key?.ctrl && key.name === 'a')) {
      this.cursor = 0
      this.renderScreen()
      return
    }
    if (key?.name === 'end' || (key?.ctrl && key.name === 'e')) {
      this.cursor = this.draft.length
      this.renderScreen()
      return
    }
    if (key?.ctrl && key.name === 'u') {
      this.draft = this.draft.slice(this.cursor)
      this.cursor = 0
      state.active = 0
      this.renderScreen()
      return
    }
    if (key?.ctrl && key.name === 'k') {
      this.draft = this.draft.slice(0, this.cursor)
      state.active = 0
      this.renderScreen()
      return
    }
    if (key?.ctrl && key.name === 'w') {
      const before = this.draft.slice(0, this.cursor)
      const start = before.search(/\S+\s*$/u)
      if (start >= 0) {
        this.draft = `${before.slice(0, start)}${this.draft.slice(this.cursor)}`
        this.cursor = start
      }
      state.active = 0
      this.renderScreen()
      return
    }

    const printable = printableText(character, key)
    if (printable) {
      this.insertText(printable)
      state.active = 0
      this.renderScreen()
    }
  }

  /**
   * Recomputed each render rather than tracked on every draft mutation, so the
   * menu can never disagree with the text it is completing.
   */
  private openSuggestions(): {
    token: CompletionToken
    items: SuggestionItem[]
    pool: SuggestionItem[]
  } | null {
    if (
      !this.isComposerEditable() ||
      this.questionState ||
      this.selectState ||
      this.terminalRows() < 5
    ) {
      this.suggestionIndex = 0
      this.suggestionQueryKey = null
      return null
    }
    if (this.suggestionDismissed !== null) {
      if (this.suggestionDismissed === this.draft) return null
      this.suggestionDismissed = null
    }
    const token = extractCompletionToken(this.draft, this.cursor)
    if (!token) {
      this.suggestionIndex = 0
      this.suggestionQueryKey = null
      return null
    }
    const queryKey = `${token.startPos}:${token.trigger}:${token.query}`
    if (queryKey !== this.suggestionQueryKey) {
      this.suggestionIndex = 0
      this.suggestionQueryKey = queryKey
    }
    const commandPosition = this.draft.slice(0, token.startPos).trim().length === 0
    const pool =
      token.trigger === '/'
        ? [...(commandPosition ? SLASH_COMMANDS : []), ...this.slashCandidates]
        : this.resourceCandidates
    if (!pool.length) return null
    const items = rankSuggestions(token.query, pool)
    return items.length ? { token, items, pool } : null
  }

  setSuggestionCandidates(candidates: ChatSuggestionCandidates): void {
    const open = this.openSuggestions()
    const selectedId = open?.items[Math.min(this.suggestionIndex, open.items.length - 1)]?.id
    this.resourceCandidates = candidates.resources
      .map(sanitizeSuggestionItem)
      .filter((item): item is SuggestionItem => item !== null)
    this.slashCandidates = candidates.slash
      .map(sanitizeSuggestionItem)
      .filter((item): item is SuggestionItem => item !== null)
    if (selectedId) {
      const refreshed = this.openSuggestions()
      const refreshedIndex = refreshed?.items.findIndex((item) => item.id === selectedId) ?? -1
      this.suggestionIndex = refreshedIndex >= 0 ? refreshedIndex : 0
    }
    if (!this.closed && this.isComposerEditable()) this.renderScreen()
  }

  private moveSuggestion(total: number, delta: number): void {
    this.suggestionIndex = (this.suggestionIndex + delta + total) % total
    this.renderScreen()
  }

  private acceptSuggestion(open: { token: CompletionToken; items: SuggestionItem[] }): void {
    const chosen = open.items[Math.min(this.suggestionIndex, open.items.length - 1)]
    if (!chosen) return
    const replacement =
      open.token.trigger === '@'
        ? formatMention(chosen.value)
        : chosen.tag === 'command'
          ? chosen.value
          : `/${chosen.value}`
    const next = applySuggestion(this.draft, open.token, replacement)
    this.draft = next.draft
    this.cursor = next.cursor
    if (
      chosen.context &&
      !this.selectedContexts.some((context) => context.label === chosen.context?.label)
    ) {
      this.selectedContexts.push(chosen.context)
    }
    this.suggestionIndex = 0
    this.suggestionDismissed = this.draft
    this.renderScreen()
  }

  /**
   * Re-derived every render rather than stored, so a mention the user
   * half-deletes simply stops lighting up instead of leaving stale state.
   */
  private liveMentionSpans(): Array<{ start: number; end: number }> {
    const selected = presentContexts(this.draft, this.selectedContexts)
    const occupied = new Set(selected.map((context) => context.label.toLowerCase()))
    const typedSlash = resolveSlashContexts(this.draft, this.slashCandidates).filter(
      (context) => !occupied.has(context.label.toLowerCase())
    )
    return [
      ...contextSpans(this.draft, [...selected, ...typedSlash]),
      ...attachmentSpans(this.draft),
    ].sort((left, right) => left.start - right.start)
  }

  private suggestionRows(width: number, rows: number): string[] {
    const open = this.openSuggestions()
    if (!open) return []
    const maxVisible = Math.max(1, Math.min(5, rows - 6))
    const selected = Math.min(this.suggestionIndex, open.items.length - 1)
    const { start, end } = suggestionWindow(open.items.length, selected, maxVisible)
    /* Width comes from the whole pool, not the filtered slice, so the column
       does not jump while the user narrows the list. */
    const labelWidth = Math.min(
      Math.floor(width * 0.4),
      Math.max(...open.pool.map((entry) => displayWidth(entry.displayText))) + 2
    )
    return open.items.slice(start, end).map((entry) => {
      const active = entry.id === open.items[selected]?.id
      const label = truncateDisplay(entry.displayText, Math.max(1, labelWidth - 2))
      const padding = ' '.repeat(Math.max(2, labelWidth - displayWidth(label)))
      const line = truncateDisplay(`  ${label}${padding}${entry.description ?? ''}`, width)
      return active ? `${BRIGHT_WHITE}${line}${RESET}` : `${DIM}${line}${RESET}`
    })
  }

  /**
   * Turns one bracketed paste into a single edit.
   *
   * An empty paste is macOS Cmd+V of an image — the terminal sends the markers
   * with nothing between them — so it routes to the same clipboard path as
   * ctrl+v rather than being discarded.
   */
  private commitPaste(text: string): void {
    if (!this.isComposerEditable()) return
    const normalized = text.replace(/\r\n?/gu, '\n')
    if (!normalized) {
      if (this.selectState) return
      this.resolveClipboard()
      return
    }
    if (this.selectState) {
      this.insertText(normalized.replace(/\s+/gu, ' '))
      this.selectState.active = 0
      this.renderScreen()
      return
    }
    const lines = normalized.split('\n').length - 1
    if (normalized.length > PASTE_PLACEHOLDER_CHARACTERS || lines >= PASTE_PLACEHOLDER_LINES) {
      const id = this.nextPasteId++
      this.pastedText.set(id, normalized)
      this.insertText(lines ? `[Pasted text #${id} +${lines} lines]` : `[Pasted text #${id}]`)
    } else {
      this.insertText(normalized)
    }
    this.renderScreen()
  }

  /** Splices stashed paste bodies back in, and drops any the user deleted. */
  private pastesFor(value: string): Map<number, string> {
    const pastes = new Map<number, string>()
    for (const match of value.matchAll(PASTED_TEXT_REF)) {
      const id = Number(match[1])
      const body = this.pastedText.get(id)
      if (body !== undefined) pastes.set(id, body)
    }
    return pastes
  }

  private expandPastes(value: string): string {
    const referenced = new Set<number>()
    const expanded = value.replace(PASTED_TEXT_REF, (match, id: string) => {
      const body = this.pastedText.get(Number(id))
      if (body === undefined) return match
      referenced.add(Number(id))
      return body
    })
    for (const id of this.pastedText.keys()) if (!referenced.has(id)) this.pastedText.delete(id)
    return expanded
  }

  private submitDraft(): void {
    /* The placeholder is what the user sees and recalls; only the wire value
       carries the expanded body, so a large paste never floods the transcript. */
    const display = this.draft
    const preload = this.preloadState
    const deferred = !this.pending
    if (deferred && !display.trim()) {
      this.draft = ''
      this.cursor = 0
      this.preferredColumn = null
      this.recalledQueue = null
      this.renderScreen()
      return
    }
    const pastes = this.pastesFor(display)
    const value = this.expandPastes(display)
    const selected = presentContexts(value, this.selectedContexts)
    const occupied = new Set(selected.map((context) => context.label.toLowerCase()))
    const contexts = [
      ...selected,
      ...resolveSlashContexts(value, this.slashCandidates).filter(
        (context) => !occupied.has(context.label.toLowerCase())
      ),
    ]
    this.transcriptScrollTopRow = null
    if (display.trim()) {
      if (this.history.at(-1) !== display) this.history.push(display)
      if (this.history.length > MAX_HISTORY_ENTRIES) this.history.shift()
      // A queued retry was already committed when it first left the queue.
      // Repaint it only if the user edited the staged retry.
      const unchangedCommittedRecall =
        this.recalledQueue?.commitDisplay === undefined &&
        display === this.recalledQueue?.initialDraft
      if (
        !deferred &&
        !(preload?.queued && display === preload.initialDraft) &&
        !unchangedCommittedRecall
      ) {
        this.commitUserLine(display)
      }
    }
    this.draft = ''
    this.cursor = 0
    this.selectedContexts = []
    this.preferredColumn = null
    this.historyIndex = this.history.length
    const input: ChatTerminalInput = {
      kind: 'line',
      value,
      ...(display !== value ? { display } : {}),
      ...(pastes.size ? { pastes } : {}),
      ...(contexts.length ? { contexts } : {}),
    }
    this.resolveInput(input, display)
    if (deferred && this.busy && display.trim()) {
      for (const listener of this.interruptListeners) listener('submit', input)
    }
  }

  private resolveClipboard(): void {
    if (!this.isComposerEditable()) return
    this.resolveInput({ kind: 'clipboard', value: this.draft })
  }

  private resolveInput(value: ChatTerminalInput, display?: string): void {
    const pending = this.pending
    this.pending = null
    let resolved = value
    const preload = value.kind === 'clipboard' ? null : this.preloadState
    if (preload && value.kind !== 'clipboard') {
      this.preloadState = null
      if (value.kind === 'line' && preload.queued) {
        resolved = {
          ...value,
          queued: true,
          ...(display === undefined ? {} : { display }),
        }
      }
      this.draft = preload.previousDraft
      this.cursor = preload.previousCursor
      this.selectedContexts = preload.previousContexts
      for (const [id, body] of preload.previousPastes) this.pastedText.set(id, body)
    }
    const recalled = !preload && resolved.kind === 'line' ? this.recalledQueue : null
    if (!preload && resolved.kind !== 'clipboard') this.recalledQueue = null

    if (pending) {
      pending(resolved)
    } else {
      if (resolved.kind === 'line') {
        resolved = {
          ...resolved,
          queued: true,
          ...(display === undefined ? {} : { display }),
        }
      }
      const entry = {
        input: resolved,
        ...(!(
          (preload?.queued && display === preload.initialDraft) ||
          (recalled?.commitDisplay === undefined && display === recalled?.initialDraft)
        )
          ? { display }
          : {}),
      }
      if (preload) {
        this.queued.unshift(entry)
        if (this.recalledQueue) this.recalledQueue.index++
      } else if (recalled) {
        this.queued.splice(Math.min(recalled.index, this.queued.length), 0, entry)
      } else {
        this.queued.push(entry)
      }
    }
    this.renderScreen()
  }

  private finishQuestion(result: ChatTerminalQuestionResult): void {
    const state = this.questionState
    if (!state) return
    this.questionState = null
    this.draft = state.previousDraft
    this.cursor = state.previousCursor
    this.selectedContexts = state.previousContexts
    if (result.kind === 'answer') this.commitUserLine(result.values.join(', '))
    this.renderScreen()
    state.resolve(result)
  }

  private finishSelect(result: ChatTerminalSelectResult): void {
    const state = this.selectState
    if (!state) return
    this.selectState = null
    this.draft = state.previousDraft
    this.cursor = state.previousCursor
    this.selectedContexts = state.previousContexts
    this.preferredColumn = null
    this.renderScreen()
    state.resolve(result)
  }

  private filteredSelectOptions(): ChatTerminalSelect['options'] {
    const state = this.selectState
    if (!state) return []
    const query = safeOneLine(this.draft).trim().toLocaleLowerCase()
    if (!query) return state.menu.options
    return state.menu.options.filter((option) =>
      `${option.label}\n${option.description ?? ''}`.toLocaleLowerCase().includes(query)
    )
  }

  private selectOptionCapacity(): number {
    return Math.max(0, Math.min(8, this.terminalRows() - 5))
  }

  private selectedQuestionLabels(): string[] {
    const state = this.questionState
    if (!state) return []
    return [...state.selected]
      .sort((left, right) => left - right)
      .map((index) => state.question.options[index]?.label)
      .filter((label): label is string => Boolean(label))
  }

  private toggleQuestionSelection(index: number): void {
    const state = this.questionState
    if (!state) return
    if (state.selected.has(index)) state.selected.delete(index)
    else state.selected.add(index)
    this.renderScreen()
  }

  private isComposerEditable(): boolean {
    return Boolean(this.composerVisible && !this.questionState && !this.closed && !this.ended)
  }

  /** Recalls the newest deferred line without disturbing earlier FIFO entries. */
  private recallQueuedDraft(): boolean {
    for (let index = this.queued.length - 1; index >= 0; index -= 1) {
      const queued = this.queued[index]
      if (queued.input.kind !== 'line' || queued.input.display === undefined) continue
      this.queued.splice(index, 1)
      this.recalledQueue = {
        index,
        initialDraft: queued.input.display,
        ...(queued.display === undefined ? {} : { commitDisplay: queued.display }),
      }
      for (const [id, body] of queued.input.pastes ?? []) this.pastedText.set(id, body)
      this.selectedContexts = [...(queued.input.contexts ?? [])]
      this.draft = queued.input.display
      this.cursor = this.draft.length
      this.preferredColumn = null
      this.historyIndex = this.history.length
      this.renderScreen()
      return true
    }
    return false
  }

  private insertText(value: string): void {
    const safe = sanitize(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '')
    if (!safe) return
    const room = MAX_DRAFT_CHARACTERS - this.draft.length
    if (room <= 0) return
    const inserted = safe.slice(0, room)
    this.draft = `${this.draft.slice(0, this.cursor)}${inserted}${this.draft.slice(this.cursor)}`
    this.cursor += inserted.length
    this.preferredColumn = null
    this.historyIndex = this.history.length
  }

  private deleteBackward(): void {
    if (this.cursor === 0) return
    const previous = previousGraphemeIndex(this.draft, this.cursor)
    this.draft = `${this.draft.slice(0, previous)}${this.draft.slice(this.cursor)}`
    this.cursor = previous
    this.preferredColumn = null
    this.renderScreen()
  }

  private deleteForward(): void {
    if (this.cursor >= this.draft.length) return
    const next = nextGraphemeIndex(this.draft, this.cursor)
    this.draft = `${this.draft.slice(0, this.cursor)}${this.draft.slice(next)}`
    this.preferredColumn = null
    this.renderScreen()
  }

  private moveVertically(direction: -1 | 1): void {
    const layout = this.composerDraftLayout()
    const targetRow = layout.cursor.row + direction
    if (targetRow < 0 || targetRow >= layout.rows.length) {
      this.navigateHistory(direction)
      return
    }

    const desiredColumn = this.preferredColumn ?? layout.cursor.column
    this.preferredColumn = desiredColumn
    const candidates = layout.points.filter((point) => point.row === targetRow)
    const best = candidates.reduce<CursorPoint | null>((current, candidate) => {
      if (!current) return candidate
      return Math.abs(candidate.column - desiredColumn) < Math.abs(current.column - desiredColumn)
        ? candidate
        : current
    }, null)
    if (best) this.cursor = best.index
    this.renderScreen()
  }

  private navigateHistory(direction: -1 | 1): void {
    if (this.history.length === 0) return
    if (direction < 0) {
      if (this.historyIndex === this.history.length) this.historyDraft = this.draft
      if (this.historyIndex === 0) return
      this.historyIndex -= 1
      this.draft = this.history[this.historyIndex] ?? ''
    } else {
      if (this.historyIndex >= this.history.length) return
      this.historyIndex += 1
      this.draft =
        this.historyIndex === this.history.length
          ? this.historyDraft
          : (this.history[this.historyIndex] ?? '')
    }
    this.cursor = this.draft.length
    this.preferredColumn = null
    this.renderScreen()
  }

  private handleTranscriptNavigationKey(key: Key | undefined): boolean {
    if (key?.name === 'pageup') {
      this.scrollTranscript(-1)
      return true
    }
    if (key?.name === 'pagedown') {
      this.scrollTranscript(1)
      return true
    }
    if (key?.ctrl && key.name === 'home') {
      this.jumpTranscript('oldest')
      return true
    }
    if (key?.ctrl && key.name === 'end') {
      this.jumpTranscript('latest')
      return true
    }
    return false
  }

  private scrollTranscript(direction: -1 | 1): void {
    const metrics = this.transcriptViewportMetrics()
    if (metrics.capacity <= 0 || metrics.maxTop <= 0) {
      this.transcriptScrollTopRow = null
      return
    }

    const page = Math.max(1, metrics.capacity - 1)
    const currentTop = this.transcriptScrollTopRow ?? metrics.maxTop
    const nextTop = Math.max(0, Math.min(metrics.maxTop, currentTop + direction * page))
    const nextScrollTop = nextTop >= metrics.maxTop ? null : nextTop
    if (nextScrollTop === this.transcriptScrollTopRow) return
    this.transcriptScrollTopRow = nextScrollTop
    this.renderScreen()
  }

  private jumpTranscript(destination: 'oldest' | 'latest'): void {
    if (destination === 'latest') {
      if (this.transcriptScrollTopRow === null) return
      this.transcriptScrollTopRow = null
      this.renderScreen()
      return
    }

    const metrics = this.transcriptViewportMetrics()
    if (metrics.capacity <= 0 || metrics.maxTop <= 0 || this.transcriptScrollTopRow === 0) return
    this.transcriptScrollTopRow = 0
    this.renderScreen()
  }

  private transcriptViewportMetrics(): { capacity: number; maxTop: number } {
    const rows = this.terminalRows()
    const panel = this.buildPanel(rows)
    const capacity = Math.max(0, rows - Math.min(rows, panel.lines.length))
    const totalRows = this.wrappedBody(this.panelWidth()).length
    return { capacity, maxTop: Math.max(0, totalRows - capacity) }
  }

  private ensureViewport(): void {
    if (!this.isInteractiveTTY() || this.viewportActive || this.closed) return
    const input = this.input as TerminalInput
    if (input.setRawMode && !input.isRaw) input.setRawMode(true)
    input.resume()
    this.viewportActive = true
    const rows = this.terminalRows()
    const columns = this.terminalColumns()
    this.output.write(
      `${BEGIN_SYNCHRONIZED_OUTPUT}${ENTER_ALTERNATE_SCREEN}${ENABLE_BRACKETED_PASTE}${HIDE_CURSOR}${CLEAR_SCREEN}${ESC}[H${END_SYNCHRONIZED_OUTPUT}`
    )
    this.renderedScreen = Array<string>(rows).fill('')
    this.renderedColumns = columns
    this.renderedRows = rows
  }

  private restoreInputMode(): void {
    if (this.restoredRawMode) return
    this.restoredRawMode = true
    const input = this.input as TerminalInput
    if (input.setRawMode && input.isRaw !== this.inputWasRaw) input.setRawMode(this.inputWasRaw)
    if (!this.inputWasFlowing) input.pause()
  }

  private isInteractiveTTY(): boolean {
    return Boolean((this.input as TerminalInput).isTTY && (this.output as TerminalOutput).isTTY)
  }

  private terminalColumns(): number {
    return Math.max(1, (this.output as TerminalOutput).columns ?? 80)
  }

  private terminalRows(): number {
    return Math.max(1, (this.output as TerminalOutput).rows ?? 24)
  }

  private panelWidth(): number {
    return Math.max(0, this.terminalColumns() - 1)
  }

  private userPanelDraftLayout(
    prompt: string,
    highlights: Array<{ start: number; end: number }> = []
  ): DraftLayout {
    return layoutDraft(
      `${USER_MESSAGE_POINTER}${prompt}${USER_MESSAGE_TEXT}`,
      this.draft,
      Math.max(1, this.panelWidth() - 3),
      this.cursor,
      highlights,
      {
        continuationPrefix: CONTINUATION_PREFIX,
        normalTextStyle: USER_MESSAGE_TEXT,
      }
    )
  }

  private composerDraftLayout(): DraftLayout {
    return this.userPanelDraftLayout(this.prompt, this.liveMentionSpans())
  }

  private renderScreen(): void {
    if (!this.viewportActive || this.closed) return
    const rows = this.terminalRows()
    const width = this.panelWidth()
    const panel = this.buildPanel(rows)
    const panelCapacity = Math.min(rows, panel.lines.length)
    const panelFocusRow = panel.focusRow ?? panel.cursor?.row
    const panelFirst =
      panelFocusRow !== undefined
        ? Math.max(
            0,
            Math.min(
              panel.centerFocus
                ? panelFocusRow - Math.floor((panelCapacity - 1) / 2)
                : panelFocusRow - panelCapacity + 1,
              Math.max(0, panel.lines.length - panelCapacity)
            )
          )
        : Math.max(0, panel.lines.length - panelCapacity)
    const panelLines = panel.lines
      .slice(panelFirst, panelFirst + panelCapacity)
      .map((line) => layoutAnsiRows(line, width)[0] ?? '')
    const panelTop = rows - panelLines.length + 1
    const transcriptCapacity = Math.max(0, panelTop - 1)
    const allTranscriptRows = this.wrappedBody(width)
    const maxTranscriptTop = Math.max(0, allTranscriptRows.length - transcriptCapacity)
    if (this.transcriptScrollTopRow !== null) {
      const clamped = Math.max(0, Math.min(this.transcriptScrollTopRow, maxTranscriptTop))
      this.transcriptScrollTopRow = clamped >= maxTranscriptTop ? null : clamped
    }
    const transcriptTop = this.transcriptScrollTopRow ?? maxTranscriptTop
    const transcriptRows = transcriptCapacity
      ? allTranscriptRows.slice(transcriptTop, transcriptTop + transcriptCapacity)
      : []
    const screen = Array<string>(rows).fill('')
    for (const [index, line] of transcriptRows.entries()) screen[index] = line
    for (const [index, line] of panelLines.entries()) screen[panelTop + index - 1] = line
    const columns = this.terminalColumns()
    const fullRepaint =
      !this.renderedScreen || this.renderedColumns !== columns || this.renderedRows !== rows

    let frame = `${BEGIN_SYNCHRONIZED_OUTPUT}${HIDE_CURSOR}${RESET}${RESET_SCROLL_REGION}`
    if (fullRepaint) frame += CLEAR_SCREEN
    for (const [index, line] of screen.entries()) {
      if ((!fullRepaint && line === this.renderedScreen?.[index]) || (fullRepaint && !line))
        continue
      frame += `${cursorTo(index + 1, 1)}${ESC}[2K${line}${RESET}`
    }

    if (panel.cursor && this.isComposerEditable()) {
      const clippedPanelCursorRow = Math.max(0, panel.cursor.row - panelFirst)
      frame += `${cursorTo(
        Math.min(rows, panelTop + clippedPanelCursorRow),
        Math.min(columns, panel.cursor.column)
      )}${SHOW_CURSOR}`
    } else if (panel.cursor && this.questionState) {
      const clippedPanelCursorRow = Math.max(0, panel.cursor.row - panelFirst)
      frame += `${cursorTo(
        Math.min(rows, panelTop + clippedPanelCursorRow),
        Math.min(columns, panel.cursor.column)
      )}${SHOW_CURSOR}`
    } else {
      frame += HIDE_CURSOR
    }
    frame += END_SYNCHRONIZED_OUTPUT
    this.renderedScreen = screen
    this.renderedColumns = columns
    this.renderedRows = rows
    this.output.write(frame)
  }

  private buildPanel(rows: number): RenderPanel {
    if (this.selectState) return this.buildSelectPanel(rows)
    if (this.questionState) return this.buildQuestionPanel(rows)
    if (!this.composerVisible) return { lines: [] }

    const layout = this.composerDraftLayout()
    const topMargin = rows >= 13 ? [''] : []
    const maxInputRows = Math.max(1, Math.min(6, Math.floor(rows / 3)))
    const firstVisible = Math.max(
      0,
      Math.min(layout.cursor.row - maxInputRows + 1, layout.rows.length - maxInputRows)
    )
    const visibleRows = layout.rows.slice(firstVisible, firstVisible + maxInputRows)
    const queuedTurns = this.queued.filter(
      ({ input }) => input.kind === 'line' && input.value.trim()
    ).length
    const queued = queuedTurns > 0 ? `${queuedTurns} queued · ` : ''
    const footer = this.busy
      ? `  ${queued}enter to steer · esc to interrupt`
      : this.pending && !this.draft
        ? '  ? for shortcuts'
        : ''
    const activityStatus = this.activityStatusLine()
    const activityRows = activityStatus ? [activityStatus] : []
    const suggestionRows = this.suggestionRows(this.panelWidth(), rows)
    /* Keep the suggestion menu visually separate from the activity line. The
       composer's shaded top row already separates activity from input. */
    const suggestionGap = suggestionRows.length ? [''] : []
    const composerCursor = {
      row:
        topMargin.length +
        suggestionRows.length +
        suggestionGap.length +
        activityRows.length +
        1 +
        layout.cursor.row -
        firstVisible,
      column: Math.min(this.panelWidth() + 1, layout.cursor.column + 2),
    }
    return {
      lines: [
        ...topMargin,
        ...suggestionRows,
        ...suggestionGap,
        ...activityRows,
        userPanelRow(),
        ...visibleRows.map((line) => userPanelRow(line)),
        userPanelRow(),
        `${DIM}${footer}${RESET}`,
      ],
      focusRow: composerCursor.row,
      centerFocus: true,
      cursor: this.isComposerEditable() ? composerCursor : undefined,
    }
  }

  private buildSelectPanel(rows: number): RenderPanel {
    const state = this.selectState
    if (!state) return { lines: [] }

    const width = this.panelWidth()
    const options = this.filteredSelectOptions()
    const capacity = Math.max(0, Math.min(8, rows - 5))
    state.active = Math.max(0, Math.min(state.active, options.length - 1))
    const { start, end } = suggestionWindow(options.length, state.active, capacity)
    const visible = options.slice(start, end)
    const labelWidth = Math.min(
      Math.floor(width * 0.55),
      Math.max(0, ...visible.map((option) => displayWidth(option.label))) + 3
    )
    const optionRows = visible.map((option) => {
      const active = option.id === options[state.active]?.id
      const pointer = active ? '❯' : ' '
      const label = truncateDisplay(option.label, Math.max(1, labelWidth - 3))
      const padding = ' '.repeat(Math.max(2, labelWidth - displayWidth(label) - 1))
      const line = truncateDisplay(
        `${pointer} ${label}${padding}${option.description ?? ''}`,
        width
      )
      return active ? `${BRIGHT_WHITE}${line}${RESET}` : `${DIM}${line}${RESET}`
    })
    if (capacity > 0 && optionRows.length === 0) {
      optionRows.push(`${DIM}  No matching chats${RESET}`)
    }

    const layout = this.userPanelDraftLayout('Search › ')
    const searchRow =
      layout.rows[layout.cursor.row] ?? `${USER_MESSAGE_POINTER}Search › ${USER_MESSAGE_TEXT}`
    const header = rows >= 5 ? [`${BOLD}? ${state.menu.prompt}${RESET}`] : []
    const cursor = {
      row: header.length + optionRows.length + 1,
      column: Math.min(width + 1, layout.cursor.column + 2),
    }
    return {
      lines: [
        ...header,
        ...optionRows,
        userPanelRow(),
        userPanelRow(searchRow),
        userPanelRow(),
        `${DIM}  ↑/↓ navigate · enter open · esc cancel${RESET}`,
      ],
      focusRow: cursor.row,
      cursor,
    }
  }

  private buildQuestionPanel(rows: number): RenderPanel {
    const state = this.questionState
    if (!state) return { lines: [] }
    const otherIndex = state.question.options.length
    const choices: Array<{ line: string; cursorColumn?: number }> = state.question.options.map(
      (option, index) => {
        const active = state.active === index
        const pointer = active ? '❯' : ' '
        const marker = state.question.multi
          ? `[${state.selected.has(index) ? '✓' : ' '}]`
          : `${index + 1}.`
        return {
          line: truncateDisplay(`${pointer} ${marker} ${option.label}`, this.panelWidth()),
        }
      }
    )

    const otherActive = state.active === otherIndex
    const otherLead = `${otherActive ? '❯' : ' '} Other › `
    const otherRoom = Math.max(1, this.panelWidth() - displayWidth(otherLead))
    const otherValue = this.draft
      ? tailToWidth(this.draft.replace(/\n/gu, ' '), otherRoom)
      : `${DIM}Type something…${RESET}`
    choices.push({
      line: `${otherLead}${otherValue}`,
      cursorColumn: otherActive
        ? Math.min(
            this.panelWidth() + 1,
            this.draft ? displayWidth(`${otherLead}${otherValue}`) + 1 : displayWidth(otherLead) + 1
          )
        : undefined,
    })
    if (state.question.multi) {
      choices.push({
        line: `${state.active === otherIndex + 1 ? '❯' : ' '} ${DIM}Submit answers${RESET}`,
      })
    }

    const maxChoices = Math.max(1, Math.min(choices.length, Math.floor(rows / 2)))
    const firstVisible = Math.max(
      0,
      Math.min(state.active - maxChoices + 1, choices.length - maxChoices)
    )
    const visibleChoices = choices.slice(firstVisible, firstVisible + maxChoices)
    const footer = state.question.multi
      ? '↑/↓ navigate · Space select · Enter submit · Esc cancel'
      : '↑/↓ navigate · Enter select · Esc cancel'
    const lines = [
      `${ESC}[1m${truncateDisplay(`? ${state.question.prompt}`, this.panelWidth())}${RESET}`,
      ...visibleChoices.map((choice) => choice.line),
      `${DIM}${truncateDisplay(footer, this.panelWidth())}${RESET}`,
    ]
    const activeChoice = choices[state.active]
    const focusRow = 1 + state.active - firstVisible
    return {
      lines,
      focusRow,
      cursor:
        activeChoice?.cursorColumn && state.active >= firstVisible
          ? { row: focusRow, column: activeChoice.cursorColumn }
          : undefined,
    }
  }

  private appendTranscript(value: string): void {
    this.transcript += value
    if (this.transcript.length <= MAX_TRANSCRIPT_CHARACTERS) return

    const preferredCut = this.transcript.length - MAX_TRANSCRIPT_CHARACTERS
    const nextLine = this.transcript.indexOf('\n', preferredCut)
    if (nextLine >= 0) {
      this.transcriptEpoch += 1
      this.transcript = this.transcript.slice(nextLine + 1)
      return
    }
    if (this.transcript.length > MAX_TRANSCRIPT_CHARACTERS * 2) {
      this.transcriptEpoch += 1
      this.transcript = `…${sanitize(this.transcript.slice(-MAX_TRANSCRIPT_CHARACTERS))}`
    }
  }

  /**
   * Wrapped rows for the whole viewport body, reusing the rows already computed
   * for the immutable part of the transcript.
   *
   * Everything up to the transcript's last newline can never change, so it is
   * wrapped once and kept; only the partial final line is re-wrapped per token.
   * That turns an O(transcript) cost per streamed chunk into O(one line).
   */
  private wrappedBody(width: number): string[] {
    const welcome = this.welcomeVisible ? this.renderWelcome() : ''
    const activity = this.activityEventsDisplay()
    const text = this.transcript
    const boundary = text.lastIndexOf('\n') + 1

    let cache = this.wrapCache
    if (
      !cache ||
      cache.width !== width ||
      cache.epoch !== this.transcriptEpoch ||
      cache.consumed > boundary
    ) {
      cache = {
        width,
        epoch: this.transcriptEpoch,
        consumed: 0,
        rows: [],
        state: { sgr: '', userBackground: false },
      }
    }
    if (cache.consumed < boundary) {
      const state: WrapState = { ...cache.state }
      const added = layoutAnsiRows(text.slice(cache.consumed, boundary), width, state)
      cache = {
        width,
        epoch: this.transcriptEpoch,
        consumed: boundary,
        rows: cache.rows.concat(added),
        state,
      }
    }
    this.wrapCache = cache

    /* The welcome block always ends with a reset and a blank line, so it cannot
       leak style into the transcript and is wrapped independently. */
    const rows = welcome ? layoutAnsiRows(welcome, width) : []
    rows.push(...cache.rows)
    const tail = text.slice(cache.consumed)
    if (tail) rows.push(...layoutAnsiRows(tail, width, { ...cache.state }))
    if (activity) rows.push(...layoutAnsiRows(activity, width))
    return rows
  }

  private commitUserLine(value: string): void {
    if (!this.isInteractiveTTY()) return
    this.transcriptScrollTopRow = null
    this.assistantPrefixPending = true
    this.assistantPrefixBuffer = ''
    this.assistantTurnActive = false
    this.assistantContinuationPending = false
    if (this.transcript && !this.transcript.endsWith('\n')) this.appendTranscript('\n')
    if (this.transcript && !this.transcript.endsWith('\n\n')) this.appendTranscript('\n')

    this.appendTranscript(`${userPanelRow()}\n`)
    const lines = sanitize(value).replace(/\t/gu, CONTINUATION_PREFIX).split('\n')
    for (const [index, line] of lines.entries()) {
      const pointer =
        index === 0
          ? `${USER_MESSAGE_POINTER}❯ ${USER_MESSAGE_TEXT}`
          : `${USER_MESSAGE_TEXT}${CONTINUATION_PREFIX}`
      this.appendTranscript(`${userPanelRow(`${pointer}${line}`)}\n`)
    }
    this.appendTranscript(`${userPanelRow()}\n`)
    this.appendTranscript('\n')
  }

  private renderWelcome(): string {
    const width = this.panelWidth()
    const chat = `chat ${this.welcomeChatTitle}`
    const artWidth = Math.max(...BLIMP_ART.map(displayWidth))
    const progress = this.welcomeRevealFrame / WELCOME_FLY_IN_FRAMES
    const eased = progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2
    const trailing = Math.max(0, artWidth - Math.round(artWidth * eased))
    const art = BLIMP_ART.map((line) => `${line}${artPad(line, artWidth)}`.slice(trailing))
    const lead = ' '.repeat(trailing)

    const boxColumns = width - artWidth - WELCOME_GUTTER
    if (boxColumns >= WELCOME_MIN_BOX_COLUMNS) {
      const rows = this.welcomeDetailBox(boxColumns)
      const gutter = ' '.repeat(WELCOME_GUTTER)
      const lines: string[] = []
      /* Centre the shorter column against the taller one. Top-aligning leaves
         the airship and the box visibly out of register whenever they differ
         in height, which they usually do. */
      const height = Math.max(art.length, rows.length)
      const artTop = Math.round((height - art.length) / 2)
      const boxTop = Math.round((height - rows.length) / 2)
      for (let index = 0; index < height; index++) {
        const line = art[index - artTop]
        const column =
          line === undefined ? ' '.repeat(artWidth) : `${BRIGHT_WHITE}${line}${RESET}${lead}`
        lines.push(`${column}${gutter}${rows[index - boxTop] ?? ''}`.trimEnd())
      }
      return `${lines.join('\n')}\n\n`
    }

    if (width >= artWidth) {
      const title = `${BOLD}${truncateDisplay('Sim Chat', width)}${RESET}`
      const scope = `${DIM}${truncateDisplay(chat, width)}${RESET}`
      const rendered = art
        .map((line) => `${BRIGHT_WHITE}${truncateDisplay(line.trimEnd(), width)}${RESET}`)
        .join('\n')
      return `${rendered}\n${title}\n${scope}\n\n`
    }

    return `${BOLD}${truncateDisplay('Sim Chat', width)}${RESET}\n${DIM}${truncateDisplay(
      chat,
      width
    )}${RESET}\n\n`
  }

  noteAttachment(): void {
    const token = `[Image #${this.nextAttachmentNumber++}]`
    const before = this.draft.slice(0, this.cursor)
    const separator = !before || /\s$/u.test(before) ? '' : ' '
    this.insertText(`${separator}${token} `)
    this.renderScreen()
  }

  setWorkspaceName(name: string): void {
    const next = safeOneLine(name).slice(0, 80)
    if (!next || next === this.welcomeWorkspaceName) return
    this.welcomeWorkspaceName = next
    if (!this.closed) this.renderScreen()
  }

  setChatTitle(title: string): void {
    const next = safeOneLine(title).slice(0, 160)
    if (!next || next === this.welcomeChatTitle) return
    this.welcomeChatTitle = next
    if (this.welcomeVisible && !this.closed) this.renderScreen()
  }

  /** Rounded detail box drawn to the right of the art, with aligned labels. */
  private welcomeDetailBox(columns: number): string[] {
    const details: Array<[string, string]> = [
      ['profile', this.welcomeProfile ?? 'default'],
      ...(this.welcomeWorkspaceName
        ? ([['workspace', this.welcomeWorkspaceName]] as Array<[string, string]>)
        : []),
      ['chat', this.welcomeChatTitle],
    ]
    const labelWidth = Math.max(...details.map(([label]) => label.length)) + 2
    const content = [
      { text: 'Sim Chat', style: BOLD },
      ...details.map(([label, value]) => ({
        text: `${`${label}:`.padEnd(labelWidth)}${value}`,
        style: DIM,
      })),
    ]
    const widest = Math.max(...content.map((entry) => displayWidth(entry.text)))
    const inner = Math.max(1, Math.min(columns - 4, widest))
    const rule = '\u2500'.repeat(inner + 2)
    const rows = [`${DIM}\u256d${rule}\u256e${RESET}`]
    for (const { text, style } of content) {
      const clipped = truncateDisplay(text, inner)
      const padding = ' '.repeat(Math.max(0, inner - displayWidth(clipped)))
      const painted = style ? `${style}${clipped}${RESET}` : clipped
      rows.push(`${DIM}\u2502${RESET} ${painted}${padding} ${DIM}\u2502${RESET}`)
    }
    rows.push(`${DIM}\u2570${rule}\u256f${RESET}`)
    return rows
  }

  /**
   * Slides the airship in from the left edge, repainting on a timer. Skipped for
   * non-interactive output and under CI/test runners, where a partially drawn
   * frame would make the header nondeterministic.
   */
  private startWelcomeFlyIn(): void {
    this.stopWelcomeFlyIn()
    if (!this.isInteractiveTTY()) return
    if (process.env.CI || process.env.VITEST) return
    this.welcomeRevealFrame = 0
    this.welcomeTimer = setInterval(() => {
      this.welcomeRevealFrame += 1
      if (this.welcomeRevealFrame >= WELCOME_FLY_IN_FRAMES) this.stopWelcomeFlyIn()
      this.renderScreen()
    }, WELCOME_FLY_IN_INTERVAL_MS)
    this.welcomeTimer.unref()
  }

  private stopWelcomeFlyIn(): void {
    if (this.welcomeTimer) clearInterval(this.welcomeTimer)
    this.welcomeTimer = null
    this.welcomeRevealFrame = WELCOME_FLY_IN_FRAMES
  }

  private activityEventsDisplay(): string {
    if (!this.activityActive) return ''
    const lines: string[] = []
    for (const id of this.activityRoots) {
      if (this.committedActivityRoots.has(id)) continue
      const node = this.activityNodes.get(id)
      if (node) lines.push(...this.activityNodeLines(node, true))
    }
    return lines.join('\n')
  }

  private activityStatusLine(): string {
    if (!this.activityActive) return ''
    const pulseFrames = ['·', '•', '●', '•']
    const pulse = pulseFrames[this.activityFrame % pulseFrames.length]
    const label = tailToWidth(
      safeOneLine(this.activityThinking) || 'Thinking…',
      Math.max(1, this.panelWidth() - 2)
    )
    return `${DIM}${ESC}[3m${pulse} ${label}${RESET}`
  }

  private activityEventLine(event: ChatActivityStatusUpdate, live: boolean, depth = 0): string {
    const icon =
      event.state === 'complete'
        ? `${ESC}[32m●${RESET}`
        : event.state === 'error'
          ? `${ESC}[31m●${RESET}`
          : `${DIM}●${RESET}`
    const indent = CONTINUATION_PREFIX.repeat(depth)
    const label = live
      ? truncateDisplay(event.label, Math.max(1, this.panelWidth() - displayWidth(indent) - 8))
      : event.label
    // A subagent's public label is its stable lane header. Its dot carries the
    // state, while tool labels may use the familiar live/error suffixes.
    const suffix = event.kind === 'tool' && live && event.state === 'running' ? '…' : ''
    const failed = event.kind === 'tool' && event.state === 'error' ? ` ${DIM}failed${RESET}` : ''
    return `${indent}${icon} ${label}${suffix}${failed}`
  }

  private recordActivityEvent(update: ChatActivityUpdate): void {
    if (update.kind === 'narration') {
      const parentId = safeOneLine(update.parentId).slice(0, 160)
      const parent = this.activityNodes.get(parentId)
      if (!parent || parent.kind !== 'subagent') return
      const delta = update.delta.replace(/\r/gu, '')
      if (!delta) return
      const last = parent.children[parent.children.length - 1]
      if (last?.kind === 'narration') last.content += delta
      else parent.children.push({ kind: 'narration', content: delta })
      return
    }

    const id = safeOneLine(update.id).slice(0, 160)
    const label = safeOneLine(update.label).slice(0, 160)
    if (!id || !label) return
    const parentId = update.parentId ? safeOneLine(update.parentId).slice(0, 160) : undefined
    const safeParentId = parentId && parentId !== id ? parentId : undefined
    const existing = this.activityNodes.get(id)
    const node: ActivityTreeNode = {
      kind: update.kind,
      id,
      label,
      state: update.state,
      ...(safeParentId ? { parentId: safeParentId } : {}),
      children: existing?.children ?? [],
    }
    this.activityNodes.set(id, node)
    if (!existing || existing.parentId !== node.parentId) this.attachActivityNode(node)

    if (node.kind === 'subagent') {
      for (const child of this.activityNodes.values()) {
        if (child.parentId === node.id) this.attachActivityNode(child)
      }
    }
  }

  private commitActivityEvents(includeRunning: boolean): void {
    if (!this.isInteractiveTTY()) return
    for (const id of this.activityRoots) {
      if (this.committedActivityRoots.has(id)) continue
      const node = this.activityNodes.get(id)
      if (!node || (!includeRunning && !this.activityNodeSettled(node))) continue
      this.commitActivityRoot(node)
    }
  }

  private commitActivityRoot(node: ActivityTreeNode): void {
    if (!this.isInteractiveTTY() || this.committedActivityRoots.has(node.id)) return
    this.committedActivityRoots.add(node.id)
    const lines = this.activityNodeLines(node, false)
    if (lines.length === 0) return
    if (this.transcript && !this.transcript.endsWith('\n')) this.appendTranscript('\n')
    this.appendTranscript(`${lines.join('\n')}\n`)
  }

  private attachActivityNode(node: ActivityTreeNode): void {
    const rootIndex = this.activityRoots.indexOf(node.id)
    if (rootIndex >= 0) this.activityRoots.splice(rootIndex, 1)
    for (const candidate of this.activityNodes.values()) {
      if (candidate.kind !== 'subagent') continue
      candidate.children = candidate.children.filter(
        (child) => child.kind !== 'node' || child.id !== node.id
      )
    }

    if (node.parentId) {
      const parent = this.activityNodes.get(node.parentId)
      if (parent?.kind === 'subagent') parent.children.push({ kind: 'node', id: node.id })
      return
    }
    this.activityRoots.push(node.id)
  }

  private activityNodeSettled(node: ActivityTreeNode, seen = new Set<string>()): boolean {
    if (node.state === 'running' || seen.has(node.id)) return false
    seen.add(node.id)
    for (const child of node.children) {
      if (child.kind !== 'node') continue
      const nested = this.activityNodes.get(child.id)
      if (nested && !this.activityNodeSettled(nested, seen)) return false
    }
    return true
  }

  private activityNodeLines(
    node: ActivityTreeNode,
    live: boolean,
    depth = 0,
    seen = new Set<string>()
  ): string[] {
    if (seen.has(node.id)) return []
    seen.add(node.id)

    const children: string[] = []
    for (const child of node.children) {
      if (child.kind === 'node') {
        const nested = this.activityNodes.get(child.id)
        if (nested) children.push(...this.activityNodeLines(nested, live, depth + 1, seen))
        continue
      }
      if (!child.content.trim()) continue
      const indent = CONTINUATION_PREFIX.repeat(depth + 1)
      // Only trim to decide whether the lane has visible work. The original
      // text (including leading/trailing blank lines) is the ordered stream.
      for (const line of child.content.split('\n')) {
        children.push(`${indent}${DIM}${line}${RESET}`)
      }
    }

    // Match the web lane projection: a closed lane with no visible work leaves
    // no orphan header, while an open empty lane still explains what is running.
    if (node.kind === 'subagent' && node.state !== 'running' && children.length === 0) return []
    return [this.activityEventLine(node, live, depth), ...children]
  }

  private stopActivity(completed = false): void {
    if (this.activityTimer) clearInterval(this.activityTimer)
    this.activityTimer = null
    if (this.activityActive) {
      this.commitActivityEvents(true)
      if (completed) {
        if (this.transcript && !this.transcript.endsWith('\n')) this.appendTranscript('\n')
        if (this.transcript && !this.transcript.endsWith('\n\n')) this.appendTranscript('\n')
        this.appendTranscript(
          `${DIM}✻ Worked for ${formatActivityDuration(Date.now() - this.activityStartedAt)}${RESET}\n`
        )
      }
    }
    this.activityActive = false
    this.activityThinking = ''
    this.activityStartedAt = 0
    this.activityNodes.clear()
    this.activityRoots.length = 0
    this.committedActivityRoots.clear()
    this.assistantTurnActive = false
    this.assistantContinuationPending = false
    this.busy = false
    this.renderScreen()
  }
}

function prefixAssistantTurn(value: string): string | null {
  let offset = 0
  let leadingSgr = ''
  while (offset < value.length) {
    if (value[offset] === ESC) {
      const sgr = value.slice(offset).match(/^\u001b\[[0-9;:]*m/u)?.[0]
      if (sgr) {
        leadingSgr += sgr
        offset += sgr.length
        continue
      }
    }

    const part = firstGrapheme(value.slice(offset))
    if (!part) break
    if (!/^\p{White_Space}+$/u.test(part)) {
      return `${ASSISTANT_TURN_PREFIX}${indentAssistantFragment(
        `${leadingSgr}${value.slice(offset)}`,
        false
      )}`
    }
    offset += part.length
  }
  return null
}

/** Materializes the assistant gutter on explicit line breaks across streamed chunks. */
function indentAssistantFragment(value: string, continuationPending: boolean): string {
  const prefixed = continuationPending ? `${CONTINUATION_PREFIX}${value}` : value
  return prefixed.replace(/\n(?=.)/gu, `\n${CONTINUATION_PREFIX}`)
}

interface WrapState {
  sgr: string
  userBackground: boolean
}

/**
 * `carry` resumes the state a previous call ended in, and receives the state
 * this call ends in — the two things that survive a row break. Threading them
 * explicitly is what makes it safe to wrap a transcript in pieces.
 */
function layoutAnsiRows(value: string, width: number, carry?: WrapState): string[] {
  if (!value || width <= 0) return []

  type LayoutToken =
    | { kind: 'sgr'; value: string }
    | { kind: 'grapheme'; value: string; width: number }

  const rows: string[] = []
  /* Resumed styling must reopen on the first row, exactly as finishRow()
     reopens it on every subsequent row. */
  let row = carry?.userBackground ? `${USER_PANEL_OUTER_MARGIN}${carry.sgr}` : (carry?.sgr ?? '')
  let column = carry?.userBackground ? displayWidth(USER_PANEL_OUTER_MARGIN) : 0
  let activeSgr = carry?.sgr ?? ''
  let userBackgroundActive = carry?.userBackground ?? false
  let hangingIndent = 0
  let logicalLinePrefix = ''
  let logicalLinePrefixRejected = false
  let pendingWord: LayoutToken[] = []
  let pendingWordWidth = 0

  const contentWidth = (): number => (userBackgroundActive && width > 2 ? width - 2 : width)

  const fillUserMessageRow = (): void => {
    if (!userBackgroundActive) return
    const target = width > 1 ? width - 1 : width
    if (column >= target) return
    row += ' '.repeat(target - column)
    column = target
  }

  const finishRow = (continueLogicalLine = true): void => {
    fillUserMessageRow()
    rows.push(row)
    const outerMargin = userBackgroundActive ? displayWidth(USER_PANEL_OUTER_MARGIN) : 0
    const continuationIndent = continueLogicalLine
      ? Math.min(hangingIndent, Math.max(0, contentWidth() - 1))
      : 0
    if (continuationIndent > 0) {
      const indent = ' '.repeat(Math.max(0, continuationIndent - outerMargin))
      row = userBackgroundActive
        ? `${USER_PANEL_OUTER_MARGIN}${activeSgr}${indent}`
        : `${indent}${activeSgr}`
    } else {
      row = userBackgroundActive ? `${USER_PANEL_OUTER_MARGIN}${activeSgr}` : activeSgr
    }
    column = Math.max(continuationIndent, outerMargin)
    if (!continueLogicalLine) {
      hangingIndent = 0
      logicalLinePrefix = ''
      logicalLinePrefixRejected = false
    }
  }

  const observeLogicalLinePrefix = (segment: string, segmentWidth: number): void => {
    if (logicalLinePrefixRejected) return
    if (segmentWidth !== 1) {
      logicalLinePrefixRejected = true
      return
    }

    // Activity trees can be nested more deeply than the assistant's two-column
    // gutter. Preserve every explicit leading space on soft wraps so a nested
    // tool or narration row never jumps back toward its parent.
    if (segment === ' ' && /^ *$/u.test(logicalLinePrefix)) {
      logicalLinePrefix += segment
      hangingIndent = displayWidth(logicalLinePrefix)
      return
    }

    const candidate = `${logicalLinePrefix}${segment}`
    const knownPrefix = [ASSISTANT_TURN_PREFIX, USER_TURN_PREFIX].find((prefix) =>
      prefix.startsWith(candidate)
    )
    if (knownPrefix) {
      logicalLinePrefix = candidate
      if (candidate === knownPrefix) hangingIndent = displayWidth(knownPrefix)
      return
    }
    logicalLinePrefixRejected = true
  }

  const appendVisible = (segment: string): void => {
    if (segment === '\t') {
      const spaces = Math.max(1, 8 - (column % 8))
      for (let index = 0; index < spaces; index += 1) appendVisible(' ')
      return
    }
    if (/[\u0000-\u001f\u007f-\u009f]/u.test(segment)) return

    const segmentWidth = graphemeWidth(segment)
    observeLogicalLinePrefix(segment, segmentWidth)
    const availableWidth = contentWidth()
    if (segmentWidth > availableWidth) {
      if (column > 0) finishRow()
      row += '…'
      column = 1
      return
    }
    if (column > 0 && column + segmentWidth > availableWidth) finishRow()
    row += segment
    column += segmentWidth
  }

  const appendToken = (token: LayoutToken): void => {
    if (token.kind === 'sgr') {
      if (userBackgroundActive && token.value === RESET) fillUserMessageRow()
      row += token.value
      activeSgr = updateActiveSgr(activeSgr, token.value)
      if (token.value === USER_MESSAGE_BACKGROUND) userBackgroundActive = true
      else if (token.value === RESET) userBackgroundActive = false
      return
    }
    appendVisible(token.value)
  }

  const flushWord = (): void => {
    if (pendingWord.length === 0) return

    const availableWidth = contentWidth()
    const outerMargin = userBackgroundActive ? displayWidth(USER_PANEL_OUTER_MARGIN) : 0
    const continuationIndent = Math.min(hangingIndent, Math.max(0, availableWidth - 1))
    const freshColumn = Math.max(continuationIndent, outerMargin)

    /**
     * Matches Ink's default wrap behavior: ordinary words move intact when they fit on a fresh
     * row, while overlong tokens hard-wrap through the remaining space. Styling tokens flush with
     * their word so absolute continuation rows can safely reopen the active SGR state.
     */
    if (
      pendingWordWidth > 0 &&
      freshColumn + pendingWordWidth <= availableWidth &&
      column > freshColumn &&
      column + pendingWordWidth > availableWidth
    ) {
      finishRow()
    }

    for (const token of pendingWord) appendToken(token)
    pendingWord = []
    pendingWordWidth = 0
  }

  const bufferWordToken = (token: LayoutToken): void => {
    pendingWord.push(token)
    if (token.kind === 'grapheme') pendingWordWidth += token.width
  }

  let offset = 0
  while (offset < value.length) {
    if (value[offset] === ESC) {
      const match = value.slice(offset).match(/^\u001b\[[0-9;:]*m/u)
      if (match) {
        const sequence = match[0]
        bufferWordToken({ kind: 'sgr', value: sequence })
        offset += sequence.length
        continue
      }
      offset += 1
      continue
    }
    if (value[offset] === '\n') {
      flushWord()
      finishRow(false)
      offset += 1
      continue
    }

    const nextControl = [value.indexOf(ESC, offset), value.indexOf('\n', offset)]
      .filter((index) => index >= 0)
      .reduce((closest, index) => Math.min(closest, index), value.length)
    const text = value.slice(offset, nextControl)
    for (const part of graphemes(text)) {
      const breakableWhitespace =
        part.segment !== '\u00a0' &&
        part.segment !== '\u202f' &&
        /^\p{White_Space}+$/u.test(part.segment)
      if (breakableWhitespace) {
        flushWord()
        appendVisible(part.segment)
      } else {
        bufferWordToken({
          kind: 'grapheme',
          value: part.segment,
          width: graphemeWidth(part.segment),
        })
      }
    }
    offset = nextControl
  }

  flushWord()
  fillUserMessageRow()
  rows.push(row)
  if (value.endsWith('\n')) rows.pop()
  if (carry) {
    carry.sgr = activeSgr
    carry.userBackground = userBackgroundActive
  }
  return rows
}

function updateActiveSgr(active: string, sequence: string): string {
  const rawParameters = sequence.slice(2, -1)
  const parameters = rawParameters ? rawParameters.split(';') : ['0']
  let lastReset = -1
  for (let index = 0; index < parameters.length; index += 1) {
    const parameter = parameters[index] ?? ''
    const code = Number(parameter.split(':', 1)[0])
    if (code === 0) lastReset = index
    if ((code === 38 || code === 48 || code === 58) && !parameter.includes(':')) {
      const mode = Number(parameters[index + 1])
      if (mode === 2) index += 4
      else if (mode === 5) index += 2
    }
  }
  if (lastReset < 0) return `${active}${sequence}`

  const remaining = parameters.slice(lastReset + 1)
  return remaining.length > 0 ? `${ESC}[${remaining.join(';')}m` : ''
}

function cursorTo(row: number, column: number): string {
  return `${ESC}[${Math.max(1, row)};${Math.max(1, column)}H`
}

/**
 * Spans of `[Image #N]` tags, so a pasted attachment reads as a tag rather than
 * loose text. Derived per render like context spans, so deleting the tag stops
 * the highlight with no bookkeeping.
 */
const ATTACHMENT_TOKEN = /\[Image #\d+\]/gu

function attachmentSpans(text: string): Array<{ start: number; end: number }> {
  return [...text.matchAll(ATTACHMENT_TOKEN)].map((match) => ({
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
  }))
}

function isEnter(key: Key | undefined): boolean {
  return key?.name === 'return' || key?.name === 'enter'
}

function printableText(character: string, key: Key | undefined): string {
  if (!character || key?.ctrl || key?.meta) return ''
  if (key?.name === 'return' || key?.name === 'enter' || key?.name === 'tab') return ''
  return sanitize(character).replace(/[\u0000-\u001f\u007f]/gu, '')
}

/** Normalizes server-provided menu text before it can enter the terminal draft or renderer. */
function sanitizeSuggestionItem(item: SuggestionItem): SuggestionItem | null {
  const value = safeOneLine(item.value).slice(0, 255)
  const displayText = safeOneLine(item.displayText).slice(0, 255)
  if (!value || !displayText) return null

  const description = item.description ? safeOneLine(item.description).slice(0, 500) : undefined
  const sanitized = {
    ...item,
    value,
    displayText,
    ...(description ? { description } : {}),
  }
  if (!item.context) return sanitized

  const contextLabel = safeOneLine(item.context.label).slice(0, 255)
  if (!contextLabel) return null
  return { ...sanitized, context: { ...item.context, label: contextLabel } }
}

function layoutDraft(
  prompt: string,
  draft: string,
  width: number,
  cursor: number,
  highlights: Array<{ start: number; end: number }> = [],
  options: DraftLayoutOptions = {}
): DraftLayout {
  const continuationPrefix = options.continuationPrefix ?? CONTINUATION_PREFIX
  const normalTextStyle = options.normalTextStyle ?? RESET
  const rows = [prompt]
  const points: CursorPoint[] = [{ index: 0, row: 0, column: displayWidth(prompt) }]
  let row = 0
  let column = displayWidth(prompt)
  let styled = false

  const setPoint = (index: number): void => {
    const previous = points.at(-1)
    if (previous?.index === index) {
      previous.row = row
      previous.column = column
    } else {
      points.push({ index, row, column })
    }
  }

  for (const part of graphemes(draft)) {
    setPoint(part.index)
    const end = part.index + part.segment.length
    if (part.segment === '\n') {
      if (styled) rows[row] += normalTextStyle
      row += 1
      column = displayWidth(continuationPrefix)
      rows.push(
        styled
          ? `${continuationPrefix}${MENTION_TEXT}`
          : `${continuationPrefix}${options.normalTextStyle ?? ''}`
      )
      setPoint(end)
      continue
    }

    const segmentWidth = displayWidth(part.segment)
    if (column + segmentWidth > width && column > displayWidth(continuationPrefix)) {
      if (styled) rows[row] += normalTextStyle
      row += 1
      column = displayWidth(continuationPrefix)
      rows.push(
        styled
          ? `${continuationPrefix}${MENTION_TEXT}`
          : `${continuationPrefix}${options.normalTextStyle ?? ''}`
      )
      setPoint(part.index)
    }
    /* ANSI has zero display width, so styling here cannot disturb the wrap or
       cursor arithmetic above. Runs are coalesced rather than wrapping every
       grapheme, and closed/reopened around a row break so no style leaks. */
    const lit = highlights.some((span) => part.index >= span.start && part.index < span.end)
    if (lit && !styled) {
      rows[row] += MENTION_TEXT
      styled = true
    } else if (!lit && styled) {
      rows[row] += normalTextStyle
      styled = false
    }
    rows[row] += part.segment
    column += segmentWidth
    setPoint(end)
  }

  if (styled) rows[row] += normalTextStyle

  const fallback = points.at(-1) ?? { index: 0, row: 0, column: displayWidth(prompt) }
  const cursorPoint = points.find((point) => point.index === cursor) ?? fallback
  return { rows, points, cursor: cursorPoint }
}
