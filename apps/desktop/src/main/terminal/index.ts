/**
 * The agent-terminal service: several concurrent shells, their tab ordering,
 * and tool execution against them.
 *
 * Commands run unattended. There is no per-command approval and no OS jail, so
 * anything the agent runs holds the user's own privileges — the only controls
 * left are upstream: the desktop capability gate, and the tool-authorization
 * check in ipc.ts that ties every call to a real pending Copilot tool call so
 * page code cannot invent one. Reintroducing a boundary means adding it back
 * here, in main, where the renderer cannot route around it.
 */
import { statSync } from 'node:fs'
import { homedir } from 'node:os'
import type { TerminalShortcutCommand } from '@sim/desktop-bridge'
import { createLogger } from '@sim/logger'
import {
  isTerminalControlKey,
  MAX_INPUT_KEYS,
  MAX_TOOL_OUTPUT_CHARS,
  resolveRunWaitMs,
  type TerminalCommandEvent,
  type TerminalControlKey,
  type TerminalCwdResult,
  type TerminalErrorCode,
  type TerminalHandoffResult,
  type TerminalOperation,
  type TerminalPanesResult,
  type TerminalStartOptions,
  type TerminalTabsState,
  type TerminalToolArgs,
  type TerminalToolResponse,
} from '@sim/terminal-protocol'
import { sleep } from '@sim/utils/helpers'
import type { BrowserWindow, WebContents } from 'electron'
import {
  type FocusedResourceShortcut,
  isResourceTabSelectionShortcut,
  resourceTabTargetIndex,
} from '@/main/resource-shortcuts'
import { readForegroundProcessGroup, signalProcessGroup } from '@/main/terminal/process-group'
import type { RunLedger } from '@/main/terminal/run-ledger'
import { elide, type ShellStartupBounds, TerminalSession } from '@/main/terminal/session'
import {
  activePane,
  awaitRun,
  capturePane,
  closeRunPane,
  isRunComplete,
  isTmuxUnavailable,
  killPane,
  listPanes,
  pollRun,
  type RecordedRun,
  resolveAttachment,
  runPaneState,
  sendKey,
  sendText,
  startRun,
  stopRun,
  TMUX_KEY_NAMES,
  type TmuxAttachment,
  type TmuxRunHandle,
} from '@/main/terminal/tmux'

const logger = createLogger('DesktopTerminal')

/**
 * How long a just-spawned shell gets to reach its first prompt. It begins our startup files
 * before anything of the user's runs, so one that has not within seconds was never instrumented.
 * The user's own files get far longer, since a heavy `.zshrc` (oh-my-zsh, nvm, pyenv) is slow on
 * a cold start and slower on a busy machine; past that, it is waiting on something.
 */
const SHELL_STARTUP_BOUNDS: ShellStartupBounds = { unstartedMs: 8_000, startingMs: 30_000 }

/** Enough of a stalled startup's screen to show what it is waiting on. */
const STARTUP_SCREEN_LINES = 20

/** Grace for a program to react to input before its screen is worth reading. */
const INPUT_ECHO_MS = 250

/** Enough of the screen to show whether the input took, without a wall of it. */
const INPUT_SCREEN_LINES = 60

/**
 * How often the active terminal's directory is reconciled against the OS.
 * Fast enough that a `cd` renames the tab about as soon as the user looks at
 * it, slow enough that the lookup is nowhere near a hot path.
 */
const CWD_POLL_MS = 1_000

/** Cmd-Shift-T history; independent of how many terminals may be open. */
const MAX_RECENTLY_CLOSED_TERMINALS = 10

/** A single chat cannot monopolize the process with native PTYs. */
export const MAX_TERMINALS_PER_SCOPE = 16

/** Pause between keys sent to a tmux pane, matching the pty keystroke gap. */
const TMUX_KEY_GAP_MS = 150

/** How long a resolved tmux attachment is reused before re-resolving. */
const TMUX_ATTACHMENT_TTL_MS = 3_000

/** How often a handoff checks whether the user or the command has finished. */
const HANDOFF_POLL_MS = 500

/**
 * Ceiling on a handoff. A person can take as long as they like — they may
 * have walked away mid-install — so this only exists so a forgotten handoff
 * cannot hold a turn open forever.
 */
const HANDOFF_MAX_MS = 12 * 60 * 60 * 1000

/**
 * Grace given to a command that is still running after the user hands back.
 * Answering a prompt usually finishes the job within seconds; anything longer
 * is an ordinary long-running command, and comes back as `running` for the
 * agent to poll rather than holding the turn.
 */
const HANDOFF_SETTLE_MS = 5_000

function elideOutput(value: string): { text: string; truncated: boolean } {
  return elide(value, MAX_TOOL_OUTPUT_CHARS)
}

/**
 * The keys an input call wants pressed, in order. A lone `key` is the same
 * thing with one element, so both arrive here as one list.
 */
function requestedKeys(args: TerminalToolArgs): TerminalControlKey[] {
  const batch = Array.isArray(args.keys) ? args.keys : []
  const keys = batch.length > 0 ? batch : isTerminalControlKey(args.key) ? [args.key] : []
  return keys.filter(isTerminalControlKey).slice(0, MAX_INPUT_KEYS)
}

const EMPTY_TABS: TerminalTabsState = { tabs: [], activeTerminalId: null }

export class TerminalError extends Error {
  constructor(
    readonly code: TerminalErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'TerminalError'
  }
}

/** Where the service pushes live updates; wired to the renderer by ipc.ts. */
export interface TerminalSink {
  data(terminalId: string, data: string): void
  tabs(state: TerminalTabsState): void
  command(event: TerminalCommandEvent): void
}

export interface TerminalServiceOptions {
  /**
   * Where the last session left off, so reopening the terminal resumes in the
   * directory the user was working in rather than dropping them back in
   * `$HOME`. Returning undefined (or a path that no longer exists) falls back
   * to the home directory.
   */
  loadCwd?(): string | undefined
  canSpawn?(): boolean
  /** Reads and signals a terminal's foreground process group; the OS's by default. */
  processGroups?: TerminalProcessGroups
  /** Where tagged tmux runs are recorded, so a later process can still stop them. */
  runLedger?: RunLedger
}

interface TerminalProcessGroups {
  foreground(shellPid: number): Promise<number | null>
  signal(pgid: number, signal: NodeJS.Signals): void
}

const OS_PROCESS_GROUPS: TerminalProcessGroups = {
  foreground: readForegroundProcessGroup,
  signal: signalProcessGroup,
}

/**
 * One tool call's Stop: remembered if it arrives before the call's command starts, and handed to
 * whatever is running once it does.
 */
interface StopLatch {
  /** Aborts on Stop; work not yet started checks it, and input stops between keystrokes. */
  readonly signal: AbortSignal
  stopRunning: (() => Promise<void>) | null
}

function stoppedBeforeStart(): TerminalError {
  return new TerminalError(
    'CANCELLED',
    'Stopped before the command started, so nothing ran in the terminal.'
  )
}

function stoppedPartWay(): TerminalError {
  return new TerminalError(
    'CANCELLED',
    'Stopped part way through the input; some of it may already have reached the terminal.'
  )
}

/** Operations that change a terminal; a Stop that lands before one starts means it never does. */
const TERMINAL_CHANGING_OPERATIONS: ReadonlySet<TerminalOperation> = new Set([
  'close',
  'handoff',
  'input',
  'kill',
  'run',
])

