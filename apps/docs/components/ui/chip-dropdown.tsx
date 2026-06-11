'use client'

import { type ComponentType, forwardRef, type ReactNode } from 'react'
import { Check } from 'lucide-react'
import { ChipChevronDown, chipVariants, TRIGGER_BORDER_CLASS } from '@/components/ui/chip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

type ChipIcon = ComponentType<{ className?: string }>

/**
 * Single option rendered inside a {@link ChipDropdown}.
 */
interface ChipDropdownOption {
  /** Stable identifier returned via `onChange`. */
  value: string
  /** Visual label rendered both inside the trigger (when selected) and in the menu. */
  label: ReactNode
  /** Optional leading icon rendered inside the menu item. */
  icon?: ChipIcon
  /** Pre-rendered leading element (e.g. a flag) — takes precedence over `icon`. */
  iconElement?: ReactNode
}

interface ChipDropdownProps {
  /** Options to render in the menu. */
  options: ReadonlyArray<ChipDropdownOption>
  /** Currently selected value. */
  value?: string
  /** Called when the user picks a different option from the menu. */
  onChange?: (value: string) => void
  /** Shown in the trigger when nothing is selected. */
  placeholder?: string
  /** Aligns the dropdown popover relative to the trigger. */
  align?: 'start' | 'center' | 'end'
  /**
   * Whether the menu width should match the trigger's. When `true` (default),
   * the menu pins to `--radix-dropdown-menu-trigger-width`. Set `false` to let
   * the menu size to its widest item.
   */
  matchTriggerWidth?: boolean
  /** Forwarded to the inner `DropdownMenuContent`. */
  contentClassName?: string
  /** Disables the trigger. */
  disabled?: boolean
  /** Optional icon rendered before the label. */
  leftIcon?: ChipIcon
  /** Forwarded class for the trigger button — layout/sizing only. */
  className?: string
}

/**
 * Docs-local mirror of the emcn `ChipDropdown`
 * (`apps/sim/components/emcn/components/chip-dropdown/chip-dropdown.tsx`) — a
 * 30px filled chip pill that opens a menu of options. The trigger reuses
 * `chipVariants` for visual parity with `Chip`; the chevron is owned by the
 * component and rendered in a 16px slot so the label's trailing gap matches a
 * leading icon's.
 *
 * @example
 * <ChipDropdown
 *   value={currentLang}
 *   onChange={setLanguage}
 *   options={LANGUAGE_OPTIONS}
 *   align='end'
 *   matchTriggerWidth={false}
 * />
 */
const ChipDropdown = forwardRef<HTMLButtonElement, ChipDropdownProps>(function ChipDropdown(
  {
    options,
    value,
    onChange,
    placeholder,
    align = 'end',
    matchTriggerWidth = true,
    contentClassName,
    disabled,
    leftIcon: LeftIcon,
    className,
  },
  ref
) {
  const selected = options.find((option) => option.value === value)
  const displayLabel = selected?.label ?? placeholder ?? 'Select...'
  const isPlaceholder = selected == null

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          ref={ref}
          type='button'
          disabled={disabled}
          className={cn(chipVariants({ variant: 'filled' }), TRIGGER_BORDER_CLASS, className)}
        >
          {LeftIcon ? (
            <LeftIcon className='size-[16px] flex-shrink-0 text-[var(--text-icon)]' />
          ) : null}
          <span
            className={cn(
              'min-w-0 flex-1 truncate text-sm',
              isPlaceholder ? 'text-[var(--text-muted)]' : 'text-[var(--text-body)]'
            )}
          >
            {displayLabel}
          </span>
          <ChipChevronDown />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={align}
        className={cn(
          matchTriggerWidth && 'w-[var(--radix-dropdown-menu-trigger-width)]',
          contentClassName
        )}
      >
        {options.map((option) => {
          const isSelected = option.value === value
          const OptionIcon = option.icon
          return (
            <DropdownMenuItem key={option.value} onSelect={() => onChange?.(option.value)}>
              {option.iconElement ?? (OptionIcon ? <OptionIcon /> : null)}
              <span>{option.label}</span>
              {isSelected ? <Check className='!ml-auto !size-[16px]' /> : null}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
})

export { ChipDropdown }
export type { ChipDropdownOption, ChipDropdownProps }
