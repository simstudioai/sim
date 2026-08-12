import { statSync } from 'node:fs'
import {
  describeRunningCommand,
  type TerminalCommandEvent,
  type TerminalOperation,
  type TerminalStartOptions,
  type TerminalTabsState,
  type TerminalToolArgs,
  type TerminalToolResponse,
} from '@sim/terminal-protocol'
import { type BrowserWindow, dialog, type WebContents } from 'electron'
import type { TerminalSessionSnapshot } from '@/main/desktop-chat-session-store'
import type { FocusedResourceShortcut } from '@/main/resource-shortcuts'
import { TerminalService, type TerminalServiceOptions, type TerminalSink } from '@/main/terminal'

/** Live terminal events tagged with the chat scope that owns their service. */
export interface ScopedTerminalSink {
  data(scope: string, terminalId: string, data: string): void
  tabs(scope: string, state: TerminalTabsState): void
  command(scope: string, event: TerminalCommandEvent): void
}

/** Creates the terminal service owned by one chat scope. */
export type TerminalServiceFactory = (
  scope: string,
  options: TerminalServiceOptions
) => TerminalService

export interface TerminalScopePersistence {
  load(scope: string): TerminalSessionSnapshot | undefined
  save(scope: string, snapshot: TerminalSessionSnapshot): boolean
  migrate(from: string, to: string): boolean
  disposeScope(scope: string): void
}

interface TerminalRegistryEntry {
  scope: string
  service: TerminalService
  persisted: TerminalSessionSnapshot | undefined
  restoreApplied: boolean
  restoring: boolean
}

function createTerminalService(_scope: string, options: TerminalServiceOptions): TerminalService {
  return new TerminalService(options)
}

/** Uses the normal shell fallback when a remembered checkout no longer exists. */
function restorableCwd(cwd: string): string | undefined {
  try {
    return statSync(cwd).isDirectory() ? cwd : undefined
  } catch {
    return undefined
  }
}

/**
 * Owns one independent terminal service per chat scope.
 *
 * Terminal ids only need to be unique inside their scope. Keeping the service
 * itself scoped isolates tab order, active selection, shell processes,
 * handoffs, focus, and recently closed state without adding a second identity
 * system inside {@link TerminalService}.
 */
export class TerminalRegistry {
  private readonly entries = new Map<string, TerminalRegistryEntry>()
  /**
   * Process-local tombstones for soft-deleted tasks. A stale renderer in
   * another window may still send start/write calls briefly; only the
   * explicit task activation path is allowed to resume a saved terminal set.
   */
  private readonly suspendedScopes = new Set<string>()
  private sink: ScopedTerminalSink | null = null

  constructor(
    private readonly persistence?: TerminalScopePersistence,
    private readonly serviceFactory: TerminalServiceFactory = createTerminalService
  ) {}

  setSink(sink: ScopedTerminalSink | null): void {
    this.sink = sink
    for (const entry of this.entries.values()) {
      this.bindSink(entry)
    }
  }

  getTabs(scope: string): TerminalTabsState {
    if (this.suspendedScopes.has(scope)) return { tabs: [], activeTerminalId: null }
    return this.serviceFor(scope).getTabs()
  }

  /** Reads an already-live group without allocating a service for a visited chat. */
  peekTabs(scope: string): TerminalTabsState {
    return this.entries.get(scope)?.service.getTabs() ?? { tabs: [], activeTerminalId: null }
  }

  /** Resumes a task only when its renderer explicitly opens that task. */
  activateScope(scope: string): TerminalTabsState {
    this.suspendedScopes.delete(scope)
    return this.peekTabs(scope)
  }

  start(scope: string, options: TerminalStartOptions): TerminalTabsState {
    if (this.suspendedScopes.has(scope)) return { tabs: [], activeTerminalId: null }
    const entry = this.entryFor(scope)
    return this.restoreOrStart(entry, options)
  }

  getScrollback(scope: string, terminalId: string): string {
    return this.serviceFor(scope).getScrollback(terminalId)
  }

  /** Clears only an existing live scope; a stale renderer must not create one. */
  clearScrollback(scope: string, terminalId: string): boolean {
    if (this.suspendedScopes.has(scope)) return false
    return this.entries.get(scope)?.service.clearScrollback(terminalId) ?? false
  }

  openTerminal(scope: string, cwd?: string): TerminalTabsState {
    return this.serviceFor(scope).openTerminal(cwd)
  }

  switchTerminal(scope: string, terminalId: string): TerminalTabsState {
    return this.serviceFor(scope).switchTerminal(terminalId)
  }

