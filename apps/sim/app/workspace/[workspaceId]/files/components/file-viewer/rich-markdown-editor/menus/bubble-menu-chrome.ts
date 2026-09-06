/**
 * Shared chrome for the editor's selection-driven bubble toolbars — the text formatting bar and the
 * table bar. Single source of truth so the two read identically; never re-derive this class string
 * per consumer.
 */

/** The floating toolbar: bordered card, popover layer, with the enter animation. */
export const BUBBLE_MENU_CLASS =
  'scrollbar-none fade-in-0 z-[var(--z-popover)] flex max-w-[calc(100%_-_1rem)] animate-in items-center gap-0.5 overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--bg)] p-1 shadow-xs duration-150 ease-out motion-reduce:animate-none'
