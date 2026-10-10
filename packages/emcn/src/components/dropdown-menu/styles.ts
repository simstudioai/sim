import {
  chipContentGap,
  chipFieldSurfaceClass,
  chipFieldTextClass,
  chipRadiusClass,
} from '#chip-chrome'
import { cn } from '#cn'

/** Shared chrome for action menus, picker lists, and their floating surfaces. */
export const MENU_STYLES = {
  surface:
    'rounded-xl border border-[var(--border)] bg-[var(--bg)] text-[var(--text-body)] shadow-medium',
  padding: 'p-1',
  rowLayout: `flex min-w-0 items-center ${chipContentGap} ${chipRadiusClass} px-2 max-md:pointer-coarse:min-h-11`,
  sizes: {
    sm: { height: 24, className: 'h-[24px] text-caption' },
    md: { height: 28, className: 'h-[28px] text-small' },
  },
  heading: 'flex h-[28px] items-center px-2 text-[var(--text-muted)] text-caption',
  selectionIcon: 'ml-auto size-[14px] shrink-0 text-[var(--text-icon)]',
  separator: 'mx-2 my-1 border-[var(--border)] border-t',
  search: `${chipFieldSurfaceClass} my-0.5 flex h-[28px] shrink-0 items-center ${chipContentGap} px-2 max-md:pointer-coarse:min-h-11`,
  searchInput: cn(chipFieldTextClass, 'size-full min-w-0 bg-transparent text-small'),
} as const