  reorderTerminal(scope: string, terminalId: string, targetIndex: number): TerminalTabsState {
    return this.serviceFor(scope).reorderTerminal(terminalId, targetIndex)
  }

  closeTerminal(scope: string, terminalId: string): TerminalTabsState {
    return this.serviceFor(scope).closeTerminal(terminalId)
  }

  write(scope: string, terminalId: string, data: string): void {
    if (this.suspendedScopes.has(scope)) return
    this.serviceFor(scope).write(terminalId, data)
  }

  resize(scope: string, terminalId: string, cols: number, rows: number): void {
    if (this.suspendedScopes.has(scope)) return
    this.serviceFor(scope).resize(terminalId, cols, rows)
  }

  finishHandoff(scope: string, terminalId: string): void {
    if (this.suspendedScopes.has(scope)) return
    this.serviceFor(scope).finishHandoff(terminalId)
  }

  executeTool(
    scope: string,
    toolCallId: string,
    operation: TerminalOperation,
    args: TerminalToolArgs
  ): Promise<TerminalToolResponse> {
    if (this.suspendedScopes.has(scope)) {
      return Promise.resolve({
        ok: false,
        code: 'SESSION_CLOSED',
        error: 'This task terminal is suspended until the task is reopened.',
      })
    }
    const entry = this.entryFor(scope)
    if (entry.persisted && !entry.restoreApplied) {
      this.restoreOrStart(entry, { cols: 80, rows: 24 })
    }
    return entry.service.executeTool(toolCallId, operation, args)
  }

  /**
   * Moves a provisional chat's live service to its durable chat id.
   *
   * A populated destination cannot be merged safely because both services may
   * own live processes with overlapping terminal ids. In that case neither
   * side is destroyed and the caller gets `false`.
   */
  migrateScope(from: string, to: string): boolean {
    if (from === to) return this.entries.has(from)
    const entry = this.entries.get(from)
    if (this.entries.has(to) || this.suspendedScopes.has(to)) return false
    if (this.persistence && !this.persistence.migrate(from, to)) return false
    if (!entry) {
      return true
    }

    this.entries.delete(from)
    entry.scope = to
    this.entries.set(to, entry)
    return true
  }

  /**
   * Records focus inside one scope and drops a stale claim from the same
   * renderer in any other scope.
   */
  setPanelFocused(scope: string, focused: boolean, owner?: WebContents | null): void {
    if (this.suspendedScopes.has(scope)) return
    if (focused && owner) {
      for (const entry of this.entries.values()) {
        if (entry.scope !== scope) entry.service.setPanelFocused(false, owner)
      }
    }
    this.serviceFor(scope).setPanelFocused(focused, owner)
  }

  /** Records the visible terminal scope without treating visibility as keyboard focus. */
  setPanelVisible(scope: string, visible: boolean, owner?: WebContents | null): void {
    if (this.suspendedScopes.has(scope)) return
    if (!visible && !this.entries.has(scope)) return
    if (visible && owner) {
      for (const entry of this.entries.values()) {
        if (entry.scope !== scope) entry.service.setPanelVisible(false, owner)
      }
    }
    this.serviceFor(scope).setPanelVisible(visible, owner)
  }

  /** Handles a menu accelerator, which has a window but no renderer chat scope. */
  handleFocusedShortcut(
    ownerWindow: BrowserWindow | null,
    shortcut: FocusedResourceShortcut
  ): boolean {
    for (const entry of this.entries.values()) {
      if (
        entry.service.handleFocusedShortcut(
          shortcut,
          ownerWindow,
          (command, terminalId) => {
            if (!ownerWindow || ownerWindow.webContents.isDestroyed()) return
            ownerWindow.webContents.send(
              'terminal:shortcut-command',
              command,
              entry.scope,
              terminalId
            )
          },
          (running) => {
            if (!ownerWindow || ownerWindow.isDestroyed()) return false
            return (
              dialog.showMessageBoxSync(ownerWindow, {
                type: 'warning',
                title: 'Close Running Terminal?',
                message: `${describeRunningCommand(running)} is still running.`,
                detail: 'Closing this terminal will stop the process.',
                buttons: ['Close Terminal', 'Cancel'],
                defaultId: 1,
                cancelId: 1,
                noLink: true,
              }) === 0
            )
          }
        )
      ) {
        return true
      }
    }
    return false
  }

  /** Abandons one provisional chat, including its shells and saved descriptor. */
  disposeScope(scope: string): void {
    this.suspendedScopes.delete(scope)
    const entry = this.entries.get(scope)
    if (entry) {
      this.entries.delete(scope)
      entry.service.setSink(null)
      entry.service.dispose()
    }
    this.persistence?.disposeScope(scope)
  }

