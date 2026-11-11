'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  type DesktopZoomAction,
  type DesktopZoomPercent,
  resolveDesktopZoom,
  type TerminalAppearanceTheme,
  type TerminalShortcutCommand,
  type TerminalThemeProfile,
} from '@sim/desktop-bridge'
import { createLogger } from '@sim/logger'
import type { TerminalTabsState } from '@sim/terminal-protocol'
import { describeRunningCommand } from '@sim/terminal-protocol'
import { formatPasteLimit, PASTE_LIMITS } from '@sim/utils/paste'
import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import { type IBufferRange, Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { getErrorMessage } from '@sim/utils/errors'
import {
  loadDesktopTerminalAppearance,
  loadDesktopTerminalThemeProfiles,
  refreshSelectedTerminalProfile,
  resolveTerminalThemePalette,
  withSelectedProfile,
} from '@/lib/desktop/appearance'
import { trackPanelFocus } from '@/lib/desktop/panel-focus'
import { addMothershipContexts } from '@/lib/mothership/events'
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
import { toast } from '@/lib/toast/sink'
import { useDesktopPreferenceMutation } from '@/hooks/use-desktop-preference-mutation'
import { DESKTOP_THEME_OPTIONS } from '@/platform/lib/data/desktop/model'
import { useSurfaceColorMode } from '@/platform/lib/data/surface-theme'
import { useCopilotTerminalStore } from '@/stores/copilot-terminal/store'

const logger = createLogger('TerminalPanel')
const EMPTY_TERMINAL_TABS: TerminalTabsState = { tabs: [], activeTerminalId: null }
const TERMINAL_BASE_FONT_SIZE = 12
const TERMINAL_ZOOM_BOUNDS = { min: 50, max: 300 } as const
/** How long the panel must stop changing size before the PTY hears about it, covering a drag. */
const RESIZE_SETTLE_MS = 120
/** Output an offscreen terminal banks before it asks the desktop app for the screen again. */
const MAX_BANKED_CHARS = 256_000

/**
 * Loads the WebGL renderer and drops it if its context dies, falling back to xterm's DOM renderer,
 * which is slower but cannot paint a stale surface.
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
    logger.warn('Terminal WebGL unavailable; using the slower DOM renderer', {
      error: getErrorMessage(error),
    })
    return null
  }
}

/**
 * xterm's selection as the rows a terminal chat chip names. xterm 6 exposes zero-based buffer
 * coordinates with an exclusive end, so a selection ending at column zero stops on the row before.
 */
function selectionSnapshot(text: string, position: IBufferRange | undefined) {
  if (!text || !position) return null
  const startLine = position.start.y + 1
  const endLine =
    position.end.y > position.start.y && position.end.x === 0 ? position.end.y : position.end.y + 1
  return { text, startLine, endLine: Math.max(startLine, endLine) }
}

/** Fits xterm to its host; bound so the addon keeps its receiver. */
function fitTerminal(addon: FitAddon): void {
  const fitToHost = addon.fit.bind(addon)
  fitToHost()
}

function sameTheme(left: TerminalAppearanceTheme, right: TerminalAppearanceTheme): boolean {
  return typeof left === 'string' || typeof right === 'string'
    ? left === right
    : left.id === right.id
}

/**
 * Mod+K clears the terminal; every other key goes to the shell. The clear claims the key, so the
 * product shell's own Mod+K (command search) does not also open.
 */
function handleTerminalLocalShortcut(event: KeyboardEvent, clear: () => void): boolean {
  const mac = /Mac|iPhone|iPad|iPod/i.test(navigator.platform)
  const primary = event.metaKey || (!mac && event.ctrlKey && !event.altKey)
  if (
    event.type !== 'keydown' ||
    event.repeat ||
    event.isComposing ||
    !primary ||
    event.shiftKey ||
    event.altKey ||
    event.key.toLowerCase() !== 'k'
  )
    return true
  event.preventDefault()
  clear()
  return false
}

function zoomActionFor(command: TerminalShortcutCommand): DesktopZoomAction | null {
  if (command === 'zoom-in') return 'in'
  if (command === 'zoom-out') return 'out'
  if (command === 'zoom-reset') return 'reset'
  return null
}

/** A close the reader confirms because a command is still running in it. */
interface TerminalCloseRequest {
  targets: { terminalId: string; running: string | null }[]
  title: string
  description: string
}

/**
 * The chat's desktop terminals as the panel reads them: the shells, the appearance and zoom the
 * desktop app keeps, focus and visibility reported to the shell, and closing with a confirmation
 * while a command runs.
 */
export function useTerminalSession({ scopeId, visible }: { scopeId: string; visible: boolean }) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [appearanceTheme, setAppearanceTheme] = useState<TerminalAppearanceTheme>('app')
  const [profiles, setProfiles] = useState<TerminalThemeProfile[]>([])
  const [defaultZoom, setDefaultZoom] = useState<DesktopZoomPercent>(100)
  const [closing, setClosing] = useState<TerminalCloseRequest | null>(null)
  const [focusRequest, setFocusRequest] = useState({ terminalId: '', nonce: 0 })
  // A shell picked in the tab strip takes the keyboard once it is on screen.
  useEffect(
    () =>
      onTerminalFocusRequest((terminalId) =>
        setFocusRequest((current) => ({ terminalId, nonce: current.nonce + 1 }))
      ),
    []
  )
  const tabsState = useCopilotTerminalStore(
    (state) => state.sessions[scopeId]?.tabs ?? EMPTY_TERMINAL_TABS
  )
  const suspended = useCopilotTerminalStore((state) => state.sessions[scopeId]?.suspended ?? false)
  const availableProfiles = useMemo(
    () => withSelectedProfile(profiles, appearanceTheme),
    [appearanceTheme, profiles]
  )

  useEffect(() => {
    if (!visible) return
    let active = true
    void Promise.all([loadDesktopTerminalAppearance(), loadDesktopTerminalThemeProfiles()]).then(
      ([appearance, nextProfiles]) => {
        if (!active) return
        setProfiles(nextProfiles)
        setAppearanceTheme(refreshSelectedTerminalProfile(nextProfiles, appearance.theme))
        setDefaultZoom(appearance.defaultZoom)
      }
    )
    return () => {
      active = false
    }
  }, [visible])

  useEffect(() => onTerminalDefaultZoomChanged(setDefaultZoom), [])

  const { pending: themePending, mutate: setTheme } = useDesktopPreferenceMutation(
    (bridge, theme: TerminalAppearanceTheme) =>
      typeof theme === 'string'
        ? bridge.settings.setTerminalTheme(theme)
        : (bridge.terminalThemes?.selectProfile(theme.id) ?? Promise.resolve(undefined)),
    'Could not update terminal appearance',
    (preferences) => setAppearanceTheme(preferences.terminalTheme)
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

  const finishClose = (terminalIds: readonly string[]) => {
    for (const terminalId of terminalIds) {
      void closeTerminal(terminalId, scopeId).catch(() => {
        toast.error('Could not close that terminal. Please try again.')
      })
    }
  }

  const themeOption = (id: string, label: string, theme: TerminalAppearanceTheme) => ({
    id,
    label,
    checked: sameTheme(theme, appearanceTheme),
    select: () => void setTheme(theme),
  })
  const [matchSim, light, dark] = DESKTOP_THEME_OPTIONS
  /** The terminal themes to choose from: Sim's three, then profiles imported from other apps. */
  const themes: [ReturnType<typeof themeOption>, ...ReturnType<typeof themeOption>[]] = [
    themeOption(matchSim.value, matchSim.label, matchSim.value),
    themeOption(light.value, light.label, light.value),
    themeOption(dark.value, dark.label, dark.value),
    ...availableProfiles.map((profile) =>
      themeOption(
        `profile-${profile.id}`,
        `${profile.source === 'iterm2' ? 'iTerm2' : 'Terminal'} · ${profile.name}`,
        profile
      )
    ),
  ]

  return {
    panelRef,
    /** The focus request for a shell, counted so a repeat pick focuses it again; 0 for none. */
    focusRequestFor: (terminalId: string) =>
      focusRequest.terminalId === terminalId ? focusRequest.nonce : 0,
    tabs: tabsState.tabs.map((tab) => tab.terminalId),
    activeTerminalId: tabsState.activeTerminalId,
    appearanceTheme,
    /** The terminal themes to choose from: Sim's three, then profiles imported from other apps. */
    themes,
    themePending,
    defaultZoom,
    newTerminal: () => {
      void openTerminal(undefined, scopeId).catch(() => {
        toast.error('Could not open a new terminal. Please try again.')
      })
    },
    /** Closes at once unless a command is running, which asks first. */
    close: (terminalId: string) => {
      const tab = tabsState.tabs.find((item) => item.terminalId === terminalId)
      if (!tab) return
      if (!tab.running) {
        finishClose([terminalId])
        return
      }
      setClosing({
        targets: [{ terminalId, running: tab.running }],
        title: 'Close terminal',
        description: `${describeRunningCommand(tab.running)} is still running. Closing the terminal will stop it.`,
      })
    },
    closing,
    cancelClose: () => setClosing(null),
    /** Rechecks the commands before closing, so a terminal that changed meanwhile is reviewed again. */
    confirmClose: (request: TerminalCloseRequest) => {
      const tabs = useCopilotTerminalStore.getState().sessions[scopeId]?.tabs.tabs ?? []
      const unchanged = request.targets.every((target) => {
        const current = tabs.find((tab) => tab.terminalId === target.terminalId)
        return current && (!current.running || current.running === target.running)
      })
      setClosing(null)
      if (!unchanged) {
        toast.warning('A terminal changed. Review it before closing.')
        return
      }
      finishClose(request.targets.map((target) => target.terminalId))
    },
  }
}

interface TerminalViewOptions {
  terminalId: string
  scopeId: string
  /** This shell is the selected one in an open, visible panel. */
  onscreen: boolean
  appearanceTheme: TerminalAppearanceTheme
  defaultZoom: DesktopZoomPercent
  /** A tab-strip pick asking this shell for the keyboard; 0 when none is pending. */
  focusRequest: number
}

/**
 * One shell's xterm emulator, kept alive behind other tabs so switching is instant. Output is only
 * parsed while the shell is on screen: an offscreen view banks it and replays on the way back, or
 * repaints from the desktop app's scrollback when the bank overflowed. The PTY hears only the size
 * a resize settles on, and only the shell on screen holds a WebGL context.
 */
export function useTerminalView({
  terminalId,
  scopeId,
  onscreen,
  appearanceTheme,
  defaultZoom,
  focusRequest,
}: TerminalViewOptions) {
  const [host, setHost] = useState<HTMLDivElement | null>(null)
  const colorMode = useSurfaceColorMode(host)
  const palette = resolveTerminalThemePalette(appearanceTheme, colorMode)
  const terminalRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const [zoom, setZoom] = useState<number>(defaultZoom)
  const onscreenRef = useRef(onscreen)
  onscreenRef.current = onscreen
  const showRef = useRef<(() => void) | null>(null)
  const hideRef = useRef<(() => void) | null>(null)
  const paletteRef = useRef(palette)
  paletteRef.current = palette
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom

  const clearVisible = useCallback(() => {
    terminalRef.current?.clear()
    terminalRef.current?.focus()
  }, [])
  const clear = useCallback(() => {
    void clearTerminalScrollback(terminalId, scopeId)
    clearVisible()
  }, [clearVisible, scopeId, terminalId])
  const applyZoom = useCallback(
    (action: DesktopZoomAction) =>
      setZoom((current) => resolveDesktopZoom(current, action, defaultZoom, TERMINAL_ZOOM_BOUNDS)),
    [defaultZoom]
  )

  useEffect(() => {
    if (!host) return
    let disposed = false
    const terminal = new Terminal({
      allowProposedApi: true,
      cursorBlink: true,
      fontSize: (TERMINAL_BASE_FONT_SIZE * zoomRef.current) / 100,
      fontFamily:
        'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
      lineHeight: 1.35,
      scrollback: 10_000,
      theme: paletteRef.current,
    })
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.loadAddon(new WebLinksAddon())
    terminal.loadAddon(new Unicode11Addon())
    terminal.unicode.activeVersion = '11'
    terminal.open(host)
    terminalRef.current = terminal
    fitRef.current = fitAddon
    terminal.attachCustomKeyEventHandler((event) => handleTerminalLocalShortcut(event, clear))
    const disposeData = terminal.onData((data) => writeToTerminal(terminalId, data, scopeId))
    const disposeResize = terminal.onResize(({ cols, rows }) =>
      resizeTerminal(terminalId, cols, rows, scopeId)
    )

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
    let repainting = false
    const repaint = () => {
      if (repainting) return
      repainting = true
      void getTerminalScrollback(terminalId, scopeId)
        .catch((error: unknown) => {
          logger.warn('Could not read terminal scrollback; the panel will start empty', {
            terminalId,
            error: getErrorMessage(error),
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
          writable = onscreenRef.current
        })
    }
    showRef.current = () => {
      if (writable || disposed) return
      if (!painted || overflowed) {
        repaint()
        return
      }
      if (banked) terminal.write(banked)
      banked = ''
      writable = true
    }
    hideRef.current = () => {
      writable = false
    }
    let resizeTimer: ReturnType<typeof setTimeout> | null = null
    const observer = new ResizeObserver(() => {
      if (resizeTimer) clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => {
        resizeTimer = null
        // A zero-sized host is offscreen, not smaller; fitting it would resize the PTY to nonsense.
        if (!onscreenRef.current || host.clientWidth <= 0 || host.clientHeight <= 0) return
        try {
          fitTerminal(fitAddon)
        } catch {}
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
  }, [host, terminalId, scopeId, clear])

  useEffect(() => {
    if (onscreen) showRef.current?.()
    else hideRef.current?.()
  }, [onscreen, host])

  // The host paints the palette's background around xterm's cells; it is the terminal's own colour.
  useEffect(() => {
    if (terminalRef.current) terminalRef.current.options.theme = palette
    if (host) host.style.backgroundColor = palette.background
  }, [palette, host])

  useEffect(() => setZoom(defaultZoom), [defaultZoom])

  useEffect(() => {
    if (!onscreen || focusRequest === 0) return
    const frame = requestAnimationFrame(() => terminalRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [focusRequest, onscreen])

  useEffect(() => {
    const terminal = terminalRef.current
    if (!terminal || !host) return
    terminal.options.fontSize = (TERMINAL_BASE_FONT_SIZE * zoom) / 100
    if (!onscreen) return
    const frame = requestAnimationFrame(() => {
      if (host.clientWidth <= 0 || host.clientHeight <= 0) return
      const fitAddon = fitRef.current
      try {
        if (fitAddon) fitTerminal(fitAddon)
      } catch {}
    })
    return () => cancelAnimationFrame(frame)
  }, [zoom, onscreen, host])

  useEffect(() => {
    if (!onscreen) return
    return onTerminalShortcutCommand(
      (command) => {
        if (command === 'clear') {
          clearVisible()
          return
        }
        const action = zoomActionFor(command)
        if (action) applyZoom(action)
      },
      scopeId,
      terminalId
    )
  }, [onscreen, scopeId, terminalId, clearVisible, applyZoom])

  useEffect(() => {
    if (!onscreen || !terminalRef.current) return
    const disposeRenderer = attachWebglRenderer(terminalRef.current)
    return () => disposeRenderer?.()
  }, [onscreen, host])

  /** The rows selected when the menu opened, since opening it moves focus away from xterm. */
  const [selection, setSelection] = useState<ReturnType<typeof selectionSnapshot>>(null)

  return {
    hostRef: setHost,
    pasteLimit: PASTE_LIMITS.TERMINAL_BYTES,
    focus: () => terminalRef.current?.focus(),
    captureSelection: () =>
      setSelection(
        selectionSnapshot(
          terminalRef.current?.getSelection() ?? '',
          terminalRef.current?.getSelectionPosition()
        )
      ),
    hasSelection: selection !== null,
    copy: () => {
      if (selection) void navigator.clipboard.writeText(selection.text)
    },
    /** Attaches the selected rows to the chat's draft, as legacy's Add to chat did. */
    addToChat: selection
      ? () =>
          addMothershipContexts([
            {
              kind: 'terminal_tab',
              terminalId,
              label:
                selection.startLine === selection.endLine
                  ? `Terminal (L${selection.startLine})`
                  : `Terminal (L${selection.startLine}-${selection.endLine})`,
              selection,
            },
          ])
      : undefined,
    paste: () => {
      void (async () => {
        reportTerminalFocused(true, scopeId)
        const result = await pasteIntoTerminal(terminalId, scopeId)
        if (result === true) {
          terminalRef.current?.focus()
          return
        }
        if (result === 'too-large') {
          toast.warning(
            `Paste is too large for the terminal. Paste up to ${formatPasteLimit(PASTE_LIMITS.TERMINAL_BYTES)} at once, or send the content through a file.`
          )
          return
        }
        toast.error('Could not paste from the clipboard. Press ⌘V to paste.')
      })()
    },
    clear,
    zoom: applyZoom,
  }
}