/**
 * How long a stopped command gets to exit after each escalation: Ctrl-C first, as the user would
 * press it, then SIGTERM and finally SIGKILL to its process group.
 */
const STOP_ESCALATION_MS = 2_000

export class TerminalService {
  /** Insertion-ordered, which is also the tab order the user sees. */
  private readonly sessions = new Map<string, TerminalSession>()
  private activeId: string | null = null
  private readonly pendingCloseConfirmations = new Set<string>()
  private agentActiveId: string | null = null
  private activeTerminalUserSelected = false
  /** True while tearing every shell down, so an exit does not respawn one. */
  private disposing = false
  private nextId = 1
  private sink: TerminalSink | null = null
  private lastEmittedTabs: string | null = null
  private cwdTimer: NodeJS.Timeout | null = null
  /**
   * The renderer whose terminal panel holds the user's keyboard focus, or null.
   *
   * The claim IS the owner — there is deliberately no separate boolean. A
   * second field could hold `true` with no live owner, and that combination is
   * precisely the latch this binding exists to prevent: every reader would
   * have to remember to reject it, and the one that forgot would close a shell
   * nobody was looking at.
   */
  private focusOwner: WebContents | null = null
  private releaseFocusListeners: (() => void) | null = null
  /** Renderer currently displaying this terminal panel, independent of DOM focus. */
  private visibleOwner: WebContents | null = null
  private releaseVisibleListeners: (() => void) | null = null
  /** Directories of recently closed terminals, newest first, for reopening. */
  private readonly recentlyClosedCwds: string[] = []
  /** Terminals handed to the user; the value is whether they have handed back. */
  private readonly handoffs = new Map<string, boolean>()
  /** Recently resolved tmux attachments, by terminal id, to avoid re-spawning. */
  private readonly tmuxCache = new Map<string, { at: number; attachment: TmuxAttachment | null }>()
  /**
   * Run handles for commands that outlived their wait window, keyed by
   * terminal. `startRun` makes a temp directory per run and only its handle can
   * remove it, so a handle dropped on the still-running path leaks that
   * directory for the life of the process while `tee` keeps appending to it.
   * Held here so the terminal's own lifecycle can reclaim them.
   */
  private readonly pendingRuns = new Map<string, TmuxRunHandle[]>()
  /**
   * Agent runs still going in tmux after their Sim terminal closed: the tmux session outlives the
   * tab, but sign-out must still stop them.
   */
  private readonly orphanedRuns = new Map<TmuxRunHandle, NodeJS.ProcessEnv>()
  /** Runs a `run` call is still waiting on; their files are read when the wait ends. */
  private readonly awaitedRuns = new Set<TmuxRunHandle>()
  /** Awaited runs released meanwhile (their terminal closed); their files go once the wait ends. */
  private readonly releasedAwaitedRuns = new Set<TmuxRunHandle>()
  /** How to stop each tool call still in flight, so Stop interrupts exactly what it started. */
  private readonly toolStops = new Map<string, () => Promise<void>>()

  constructor(private readonly options: TerminalServiceOptions = {}) {}

  setSink(sink: TerminalSink | null): void {
    this.sink = sink
    // A new sink has seen nothing, so the dedupe baseline has to reset or the
    // panel would wait for an unrelated change before learning the tab list.
    this.lastEmittedTabs = null
    if (sink) this.startCwdWatch()
    else this.stopCwdWatch()
  }

  /**
   * Keeps the visible tab's directory honest without depending on the shell.
   *
   * Only the active session is polled, and only while a panel is attached and
   * nothing is running in the foreground (a running command owns the label
   * anyway), so this costs one cheap lookup a second at most — the reason it
   * samples rather than watching every keystroke.
   */
  private startCwdWatch(): void {
    if (this.cwdTimer) return
    this.cwdTimer = setInterval(() => {
      const active = this.activeId ? this.sessions.get(this.activeId) : null
      if (!active || active.isBusy) return
      void active.refreshCwd()
    }, CWD_POLL_MS)
    this.cwdTimer.unref?.()
  }

  private stopCwdWatch(): void {
    if (!this.cwdTimer) return
    clearInterval(this.cwdTimer)
    this.cwdTimer = null
  }

  getTabs(): TerminalTabsState {
    if (this.sessions.size === 0) return EMPTY_TABS
    return {
      tabs: [...this.sessions.values()].map((session) =>
        session.tabState(session.terminalId === this.activeId)
      ),
      activeTerminalId: this.activeId,
      agentActiveTerminalId: this.agentActiveId,
    }
  }

  /** Tool-facing tab list whose active marker follows the agent cursor. */
  private getAgentTabs(): TerminalTabsState {
    const state = this.getTabs()
    return {
      ...state,
      tabs: state.tabs.map((tab) => ({
        ...tab,
        active: tab.terminalId === this.agentActiveId,
      })),
      activeTerminalId: this.agentActiveId,
    }
  }

  /** Opens the first terminal, or adopts what is already running. */
  start(options: TerminalStartOptions): TerminalTabsState {
    if (this.sessions.size === 0) {
      this.spawn(this.startingCwd(), options.cols, options.rows, {
        activateVisible: true,
        activateAgent: true,
      })
    }
    return this.getTabs()
  }

  /**
   * Everything on a terminal's screen, for a freshly created view to paint
   * itself from.
   *
   * Pulled by the view rather than pushed on start. Pushing meant the repaint
   * was aimed at whoever happened to be subscribed at the time: on a first
   * mount that is nobody, because the tab list is still empty and no view
   * exists yet, so the paint was dropped and the panel came up blank over a
   * shell that had been running all along. On later mounts it was everybody,
   * so a panel that already had its content repainted anyway. A view asking
   * for its own terminal is right in both cases, and asks exactly once.
   */
  getScrollback(terminalId: string): string {
    return this.sessions.get(terminalId)?.takeReplaySnapshot() ?? ''
  }

  /** Clears retained output without disturbing the shell process itself. */
  clearScrollback(terminalId: string): boolean {
    const session = this.sessions.get(terminalId)
    if (!session) return false
    session.clearScrollback()
    return true
  }

  /** Opens an additional terminal and makes it active. */
  openTerminal(cwd?: string): TerminalTabsState {
    const active = this.activeId ? this.sessions.get(this.activeId) : null
    const size = active ? { cols: active.cols, rows: active.rows } : { cols: 80, rows: 24 }
    // A new terminal opens where the current one is: the user is almost always
    // continuing the same piece of work in a second shell.
    this.activeTerminalUserSelected = true
    this.spawn(cwd ?? active?.currentCwd ?? this.startingCwd(), size.cols, size.rows, {
      activateVisible: true,
      activateAgent: this.agentActiveId === null,
    })
    return this.getTabs()
  }

  /** Recreates a persisted tab without treating restoration as user interaction. */
  restoreTerminal(cwd?: string): TerminalTabsState {
    const active = this.activeId ? this.sessions.get(this.activeId) : null
    const size = active ? { cols: active.cols, rows: active.rows } : { cols: 80, rows: 24 }
    this.spawn(cwd ?? active?.currentCwd ?? this.startingCwd(), size.cols, size.rows, {
      activateVisible: true,
      activateAgent: true,
    })
    this.activeTerminalUserSelected = false
    return this.getTabs()
  }