  /**
   * Persists and stops one durable chat's live PTYs while retaining its saved
   * descriptor. A later start recreates fresh shells in the remembered cwd
   * order; process state and scrollback remain intentionally ephemeral.
   *
   * The persist is best-effort: suspension accompanies chat deletion, and a
   * descriptor that could not be saved must never leave the deleted chat's
   * shells running invisibly. A restore after a failed save falls back to the
   * last successfully saved descriptor, or a fresh shell.
   */
  suspendScope(scope: string): boolean {
    const entry = this.entries.get(scope)
    if (!entry) {
      this.suspendedScopes.add(scope)
      return true
    }
    try {
      this.persistEntry(entry)
    } catch {
      // Best-effort by design; teardown below must still run.
    }

    this.suspendedScopes.add(scope)
    this.entries.delete(scope)
    entry.service.setSink(null)
    entry.service.dispose()
    return true
  }

  /** Tears down every shell owned by every chat scope. */
  dispose(): void {
    const entries = [...this.entries.values()]
    this.entries.clear()
    this.suspendedScopes.clear()
    for (const entry of entries) {
      this.persistEntry(entry)
      entry.service.setSink(null)
      entry.service.dispose()
    }
  }

  private serviceFor(scope: string): TerminalService {
    return this.entryFor(scope).service
  }

  private entryFor(scope: string): TerminalRegistryEntry {
    if (this.suspendedScopes.has(scope)) {
      throw new Error('This task terminal is suspended until the task is reopened.')
    }
    const existing = this.entries.get(scope)
    if (existing) return existing

    const persisted = this.persistence?.load(scope)
    const rememberedCwd = persisted?.tabs[0]?.cwd
    const entry: TerminalRegistryEntry = {
      scope,
      service: this.serviceFactory(scope, {
        loadCwd: () => rememberedCwd,
      }),
      persisted,
      restoreApplied: false,
      restoring: false,
    }
    this.entries.set(scope, entry)
    this.bindSink(entry)
    return entry
  }

  /**
   * Recreates persisted tab descriptors as fresh shells. Process state,
   * scrollback, environment variables and foreground programs deliberately do
   * not pretend to survive an app restart.
   */
  private restoreOrStart(
    entry: TerminalRegistryEntry,
    options: TerminalStartOptions
  ): TerminalTabsState {
    if (entry.restoreApplied) return entry.service.start(options)

    entry.restoreApplied = true
    entry.restoring = true
    let tabs: TerminalTabsState
    try {
      entry.service.start(options)
      const persisted = entry.persisted
      if (persisted) {
        for (const tab of persisted.tabs.slice(1)) {
          entry.service.restoreTerminal(restorableCwd(tab.cwd))
        }
        const restored = entry.service.getTabs()
        const active = restored.tabs[persisted.activeIndex]
        if (active) entry.service.restoreActiveTerminal(active.terminalId)
      }
      tabs = entry.service.getTabs()
    } finally {
      entry.restoring = false
      entry.persisted = undefined
    }
    this.persistTabs(entry, tabs)
    return tabs
  }

  /**
   * The wrapper reads `entry.scope` at delivery time so scope migration
   * retags future events without replacing the service or its live shells.
   */
  private bindSink(entry: TerminalRegistryEntry): void {
    if (!this.sink) {
      entry.service.setSink(null)
      return
    }

    const sink: TerminalSink = {
      data: (terminalId, data) => this.sink?.data(entry.scope, terminalId, data),
      tabs: (state) => {
        this.persistTabs(entry, state)
        this.sink?.tabs(entry.scope, state)
      },
      command: (event) => this.sink?.command(entry.scope, event),
    }
    entry.service.setSink(sink)
  }

  private persistEntry(entry: TerminalRegistryEntry): boolean {
    return this.persistTabs(entry, entry.service.getTabs())
  }

  private persistTabs(entry: TerminalRegistryEntry, state: TerminalTabsState): boolean {
    if (entry.restoring || !this.persistence || state.tabs.length === 0) return true
    const tabs = state.tabs.flatMap((tab) =>
      typeof tab.cwd === 'string' && tab.cwd.length > 0 ? [{ cwd: tab.cwd }] : []
    )
    if (tabs.length === 0) return true
    const activeIndex = Math.max(
      0,
      state.tabs.findIndex((tab) => tab.terminalId === state.activeTerminalId)
    )
    return this.persistence.save(entry.scope, { v: 1, tabs, activeIndex })
  }
}
