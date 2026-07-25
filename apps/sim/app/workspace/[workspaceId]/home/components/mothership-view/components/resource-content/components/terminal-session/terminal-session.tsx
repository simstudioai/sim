'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { TerminalWindow } from '@sim/emcn/icons'
import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import { Terminal } from '@xterm/xterm'
import { useTheme } from 'next-themes'
import '@xterm/xterm/css/xterm.css'
import { TERMINAL_SESSION_RESOURCE_ID } from '@/lib/copilot/resources/types'
import {
  onTerminalData,
  onTerminalReplay,
  resizeTerminal,
  startTerminalSession,
  writeToTerminal,
} from '@/lib/terminal/transport'
import { useMothershipResources } from '@/app/workspace/[workspaceId]/home/components/mothership-resources-context'
import { useCopilotTerminalStore } from '@/stores/copilot-terminal/store'

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
 * The terminal panel. Unlike the browser panel, nothing native is overlaid
 * here: xterm.js renders the PTY's bytes in the DOM, so the panel is an
 * ordinary React subtree that happens to be a fully functioning terminal.
 */
export function TerminalSession() {
  const { resolvedTheme } = useTheme()
  const hostRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const session = useCopilotTerminalStore((state) => state.session)
  const { removeResource } = useMothershipResources()
  const [startError, setStartError] = useState<string | null>(null)

  const start = useCallback(async (cols: number, rows: number) => {
    try {
      await startTerminalSession({ cols, rows })
      setStartError(null)
    } catch (error) {
      setStartError((error as Error).message)
    }
  }, [])

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
    // WebGL is a big win on heavy output but is unavailable in some GPU
    // configurations; the DOM renderer is a correct, slower fallback.
    try {
      terminal.loadAddon(new WebglAddon())
    } catch {
      // Canvas/DOM renderer remains in place.
    }

    terminalRef.current = terminal

    fit.fit()
    const disposeData = terminal.onData((data) => writeToTerminal(data))
    const disposeResize = terminal.onResize(({ cols, rows }) => resizeTerminal(cols, rows))
    const unsubscribeData = onTerminalData((data) => terminal.write(data))
    // The desktop app owns the scrollback, so a panel mounting over a shell
    // that was already running repaints from it rather than from anything the
    // renderer kept. Resetting first makes the repaint idempotent, so bytes
    // that arrived before it cannot show up twice.
    const unsubscribeReplay = onTerminalReplay((data) => {
      terminal.reset()
      if (data) terminal.write(data)
    })

    const observer = new ResizeObserver(() => {
      try {
        fit.fit()
      } catch {
        // Zero-sized while the panel animates; the next observation refits.
      }
    })
    observer.observe(host)

    void start(terminal.cols, terminal.rows)

    return () => {
      observer.disconnect()
      unsubscribeData()
      unsubscribeReplay()
      disposeData.dispose()
      disposeResize.dispose()
      terminal.dispose()
      terminalRef.current = null
    }
    // Theme changes are applied through the separate effect below so the
    // terminal is never torn down (and its buffer never lost) for a repaint.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start])

  useEffect(() => {
    const terminal = terminalRef.current
    if (!terminal) return
    terminal.options.theme = resolvedTheme === 'dark' ? DARK_THEME : LIGHT_THEME
  }, [resolvedTheme])

  // `exit`, Ctrl-D, or a crashed shell ends the session, and a panel with no
  // shell behind it has nothing to show and no way back — so it closes itself.
  // Gated on having been alive so the pre-start null state never closes it.
  const wasAlive = useRef(false)
  useEffect(() => {
    if (session?.alive) {
      wasAlive.current = true
      return
    }
    if (session && !session.alive && wasAlive.current) {
      wasAlive.current = false
      removeResource('terminal', TERMINAL_SESSION_RESOURCE_ID)
    }
  }, [session, removeResource])

  return (
    <div className='flex h-full flex-col overflow-hidden bg-[var(--bg)]'>
      <div className='flex shrink-0 items-center gap-2 border-[var(--border)] border-b px-2.5 py-1.5'>
        <TerminalWindow className='size-[14px] shrink-0 text-[var(--text-tertiary)]' />
        <span className='min-w-0 flex-1 truncate font-mono text-[var(--text-secondary)] text-small'>
          {session?.cwd ?? 'No shell running'}
        </span>
        {session?.foregroundCommand && (
          <span className='shrink-0 text-[var(--text-muted)] text-small'>Running…</span>
        )}
      </div>

      <div className='relative min-h-0 flex-1'>
        <div ref={hostRef} className='absolute inset-0 px-2 py-1' />
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
