'use client'

import {
  type ComponentType,
  forwardRef,
  type ReactNode,
  useContext,
  useMemo,
  useState,
} from 'react'
import type { VariantProps } from 'class-variance-authority'
import { Check, ChevronDown } from '../../icons'
import { cn } from '../../lib/cn'
import { chipVariants, TRIGGER_BORDER_CLASS } from '../chip/chip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSearchInput,
  DropdownMenuTrigger,
} from '../dropdown-menu/dropdown-menu'
import { InsideModalContext } from '../modal/modal'

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
  /** Pre-rendered leading element (e.g. an avatar) — takes precedence over `icon`. */
  iconElement?: ReactNode
}

/**
 * Trigger + menu chrome props shared by both selection modes.
 */
interface ChipDropdownBaseProps extends VariantProps<typeof chipVariants> {
  /** Options to render in the menu. */
  options: ReadonlyArray<ChipDropdownOption>
  /** Shown in the trigger when nothing is selected. */
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
  /** Optional icon rendered before the label (mirrors `Chip`'s `leftIcon`). */
  leftIcon?: ChipIcon
  /** Forwarded class for the trigger button. */
  className?: string
  /**
   * Accessible name for the trigger. Use when the visible label sits outside
   * the component (a field label above it) rather than in the selected value.
   */
  'aria-label'?: string
  /** Id of the element naming the trigger. Pair with a visible field label. */
  'aria-labelledby'?: string
}

/**
 * Single-select props (the default). Picking an option closes the menu and
 * reports the new value via `onChange`.
 */
interface ChipDropdownSingleProps extends ChipDropdownBaseProps {
  multiple?: false
  /** Currently selected value. */
  value?: string
  /** Called when the user picks a different option from the menu. */
  onChange?: (value: string) => void
  /**
   * Whether to render a trailing check icon on the currently selected item
   * (default `true`). When `false`, items render without the check affordance.
   */
  showSelectedCheck?: boolean
}

/**
 * Multi-select props. The menu stays open across toggles; each active option is
 * marked with a trailing check, and `onChange` reports the next selected set.
 */
interface ChipDropdownMultiProps extends ChipDropdownBaseProps {
  multiple: true
  /** Currently selected values. Empty array reads as "all" / no filter. */
  value?: string[]
  /** Called with the next selected values when an option is toggled. */
  onChange?: (values: string[]) => void
  /** Label shown in the trigger and as the reset row when nothing is selected. */
  allLabel?: string
  /**
   * Whether to render the leading "all" reset row inside the menu. Defaults to
   * `true` for filter-style use (empty selection reads as "all"). Set `false`
   * for selection-style pickers where an empty list is a real "nothing
   * selected" state rather than an "all" shortcut.
   */
  showAllOption?: boolean
  /** Renders a search field at the top of the menu that filters options by label. */
  searchable?: boolean
  /** Placeholder for the search field. */
  searchPlaceholder?: string
}

type ChipDropdownProps = ChipDropdownSingleProps | ChipDropdownMultiProps

/**
 * Dropdown counterpart to {@link Chip} — a 30px pill that opens a menu of
 * options. In single mode (the default) it reports the picked value; in
 * `multiple` mode it toggles values, keeps the menu open across selections,
 * and optionally renders an "all" reset row and a search field.
 *
 * The trigger reuses `chipVariants` for visual parity with `Chip`. The label
 * is `flex-1`, so the trailing chevron is pushed flush right. The chevron is
 * owned by the component and rendered at `h-[6px] w-[10px]` (matching the
 * workspace-header chevron) — there is intentionally no `rightIcon` prop. The
 * trigger and menu shell are identical across modes; only the selection
 * semantics (label, item handlers, open state, search) branch on `multiple`.
 *
 * @example
 * // Single-select
 * <ChipDropdown
 *   value={member.role}
 *   onChange={(role) => updateRole(role)}
 *   options={ROLE_OPTIONS}
 *   placeholder='Select role'
 * />
 *
 * @example
 * // Multi-select
 * <ChipDropdown
 *   multiple
 *   value={ownerFilter}
 *   onChange={setOwnerFilter}
 *   options={memberOptions}
 *   allLabel='All'
 *   searchable
 *   searchPlaceholder='Search members...'
 *   fullWidth
 *   flush
 * />
 */
