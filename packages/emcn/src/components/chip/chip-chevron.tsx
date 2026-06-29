import { ChevronDown } from '../../icons'
import { cn } from '../../lib/cn'

interface ChipChevronDownProps {
  /** Layout-only extras (e.g. `ml-auto` to push the chevron flush right). Never chrome. */
  className?: string
}

/**
 * Canonical trailing chevron adornment for chip-style dropdown triggers — a
 * 16px hidden-from-AT slot centering the 10×6 {@link ChevronDown} glyph in
 * `--text-icon`, matching the chevron `ChipDropdown` owns internally. Use it
 * inside hand-built `chipVariants` triggers (breadcrumb dropdowns, header
 * "New column"-style buttons) instead of re-deriving the span + icon markup.
 *
 * @example
 * <button type='button' className={chipVariants()}>
 *   <span className={chipContentLabelClass}>New column</span>
 *   <ChipChevronDown />
 * </button>
 */
export function ChipChevronDown({ className }: ChipChevronDownProps) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex size-[16px] flex-shrink-0 items-center justify-center text-[var(--text-icon)]',
        className
      )}
    >
      <ChevronDown className='h-[6px] w-[10px]' />
    </span>
  )
}
