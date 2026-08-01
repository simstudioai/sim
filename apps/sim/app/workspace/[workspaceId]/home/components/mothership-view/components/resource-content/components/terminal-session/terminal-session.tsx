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
import { cn, TabStrip, type TabStripItem, toast } from '@sim/emcn'
import { TerminalWindow } from '@sim/emcn/icons'
import { createLogger } from '@sim/logger'
import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import { Terminal } from '@xterm/xterm'
import { useTheme } from 'next-themes'
import '@xterm/xterm/css/xterm.css'
import { MAX_TERMINALS, type TerminalTabState } from '@sim/terminal-protocol'
import { SIM_RESOURCE_DRAG_TYPE } from '@/lib/copilot/resource-types'
import { TERMINAL_SESSION_RESOURCE_ID } from '@/lib/copilot/resources/types'
import { trackPanelFocus } from '@/lib/desktop/panel-focus'
import {
  closeTerminal,
  getTerminalScrollback,
  onTerminalData,
  openTerminal,
  pasteIntoTerminal,
  reportTerminalFocused,
  resizeTerminal,
  startTerminalSession,
  switchTerminal,
  writeToTerminal,
} from '@/lib/terminal/transport'
import { useMothershipResources } from '@/app/workspace/[workspaceId]/home/components/mothership-resources-context'
import { TerminalContextMenu } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-content/components/terminal-session/terminal-context-menu'
import { ContextMenu } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/workflow-list/components/context-menu/context-menu'
import { useContextMenu } from '@/app/workspace/[workspaceId]/w/components/sidebar/hooks'
import { useCopilotTerminalStore } from '@/stores/copilot-terminal/store'

const logger = createLogger('TerminalSession')

/**
 * How long a command must run before the tab names it.
 *
 * A tab that says what it is busy with is useful for a build you left running
 * in the background, and pure noise for `ls` — swapping the label and spinning
 * the icon for thirty milliseconds reads as a glitch. Waiting a beat keeps the
 * signal and drops the flicker.
 */
const COMMAND_SETTLE_MS = 1_000

