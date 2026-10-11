/** Reads the rendered terminal height, falling back to saved layout before it mounts. */
export function getTerminalHeight(): number {
  if (typeof document === 'undefined') return 0

  const terminal = document.querySelector<HTMLElement>('.terminal-container')
  if (terminal) return terminal.getBoundingClientRect().height

  return Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue('--terminal-height') || '0'
  )
}