  /** Restores the persisted visible/agent cursor without claiming user ownership. */
  restoreActiveTerminal(terminalId: string): TerminalTabsState {
    if (!this.sessions.has(terminalId)) {
      throw new TerminalError('NO_SUCH_TERMINAL', unknownTerminal(terminalId))
    }
    this.activeId = terminalId
    this.agentActiveId = terminalId
    this.activeTerminalUserSelected = false
    this.emitTabs()
    return this.getTabs()
  }

  /** Opens a shell for agent work without changing the terminal the user sees. */
  private openAgentTerminal(cwd?: string): TerminalTabsState {
    const agent = this.agentActiveId ? this.sessions.get(this.agentActiveId) : null
    const visible = this.activeId ? this.sessions.get(this.activeId) : null
    const source = agent ?? visible
    const size = source ? { cols: source.cols, rows: source.rows } : { cols: 80, rows: 24 }
    this.spawn(cwd ?? source?.currentCwd ?? this.startingCwd(), size.cols, size.rows, {
      activateVisible: this.activeId === null,
      activateAgent: true,
    })
    return this.getAgentTabs()
  }

  /**
   * Shows a terminal. `claim` records it as the user's own; a switch that only
   * mirrors the renderer's resource-strip selection passes false so the agent
   * can still close or adopt the shell as its own.
   */
  switchTerminal(
    terminalId: string,
    { claim = true }: { claim?: boolean } = {}
  ): TerminalTabsState {
    if (!this.sessions.has(terminalId)) {
      throw new TerminalError('NO_SUCH_TERMINAL', unknownTerminal(terminalId))
    }
    this.activeId = terminalId
    if (claim) this.activeTerminalUserSelected = true
    this.emitTabs()
    void this.sessions.get(terminalId)?.refreshCwd()
    return this.getTabs()
  }

  /** Moves the agent cursor without changing the visible terminal. */
  private switchAgentTerminal(terminalId: string): TerminalTabsState {
    if (!this.sessions.has(terminalId)) {
      throw new TerminalError('NO_SUCH_TERMINAL', unknownTerminal(terminalId))
    }
    this.agentActiveId = terminalId
    this.emitTabs()
    return this.getAgentTabs()
  }

  /** Moves one terminal to a final list index without changing the active shell. */
  reorderTerminal(terminalId: string, targetIndex: number): TerminalTabsState {
    if (!this.sessions.has(terminalId)) {
      throw new TerminalError('NO_SUCH_TERMINAL', unknownTerminal(terminalId))
    }
    if (!Number.isFinite(targetIndex)) return this.getTabs()
    const entries = [...this.sessions.entries()]
    const currentIndex = entries.findIndex(([id]) => id === terminalId)
    const nextIndex = Math.max(0, Math.min(entries.length - 1, Math.trunc(targetIndex)))
    if (currentIndex === nextIndex) return this.getTabs()
    const [entry] = entries.splice(currentIndex, 1)
    entries.splice(nextIndex, 0, entry)
    this.sessions.clear()
    for (const [id, session] of entries) this.sessions.set(id, session)
    this.emitTabs()
    return this.getTabs()
  }

  /**
   * Closes a terminal. Each shell is its own resource tab in the renderer, so
   * closing the last one simply leaves none; the strip drops the tab and a new
   * shell comes back through `+ Terminal` or the agent. A shell that ends by
   * itself — `exit`, or Ctrl-D — goes the same way: it leaves behind a session
   * that can no longer do anything, so it is reaped like a close.
   */
  closeTerminal(terminalId: string): TerminalTabsState {
    if (!this.sessions.has(terminalId)) {
      throw new TerminalError('NO_SUCH_TERMINAL', unknownTerminal(terminalId))
    }
    return this.retire(terminalId)
  }

  /** Closes agent-owned work without destroying the shell the user claimed. */
  private closeAgentTerminal(terminalId: string): TerminalTabsState {
    if (terminalId === this.activeId && this.activeTerminalUserSelected) {
      throw new TerminalError(
        'INVALID_REQUEST',
        'That terminal is currently being used by the user. Switch to another agent terminal instead of closing it.'
      )
    }
    return this.closeTerminal(terminalId)
  }

  /**
   * Removes the temp directories of tracked runs that have since finished, or whose pane is gone
   * (the user closed it, or tmux restarted): nothing will ever write their status, and their ids
   * may already belong to the user's own panes.
   *
   * Called when a new run starts on the same terminal, which is the one moment
   * the service is already doing run bookkeeping — a dedicated reaper timer
   * would be a subsystem to own for something this cheap. A run still going is
   * left alone: its `tee` is still appending to that directory.
   */
  private async reapFinishedRuns(terminalId: string, env: NodeJS.ProcessEnv): Promise<void> {
    // A closed tab's run whose pane has since gone (its command ended) needs no stopping.
    for (const [handle, orphanEnv] of this.orphanedRuns) {
      if ((await runPaneState(handle, orphanEnv)) === 'gone') {
        this.orphanedRuns.delete(handle)
        this.forgetRun(handle)
      }
    }
    for (const handle of this.pendingRuns.get(terminalId) ?? []) {
      if (this.awaitedRuns.has(handle)) continue
      const complete = isRunComplete(handle)
      if (complete || (await runPaneState(handle, env)) === 'gone') {
        // A pane kept open after its command ended (`remain-on-exit`) closes with its run.
        if (complete) await closeRunPane(handle, env)
        this.untrackRun(terminalId, handle)
        this.forgetRun(handle)
        handle.dispose()
      }
    }
  }

  /** Drops a run's record once nothing of it is left for any process to stop. */
  private forgetRun(handle: TmuxRunHandle): void {
    if (handle.runId) this.options.runLedger?.forget(handle.runId)
  }

  /** Removes a run's files now, or once the call still reading them is done with them. */
  private releaseRun(handle: TmuxRunHandle): void {
    if (this.awaitedRuns.has(handle)) this.releasedAwaitedRuns.add(handle)
    else handle.dispose()
  }

  private untrackRun(terminalId: string, handle: TmuxRunHandle): void {
    const remaining = (this.pendingRuns.get(terminalId) ?? []).filter((entry) => entry !== handle)
    if (remaining.length === 0) this.pendingRuns.delete(terminalId)
    else this.pendingRuns.set(terminalId, remaining)
  }

  /**
   * Releases every tracked run for a terminal, finished or not. The terminal is
   * going away, so nothing will ever read these files again.
   */
  private releasePendingRuns(terminalId: string, env?: NodeJS.ProcessEnv): void {
    const pending = this.pendingRuns.get(terminalId)
    if (!pending) return
    for (const handle of pending) {
      // A finished run's pane may still be open (`remain-on-exit`): it is closed, while still the
      // run's, before the record goes, and its files go only after that check, which an untracked
      // run needs them for. Without the shell's environment the record stays, and the next sweep
      // closes it. An untracked run is never stopped, so it is not kept either.
      if (isRunComplete(handle) && env) {
        void closeRunPane(handle, env)
          .then(async () => {
            if ((await runPaneState(handle, env)) === 'gone') this.forgetRun(handle)
          })
          .finally(() => this.releaseRun(handle))
        continue
      }
      if (env && handle.runId !== null && !isRunComplete(handle)) this.orphanedRuns.set(handle, env)
      this.releaseRun(handle)
    }
    this.pendingRuns.delete(terminalId)
  }

