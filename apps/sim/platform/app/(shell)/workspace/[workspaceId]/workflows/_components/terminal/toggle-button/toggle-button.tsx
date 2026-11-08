import type { MouseEvent } from 'react'
import { IconButton } from '@sim/emcn/button'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/terminal/toggle-button/toggle-button.module.css'

interface ToggleButtonProps {
  isExpanded: boolean
  onToggle: () => void
}

/** The terminal's collapse control: its chevron points down while open and up while folded. */
export function ToggleButton({ isExpanded, onToggle }: ToggleButtonProps) {
  return (
    <IconButton
      render={
        <button
          type='button'
          className={styles.toggle}
          aria-expanded={isExpanded}
          data-collapsed={!isExpanded || undefined}
        />
      }
      label={isExpanded ? 'Collapse terminal' : 'Expand terminal'}
      icon='I051'
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
