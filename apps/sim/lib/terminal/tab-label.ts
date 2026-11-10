import type { TerminalTabState } from '@sim/terminal-protocol'

/**
 * Whether a tab should be named after what it is running rather than where it
 * is. A full-screen program is named the moment it appears: the delay exists
 * to stop `ls` flickering the label, and an editor or coding agent is not a
 * transient command — it holds the terminal until it is quit, so there is
 * nothing to wait out.
 */
export function namesItsCommand(tab: TerminalTabState, settled: ReadonlySet<string>): boolean {
  return Boolean(tab.running) && (tab.interactive || settled.has(tab.terminalId))
}

/** The strip label for a terminal: its settled foreground program, else its cwd basename. */
export function terminalTabTitle(tab: TerminalTabState, settled: ReadonlySet<string>): string {
  return namesItsCommand(tab, settled) ? (tab.running ?? tab.title) : tab.title
}