  /**
   * Drops a terminal and moves both cursors to a neighbour. Closing and
   * exiting share this so the two cannot drift into different answers.
   */
  private retire(terminalId: string): TerminalTabsState {
    const session = this.sessions.get(terminalId)
    if (!session) return this.getTabs()
    const closedCwd = session.currentCwd
    const order = [...this.sessions.keys()]
    const index = order.indexOf(terminalId)
    const env = session.env
    session.dispose()
    this.sessions.delete(terminalId)
    this.tmuxCache.delete(terminalId)
    this.releasePendingRuns(terminalId, env)

    this.rememberClosed(closedCwd)
    // Nothing is left for the user to hold on to; the next shell the agent
    // opens must not inherit a claim on a terminal that no longer exists.
    if (this.sessions.size === 0) this.activeTerminalUserSelected = false
    if (this.activeId === terminalId) {
      this.activeId = order[index + 1] ?? order[index - 1] ?? null
    }
    if (this.agentActiveId === terminalId) {
      this.agentActiveId = order[index + 1] ?? order[index - 1] ?? null
    }
    this.emitTabs()
    return this.getTabs()
  }

  /**
   * Claims one application-menu shortcut while this terminal owns focus.
   *
   * Main-owned tab operations happen here. Canvas operations are emitted back
   * to the renderer that made the focus claim, so the same xterm action serves
   * native accelerators and the terminal's own menu. Reopening creates a fresh
   * shell in the last closed terminal's directory; a dead process itself cannot
   * be restored.
   */
  handleFocusedShortcut(
    shortcut: FocusedResourceShortcut,
    ownerWindow: BrowserWindow | null,
    emitRendererCommand: (command: TerminalShortcutCommand, terminalId: string) => void,
    confirmCloseRunning?: (running: string) => boolean | Promise<boolean>
  ): boolean {
    // Hard reload and history have no terminal meaning — leave them to the Browser or shell.
    if (
      shortcut === 'focus-omnibox' ||
      shortcut === 'hard-reload' ||
      shortcut === 'back' ||
      shortcut === 'forward'
    ) {
      return false
    }
    const visibleTabShortcut =
      shortcut === 'new-tab' || shortcut === 'reopen-closed-tab' || shortcut === 'close-tab'
    const ownsVisibleTabs =
      visibleTabShortcut && this.sessions.size > 0 && this.ownsVisiblePanel(ownerWindow)
    if (!this.ownsInteraction(ownerWindow) && !ownsVisibleTabs) return false

    if (isResourceTabSelectionShortcut(shortcut)) {
      const ids = [...this.sessions.keys()]
      const targetIndex = resourceTabTargetIndex(
        shortcut,
        ids.length,
        this.activeId ? ids.indexOf(this.activeId) : -1
      )
      const targetId = targetIndex === null ? null : ids[targetIndex]
      if (targetId) this.switchTerminal(targetId)
      return true
    }

    switch (shortcut) {
      case 'new-tab':
        this.openTerminal()
        return true
      case 'reopen-closed-tab': {
        const cwd = this.recentlyClosedCwds.shift()
        if (cwd !== undefined) this.openTerminal(cwd || undefined)
        return true
      }
      case 'close-tab':
        if (this.activeId) {
          const active = this.sessions.get(this.activeId)
          const running = active?.isBusy ? (active.foreground ?? 'A process') : null
          if (running && active && confirmCloseRunning) {
            void this.confirmCloseRunningTerminal(active, running, confirmCloseRunning)
            return true
          }
          this.closeTerminal(this.activeId)
        }
        return true
      case 'reload-or-clear':
        if (this.activeId) {
          this.clearScrollback(this.activeId)
          emitRendererCommand('clear', this.activeId)
        }
        return true
    }

    if (this.activeId) emitRendererCommand(shortcut, this.activeId)
    return true
  }

  /** Revalidates the captured terminal after an asynchronous native-window confirmation. */
  private async confirmCloseRunningTerminal(
    terminal: TerminalSession,
    running: string,
    confirm: (running: string) => boolean | Promise<boolean>
  ): Promise<void> {
    const id = this.activeId
    if (!id || this.pendingCloseConfirmations.has(id)) return
    this.pendingCloseConfirmations.add(id)
    try {
      if (!(await confirm(running))) return
      if (this.sessions.get(id) !== terminal) return
      if (terminal.isBusy && (terminal.foreground ?? 'A process') !== running) return
      this.closeTerminal(id)
    } catch {
      logger.warn('Could not confirm closing the running terminal')
    } finally {
      this.pendingCloseConfirmations.delete(id)
    }
  }

  /**
   * Whether the terminal panel owns keyboard focus. Menu accelerators are
   * global, so Cmd-W has to know whether the user is looking at a terminal or
   * at something else in the window before deciding what to close.
   *
   * The claim is bound to the renderer that made it. A reload or a window close
   * never runs the renderer's cleanup, so without that binding the flag latched
   * true forever and Cmd-W destroyed an invisible shell.
   */
  setPanelFocused(focused: boolean, owner?: WebContents | null): void {
    if (!focused) {
      // Only the holder may release. Every renderer reports its own blur — a
      // second window switching away from its terminal, or tearing its panel
      // down, sends `false` from a WebContents that never held the claim. Left
      // ungated, that erased the live claim of the window the user was
      // actually typing in, and their next Cmd-W closed that window with its
      // shells still running. A release with no owner named is the shell's own
      // teardown (dispose), which may always release.
      if (owner && this.focusOwner && owner !== this.focusOwner) return
      this.releaseFocusOwner()
      return
    }
    this.releaseFocusOwner()
    // An unattributable claim is dropped rather than recorded: with no live
    // renderer behind it there is nothing that could ever release it.
    if (!owner || owner.isDestroyed()) return
    this.focusOwner = owner
    this.activeTerminalUserSelected = true
    const release = () => this.setPanelFocused(false, owner)
    const onNavigate = (details: { isMainFrame: boolean; isSameDocument: boolean }) => {
      // A same-document route change keeps the React tree that made the claim.
      if (details.isMainFrame && !details.isSameDocument) release()
    }
    owner.once('destroyed', release)
    owner.on('did-start-navigation', onNavigate)
    this.releaseFocusListeners = () => {
      if (owner.isDestroyed()) return
      owner.removeListener('destroyed', release)
      owner.removeListener('did-start-navigation', onNavigate)
    }
  }

  /** Records which app window is currently displaying this terminal resource. */
  setPanelVisible(visible: boolean, owner?: WebContents | null): void {
    if (!visible) {
      if (owner && this.visibleOwner && owner !== this.visibleOwner) return
      this.releaseVisibleOwner()
      return
    }
    this.releaseVisibleOwner()
    if (!owner || owner.isDestroyed()) return
    this.visibleOwner = owner
    const release = () => this.setPanelVisible(false, owner)
    const onNavigate = (details: { isMainFrame: boolean; isSameDocument: boolean }) => {
      if (details.isMainFrame && !details.isSameDocument) release()
    }
    owner.once('destroyed', release)
    owner.on('did-start-navigation', onNavigate)
    this.releaseVisibleListeners = () => {
      if (owner.isDestroyed()) return
      owner.removeListener('destroyed', release)
      owner.removeListener('did-start-navigation', onNavigate)
    }
  }

  /** Captures live renderer claims before the registry replaces this service. */
  getPanelOwners(): { focused: WebContents | null; visible: WebContents | null } {
    return {
      focused: this.focusOwner && !this.focusOwner.isDestroyed() ? this.focusOwner : null,
      visible: this.visibleOwner && !this.visibleOwner.isDestroyed() ? this.visibleOwner : null,
    }
  }

