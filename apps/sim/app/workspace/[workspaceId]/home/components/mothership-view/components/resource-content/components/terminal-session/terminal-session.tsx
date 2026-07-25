'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { cn, TabStrip, type TabStripItem } from '@sim/emcn'
import { Loader, TerminalWindow } from '@sim/emcn/icons'
import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import { Terminal } from '@xterm/xterm'
import { useTheme } from 'next-themes'
import '@xterm/xterm/css/xterm.css'
import { MAX_TERMINALS } from '@sim/terminal-protocol'
import { TERMINAL_SESSION_RESOURCE_ID } from '@/lib/copilot/resources/types'
import {
  closeTerminal,
  onTerminalData,
  onTerminalReplay,
  openTerminal,
  resizeTerminal,
  startTerminalSession,
  switchTerminal,
  writeToTerminal,
} from '@/lib/terminal/transport'
import { useMothershipResources } from '@/app/workspace/[workspaceId]/home/components/mothership-resources-context'
import { useCopilotTerminalStore } from '@/stores/copilot-terminal/store'

/**
 * How long the panel must stop changing size before the PTY is told about it.
 * Long enough to cover a divider drag, short enough that a deliberate resize
 * still feels immediate.
 */
const RESIZE_SETTLE_MS = 120

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
 * There is no canvas tier because `@xterm/addon-canvas` has no release for
 * xterm 6 — every published version, latest beta included, peers on xterm 5.
 */
function attachWebglRenderer(terminal: Terminal): void {
  try {
    const webgl = new WebglAddon()
    webgl.onContextLoss(() => webgl.dispose())
    terminal.loadAddon(webgl)
  } catch {
    // No usable WebGL on this machine; the DOM renderer stays in place.
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
function TerminalView({ terminalId, active }: { terminalId: string; active: boolean }) {
  const { resolvedTheme } = useTheme()
  const hostRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const activeRef = useRef(active)
  activeRef.current = active

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

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
    attachWebglRenderer(terminal)

    terminalRef.current = terminal
    fitRef.current = fit

    const disposeData = terminal.onData((data) => writeToTerminal(terminalId, data))
    const disposeResize = terminal.onResize(({ cols, rows }) =>
      resizeTerminal(terminalId, cols, rows)
    )
    const unsubscribeData = onTerminalData((id, data) => {
      if (id === terminalId) terminal.write(data)
    })
    // The desktop app owns the scrollback, so a panel mounting over a shell
    // that was already running repaints from it. Resetting first makes the
    // repaint idempotent, so bytes that arrived before it cannot show up twice.
    const unsubscribeReplay = onTerminalReplay((id, data) => {
      if (id !== terminalId) return
      terminal.reset()
      if (data) terminal.write(data)
    })

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
        if (!activeRef.current) return
        try {
          fit.fit()
        } catch {
          // Zero-sized while animating; the next observation refits.
        }
      }, RESIZE_SETTLE_MS)
    })
    observer.observe(host)

    return () => {
      if (resizeTimer) clearTimeout(resizeTimer)
      observer.disconnect()
      unsubscribeData()
      unsubscribeReplay()
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

  useEffect(() => {
    const terminal = terminalRef.current
    if (!terminal) return
    terminal.options.theme = resolvedTheme === 'dark' ? DARK_THEME : LIGHT_THEME
  }, [resolvedTheme])

  useEffect(() => {
    if (!active) return
    // Measure after the browser has laid the newly shown terminal out.
    const frame = requestAnimationFrame(() => {
      try {
        fitRef.current?.fit()
        terminalRef.current?.focus()
      } catch {
        // Panel still animating; the ResizeObserver refits.
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [active])

  // An inactive tab is `display: none`, not merely invisible. xterm watches its
  // element with an IntersectionObserver and pauses rendering once it stops
  // intersecting — which `visibility: hidden` never does, since it still
  // occupies its box. Left that way, every background terminal keeps painting
  // output nobody is looking at, out of the active terminal's frame budget.
  // xterm re-measures and does a full refresh when the element comes back.
  return <div ref={hostRef} className={cn('absolute inset-0 px-2 py-1', !active && 'hidden')} />
}

/**
 * The terminal panel. Unlike the browser panel, nothing native is overlaid
 * here: xterm.js renders each PTY's bytes in the DOM, so the panel is an
 * ordinary React subtree that happens to be a set of working terminals.
 */
export function TerminalSession() {
  const { tabs, activeTerminalId } = useCopilotTerminalStore((state) => state.tabs)
  const { removeResource } = useMothershipResources()
  const [startError, setStartError] = useState<string | null>(null)

  useEffect(() => {
    startTerminalSession({ cols: 80, rows: 24 })
      .then(() => setStartError(null))
      .catch((error: Error) => setStartError(error.message))
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

  // The spinner means "transient work in progress", which is why a full-screen
  // program does not get one: an editor or coding agent owns the terminal until
  // it is quit, and spinning for the hour it is open would say the wrong thing.
  // It is the only sign that something is running in a tab nobody is looking at.
  const items = useMemo<TabStripItem[]>(
    () =>
      tabs.map((tab) => ({
        id: tab.terminalId,
        title: tab.title,
        icon:
          tab.running && !tab.interactive ? (
            <Loader className='size-[12px] shrink-0 animate-spin text-[var(--text-icon)]' />
          ) : (
            <TerminalWindow className='size-[12px] shrink-0 text-[var(--text-icon)]' />
          ),
        active: tab.terminalId === activeTerminalId,
      })),
    [tabs, activeTerminalId]
  )

  const handleNew = useCallback(() => {
    void openTerminal()
  }, [])
  const handleSwitch = useCallback((terminalId: string) => {
    void switchTerminal(terminalId)
  }, [])
  const handleClose = useCallback((terminalId: string) => {
    void closeTerminal(terminalId)
  }, [])

  return (
    <div className='flex h-full flex-col overflow-hidden bg-[var(--bg)]'>
      {tabs.length > 0 && (
        <TabStrip
          tabs={items}
          onSelect={handleSwitch}
          onNew={handleNew}
          maxTabs={MAX_TERMINALS}
          newTabLabel='New terminal'
          {...(tabs.length > 1 ? { onClose: handleClose } : {})}
        />
      )}

      <div className='relative min-h-0 flex-1'>
        {tabs.map((tab) => (
          <TerminalView
            key={tab.terminalId}
            terminalId={tab.terminalId}
            active={tab.terminalId === activeTerminalId}
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
