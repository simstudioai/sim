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
  /**
   * Disables the whole menu — for a menu that acts on a selection and has
   * nothing to act on. `disabled` belongs on the TRIGGER, not on the button
   * inside it: Radix gates opening on the trigger's own prop, and a disabled
   * `<button>` still dispatches `pointerdown` in Chrome, so a menu disabled
   * only on the child would look inert and still open.
   */
  disabled?: boolean
  /** Layout-only classes for the trigger button (e.g. a left margin). */
  triggerClassName?: string
}

/**
 * Canonical `...` actions menu — the trailing menu of a settings list row, and
 * the bulk-action menu of a table's select-all band. Mirrors the Teammates /
 * Secrets / API-key row menus so every one of them behaves identically.
 *
 * An action with a `tooltip` gets its item wrapped in a plain span tooltip
 * trigger (the settings-header chip pattern) — a disabled item is
 * `pointer-events-none`, so the wrapper is what keeps hover working.
 */
export function RowActionsMenu({
  label,
  actions,
  disabled,
  triggerClassName,
}: RowActionsMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button type='button' aria-label={label} className={cn(chipVariants(), triggerClassName)}>
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