  /**
   * Whether this renderer owns the visible active terminal.
   *
   * IPC validates recent trusted input separately. Keeping ownership checks
   * beside terminal state prevents a stale renderer from targeting a hidden
   * tab or a terminal displayed by another window.
   */
  acceptsUserInput(owner: WebContents, terminalId: string): boolean {
    return (
      !owner.isDestroyed() &&
      this.focusOwner === owner &&
      this.visibleOwner === owner &&
      this.activeId === terminalId &&
      this.sessions.has(terminalId)
    )
  }

  /**
   * Whether one renderer may close a tab. The strip that lists shells sits
   * outside the terminal panel, so a renderer on the chat may close a shell
   * nobody is displaying; while a window does display the panel, only that
   * window may close, so a second window on the same chat cannot end a shell
   * someone is using.
   */
  acceptsUserClose(owner: WebContents, terminalId: string): boolean {
    if (owner.isDestroyed() || !this.sessions.has(terminalId)) return false
    const shown = this.visibleOwner && !this.visibleOwner.isDestroyed() ? this.visibleOwner : null
    return shown === null || shown === owner
  }

  /** Drops the claim and unsubscribes from the owner's lifecycle. */
  private releaseFocusOwner(): void {
    this.releaseFocusListeners?.()
    this.releaseFocusListeners = null
    this.focusOwner = null
  }

  private releaseVisibleOwner(): void {
    this.releaseVisibleListeners?.()
    this.releaseVisibleListeners = null
    this.visibleOwner = null
  }

  /**
   * Whether a global accelerator fired in the window that actually holds the
   * focused terminal panel. Without the window check a claim made in one window
   * answered Cmd-W in every other one.
   */
  private ownsInteraction(ownerWindow: BrowserWindow | null): boolean {
    if (!this.focusOwner || this.focusOwner.isDestroyed()) return false
    // Required, not optional, and null answers no. A window is what an
    // accelerator arrives from, so "no window" cannot be a window this claim
    // answers for — and making the parameter mandatory means a later caller
    // cannot reintroduce the cross-window bug just by leaving it off.
    if (!ownerWindow) return false
    // The panel lives in the window's own top-level renderer, so this is an
    // identity check on that renderer — and it keeps electron a type-only
    // import here, which is what lets the service be tested without a shell.
    return ownerWindow.webContents === this.focusOwner
  }

  private ownsVisiblePanel(ownerWindow: BrowserWindow | null): boolean {
    return Boolean(
      ownerWindow &&
        this.visibleOwner &&
        !this.visibleOwner.isDestroyed() &&
        ownerWindow.webContents === this.visibleOwner
    )
  }

  private rememberClosed(cwd: string | null): void {
    this.recentlyClosedCwds.unshift(cwd ?? '')
    if (this.recentlyClosedCwds.length > MAX_RECENTLY_CLOSED_TERMINALS) {
      this.recentlyClosedCwds.length = MAX_RECENTLY_CLOSED_TERMINALS
    }
  }

  /** A directory that still exists, else the usual starting point. */
  private resolveCwd(candidate: string | null): string {
    if (candidate) {
      try {
        if (statSync(candidate).isDirectory()) return candidate
      } catch {
        // Deleted while the shell was open; fall through.
      }
    }
    return this.startingCwd()
  }

  write(terminalId: string, data: string): void {
    this.sessions.get(terminalId)?.write(data)
  }

  resize(terminalId: string, cols: number, rows: number): void {
    this.sessions.get(terminalId)?.resize(cols, rows)
  }

  dispose(): void {
    this.disposing = true
    this.stopCwdWatch()
    // Remove each session before disposing it: dispose() emits state, which
    // reads back through getTabs(), and a session still in the map there is
    // published to the renderer as a live tab after its shell is gone.
    for (const [terminalId, session] of [...this.sessions]) {
      this.sessions.delete(terminalId)
      session.dispose()
    }
    this.sessions.clear()
    this.tmuxCache.clear()
    for (const handles of this.pendingRuns.values()) {
      for (const handle of handles) this.releaseRun(handle)
    }
    this.pendingRuns.clear()
    this.activeId = null
    this.agentActiveId = null
    this.activeTerminalUserSelected = false
    // A stale claim here is what let Cmd-W close a shell that no longer exists.
    this.setPanelFocused(false)
    this.setPanelVisible(false)
    this.disposing = false
  }

  async executeTool(
    toolCallId: string,
    operation: TerminalOperation,
    args: TerminalToolArgs
  ): Promise<TerminalToolResponse> {
    // A Stop can arrive before the command exists (while the shell or tmux is still being
    // resolved); the latch carries it to the moment the command would start.
    const halt = new AbortController()
    const latch: StopLatch = { signal: halt.signal, stopRunning: null }
    const stop = async () => {
      halt.abort()
      await latch.stopRunning?.()
    }
    this.toolStops.set(toolCallId, stop)
    try {
      const result = await this.dispatch(toolCallId, operation, args ?? {}, latch)
      return { ok: true, result }
    } catch (error) {
      if (error instanceof TerminalError) {
        logger.warn('Terminal operation refused', { toolCallId, operation, code: error.code })
        return { ok: false, error: error.message, code: error.code }
      }
      const message = (error as Error).message
      logger.error('Terminal operation failed', { toolCallId, operation, error: message })
      return { ok: false, error: message }
    } finally {
      if (this.toolStops.get(toolCallId) === stop) this.toolStops.delete(toolCallId)
    }
  }

  /**
   * Stops a tool call still in flight: interrupts the command a `run` started (escalating to its
   * process group if Ctrl-C does not end it) or ends a handoff. The call then returns its result
   * as usual. False when this service is not running that call.
   */
  async cancelTool(toolCallId: string): Promise<boolean> {
    const stop = this.toolStops.get(toolCallId)
    if (!stop) return false
    await stop()
    return true
  }

  /**
   * Stops every command the agent started that is still running, for sign-out: a plain shell's
   * agent command by its own process group, as Stop does, and every tmux run window still going.
   * A command the user started is not the agent's and is left alone.
   */
  async stopAgentCommands(): Promise<void> {
    const stops: Promise<void>[] = []
    for (const session of this.sessions.values()) {
      const toolCallId = session.agentCommandToolCallId
      if (toolCallId) stops.push(this.stopCommand(session, toolCallId))
      for (const handle of this.pendingRuns.get(session.terminalId) ?? []) {
        if (!isRunComplete(handle)) stops.push(stopRun(handle, session.env, STOP_ESCALATION_MS))
      }
    }
    for (const [handle, env] of this.orphanedRuns) {
      stops.push(stopRun(handle, env, STOP_ESCALATION_MS))
    }
    this.orphanedRuns.clear()
    await Promise.allSettled(stops)
  }

  /** Stops the command a plain shell's `run` handed back as still going, if it still is. */
  async stopAgentCommand(toolCallId: string): Promise<void> {
    await Promise.allSettled(
      [...this.sessions.values()].map((session) => this.stopCommand(session, toolCallId))
    )
  }

  /** Waits for the command a run started to end, up to `ms`. */
  private async commandEnds(
    session: TerminalSession,
    toolCallId: string,
    ms: number
  ): Promise<boolean> {
    const deadline = Date.now() + ms
    while (session.agentCommandToolCallId === toolCallId) {
      if (Date.now() >= deadline || !session.alive) {
        return session.agentCommandToolCallId !== toolCallId
      }
      await sleep(50)
    }
    return true
  }

