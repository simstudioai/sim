import type { MouseEvent } from 'react'
import { IconButton } from '@sim/emcn/button'

interface ToggleButtonProps {
  isExpanded: boolean
  onToggle: () => void
}

/** The terminal's collapse control, with the open and folded chevrons EMCN's Disclosure shows. */
export function ToggleButton({ isExpanded, onToggle }: ToggleButtonProps) {
  return (
    <IconButton
      render={<button type='button' aria-expanded={isExpanded} />}
      label={isExpanded ? 'Collapse terminal' : 'Expand terminal'}
      icon={isExpanded ? 'I051' : 'I090'}
      size='compact'
      tooltip
      onClick={onToggle}
    />
  )
}

/**
 * A click on a terminal header's empty space toggles the terminal, as the legacy header did. Clicks
 * on its controls, and on menus they portal out, keep their own meaning.
 */
export function toggleFromHeader(onToggle: () => void) {
  return (event: MouseEvent<HTMLElement>) => {
    const target = event.target
    if (!(target instanceof Element) || !event.currentTarget.contains(target)) return
    if (target.closest('button, a, input, [role="tab"], [role="separator"]')) return
    onToggle()
  }
}