const ChipDropdown = forwardRef<HTMLButtonElement, ChipDropdownProps>(
  function ChipDropdown(props, ref) {
    const {
      options,
      placeholder,
      align = 'end',
      matchTriggerWidth = true,
      contentClassName,
      disabled,
      leftIcon: LeftIcon,
      className,
      variant = 'filled',
      active,
      fullWidth,
      flush,
      'aria-label': ariaLabel,
      'aria-labelledby': ariaLabelledBy,
    } = props

    const isMultiple = props.multiple === true
    const selectedValues = useMemo<string[]>(
      () => (isMultiple ? (props.value ?? []) : props.value != null ? [props.value] : []),
      [isMultiple, props.value]
    )

    /**
     * Inside a modal dialog the menu must be modal too: a non-modal menu
     * portaled to `body` inherits the dialog's `pointer-events: none` body
     * lock and outside-scroll lock (unclickable, unscrollable), and the
     * dialog's still-active focus trap fights item focus. Outside dialogs we
     * stay non-modal so filter chips don't lock page scroll while open.
     */
    const insideModal = useContext(InsideModalContext)

    const [open, setOpen] = useState(false)
    const [search, setSearch] = useState('')
    const searchable = isMultiple && props.searchable === true
    const searchPlaceholder = isMultiple ? (props.searchPlaceholder ?? 'Search...') : 'Search...'
    const allLabel = isMultiple ? (props.allLabel ?? 'All') : ''
    const showAllOption = isMultiple ? props.showAllOption !== false : false
    const showSelectedCheck = isMultiple || props.showSelectedCheck !== false

    const filteredOptions = useMemo(() => {
      const query = search.trim().toLowerCase()
      if (!searchable || !query) return options
      return options.filter(
        (option) => typeof option.label === 'string' && option.label.toLowerCase().includes(query)
      )
    }, [options, searchable, search])

    const isInverse = variant === 'primary' || variant === 'destructive'
    const hasTriggerBorder = variant !== 'primary' && variant !== 'destructive'

    let displayLabel: ReactNode
    if (isMultiple) {
      displayLabel =
        selectedValues.length === 0
          ? allLabel
          : selectedValues.length === 1
            ? (options.find((option) => option.value === selectedValues[0])?.label ?? allLabel)
            : `${selectedValues.length} selected`
    } else {
      const selected = options.find((option) => option.value === selectedValues[0])
      displayLabel = selected?.label ?? placeholder ?? 'Select...'
    }
    const isPlaceholder = !isMultiple && selectedValues.length === 0

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
    const labelClass = cn(
      'min-w-0 flex-1 truncate text-sm',
      !isInverse && 'text-[var(--text-body)]'
    )

    const renderItem = (option: ChipDropdownOption) => {
      const isSelected = selectedValues.includes(option.value)
      const OptionIcon = option.icon
      return (
        <DropdownMenuItem
          key={option.value}
          onSelect={(event) => {
            if (isMultiple) {
              event.preventDefault()
              props.onChange?.(
                isSelected
                  ? selectedValues.filter((v) => v !== option.value)
                  : [...selectedValues, option.value]
              )
            } else {
              props.onChange?.(option.value)
            }
          }}
        >
          {option.iconElement ?? (OptionIcon ? <OptionIcon /> : null)}
          <span>{option.label}</span>
          {showSelectedCheck && isSelected ? <Check className='!ml-auto !size-[16px]' /> : null}
        </DropdownMenuItem>
      )
    }

    return (
      <DropdownMenu
        modal={insideModal}
        {...(isMultiple
          ? {
              open,
              onOpenChange: (next: boolean) => {
                setOpen(next)
                if (!next) setSearch('')
              },
            }
          : {})}
      >
        <DropdownMenuTrigger asChild disabled={disabled}>
          <button
            ref={ref}
            type='button'
            disabled={disabled}
            aria-label={ariaLabel}
            aria-labelledby={ariaLabelledBy}
            className={cn(
              chipVariants({ variant, active, fullWidth, flush }),
              hasTriggerBorder && TRIGGER_BORDER_CLASS,
              className
            )}
          >
            {LeftIcon ? <LeftIcon className={iconClass} /> : null}
            <span
              className={cn(labelClass, isPlaceholder && !isInverse && 'text-[var(--text-muted)]')}
            >
              {displayLabel}
            </span>
            <span aria-hidden className={chevronSlotClass}>
              <ChevronDown className='h-[6px] w-[10px]' />
            </span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align={align}
          onOpenAutoFocus={searchable ? (event) => event.preventDefault() : undefined}
          className={cn(
            matchTriggerWidth && 'w-[var(--radix-dropdown-menu-trigger-width)] max-w-none',
            contentClassName
          )}
        >
          {searchable && (
            <DropdownMenuSearchInput
              placeholder={searchPlaceholder}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setOpen(false)
              }}
            />
          )}
          {showAllOption && (
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault()
                if (isMultiple) props.onChange?.([])
              }}
            >
              <span>{allLabel}</span>
              {selectedValues.length === 0 ? <Check className='!ml-auto !size-[16px]' /> : null}
            </DropdownMenuItem>
          )}
          {filteredOptions.map(renderItem)}
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }
)

ChipDropdown.displayName = 'ChipDropdown'

export { ChipDropdown }
export type { ChipDropdownOption, ChipDropdownProps }