  /**
   * Interrupts the command a run started. Escalation is bound to that command's own process
   * group, read while it still holds the foreground, and each signal is sent only while the same
   * call and the same group still hold it, so a command the user starts meanwhile is never hit.
   */
  private async stopCommand(session: TerminalSession, toolCallId: string): Promise<void> {
    if (session.agentCommandToolCallId !== toolCallId) return
    const groups = this.options.processGroups ?? OS_PROCESS_GROUPS
    const pgid = await groups.foreground(session.pid)
    if (session.agentCommandToolCallId !== toolCallId) return
    session.kill('SIGINT')
    for (const escalation of ['SIGTERM', 'SIGKILL'] as const) {
      if (await this.commandEnds(session, toolCallId, STOP_ESCALATION_MS)) return
      if (pgid === null || (await groups.foreground(session.pid)) !== pgid) return
      if (session.agentCommandToolCallId !== toolCallId) return
      logger.info('Stopped command ignored the previous signal; escalating', {
        toolCallId,
        signal: escalation,
      })
      groups.signal(pgid, escalation)
    }
  }

  private async dispatch(
    toolCallId: string,
    operation: TerminalOperation,
    args: TerminalToolArgs,
    latch: StopLatch
  ): Promise<unknown> {
    switch (operation) {
      case 'list':
        return this.getAgentTabs()
      case 'new':
        return this.openAgentTerminal(typeof args.cwd === 'string' ? args.cwd : undefined)
      case 'switch':
        return this.switchAgentTerminal(this.requireId(args))
      case 'close':
        // A named pane is a tmux thing and needs the session resolved below;
        // without one, close means the Sim terminal.
        if (typeof args.pane !== 'string' || !args.pane.trim()) {
          return this.closeAgentTerminal(this.requireId(args))
        }
        break
      default:
        break
    }

    const session = this.requireSession(args)
    // A tab either has tmux attached or it does not, and every operation below
    // behaves differently depending on which.
    const tmux = await this.resolveTmux(session)
    // A Stop that landed while the session resolved: nothing that changes the terminal starts.
    if (latch.signal.aborted && TERMINAL_CHANGING_OPERATIONS.has(operation)) {
      throw stoppedBeforeStart()
    }

    switch (operation) {
      case 'cwd':
        return {
          cwd: session.currentCwd,
          shellName: session.shell,
          home: homedir(),
          terminalId: session.terminalId,
        } satisfies TerminalCwdResult
      case 'close': {
        if (!tmux) {
          throw new TerminalError(
            'NO_TMUX',
            'That terminal is a plain shell, so it has no panes. Close the terminal itself by omitting `pane`.'
          )
        }
        const target = await this.resolvePane(tmux.session, args, session)
        if (latch.signal.aborted) throw stoppedBeforeStart()
        const killed = await killPane(target, session.env)
        if (!killed.ok) {
          throw new TerminalError(
            'NO_SUCH_PANE',
            killed.stderr.trim() || `tmux could not close pane ${target}.`
          )
        }
        return {
          closed: target,
          terminalId: session.terminalId,
          panes: await listPanes(tmux.session, session.env),
        }
      }
      case 'handoff':
        if (latch.signal.aborted) throw stoppedBeforeStart()
        latch.stopRunning = async () => this.finishHandoff(session.terminalId)
        return this.handoff(session, args)
      case 'panes': {
        if (!tmux) {
          throw new TerminalError(
            'NO_TMUX',
            'That terminal is a plain shell, not a tmux session, so it has no panes.'
          )
        }
        return {
          terminalId: session.terminalId,
          session: tmux.session,
          panes: await listPanes(tmux.session, session.env),
        } satisfies TerminalPanesResult
      }
      case 'run':
        return tmux
          ? this.runInTmux(toolCallId, session, tmux.session, args, latch)
          : this.run(toolCallId, session, args, latch)
      case 'read': {
        const requested = Number(args.lines)
        const lines = Number.isFinite(requested) && requested > 0 ? requested : 200
        if (!tmux) return await session.readScrollback(lines)
        const target = await this.resolvePane(tmux.session, args, session)
        const captured = await capturePane(target, lines, session.env)
        if (!captured.ok) {
          throw new TerminalError(
            'NO_SUCH_PANE',
            captured.stderr.trim() || `tmux could not read pane ${target}.`
          )
        }
        return {
          output: captured.stdout,
          cwd: session.currentCwd,
          terminalId: session.terminalId,
          pane: target,
          truncated: false,
          running: null,
        }
      }
      case 'input':
        return tmux
          ? this.inputToTmux(session, tmux.session, args, latch.signal)
          : this.inputToShell(session, args, latch.signal)
      case 'kill': {
        const signal =
          args.signal === 'SIGTERM' || args.signal === 'SIGKILL' || args.signal === 'SIGINT'
            ? args.signal
            : 'SIGINT'
        // Inside tmux a signal has to arrive as a keypress in the pane. Killing
        // the pty would take down the tmux client instead, detaching the user's
        // whole session rather than stopping the one thing they asked about.
        if (tmux) {
          const target = await this.resolvePane(tmux.session, args, session)
          if (latch.signal.aborted) throw stoppedBeforeStart()
          await sendKey(target, signal === 'SIGKILL' ? 'C-\\' : 'C-c', session.env)
          return { signal, terminalId: session.terminalId, pane: target }
        }
        session.kill(signal)
        return { signal, terminalId: session.terminalId }
      }
      default:
        throw new TerminalError('INVALID_REQUEST', `Unknown terminal operation: ${operation}`)
    }
  }

  /**
   * Gives the terminal to the user and waits for them.
   *
   * A command sitting on a prompt it cannot answer — a password, a decision
   * that is not the agent's to make — otherwise leaves the tool call spinning
   * with nothing on screen to explain why. This surfaces a chip in the chat
   * saying what is needed, and resolves when the command that was blocking
   * finishes, so the agent resumes knowing the outcome rather than guessing
   * whether the user got to it.
   */
  private async handoff(session: TerminalSession, args: TerminalToolArgs): Promise<unknown> {
    const reason = typeof args.reason === 'string' ? args.reason.trim() : ''
    const terminalId = session.terminalId
    this.handoffs.set(terminalId, false)

    const settled = async (handedBack: boolean): Promise<TerminalHandoffResult> => {
      const view = await session.readScrollback(INPUT_SCREEN_LINES)
      return {
        terminalId,
        reason,
        handedBack,
        running: session.foreground,
        output: view.output,
        cwd: session.currentCwd,
      }
    }

    try {
      const deadline = Date.now() + HANDOFF_MAX_MS
      let handedBackAt: number | null = null
      while (Date.now() < deadline) {
        await sleep(HANDOFF_POLL_MS)
        if (!session.alive) {
          throw new TerminalError('SESSION_CLOSED', 'That terminal was closed during the handoff.')
        }
        // The command finishing is the real end of the handoff, whether or not
        // the user pressed anything: it means the prompt got answered.
        if (!session.isBusy) return await settled(this.handoffs.get(terminalId) === true)
        if (this.handoffs.get(terminalId) === true) {
          handedBackAt ??= Date.now()
          if (Date.now() - handedBackAt >= HANDOFF_SETTLE_MS) return await settled(true)
        }
      }
      return await settled(this.handoffs.get(terminalId) === true)
    } finally {
      this.handoffs.delete(terminalId)
    }
  }

