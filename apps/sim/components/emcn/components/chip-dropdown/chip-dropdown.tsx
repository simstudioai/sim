'use client'

import { type ComponentType, forwardRef, type ReactNode } from 'react'
import type { VariantProps } from 'class-variance-authority'
import { chipVariants, TRIGGER_BORDER_CLASS } from '@/components/emcn/components/chip/chip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/emcn/components/dropdown-menu/dropdown-menu'
import { Check, ChevronDown } from '@/components/emcn/icons'
import { cn } from '@/lib/core/utils/cn'

type ChipIcon = ComponentType<{ className?: string }>

/**
 * Single option rendered inside a {@link ChipDropdown}.
 */
interface ChipDropdownOption {
  /** Stable identifier returned via `onChange`. */
  value: string
  /** Visual label rendered both inside the trigger (when selected) and in the menu. */
  label: ReactNode
  /**
   * Optional leading icon rendered inside the menu item. Auto-sized to
   * `size-[14px]` and tinted with `--text-icon` via the item's base classes
   * (see `DROPDOWN_MENU_ITEM_BASE_CLASSES`).
   */
  icon?: ChipIcon
}

interface ChipDropdownProps extends VariantProps<typeof chipVariants> {
  /** Currently selected value. */
  value?: string
  /** Called when the user picks a different option from the menu. */
  onChange?: (value: string) => void
  /** Options to render in the menu. */
  options: ReadonlyArray<ChipDropdownOption>
  /** Shown in the trigger when no option matches `value`. */
  placeholder?: string
  /** Aligns the dropdown popover relative to the trigger. */
  align?: 'start' | 'center' | 'end'
  /**
   * Whether the menu width should match the trigger's. When `true` (default),
   * the menu pins to `--radix-dropdown-menu-trigger-width`. Set `false` to let
   * the menu size to its widest item (avoids truncating long option labels on
   * narrow triggers). For anything finer-grained, pass `contentClassName`.
   */
  matchTriggerWidth?: boolean
  /**
   * Forwarded to the inner `DropdownMenuContent`. Use this as the shadcn-style
   * escape hatch when neither `matchTriggerWidth` value fits (e.g. a fixed
   * pixel width, a different `max-width`, a wider `min-width` floor than the
   * `min-w-[8rem]` baked into `DropdownMenuContent`).
   */
  contentClassName?: string
  /** Disables the trigger. */
  disabled?: boolean
  /**
   * Whether to render a trailing check icon on the currently selected item
   * (default `true`). When `false`, items render without the check affordance.
   */
  showSelectedCheck?: boolean
  /** Optional icon rendered before the label (mirrors `Chip`'s `leftIcon`). */
  leftIcon?: ChipIcon
  /** Forwarded class for the trigger button. */
  className?: string
}

/**
 * Dropdown counterpart to {@link Chip} — a 30px pill that opens a menu of
 * options and reports the selected value via `onChange`.
 *
 * The trigger reuses `chipVariants` for visual parity with `Chip`. The label
 * is `flex-1`, so the trailing chevron is pushed flush right. The chevron is
 * owned by the component and rendered at `h-[6px] w-[10px]` (matching the
 * workspace-header chevron) — there is intentionally no `rightIcon` prop.
 *
 * @example
 * <ChipDropdown
 *   value={member.role}
 *   onChange={(role) => updateRole(role)}
 *   options={ROLE_OPTIONS}
 *   placeholder='Select role'
 * />
 */
const ChipDropdown = forwardRef<HTMLButtonElement, ChipDropdownProps>(function ChipDropdown(
  {
    value,
    onChange,
    options,
    placeholder,
    align = 'end',
    matchTriggerWidth = true,
    contentClassName,
    disabled,
    showSelectedCheck = true,
    leftIcon: LeftIcon,
    className,
    variant = 'filled',
    active,
    fullWidth,
    flush,
  },
  ref
) {
  const selected = options.find((option) => option.value === value)
  const displayLabel: ReactNode = selected?.label ?? placeholder ?? 'Select...'
  const isInverse = variant === 'primary' || variant === 'destructive'
  const hasTriggerBorder = variant !== 'primary' && variant !== 'destructive'
  const iconClass = cn('size-[16px] flex-shrink-0', !isInverse && 'text-[var(--text-icon)]')
  /**
   * The chevron glyph stays at its conventional subtle size, but is rendered
   * inside a `size-[16px]` slot so its bounding box matches `leftIcon`'s. The
   * chip's `gap-2` then produces visually equal spacing on both sides of the
   * label — without this, the smaller glyph's bounding box would let the
   * chevron read as glued to the text relative to the leading icon.
   */
  const chevronSlotClass = cn(
    'inline-flex size-[16px] flex-shrink-0 items-center justify-center',
    !isInverse && 'text-[var(--text-icon)]'
  )
  /**
   * `flex-1` is always applied so the chevron is pushed flush against the
   * trailing edge whenever the trigger gets stretched — by `fullWidth`, by a
   * flex parent with `flex-grow`, or by a CSS grid cell with a fixed track.
   * On intrinsic-width triggers (`inline-flex` with no parent constraint) the
   * container is sized to max-content, so `flex-grow` has no leftover space to
   * consume and the layout collapses to the natural `gap-2` between items.
   */
  const labelClass = cn('min-w-0 flex-1 truncate text-sm', !isInverse && 'text-[var(--text-body)]')

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          ref={ref}
          type='button'
          disabled={disabled}
          className={cn(
            chipVariants({ variant, active, fullWidth, flush }),
            hasTriggerBorder && TRIGGER_BORDER_CLASS,
            className
          )}
        >
          {LeftIcon ? <LeftIcon className={iconClass} /> : null}
          <span className={labelClass}>{displayLabel}</span>
          <span aria-hidden className={chevronSlotClass}>
            <ChevronDown className='h-[6px] w-[10px]' />
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={align}
        className={cn(
          'z-[var(--z-popover)]',
          matchTriggerWidth && 'w-[var(--radix-dropdown-menu-trigger-width)] max-w-none',
          contentClassName
        )}
      >
        {options.map((option) => {
          const isSelected = option.value === value
          const OptionIcon = option.icon
          return (
            <DropdownMenuItem key={option.value} onSelect={() => onChange?.(option.value)}>
              {OptionIcon ? <OptionIcon /> : null}
              <span>{option.label}</span>
              {showSelectedCheck && isSelected ? <Check className='!ml-auto !size-[16px]' /> : null}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
})

ChipDropdown.displayName = 'ChipDropdown'

export { ChipDropdown }
export type { ChipDropdownOption, ChipDropdownProps }
