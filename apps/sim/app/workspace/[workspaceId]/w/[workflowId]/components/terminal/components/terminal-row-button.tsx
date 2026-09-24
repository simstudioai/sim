import type { ButtonHTMLAttributes } from 'react'
import { cn } from '@sim/emcn'
import { ROW_STYLES } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/terminal/types'

export interface TerminalRowButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-pressed'> {
  /** Use the selected chip surface for the active output row. */
  selected?: boolean
}

/** Native terminal row action with the established EMCN chip surface. */
export function TerminalRowButton({
  selected,
  className,
  onClick,
  type,
  ...props
}: TerminalRowButtonProps) {
  return (
    <button
      type={type ?? 'button'}
      className={cn(selected ? ROW_STYLES.rowSelected : ROW_STYLES.row, className)}
      aria-pressed={selected}
      onClick={(event) => {
        event.stopPropagation()
        onClick?.(event)
      }}
      {...props}
    />
  )
}