  /** The user pressing the hand-back button on a waiting handoff. */
  finishHandoff(terminalId: string): void {
    if (!this.handoffs.has(terminalId)) return
    this.handoffs.set(terminalId, true)
    if (terminalId === this.activeId && terminalId === this.agentActiveId) {
      this.activeTerminalUserSelected = false
    }
  }

  /**
   * The tmux session attached in a terminal, cached briefly.
   *
   * Resolving it spawns `tmux list-clients` and a whole-machine `ps` — a real
   * cost to pay on every tool call, when a shell's attachment does not change
   * between calls a second apart. A short TTL keeps the common burst of
   * operations (run, then poll with read, then read again) to one resolution,
   * while staying fresh enough to notice the user starting or leaving tmux.
   */
  private async resolveTmux(session: TerminalSession): Promise<TmuxAttachment | null> {
    if (isTmuxUnavailable()) return null
    const cached = this.tmuxCache.get(session.terminalId)
    if (cached && Date.now() - cached.at < TMUX_ATTACHMENT_TTL_MS) {
      return cached.attachment
    }
    const attachment = await resolveAttachment(session.pid, session.env)
    this.tmuxCache.set(session.terminalId, { at: Date.now(), attachment })
    return attachment
  }

  /** The pane a call names, or the session's active one. */
  private async resolvePane(
    session: string,
    args: TerminalToolArgs,
    terminal: TerminalSession
  ): Promise<string> {
    if (typeof args.pane === 'string' && args.pane.trim()) return args.pane.trim()
    const active = await activePane(session, terminal.env)
    if (!active) {
      throw new TerminalError('NO_SUCH_PANE', `tmux session "${session}" has no active pane.`)
    }
    return active
  }

  /**
   * Types into a tmux pane rather than the pty.
   *
   * Writing to the pty would reach whichever pane tmux happens to have focused
   * and would be invisible to any targeting the caller asked for; send-keys
   * addresses a pane directly. Unlike the plain-shell path this is allowed at
   * an idle prompt, because in tmux there is no foreground command to gate on
   * and typing a command into a pane is the normal way to drive one.
   */
  private async inputToTmux(
    terminal: TerminalSession,
    session: string,
    args: TerminalToolArgs,
    signal: AbortSignal
  ): Promise<unknown> {
    const target = await this.resolvePane(session, args, terminal)
    if (signal.aborted) throw stoppedBeforeStart()
    const keys = requestedKeys(args)
    if (keys.length > 0) {
      for (let index = 0; index < keys.length; index += 1) {
        // Paced like the pty path: a pane redraws between presses, so a batch
        // lands where the same keys pressed by hand would.
        if (index > 0) await sleep(TMUX_KEY_GAP_MS)
        if (signal.aborted) throw stoppedPartWay()
        await sendKey(target, TMUX_KEY_NAMES[keys[index]] ?? keys[index], terminal.env)
      }
    } else if (typeof args.text === 'string') {
      await sendText(target, args.text, terminal.env)
      // Enter is a separate send-keys for the same reason it is a separate pty
      // write: a program reading one chunk treats text plus a carriage return
      // as text, and the message sits unsubmitted.
      if (signal.aborted) throw stoppedPartWay()
      if (/[\r\n]$/.test(args.text)) await sendKey(target, 'Enter', terminal.env)
    } else {
      throw new TerminalError('INVALID_REQUEST', 'input needs `text`, `key`, or `keys`.')
    }

    await sleep(INPUT_ECHO_MS)
    const captured = await capturePane(target, INPUT_SCREEN_LINES, terminal.env)
    return {
      sent: keys.length > 0 ? keys.join(', ') : args.text,
      terminalId: terminal.terminalId,
      pane: target,
      output: captured.stdout,
    }
  }

  private async inputToShell(
    session: TerminalSession,
    args: TerminalToolArgs,
    signal: AbortSignal
  ): Promise<unknown> {
    // Input is only ever delivered to a program that already holds the
    // foreground. At a bare shell prompt these bytes would be a command
    // line, and running commands that way would bypass the capture and
    // status tracking that `run` provides.
    if (!session.isBusy) {
      throw new TerminalError(
        'INVALID_REQUEST',
        'Nothing is running in that terminal, so there is nothing to type into. Use the run operation to run a command.'
      )
    }
    // Every input returns the screen it produced. Reporting only "sent"
    // lets the model assume its message went through and start waiting on
    // a reply to text still sitting unsubmitted in a composer; the screen
    // is the evidence of what the program actually did with the input.
    if (signal.aborted) throw stoppedBeforeStart()
    const keys = requestedKeys(args)
    if (keys.length > 0) {
      await session.pressKeys(keys, signal)
      if (signal.aborted) throw stoppedPartWay()
      await sleep(INPUT_ECHO_MS)
      return { sent: keys.join(', '), ...(await session.readScrollback(INPUT_SCREEN_LINES)) }
    }
    if (typeof args.text === 'string') {
      await session.type(args.text, signal)
      if (signal.aborted) throw stoppedPartWay()
      await sleep(INPUT_ECHO_MS)
      return { sent: args.text, ...(await session.readScrollback(INPUT_SCREEN_LINES)) }
    }
    throw new TerminalError('INVALID_REQUEST', 'input needs `text`, `key`, or `keys`.')
  }

  /**
   * Runs a command inside a tmux session, in its own window.
   *
   * The user's panes are theirs; borrowing one would type over whatever they
   * are doing. A dedicated window is still visible to them — they can switch
   * to it and watch — while output and the exit status come back through
   * files, so the result is structured even though shell integration cannot
   * see through tmux.
   */
  private async runInTmux(
    toolCallId: string,
    terminal: TerminalSession,
    session: string,
    args: TerminalToolArgs,
    latch: StopLatch
  ): Promise<unknown> {
    const command = typeof args.command === 'string' ? args.command.trim() : ''
    if (!command) throw new TerminalError('INVALID_REQUEST', 'run needs a `command`.')
    if (latch.signal.aborted) throw stoppedBeforeStart()

    const started = Date.now()
    await this.reapFinishedRuns(terminal.terminalId, terminal.env)
    const ledger = this.options.runLedger
    const handle = await startRun(session, command, terminal.currentCwd, terminal.env, {
      ...(ledger
        ? {
            beforeStart: (run: RecordedRun) =>
              ledger.record({ ...run, callId: toolCallId, state: 'started' }),
          }
        : {}),
    })
    if ('error' in handle) throw new TerminalError('SPAWN_FAILED', handle.error)
    // Tracked from the moment its window exists, so sign-out can stop it even mid-wait.
    const pending = this.pendingRuns.get(terminal.terminalId)
    if (pending) pending.push(handle)
    else this.pendingRuns.set(terminal.terminalId, [handle])
    this.awaitedRuns.add(handle)

    const waitMs = resolveRunWaitMs(args.waitSeconds)
    // Inside tmux a stop arrives as Ctrl-C in the run's own window; closing that window hangs up
    // anything that ignored it. The wait ends with the stop, since a closed window never writes
    // the run's exit status.
    let endWait: () => void = () => {}
    const stopped = new Promise<void>((resolve) => {
      endWait = resolve
    })
    latch.stopRunning = async () => {
      await stopRun(handle, terminal.env, STOP_ESCALATION_MS)
      endWait()
    }
    // A Stop that landed while the run window opened applies now.
    if (latch.signal.aborted) void latch.stopRunning()
    const outcome = await Promise.race([
      awaitRun(handle, waitMs),
      // A stopped run's closed pane never writes its status. An untracked run is never stopped,
      // so it is still going unless its status says otherwise.
      stopped.then(() =>
        handle.runId === null ? pollRun(handle) : { ...pollRun(handle), done: true }
      ),
    ]).finally(() => {
      this.awaitedRuns.delete(handle)
      if (this.releasedAwaitedRuns.delete(handle)) handle.dispose()
    })
    if (outcome.done) {
      await closeRunPane(handle, terminal.env)
      this.untrackRun(terminal.terminalId, handle)
      this.forgetRun(handle)
      handle.dispose()
    }
    // Still going, it stays tracked, and nothing polls the status file again: `read` captures
    // the pane instead. Its record is marked handed back only once that result reaches the model;
    // see `TerminalRegistry.markRunDelivered`.

    const { text, truncated } = elideOutput(outcome.output)
    return {
      command,
      output: text,
      status: outcome.done ? 'completed' : 'running',
      exitCode: outcome.exitCode,
      durationMs: Date.now() - started,
      cwd: terminal.currentCwd,
      terminalId: terminal.terminalId,
      pane: handle.pane,
      truncated,
    }
  }

