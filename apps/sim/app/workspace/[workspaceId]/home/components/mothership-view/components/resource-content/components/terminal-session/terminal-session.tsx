'use client'

import {
  memo,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  type DesktopZoomAction,
  type DesktopZoomPercent,
  resolveDesktopZoom,
  type TerminalAppearanceTheme,
  type TerminalShortcutCommand,
  type TerminalThemeProfile,
} from '@sim/desktop-bridge'
import {
  cn,
  NATIVE_SURFACE_OCCLUSION_PREPARE_EVENT,
  TabStrip,
  type TabStripItem,
  type TabStripSelectionSource,
  toast,
} from '@sim/emcn'
import { TerminalWindow } from '@sim/emcn/icons'
import { createLogger } from '@sim/logger'
import { formatPasteLimit, PASTE_LIMITS } from '@sim/utils/paste'
import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import { type IBufferRange, Terminal } from '@xterm/xterm'
import { useTheme } from 'next-themes'
import { useContextMenu } from '@/hooks/use-context-menu'
import '@xterm/xterm/css/xterm.css'
import {
  describeRunningCommand,
  type TerminalTabState,
  type TerminalTabsState,
} from '@sim/terminal-protocol'
import { getDesktopBridge } from '@/lib/desktop'
import {
  loadDesktopTerminalAppearance,
  loadDesktopTerminalThemeProfiles,
  refreshSelectedTerminalProfile,
  resolveTerminalThemePalette,
  withSelectedProfile,
} from '@/lib/desktop/appearance'
import { trackPanelFocus } from '@/lib/desktop/panel-focus'
import { addMothershipContext } from '@/lib/mothership/events'
import { SIM_RESOURCE_DRAG_TYPE } from '@/lib/mothership/resource-types'
import { TERMINAL_SESSION_RESOURCE_ID } from '@/lib/mothership/resources/types'
import {
  clearTerminalScrollback,
  closeTerminal,
  getTerminalScrollback,
  onTerminalData,
  onTerminalDefaultZoomChanged,
  onTerminalShortcutCommand,
  openTerminal,
  pasteIntoTerminal,
  reorderTerminal,
  reportTerminalFocused,
  reportTerminalVisible,
  resizeTerminal,
  startTerminalSession,
  switchTerminal,
  writeToTerminal,
} from '@/lib/terminal/transport'
import { useMothershipResources } from '@/app/workspace/[workspaceId]/home/components/mothership-resources-context'
import { TerminalContextMenu } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-content/components/terminal-session/terminal-context-menu'
import { TerminalTabIcon } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-content/components/terminal-session/terminal-tab-icon'
import { ContextMenu } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/workflow-list/components/context-menu/context-menu'
import { useDesktopPreferenceMutation } from '@/hooks/use-desktop-preference-mutation'
import { useCopilotTerminalStore } from '@/stores/copilot-terminal/store'
import type { ChatContext, TerminalTextSelection } from '@/stores/panel'

const logger = createLogger('TerminalSession')
const EMPTY_TERMINAL_TABS: TerminalTabsState = { tabs: [], activeTerminalId: null }
const EMPTY_AGENT_COMMAND_TERMINAL_IDS: Record<string, string> = {}
const TERMINAL_BASE_FONT_SIZE = 12
const TERMINAL_ZOOM_BOUNDS = { min: 50, max: 300 } as const

/** Fits xterm to its current host while preserving the addon's method binding. */
function fitTerminal(addon: FitAddon): void {
  const fitToHost = addon.fit.bind(addon)
  fitToHost()
}

/**
 * Radix keeps closed menus mounted for their exit animation. A full-screen
 * effect starts in a layout effect, so hide the active menu hierarchy in the
 * DOM before React begins its normal close lifecycle; otherwise its popover
 * z-index leaves the fading menu floating above the effect.
 */
function hideMountedMenuSurfaces(): void {
  for (const menu of document.querySelectorAll<HTMLElement>(
    '[data-native-surface-overlay][role="menu"]'
  )) {
    menu.style.setProperty('visibility', 'hidden', 'important')
  }
}

/**
 * How long a command must run before the tab names it.
 *
 * A tab that says what it is busy with is useful for a build you left running
 * in the background, and pure noise for `ls` — swapping the label and spinning
 * the icon for thirty milliseconds reads as a glitch. Waiting a beat keeps the
 * signal and drops the flicker.
 */
const COMMAND_SETTLE_MS = 1_000

/** Full working directory, plus a concise name for whatever the shell is running. */
export function terminalTooltip(tab: TerminalTabState): string {
  const where = tab.cwd ?? 'Terminal'
  return tab.running ? `${where} — ${describeRunningCommand(tab.running)}` : where
}

function sameIds(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every((id) => b.has(id))
}

/**
 * Whether a tab should be named after what it is running rather than where it
 * is. A full-screen program is named the moment it appears: the delay exists
 * to stop `ls` flickering the label, and an editor or coding agent is not a
 * transient command — it holds the terminal until it is quit, so there is
 * nothing to wait out.
 */
function namesItsCommand(tab: TerminalTabState, settled: ReadonlySet<string>): boolean {
  return Boolean(tab.running) && (tab.interactive || settled.has(tab.terminalId))
}

