/** Reads the rendered workflow panel width, including responsive bounds and live resizing. */
export function getPanelWidth(): number {
  if (typeof document === 'undefined') return 0

  const panel = document.querySelector<HTMLElement>('.panel-container')
  if (panel) return panel.getBoundingClientRect().width

  return Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue('--panel-width') || '0'
  )
}

/** Reads the rendered terminal height, falling back to saved layout before it mounts. */
export function getTerminalHeight(): number {
  if (typeof document === 'undefined') return 0

  const terminal = document.querySelector<HTMLElement>('.terminal-container')
  if (terminal) return terminal.getBoundingClientRect().height

  return Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue('--terminal-height') || '0'
  )
}