/** Full working directory, plus whatever the shell is running in it. */
function terminalTooltip(tab: TerminalTabState): string {
  const where = tab.cwd ?? 'Terminal'
  return tab.running ? `${where} — ${tab.running}` : where
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

const LIGHT_THEME = {
  background: '#ffffff',
  foreground: '#1f2328',
  cursor: '#1f2328',
  selectionBackground: '#b4d5fe',
  black: '#24292e',
  red: '#d1242f',
  green: '#1a7f37',
  yellow: '#9a6700',
  blue: '#0969da',
  magenta: '#8250df',
  cyan: '#1b7c83',
  white: '#6e7781',
  brightBlack: '#57606a',
  brightRed: '#a40e26',
  brightGreen: '#1a7f37',
  brightYellow: '#633c01',
  brightBlue: '#218bff',
  brightMagenta: '#a475f9',
  brightCyan: '#3192aa',
  brightWhite: '#8c959f',
}

const DARK_THEME = {
  background: '#0d1117',
  foreground: '#e6edf3',
  cursor: '#e6edf3',
  selectionBackground: '#264f78',
  black: '#484f58',
  red: '#ff7b72',
  green: '#3fb950',
  yellow: '#d29922',
  blue: '#58a6ff',
  magenta: '#bc8cff',
  cyan: '#39c5cf',
  white: '#b1bac4',
  brightBlack: '#6e7681',
  brightRed: '#ffa198',
  brightGreen: '#56d364',
  brightYellow: '#e3b341',
  brightBlue: '#79c0ff',
  brightMagenta: '#d2a8ff',
  brightCyan: '#56d4dd',
  brightWhite: '#f0f6fc',
}

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
/**
 * Shortcuts a terminal answers itself, before xterm turns them into bytes for
 * the shell.
 *
 * Only the ones with no menu item: Cmd-W and Cmd-Shift-T are global menu
 * accelerators, so they never reach here and are handled in the main process
 * against the focused panel instead. Returning false stops xterm from also
 * sending the keystroke on to the pty, which would otherwise put a stray
 * control character in front of whatever the user was typing.
 */
function handleTerminalShortcut(event: KeyboardEvent, terminal: Terminal): boolean {
  const primary = event.metaKey || (event.ctrlKey && !event.altKey)
  if (event.type !== 'keydown' || !primary || event.shiftKey || event.altKey) return true
  switch (event.key.toLowerCase()) {
    case 't':
      void openTerminal()
      return false
    case 'k':
      // What Cmd-K means in every other macOS terminal: wipe the screen and
      // the scrollback, leaving the prompt.
      terminal.clear()
      return false
    default:
      return true
  }
}

const TerminalView = memo(function TerminalView({
  terminalId,
  active,
  visible,
}: {
  terminalId: string
  active: boolean
  visible: boolean
}) {
  const { resolvedTheme } = useTheme()
  const hostRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  // Being the selected tab is not enough to be on screen: the whole panel is
  // hidden whenever another resource is open.
  const onscreen = active && visible
  const onscreenRef = useRef(onscreen)
  onscreenRef.current = onscreen
  const showRef = useRef<(() => void) | null>(null)
  const hideRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    let disposed = false
    const terminal = new Terminal({
      allowProposedApi: true,
      cursorBlink: true,
      fontSize: 12,
      fontFamily:
        'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
      lineHeight: 1.35,
      scrollback: 10_000,
      theme: resolvedTheme === 'dark' ? DARK_THEME : LIGHT_THEME,
    })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.loadAddon(new WebLinksAddon())
    const unicode = new Unicode11Addon()
    terminal.loadAddon(unicode)
    terminal.unicode.activeVersion = '11'

    terminal.open(host)

    terminalRef.current = terminal
    fitRef.current = fit
    terminal.attachCustomKeyEventHandler((event) => handleTerminalShortcut(event, terminal))

    const disposeData = terminal.onData((data) => writeToTerminal(terminalId, data))
    const disposeResize = terminal.onResize(({ cols, rows }) =>
      resizeTerminal(terminalId, cols, rows)
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

    const unsubscribeData = onTerminalData(terminalId, (data) => {
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
    })

    // Guarded because a snapshot is a round trip to the desktop app, and a tab
    // switched away from and back to during one would otherwise start a second
    // that resets and repaints over the first.
    let repainting = false
    const repaint = () => {
      if (repainting) return
      repainting = true
      return getTerminalScrollback(terminalId)
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
          fit.fit()
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
  }, [terminalId])

  // Runs after the effect above, which is what installs these.
  useEffect(() => {
    if (onscreen) showRef.current?.()
    else hideRef.current?.()
  }, [onscreen, terminalId])

  useEffect(() => {
    const terminal = terminalRef.current
    if (!terminal) return
    terminal.options.theme = resolvedTheme === 'dark' ? DARK_THEME : LIGHT_THEME
  }, [resolvedTheme])

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

  useEffect(() => {
    if (!onscreen) return
    // Measure after the browser has laid the newly shown terminal out.
    const frame = requestAnimationFrame(() => {
      const host = hostRef.current
      if (!host || host.clientWidth <= 0 || host.clientHeight <= 0) return
      try {
        fitRef.current?.fit()
        terminalRef.current?.focus()
      } catch {
        // Panel still animating; the ResizeObserver refits.
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [onscreen])

  const {
    isOpen: isMenuOpen,
    position: menuPosition,
    menuRef,
    handleContextMenu,
    closeMenu,
  } = useContextMenu()
  // Read at open time so Copy reflects the selection the click landed on.
  const [hasSelection, setHasSelection] = useState(false)

  const openMenu = useCallback(
    (event: React.MouseEvent) => {
      setHasSelection(Boolean(terminalRef.current?.hasSelection()))
      // Suppresses Electron's native editable-field menu, which would
      // otherwise target xterm's offscreen input textarea.
      handleContextMenu(event)
    },
    [handleContextMenu]
  )

  const copySelection = useCallback(() => {
    const selection = terminalRef.current?.getSelection()
    if (selection) void navigator.clipboard.writeText(selection)
  }, [])

  const pasteClipboard = useCallback(() => {
    void (async () => {
      // Main-side first: it reads the clipboard synchronously, so the paste
      // cannot be refused for want of a recent gesture the way an awaited
      // renderer read can.
      if (await pasteIntoTerminal(terminalId)) {
        terminalRef.current?.focus()
        return
      }
      try {
        const text = await navigator.clipboard.readText()
        if (!text) return
        // Straight to the PTY: the shell echoes it, exactly like a real paste.
        writeToTerminal(terminalId, text)
        terminalRef.current?.focus()
      } catch {
        // Reading the clipboard needs a permission the shell grants to its own
        // origin; an older shell that predates that grant denies it. Keyboard
        // paste is a native paste event and keeps working either way.
        toast.error('Could not read the clipboard. Press ⌘V to paste.')
      }
    })()
  }, [terminalId])

  const clearScreen = useCallback(() => {
    terminalRef.current?.clear()
    terminalRef.current?.focus()
  }, [])

  const newTab = useCallback(() => {
    void openTerminal()
  }, [])

  // Scoped to the terminal that was right-clicked, not the active one.
  // Offered even for the only terminal: closing the last one restarts its
  // shell in place rather than removing the tab, so there is always something
  // for the action to do — and hiding it here while the tab strip's own close
  // stays available would just be the two menus disagreeing.
  const closeThisTerminal = useCallback(() => {
    void closeTerminal(terminalId)
  }, [terminalId])

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
        onContextMenu={openMenu}
        className={cn('absolute inset-0 px-2 py-1', !active && 'hidden')}
      />
      <TerminalContextMenu
        isOpen={isMenuOpen}
        position={menuPosition}
        menuRef={menuRef}
        onClose={closeMenu}
        hasSelection={hasSelection}
        onCopy={copySelection}
        onPaste={pasteClipboard}
        onClear={clearScreen}
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
export function TerminalSession({ visible }: { visible: boolean }) {
  const panelRef = useRef<HTMLDivElement>(null)
  const { tabs, activeTerminalId } = useCopilotTerminalStore((state) => state.tabs)
  const settledCommands = useSettledCommands(tabs)
  const { removeResource } = useMothershipResources()
  const [startError, setStartError] = useState<string | null>(null)

  // Interaction ownership is reported once for the whole panel, never per tab.
  // The shell holds a single focus flag, so a per-tab reporter would let one
  // tab's unmount erase a sibling's live claim — and Cmd-W would then fall
  // through to closing the window out from under a running shell.
  //
  // No claim on appear: xterm focuses its textarea once the panel is measurably
  // on screen, and that focusin is the claim. Appearing is not enough, because
  // the agent opens this panel on the user's behalf — claiming then would let a
  // Cmd-W meant for the chat close a shell the user never touched.
  useEffect(() => {
    const panel = panelRef.current
    if (!panel || !visible) return
    return trackPanelFocus(panel, reportTerminalFocused)
  }, [visible])

  useEffect(() => {
    let active = true
    startTerminalSession({ cols: 80, rows: 24 })
      .then(() => {
        if (active) setStartError(null)
      })
      .catch((error: Error) => {
        if (active) setStartError(error.message)
      })
    return () => {
      active = false
    }
  }, [])

  // Closing the last terminal closes the panel: there is nothing left to show
  // and no way back from inside it.
  const hasStarted = useRef(false)
  useEffect(() => {
    if (tabs.length > 0) {
      hasStarted.current = true
      return
    }
    if (hasStarted.current) {
      hasStarted.current = false
      removeResource('terminal', TERMINAL_SESSION_RESOURCE_ID)
    }
  }, [tabs.length, removeResource])

  // Every tab carries the same glyph. A spinner would have to mean "transient
  // work", and nothing here can tell that from a coding agent sitting open for
  // an hour: the alternate screen is the only signal available, and the tools
  // people leave running — Claude Code, Codex — draw inline without it. A
  // spinner that is wrong for the longest-lived tabs is worse than none, and
  // the tab already says what it is running.
  const items = useMemo<TabStripItem[]>(
    () =>
      tabs.map((tab) => {
        const naming = namesItsCommand(tab, settledCommands) ? tab.running : null
        return {
          id: tab.terminalId,
          title: naming ?? tab.title,
          // The label is a basename, and the tab may be running something it
          // is not naming yet, so hovering gives the whole picture: where the
          // shell is, and what it is doing there.
          tooltip: terminalTooltip(tab),
          icon: <TerminalWindow className='size-[12px] shrink-0 text-[var(--text-icon)]' />,
          active: tab.terminalId === activeTerminalId,
        }
      }),
    [tabs, activeTerminalId, settledCommands]
  )

  const [contextTerminalId, setContextTerminalId] = useState<string | null>(null)
  const {
    isOpen: isContextMenuOpen,
    position: contextMenuPosition,
    menuRef: contextMenuRef,
    handleContextMenu,
    closeMenu: closeContextMenu,
  } = useContextMenu()
  const contextTab = tabs.find((tab) => tab.terminalId === contextTerminalId)

  const handleNew = useCallback(() => {
    void openTerminal()
  }, [])
  const handleSwitch = useCallback((terminalId: string) => {
    void switchTerminal(terminalId)
  }, [])
  // Closing the only terminal resets it rather than emptying the panel; the
  // desktop app decides that, so the button means the same thing at any count.
  const handleClose = useCallback((terminalId: string) => {
    void closeTerminal(terminalId)
  }, [])

  // A duplicate is a new shell in the same directory, not a copy of the
  // session: scrollback and whatever is running belong to the original pty.
  const handleDuplicate = useCallback((cwd: string | null) => {
    void openTerminal(cwd ?? undefined)
  }, [])

  // Dragging a terminal tab into the chat attaches it as context. This strip
  // has no reordering, so supplying this is also what makes its tabs
  // draggable at all.
  const startTabDrag = useCallback(
    (event: ReactDragEvent<HTMLDivElement>, terminalId: string) => {
      const tab = tabs.find((entry) => entry.terminalId === terminalId)
      if (!tab) return
      event.dataTransfer.effectAllowed = 'copy'
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
      {tabs.length > 0 && (
        <TabStrip
          tabs={items}
          onSelect={handleSwitch}
          onNew={handleNew}
          onTabContextMenu={openTabContextMenu}
          onTabDragStart={startTabDrag}
          maxTabs={MAX_TERMINALS}
          newTabLabel='New terminal'
          onClose={handleClose}
        >
          <ContextMenu
            isOpen={isContextMenuOpen && Boolean(contextTab)}
            position={contextMenuPosition}
            menuRef={contextMenuRef}
            onClose={closeContextMenu}
            onDuplicate={contextTab ? () => handleDuplicate(contextTab.cwd) : undefined}
            {...(contextTab
              ? { onCloseTab: () => handleClose(contextTab.terminalId), showCloseTab: true }
              : {})}
            onDelete={() => {}}
            showRename={false}
            showDuplicate={Boolean(contextTab)}
            disableDuplicate={tabs.length >= MAX_TERMINALS}
            showDelete={false}
          />
        </TabStrip>
      )}

      <div className='relative min-h-0 flex-1'>
        {tabs.map((tab) => (
          <TerminalView
            key={tab.terminalId}
            terminalId={tab.terminalId}
            active={tab.terminalId === activeTerminalId}
            visible={visible}
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