/**
 * The terminals whose command has been running long enough to show. Returns a
 * stable set, so a tab strip that would render identically does not re-render.
 */
function useSettledCommands(tabs: TerminalTabState[]): ReadonlySet<string> {
  const [settled, setSettled] = useState<ReadonlySet<string>>(() => new Set())
  const startedAt = useRef(new Map<string, number>())

  useEffect(() => {
    const started = startedAt.current
    const live = new Set(tabs.map((tab) => tab.terminalId))
    for (const id of [...started.keys()]) {
      if (!live.has(id)) started.delete(id)
    }
    for (const tab of tabs) {
      if (!tab.running) started.delete(tab.terminalId)
      else if (!started.has(tab.terminalId)) started.set(tab.terminalId, Date.now())
    }

    const recompute = () => {
      const now = Date.now()
      const next = new Set<string>()
      let soonest = Number.POSITIVE_INFINITY
      for (const [id, at] of started) {
        const elapsed = now - at
        if (elapsed >= COMMAND_SETTLE_MS) next.add(id)
        else soonest = Math.min(soonest, COMMAND_SETTLE_MS - elapsed)
      }
      setSettled((current) => (sameIds(current, next) ? current : next))
      return soonest
    }

    const soonest = recompute()
    if (!Number.isFinite(soonest)) return
    const timer = setTimeout(recompute, Math.max(0, soonest))
    return () => clearTimeout(timer)
  }, [tabs])

  return settled
}

/**
 * How long the panel must stop changing size before the PTY is told about it.
 * Long enough to cover a divider drag, short enough that a deliberate resize
 * still feels immediate.
 */
const RESIZE_SETTLE_MS = 120

/**
 * How much output an offscreen terminal banks before it gives up and asks the
 * desktop app for the screen again on the way back in.
 *
 * Matched to the scrollback the desktop app retains: past that, replaying the
 * bank costs more than the snapshot and cannot show anything the snapshot
 * would not.
 */
const MAX_BANKED_CHARS = 256_000

/**
 * Loads the WebGL renderer and drops it if its context dies.
 *
 * WebGL is a large win on heavy output, but the context can be lost long after
 * it loads: a GPU process restart, a driver hiccup, the window moving between
 * GPUs, or simply too many live contexts — each terminal tab holds its own and
 * the browser silently drops the oldest past its limit. An addon left loaded
 * after that keeps painting a dead surface while the buffer moves on, which is
 * what makes rows freeze or tear mid-scroll. Disposing falls back to xterm's
 * DOM renderer: slower, but it cannot go stale.
 *
 * There is deliberately no canvas tier in between. `@xterm/addon-canvas` has
 * had no release since 2024 and none at all for xterm 6, while core xterm and
 * this addon ship in lockstep; adopting it would mean moving the core library
 * back a major version onto a renderer that is no longer published.
 */
function attachWebglRenderer(terminal: Terminal): (() => void) | null {
  try {
    const webgl = new WebglAddon()
    webgl.onContextLoss(() => {
      logger.warn('Terminal WebGL context lost; falling back to the DOM renderer')
      webgl.dispose()
    })
    terminal.loadAddon(webgl)
    return () => webgl.dispose()
  } catch (error) {
    // The DOM renderer stays in place. Logged rather than swallowed: it is a
    // large, silent performance cliff, and "the terminal feels slow" is
    // otherwise indistinguishable from every other cause of slowness.
    logger.warn('Terminal WebGL unavailable; using the slower DOM renderer', {
      error: (error as Error).message,
    })
    return null
  }
}

/**
 * One terminal's xterm instance.
 *
 * Every open terminal stays mounted, including the ones behind other tabs, so
 * switching is instant and scrollback is never rebuilt. Only the active one is
 * visible, and only it is measured — `fit()` against a hidden element reads a
 * zero-sized box and would resize the PTY to nonsense.
 */
/** Handles terminal-local shortcuts not owned by the application menu. */
function handleTerminalLocalShortcut(event: KeyboardEvent, clear: () => void): boolean {
  const mac = /Mac|iPhone|iPad|iPod/i.test(navigator.platform)
  const primary = event.metaKey || (!mac && event.ctrlKey && !event.altKey)
  if (
    event.type !== 'keydown' ||
    event.repeat ||
    event.isComposing ||
    !primary ||
    event.shiftKey ||
    event.altKey
  ) {
    return true
  }
  if (event.key.toLowerCase() !== 'k') return true
  clear()
  return false
}

/** Scales xterm's 12px actual size without constraining shortcut-created rungs. */
export function terminalFontSizeForZoom(zoom: number): number {
  return (TERMINAL_BASE_FONT_SIZE * zoom) / 100
}

export type TerminalSelectionSnapshot = TerminalTextSelection

/**
 * Turns xterm's selection into the snapshot stored on a terminal chat chip.
 *
 * Despite the public typings describing these cells as one-based, xterm 6's
 * implementation exposes its normalized, zero-based buffer coordinates here.
 * The end cell is exclusive, so a selection ending at column zero of a later
 * row contains characters only through the preceding row.
 */