  private async run(
    toolCallId: string,
    session: TerminalSession,
    args: TerminalToolArgs,
    latch: StopLatch
  ): Promise<unknown> {
    const command = typeof args.command === 'string' ? args.command.trim() : ''
    if (!command) {
      throw new TerminalError('INVALID_REQUEST', 'run needs a `command`.')
    }
    if (!session.hasShellIntegration) {
      await this.awaitShellStartup(session, latch)
    }
    if (session.isBusy) {
      throw new TerminalError(
        'BUSY',
        `"${session.foreground}" is still running in that terminal. Poll it with the read operation, stop it with kill, or open another terminal with new.`
      )
    }

    if (latch.signal.aborted) throw stoppedBeforeStart()
    latch.stopRunning = () => this.stopCommand(session, toolCallId)
    return session.runCommand(command, toolCallId, resolveRunWaitMs(args.waitSeconds))
  }

  /** Waits for a shell's first prompt, refusing the run with what it is doing if none comes. */
  private async awaitShellStartup(session: TerminalSession, latch: StopLatch): Promise<void> {
    const readiness = await session.waitForShellIntegration(SHELL_STARTUP_BOUNDS, latch.signal)
    switch (readiness) {
      case 'ready':
        return
      case 'stopped':
        throw stoppedBeforeStart()
      case 'exited':
        throw new TerminalError('SESSION_CLOSED', 'The shell exited before it reached a prompt.')
      case 'starting': {
        const screen = (await session.readScrollback(STARTUP_SCREEN_LINES)).output.trim()
        throw new TerminalError(
          'NO_SHELL_INTEGRATION',
          `The shell has been running its startup files for over ${SHELL_STARTUP_BOUNDS.startingMs / 1000} s without reaching a prompt, so nothing was run. Its screen:\n${screen || '(empty)'}\nIf it is waiting for an answer, ask the user to answer it in that terminal (terminalId ${session.terminalId}), then run the command again.`
        )
      }
      case 'not-instrumented':
        throw new TerminalError(
          'NO_SHELL_INTEGRATION',
          'This shell did not load Sim shell integration, so command boundaries and exit codes cannot be determined. Ask the user to run the command themselves, or use a bash/zsh session.'
        )
    }
  }

  private spawn(
    cwd: string,
    cols: number,
    rows: number,
    options: { activateVisible: boolean; activateAgent: boolean }
  ): TerminalSession {
    if (this.sessions.size >= MAX_TERMINALS_PER_SCOPE) {
      throw new TerminalError(
        'RESOURCE_LIMIT',
        `A task can have at most ${MAX_TERMINALS_PER_SCOPE} live terminals.`
      )
    }
    if (this.options.canSpawn && !this.options.canSpawn()) {
      throw new TerminalError(
        'RESOURCE_LIMIT',
        'Sim can have at most 48 live terminals. Close a terminal before opening another.'
      )
    }
    const terminalId = String(this.nextId++)
    try {
      const session = TerminalSession.create({
        terminalId,
        cwd,
        cols,
        rows,
        callbacks: {
          onData: (id, data) => this.sink?.data(id, data),
          onState: () => {
            this.emitTabs()
          },
          onCommand: (event) => this.sink?.command(event),
          onExit: (id) => {
            // Not during shutdown: every shell is ending then, and replacing
            // the last one would spawn a shell as the app is closing.
            if (this.disposing) return
            this.retire(id)
          },
        },
      })
      this.sessions.set(terminalId, session)
      if (options.activateVisible || this.activeId === null) this.activeId = terminalId
      if (options.activateAgent || this.agentActiveId === null) this.agentActiveId = terminalId
      this.emitTabs()
      return session
    } catch (error) {
      throw new TerminalError('SPAWN_FAILED', (error as Error).message)
    }
  }

  /**
   * Resolves the terminal a tool call targets: the one it named, else the
   * active one. Starting a shell on demand keeps a tool call from depending on
   * the panel having finished mounting — the renderer opens the resource and
   * dispatches the tool in the same tick, so the panel's own `start` usually
   * lands after the tool arrives.
   */
  private requireSession(args: TerminalToolArgs): TerminalSession {
    const requested = typeof args.terminalId === 'string' ? args.terminalId : null
    if (requested) {
      const session = this.sessions.get(requested)
      if (!session?.alive) {
        throw new TerminalError('NO_SUCH_TERMINAL', unknownTerminal(requested))
      }
      return session
    }

    const active = this.agentActiveId ? this.sessions.get(this.agentActiveId) : null
    if (active?.alive) return active

    const spawned = this.spawn(this.startingCwd(), 80, 24, {
      activateVisible: this.activeId === null,
      activateAgent: true,
    })
    if (!spawned.alive) {
      throw new TerminalError('SPAWN_FAILED', 'Could not open a terminal on this machine.')
    }
    return spawned
  }

  private requireId(args: TerminalToolArgs): string {
    const terminalId = typeof args.terminalId === 'string' ? args.terminalId.trim() : ''
    if (!terminalId) {
      throw new TerminalError(
        'INVALID_REQUEST',
        'This operation needs a `terminalId` from the list operation.'
      )
    }
    return terminalId
  }

  /**
   * The remembered directory when it still exists, else home. A saved path can
   * disappear between launches (a branch checkout, a deleted clone), and
   * spawning into a missing cwd fails outright rather than degrading.
   */
  private startingCwd(): string {
    const remembered = this.options.loadCwd?.()
    if (remembered) {
      try {
        if (statSync(remembered).isDirectory()) return remembered
      } catch {
        // Gone since last launch; fall through to home.
      }
    }
    return homedir()
  }

  /**
   * Broadcasts the tab list only when it has actually changed.
   *
   * Session state is emitted on every shell-integration marker, and a shell
   * repaints its prompt on each resize — so a divider drag would otherwise
   * push a stream of identical tab lists at the renderer and re-render the
   * panel for nothing.
   */
  private emitTabs(): void {
    const tabs = this.getTabs()
    const serialized = JSON.stringify(tabs)
    if (serialized === this.lastEmittedTabs) return
    this.lastEmittedTabs = serialized
    this.sink?.tabs(tabs)
  }
}

function unknownTerminal(terminalId: string): string {
  return `No terminal with id ${terminalId}. Call terminal_list for the open ones.`
}
