import { cn, MENU_STYLES } from '@sim/emcn'

/** Shared floating toolbar chrome for text and table selections. */
export const BUBBLE_MENU_CLASS = cn(
  MENU_STYLES.surface,
  MENU_STYLES.padding,
  'scrollbar-none fade-in-0 absolute top-0 left-0 z-[var(--z-popover)] flex w-max max-w-[calc(100%_-_1rem)] animate-in items-center gap-0.5 overflow-x-auto duration-150 ease-out motion-reduce:animate-none'
)