export function terminalSelectionSnapshot(
  text: string,
  position: IBufferRange | undefined
): TerminalSelectionSnapshot | null {
  if (!text || !position) return null

  const startLine = position.start.y + 1
  const endLine =
    position.end.y > position.start.y && position.end.x === 0 ? position.end.y : position.end.y + 1

  return { text, startLine, endLine: Math.max(startLine, endLine) }
}

/** Human-readable chip label for the selected terminal buffer rows. */
export function terminalSelectionLabel(selection: TerminalSelectionSnapshot): string {
  return selection.startLine === selection.endLine
    ? `Terminal (L${selection.startLine})`
    : `Terminal (L${selection.startLine}-${selection.endLine})`
}

function zoomActionForTerminalCommand(command: TerminalShortcutCommand): DesktopZoomAction | null {
  switch (command) {
    case 'zoom-in':
      return 'in'
    case 'zoom-out':
      return 'out'
    case 'zoom-reset':
      return 'reset'
    default:
      return null
  }
}

const TerminalView = memo(function TerminalView({
  terminalId,
  running,
  active,
  visible,
  scopeId,
  appearanceTheme,
  profiles,
  onAppearanceThemeChange,
  appearanceThemePending,
  defaultZoom,
  focusRequest,
}: {
  terminalId: string
  running: string | null
  active: boolean
  visible: boolean
  scopeId: string
  appearanceTheme: TerminalAppearanceTheme
  profiles: TerminalThemeProfile[]
  onAppearanceThemeChange?: (theme: TerminalAppearanceTheme) => void
  appearanceThemePending?: boolean
  defaultZoom: DesktopZoomPercent
  focusRequest: number
}) {
  const { resolvedTheme } = useTheme()
  const terminalTheme = resolveTerminalThemePalette(appearanceTheme, resolvedTheme)
  const hostRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const [currentZoom, setCurrentZoom] = useState<number>(defaultZoom)
  // Being the selected tab is not enough to be on screen: the whole panel is
  // hidden whenever another resource is open.
  const onscreen = active && visible
  const onscreenRef = useRef(onscreen)
  onscreenRef.current = onscreen
  const showRef = useRef<(() => void) | null>(null)
  const hideRef = useRef<(() => void) | null>(null)

  const clearVisibleScreen = useCallback(() => {
    terminalRef.current?.clear()
    terminalRef.current?.focus()
  }, [])

  const clearScreen = useCallback(() => {
    void clearTerminalScrollback(terminalId, scopeId)
    clearVisibleScreen()
  }, [clearVisibleScreen, scopeId, terminalId])

  const applyZoom = useCallback(
    (action: DesktopZoomAction) => {
      setCurrentZoom((current) =>
        resolveDesktopZoom(current, action, defaultZoom, TERMINAL_ZOOM_BOUNDS)
      )
    },
    [defaultZoom]
  )

  const shortcutHandlerRef = useRef<(command: TerminalShortcutCommand) => void>(() => {})
  shortcutHandlerRef.current = (command) => {
    if (command === 'clear') {
      // The application-menu route already cleared the desktop-owned replay
      // buffer before emitting this renderer command.
      clearVisibleScreen()
      return
    }
    const action = zoomActionForTerminalCommand(command)
    if (action) applyZoom(action)
  }

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    let disposed = false
    const terminal = new Terminal({
      allowProposedApi: true,
      cursorBlink: true,
      fontSize: terminalFontSizeForZoom(currentZoom),
      fontFamily:
        'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
      lineHeight: 1.35,
      scrollback: 10_000,
      theme: terminalTheme,
    })
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.loadAddon(new WebLinksAddon())
    const unicode = new Unicode11Addon()
    terminal.loadAddon(unicode)
    terminal.unicode.activeVersion = '11'

    terminal.open(host)

    terminalRef.current = terminal
    fitRef.current = fitAddon
    terminal.attachCustomKeyEventHandler((event) => handleTerminalLocalShortcut(event, clearScreen))

    const disposeData = terminal.onData((data) => writeToTerminal(terminalId, data, scopeId))
    const disposeResize = terminal.onResize(({ cols, rows }) =>
      resizeTerminal(terminalId, cols, rows, scopeId)
    )
    // Output is only parsed into a terminal that is on screen.
    //
    // `write` parses whether or not the view is painting, and parsing is the
    // expensive half — pausing the renderer for a hidden tab saved the drawing
    // and none of the decoding. So every open terminal was decoding its
    // shell's output at full rate behind whatever the user was actually
    // looking at, and the cost grew with the number of tabs rather than with
    // the one in front of them. An offscreen view banks its bytes and replays
    // them on the way back in, which is indistinguishable on screen.
    //
    // Bytes are banked during the opening snapshot too. The desktop app owns
    // the scrollback, so a view opening onto a shell that has been running
    // without it paints from what is already on that screen — but the snapshot
    // is a moment in time, and anything arriving while it is in flight would
    // either be wiped by the reset or, written first, appear above the history
    // it followed. Banking keeps the order true.
    let writable = false
    let banked = ''
    let overflowed = false
    let painted = false

    const unsubscribeData = onTerminalData(
      terminalId,
      (data) => {
        if (writable) {
          terminal.write(data)
          return
        }
        if (overflowed) return
        banked += data
        if (banked.length > MAX_BANKED_CHARS) {
          banked = ''
          overflowed = true
        }
      },
      scopeId
    )

    // Guarded because a snapshot is a round trip to the desktop app, and a tab
    // switched away from and back to during one would otherwise start a second
    // that resets and repaints over the first.
    let repainting = false
    const repaint = () => {
      if (repainting) return
      repainting = true
      return getTerminalScrollback(terminalId, scopeId)
        .catch((error: Error) => {
          // Logged rather than swallowed: a failure here is indistinguishable
          // on screen from a shell that has printed nothing, so the panel comes
          // up blank over a live terminal with no clue why. The usual cause is
          // a desktop build older than this renderer, which has no scrollback
          // channel to answer with.
          logger.warn('Could not read terminal scrollback; the panel will start empty', {
            terminalId,
            error: error.message,
          })
          return ''
        })
        .then((scrollback) => {
          repainting = false
          if (disposed) return
          terminal.reset()
          if (scrollback) terminal.write(scrollback)
          if (banked) terminal.write(banked)
          banked = ''
          overflowed = false
          painted = true
          // Only now: bytes that landed mid-snapshot are in the bank, and
          // writing them straight through would have put them out of order.
          // Read live rather than assumed — the tab may have been switched
          // away from while this was in flight.
          writable = onscreenRef.current
        })
    }

    const show = () => {
      if (writable || disposed) return
      if (!painted || overflowed) {
        void repaint()
        return
      }
      if (banked) terminal.write(banked)
      banked = ''
      writable = true
    }

    const hide = () => {
      writable = false
    }

    showRef.current = show
    hideRef.current = hide

    // Resizing is debounced, and deliberately not applied to hidden tabs.
    //
    // Every distinct column count reaches the shell as a SIGWINCH and makes it
    // repaint its prompt. Dragging the panel divider produces a new width each
    // frame, so fitting on every observation walks the shell through dozens of
    // widths — which is the flickering, scrolling, newline-spewing mess. Only
    // the size the drag settles on is worth telling the PTY about.
    //
    // Hidden tabs are skipped because they measure 0x0, and fitting that would
    // resize their PTY to nonsense. They refit on activation.
    let resizeTimer: ReturnType<typeof setTimeout> | null = null
    const observer = new ResizeObserver(() => {
      if (resizeTimer) clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => {
        resizeTimer = null
        // A zero-sized host means this terminal is off screen — either behind
        // another tab or with the whole panel hidden behind another resource —
        // not that it shrank. Fitting to that would resize the pty to nonsense.
        if (!onscreenRef.current || host.clientWidth <= 0 || host.clientHeight <= 0) return
        try {
          fitTerminal(fitAddon)
        } catch {
          // Zero-sized while animating; the next observation refits.
        }
      }, RESIZE_SETTLE_MS)
    })
    observer.observe(host)

    return () => {
      disposed = true
      showRef.current = null
      hideRef.current = null
      if (resizeTimer) clearTimeout(resizeTimer)
      observer.disconnect()
      unsubscribeData()
      disposeData.dispose()
      disposeResize.dispose()
      terminal.dispose()
      terminalRef.current = null
      fitRef.current = null
    }
    // Theme is applied by the effect below so the terminal is never torn down
    // (and its buffer never lost) for a repaint.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminalId, scopeId])

  // Runs after the effect above, which is what installs these.
  useEffect(() => {
    if (onscreen) showRef.current?.()
    else hideRef.current?.()
  }, [onscreen, terminalId])

  useEffect(() => {
    const terminal = terminalRef.current
    if (!terminal) return
    terminal.options.theme = terminalTheme
  }, [terminalTheme])

  useEffect(() => {
    setCurrentZoom(defaultZoom)
  }, [defaultZoom])

  useEffect(() => {
    const terminal = terminalRef.current
    const host = hostRef.current
    if (!terminal || !host) return
    terminal.options.fontSize = terminalFontSizeForZoom(currentZoom)
    if (!onscreen) return
    const frame = requestAnimationFrame(() => {
      if (host.clientWidth <= 0 || host.clientHeight <= 0) return
      try {
        const fitAddon = fitRef.current
        if (fitAddon) fitTerminal(fitAddon)
      } catch {
        // Panel still animating; the ResizeObserver refits.
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [currentZoom, onscreen])

  useEffect(() => {
    if (!onscreen || focusRequest === 0) return
    const frame = requestAnimationFrame(() => terminalRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [focusRequest, onscreen])

  useEffect(() => {
    if (!onscreen) return
    return onTerminalShortcutCommand(
      (command) => {
        shortcutHandlerRef.current(command)
      },
      scopeId,
      terminalId
    )
  }, [onscreen, scopeId, terminalId])

  // A GPU renderer only for the terminal on screen.
  //
  // Every open terminal keeps its emulator alive so switching is instant, but
  // a hidden one is `display: none` and xterm has already paused painting it —
  // a WebGL context for it buys nothing and costs plenty. Browsers cap how
  // many contexts can be live and evict the oldest past that, so holding one
  // per tab means tabs quietly knocking each other's renderers out and falling
  // back to the DOM. Handing the renderer to whichever tab is visible keeps
  // one context for the whole panel.
  useEffect(() => {
    if (!onscreen) return
    const terminal = terminalRef.current
    if (!terminal) return
    const disposeRenderer = attachWebglRenderer(terminal)
    return () => disposeRenderer?.()
  }, [onscreen])

  const {
    isOpen: isMenuOpen,
    position: menuPosition,
    menuRef,
    handleContextMenu,
    closeMenu,
  } = useContextMenu()

  // Renderer-owned xterm is naturally blurred/tinted by the real modal
  // backdrop. Its portaled context menu sits above that backdrop, though, so
  // dismiss it during the same pre-paint handshake instead of letting terminal
  // chrome float over a newly opened full-screen modal.
  useEffect(() => {
    if (!onscreen) return
    const handlePrepare = () => {
      if (isMenuOpen || menuRef.current) hideMountedMenuSurfaces()
      if (isMenuOpen) closeMenu()
    }
    window.addEventListener(NATIVE_SURFACE_OCCLUSION_PREPARE_EVENT, handlePrepare)
    return () => window.removeEventListener(NATIVE_SURFACE_OCCLUSION_PREPARE_EVENT, handlePrepare)
  }, [closeMenu, isMenuOpen, onscreen])
  // Snapshot at open time: opening the dropdown moves focus away from xterm,
  // but Add to chat must keep the exact text and rows the user right-clicked.
  const [selectionSnapshot, setSelectionSnapshot] = useState<TerminalSelectionSnapshot | null>(null)

  const openMenu = useCallback(
    (event: React.MouseEvent) => {
      const terminal = terminalRef.current
      setSelectionSnapshot(
        terminalSelectionSnapshot(terminal?.getSelection() ?? '', terminal?.getSelectionPosition())
      )
      // Suppresses Electron's native editable-field menu, which would
      // otherwise target xterm's offscreen input textarea.
      handleContextMenu(event)
    },
    [handleContextMenu]
  )

  const copySelection = useCallback(() => {
    if (selectionSnapshot) void navigator.clipboard.writeText(selectionSnapshot.text)
  }, [selectionSnapshot])

  const addSelectionToChat = useCallback(() => {
    if (!selectionSnapshot) return
    const context: ChatContext = {
      kind: 'terminal_tab',
      terminalId,
      label: terminalSelectionLabel(selectionSnapshot),
      selection: selectionSnapshot,
    }
    addMothershipContext(context)
  }, [selectionSnapshot, terminalId])

  const pasteClipboard = () => {
    void (async () => {
      reportTerminalFocused(true, scopeId)
      const result = await pasteIntoTerminal(terminalId, scopeId)
      if (result === true) {
        terminalRef.current?.focus()
        return
      }
      if (result === 'too-large') {
        toast.warning('Paste is too large for the terminal', {
          description: `Paste up to ${formatPasteLimit(PASTE_LIMITS.TERMINAL_BYTES)} at once, or send the content through a file.`,
        })
        return
      }
      toast.error('Could not paste from the clipboard. Press ⌘V to paste.')
    })()
  }

  const newTab = useCallback(() => {
    void openTerminal(undefined, scopeId).catch(() => {
      toast.error('Could not open a new terminal. Please try again.')
    })
  }, [scopeId])

  // Scoped to the terminal that was right-clicked, not the active one.
  // Offered even for the only terminal: closing the last one restarts its
  // shell in place rather than removing the tab, so there is always something
  // for the action to do — and hiding it here while the tab strip's own close
  // stays available would just be the two menus disagreeing.
  const closeThisTerminal = useCallback(() => {
    if (
      running &&
      !window.confirm(
        `${describeRunningCommand(running)} is still running. Close this terminal and stop it?`
      )
    ) {
      return
    }
    void closeTerminal(terminalId, scopeId).catch(() => {
      toast.error('Could not close that terminal. Please try again.')
    })
  }, [running, terminalId, scopeId])

  // An inactive tab is `display: none`, not merely invisible. xterm watches its
  // element with an IntersectionObserver and pauses rendering once it stops
  // intersecting — which `visibility: hidden` never does, since it still
  // occupies its box. Left that way, every background terminal keeps painting
  // output nobody is looking at, out of the active terminal's frame budget.
  // xterm re-measures and does a full refresh when the element comes back.
  return (
    <>
      <div
        ref={hostRef}
        data-paste-max-bytes={PASTE_LIMITS.TERMINAL_BYTES}
        onPointerDown={() => terminalRef.current?.focus()}
        onContextMenu={openMenu}
        className={cn('absolute inset-0 pt-[7px] pr-2 pb-1 pl-1.5', !active && 'hidden')}
        style={{ backgroundColor: terminalTheme.background }}
      />
      <TerminalContextMenu
        isOpen={isMenuOpen}
        position={menuPosition}
        menuRef={menuRef}
        onClose={closeMenu}
        hasSelection={selectionSnapshot !== null}
        onAddToChat={selectionSnapshot ? addSelectionToChat : undefined}
        onCopy={copySelection}
        onPaste={pasteClipboard}
        onClear={clearScreen}
        onZoomIn={() => applyZoom('in')}
        onZoomOut={() => applyZoom('out')}
        onActualSize={() => applyZoom('reset')}
        appearanceTheme={appearanceTheme}
        profiles={profiles}
        onAppearanceThemeChange={onAppearanceThemeChange}
        appearanceThemePending={appearanceThemePending}
        onNewTab={newTab}
        onCloseTerminal={closeThisTerminal}
      />
    </>
  )
})

/**
 * The terminal panel. Unlike the browser panel, nothing native is overlaid
 * here: xterm.js renders each PTY's bytes in the DOM, so the panel is an
 * ordinary React subtree that happens to be a set of working terminals.
 */
interface TerminalSessionProps {
  visible: boolean
  scopeId: string
}

/** Administrative suspension retains the resource even though live PTYs are gone. */
export function shouldRemoveTerminalResource(
  tabCount: number,
  hasStarted: boolean,
  suspended: boolean
): boolean {
  return !suspended && tabCount === 0 && hasStarted
}

export function TerminalSession({ visible, scopeId }: TerminalSessionProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [appearanceTheme, setAppearanceTheme] = useState<TerminalAppearanceTheme>('app')
  const [profiles, setProfiles] = useState<TerminalThemeProfile[]>([])
  const [defaultZoom, setDefaultZoom] = useState<DesktopZoomPercent>(100)
  // Scope activation happens after a navigation commits. Selecting this
  // panel's bucket directly avoids briefly rendering the previous chat's
  // terminal ids and then sending user actions for them under the new scope.
  const tabsState = useCopilotTerminalStore(
    (state) => state.sessions[scopeId]?.tabs ?? EMPTY_TERMINAL_TABS
  )
  const suspended = useCopilotTerminalStore((state) => state.sessions[scopeId]?.suspended ?? false)
  const agentCommandTerminalIds = useCopilotTerminalStore(
    (state) => state.sessions[scopeId]?.agentCommandTerminalIds ?? EMPTY_AGENT_COMMAND_TERMINAL_IDS
  )
  const activityResetEpoch = useCopilotTerminalStore(
    (state) => state.sessions[scopeId]?.activityResetEpoch ?? 0
  )
  const { tabs, activeTerminalId } = tabsState
  const agentCommandTargets = useMemo(
    () => new Set(Object.values(agentCommandTerminalIds)),
    [agentCommandTerminalIds]
  )
  const settledCommands = useSettledCommands(tabs)
  const { removeResource } = useMothershipResources()
  const [startError, setStartError] = useState<string | null>(null)
  const [focusRequest, setFocusRequest] = useState({ terminalId: '', nonce: 0 })
  const availableProfiles = useMemo(
    () => withSelectedProfile(profiles, appearanceTheme),
    [appearanceTheme, profiles]
  )

  useEffect(() => {
    if (!visible) return
    let active = true
    void Promise.all([loadDesktopTerminalAppearance(), loadDesktopTerminalThemeProfiles()]).then(
      ([nextAppearance, nextProfiles]) => {
        if (!active) return
        setProfiles(nextProfiles)
        setAppearanceTheme(refreshSelectedTerminalProfile(nextProfiles, nextAppearance.theme))
        setDefaultZoom(nextAppearance.defaultZoom)
      }
    )
    return () => {
      active = false
    }
  }, [visible])

  useEffect(() => {
    let active = true
    const unsubscribe = onTerminalDefaultZoomChanged((zoom) => {
      if (active) setDefaultZoom(zoom)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  const { pending: appearanceThemePending, mutate: setTerminalAppearanceTheme } =
    useDesktopPreferenceMutation(
      (bridge, theme: TerminalAppearanceTheme) =>
        typeof theme === 'string'
          ? bridge.settings.setTerminalTheme(theme)
          : (bridge.terminalThemes?.selectProfile(theme.id) ?? Promise.resolve(undefined)),
      'Could not update terminal appearance',
      (preferences) => setAppearanceTheme(preferences.terminalTheme)
    )
  // Stable so the memoized TerminalView can bail out; recomputing the bridge
  // check per render would hand every terminal a fresh closure.
  const hasDesktopBridge = Boolean(getDesktopBridge())
  const handleAppearanceThemeChange = useCallback(
    (theme: TerminalAppearanceTheme) => void setTerminalAppearanceTheme(theme),
    [setTerminalAppearanceTheme]
  )

  useEffect(() => {
    if (!visible || suspended) return
    const panel = panelRef.current
    if (!panel) return
    return trackPanelFocus(panel, (focused) => reportTerminalFocused(focused, scopeId))
  }, [visible, suspended, scopeId])

  useEffect(() => {
    reportTerminalVisible(visible && !suspended, scopeId)
    return () => reportTerminalVisible(false, scopeId)
  }, [scopeId, suspended, visible])

  useEffect(() => {
    if (suspended) {
      setStartError(null)
      return
    }
    let active = true
    startTerminalSession({ cols: 80, rows: 24 }, scopeId)
      .then(() => {
        if (active) setStartError(null)
      })
      .catch((error: Error) => {
        if (active) setStartError(error.message)
      })
    return () => {
      active = false
    }
  }, [scopeId, suspended])

  // Closing the last terminal closes the panel: there is nothing left to show
  // and no way back from inside it.
  const hasStarted = useRef(false)
  useEffect(() => {
    if (suspended) {
      hasStarted.current = false
      return
    }
    if (tabs.length > 0) {
      hasStarted.current = true
      return
    }
    if (shouldRemoveTerminalResource(tabs.length, hasStarted.current, suspended)) {
      hasStarted.current = false
      removeResource('terminal', TERMINAL_SESSION_RESOURCE_ID)
    }
  }, [tabs.length, suspended, removeResource])

  // Shell process state is not activity state: a coding tool can run for hours.
  // The agent-command lifecycle is precise, though, so the targeted terminal
  // replaces its regular glyph while Mothership is actively driving it.
  const items = useMemo<TabStripItem[]>(() => {
    const labels = tabs.map((tab) =>
      namesItsCommand(tab, settledCommands) ? (tab.running ?? tab.title) : tab.title
    )
    const counts = new Map<string, number>()
    for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1)
    const occurrences = new Map<string, number>()
    return tabs.map((tab, index) => {
      const label = labels[index]
      const occurrence = (occurrences.get(label) ?? 0) + 1
      occurrences.set(label, occurrence)
      const isAgentCommandRunning = agentCommandTargets.has(tab.terminalId)
      return {
        id: tab.terminalId,
        title: counts.get(label) === 1 ? label : `${label} ${occurrence}`,
        // The label is a basename, and the tab may be running something it
        // is not naming yet, so hovering identifies the working directory and
        // foreground program without exposing the literal command.
        tooltip: terminalTooltip(tab),
        icon: (
          <TerminalTabIcon
            key={`${tab.terminalId}:${activityResetEpoch}`}
            active={isAgentCommandRunning}
          />
        ),
        active: tab.terminalId === activeTerminalId,
      }
    })
  }, [tabs, activeTerminalId, agentCommandTargets, activityResetEpoch, settledCommands])

  const [contextTerminalId, setContextTerminalId] = useState<string | null>(null)
  const {
    isOpen: isContextMenuOpen,
    position: contextMenuPosition,
    menuRef: contextMenuRef,
    handleContextMenu,
    closeMenu: closeContextMenu,
  } = useContextMenu()

  useEffect(() => {
    if (!visible) return
    const handlePrepare = () => {
      if (isContextMenuOpen || contextMenuRef.current) hideMountedMenuSurfaces()
      if (isContextMenuOpen) closeContextMenu()
    }
    window.addEventListener(NATIVE_SURFACE_OCCLUSION_PREPARE_EVENT, handlePrepare)
    return () => window.removeEventListener(NATIVE_SURFACE_OCCLUSION_PREPARE_EVENT, handlePrepare)
  }, [closeContextMenu, isContextMenuOpen, visible])
  const contextTab = tabs.find((tab) => tab.terminalId === contextTerminalId)
  const canReorderTabs = Boolean(getDesktopBridge()?.terminal.reorderTerminal)

  useEffect(() => {
    if (isContextMenuOpen && contextTerminalId && !contextTab) {
      setContextTerminalId(null)
      closeContextMenu()
    }
  }, [closeContextMenu, contextTab, contextTerminalId, isContextMenuOpen])

  const handleNew = useCallback(() => {
    void openTerminal(undefined, scopeId)
      .then((state) => {
        if (state.activeTerminalId) {
          setFocusRequest((current) => ({
            terminalId: state.activeTerminalId ?? '',
            nonce: current.nonce + 1,
          }))
        }
      })
      .catch(() => {
        toast.error('Could not open a new terminal. Please try again.')
      })
  }, [scopeId])
  const handleSwitch = useCallback(
    (terminalId: string, source?: TabStripSelectionSource) => {
      if (source !== 'keyboard') {
        setFocusRequest((current) => ({ terminalId, nonce: current.nonce + 1 }))
      }
      void switchTerminal(terminalId, scopeId).catch(() => {
        toast.error('Could not switch terminals. Please try again.')
      })
    },
    [scopeId]
  )
  const handleReorder = useCallback(
    (terminalId: string, targetIndex: number) => {
      void reorderTerminal(terminalId, targetIndex, scopeId).catch(() => {
        toast.error('Could not reorder that terminal. Please try again.')
      })
    },
    [scopeId]
  )
  // Closing the only terminal resets it rather than emptying the panel; the
  // desktop app decides that, so the button means the same thing at any count.
  const handleClose = useCallback(
    (terminalId: string) => {
      const tab = tabs.find((entry) => entry.terminalId === terminalId)
      if (
        tab?.running &&
        !window.confirm(
          `${describeRunningCommand(tab.running)} is still running. Close this terminal and stop it?`
        )
      ) {
        return
      }
      void closeTerminal(terminalId, scopeId).catch(() => {
        toast.error('Could not close that terminal. Please try again.')
      })
    },
    [scopeId, tabs]
  )

  // A duplicate is a new shell in the same directory, not a copy of the
  // session: scrollback and whatever is running belong to the original pty.
  const handleDuplicate = useCallback(
    (cwd: string | null) => {
      void openTerminal(cwd ?? undefined, scopeId)
        .then((state) => {
          if (state.activeTerminalId) {
            setFocusRequest((current) => ({
              terminalId: state.activeTerminalId ?? '',
              nonce: current.nonce + 1,
            }))
          }
        })
        .catch(() => {
          toast.error('Could not duplicate that terminal. Please try again.')
        })
    },
    [scopeId]
  )

  const handleCloseMany = useCallback(
    (terminalIds: string[]) => {
      const runningCount = tabs.filter(
        (tab) => terminalIds.includes(tab.terminalId) && Boolean(tab.running)
      ).length
      if (
        runningCount > 0 &&
        !window.confirm(
          `${runningCount} selected ${runningCount === 1 ? 'terminal has' : 'terminals have'} a running process. Close ${runningCount === 1 ? 'it' : 'them'} anyway?`
        )
      ) {
        return
      }
      for (const terminalId of terminalIds) {
        void closeTerminal(terminalId, scopeId).catch(() => {
          toast.error('Could not close one of those terminals. Please try again.')
        })
      }
    },
    [scopeId, tabs]
  )

  const closeOtherTabs = useCallback(() => {
    if (!contextTab) return
    handleCloseMany(
      tabs.filter((tab) => tab.terminalId !== contextTab.terminalId).map((tab) => tab.terminalId)
    )
  }, [contextTab, handleCloseMany, tabs])

  const closeTabsToRight = useCallback(() => {
    if (!contextTab) return
    const contextIndex = tabs.findIndex((tab) => tab.terminalId === contextTab.terminalId)
    handleCloseMany(tabs.slice(contextIndex + 1).map((tab) => tab.terminalId))
  }, [contextTab, handleCloseMany, tabs])

  const contextIndex = contextTab
    ? tabs.findIndex((tab) => tab.terminalId === contextTab.terminalId)
    : -1

  // A terminal can move inside the strip or be copied into chat as context.
  const startTabDrag = useCallback(
    (event: ReactDragEvent<HTMLDivElement>, terminalId: string) => {
      const tab = tabs.find((entry) => entry.terminalId === terminalId)
      if (!tab) return
      event.dataTransfer.effectAllowed = 'copyMove'
      event.dataTransfer.setData(
        SIM_RESOURCE_DRAG_TYPE,
        JSON.stringify({ type: 'terminal', id: tab.terminalId, title: tab.title })
      )
    },
    [tabs]
  )

  const openTabContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>, terminalId: string) => {
      window.getSelection()?.removeAllRanges()
      setContextTerminalId(terminalId)
      handleContextMenu(event)
    },
    [handleContextMenu]
  )

  return (
    <div ref={panelRef} className='flex h-full flex-col overflow-hidden bg-[var(--bg)]'>
      <TabStrip
        tabs={items}
        onSelect={handleSwitch}
        onNew={handleNew}
        onTabContextMenu={openTabContextMenu}
        onTabDragStart={startTabDrag}
        {...(canReorderTabs ? { onReorder: handleReorder } : {})}
        newTabLabel='New terminal'
        onClose={handleClose}
        overlays={
          <ContextMenu
            isOpen={isContextMenuOpen && Boolean(contextTab)}
            position={contextMenuPosition}
            menuRef={contextMenuRef}
            onClose={closeContextMenu}
            onDuplicate={contextTab ? () => handleDuplicate(contextTab.cwd) : undefined}
            onCloseOtherTabs={contextTab ? closeOtherTabs : undefined}
            onCloseTabsToRight={contextTab ? closeTabsToRight : undefined}
            disableCloseOtherTabs={tabs.length <= 1}
            disableCloseTabsToRight={contextIndex < 0 || contextIndex === tabs.length - 1}
            {...(contextTab
              ? { onCloseTab: () => handleClose(contextTab.terminalId), showCloseTab: true }
              : {})}
            onDelete={() => {}}
            showRename={false}
            showDuplicate={Boolean(contextTab)}
            showDelete={false}
          />
        }
      />

      <div className='relative min-h-0 flex-1'>
        {tabs.map((tab) => (
          <TerminalView
            key={tab.terminalId}
            terminalId={tab.terminalId}
            running={tab.running}
            active={tab.terminalId === activeTerminalId}
            visible={visible}
            scopeId={scopeId}
            appearanceTheme={appearanceTheme}
            profiles={availableProfiles}
            onAppearanceThemeChange={hasDesktopBridge ? handleAppearanceThemeChange : undefined}
            appearanceThemePending={appearanceThemePending}
            defaultZoom={defaultZoom}
            focusRequest={focusRequest.terminalId === tab.terminalId ? focusRequest.nonce : 0}
          />
        ))}
        {startError && (
          <div className='absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[var(--bg)] px-6 text-center'>
            <TerminalWindow className='size-[18px] text-[var(--text-tertiary)]' />
            <p className='text-[var(--text-muted)] text-small'>{startError}</p>
          </div>
        )}
      </div>
    </div>
  )
}
