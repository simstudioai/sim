'use client'

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  type DesktopZoomAction,
  type DesktopZoomPercent,
  resolveDesktopZoom,
  type TerminalAppearanceTheme,
  type TerminalShortcutCommand,
  type TerminalThemeProfile,
} from '@sim/desktop-bridge'
import { cn, NATIVE_SURFACE_OCCLUSION_PREPARE_EVENT, toast } from '@sim/emcn'
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
import { describeRunningCommand, type TerminalTabsState } from '@sim/terminal-protocol'
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
import { onTerminalFocusRequest } from '@/lib/terminal/focus'
import {
  clearTerminalScrollback,
  closeTerminal,
  getTerminalScrollback,
  onTerminalData,
  onTerminalDefaultZoomChanged,
  onTerminalShortcutCommand,
  openTerminal,
  pasteIntoTerminal,
  reportTerminalFocused,
  reportTerminalVisible,
  resizeTerminal,
  writeToTerminal,
} from '@/lib/terminal/transport'
import { TerminalContextMenu } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-content/components/terminal-session/terminal-context-menu'
import { useDesktopPreferenceMutation } from '@/hooks/use-desktop-preference-mutation'
import { useCopilotTerminalStore } from '@/stores/copilot-terminal/store'
import type { ChatContext, TerminalTextSelection } from '@/stores/panel'

const logger = createLogger('TerminalSession')
const EMPTY_TERMINAL_TABS: TerminalTabsState = { tabs: [], activeTerminalId: null }
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
  const { tabs, activeTerminalId } = tabsState
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

  // The strip asks for the keyboard when the user picks a shell with the
  // pointer or opens one; the request lands once that shell is on screen.
  useEffect(
    () =>
      onTerminalFocusRequest((terminalId) => {
        setFocusRequest((current) => ({ terminalId, nonce: current.nonce + 1 }))
      }),
    []
  )

  return (
    <div ref={panelRef} className='flex h-full flex-col overflow-hidden bg-[var(--bg)]'>
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
      </div>
    </div>
  )
}
