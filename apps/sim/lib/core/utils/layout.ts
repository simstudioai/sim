/** Returns the width currently occupied by the workflow inspector and tool rail. */
export function getVisiblePanelWidth(): number {
  if (typeof document === 'undefined') return 0

  return (
    document.querySelector<HTMLElement>('.workflow-right-tools')?.getBoundingClientRect().width ?? 0
  )
}

/** Returns the height currently occupied by the workflow header. */
export function getVisibleWorkflowHeaderHeight(): number {
  if (typeof document === 'undefined') return 0

  return (
    document.querySelector<HTMLElement>('.workflow-header')?.getBoundingClientRect().height ?? 0
  )
}
