import {
  chipVariants,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  MoreHorizontal,
  Tooltip,
} from '@sim/emcn'

export interface RowAction {
  label: string
  onSelect: () => void
  /** Renders in the error color (e.g. Delete). */
  destructive?: boolean
  disabled?: boolean
  /** Hover tooltip on the item (e.g. why it's disabled) — mirrors `SettingsAction.tooltip`. */
  tooltip?: string
}

interface RowActionsMenuProps {
  /** Accessible label for the trigger, e.g. `API key actions`. */
  label: string
  actions: RowAction[]
  /** Layout-only classes for the trigger button (e.g. a left margin). */
  triggerClassName?: string
}

/**
 * Canonical trailing `...` actions menu for a settings list row. Mirrors the
 * Teammates / Secrets / API-key row menus so every list row behaves identically.
 *
 * An action with a `tooltip` gets its item wrapped in a plain span tooltip
 * trigger (the settings-header chip pattern) — a disabled item is
 * `pointer-events-none`, so the wrapper is what keeps hover working.
 */
export function RowActionsMenu({ label, actions, triggerClassName }: RowActionsMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type='button'
          aria-label={label}
          className={cn(chipVariants({ flush: true }), triggerClassName)}
        >
          <MoreHorizontal className='size-[14px] flex-shrink-0 text-[var(--text-icon)]' />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end'>
        {actions.map((action) => {
          const item = (
            <DropdownMenuItem
              key={action.label}
              onSelect={action.onSelect}
              disabled={action.disabled}
              className={action.destructive ? 'text-[var(--text-error)]' : undefined}
            >
              {action.label}
            </DropdownMenuItem>
          )
          return action.tooltip ? (
            <Tooltip.Root key={action.label}>
              <Tooltip.Trigger asChild>
                <span className='block'>{item}</span>
              </Tooltip.Trigger>
              <Tooltip.Content>{action.tooltip}</Tooltip.Content>
            </Tooltip.Root>
          ) : (
            item
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
