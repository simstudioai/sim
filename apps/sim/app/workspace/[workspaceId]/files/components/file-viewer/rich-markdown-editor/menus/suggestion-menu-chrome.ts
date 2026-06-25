/**
 * Shared chrome for the editor's keyboard-driven suggestion popups — the `/` slash-command menu and
 * the `@` mention menu. Single source of truth so the two read identically; never re-derive these
 * class strings per consumer.
 */

/** The floating panel: bordered card with the enter animation, width-capped like the chat mention menu. */
export const SUGGESTION_SURFACE_CLASS =
  'min-w-[220px] max-w-[min(300px,calc(100vw-32px))] origin-top-left animate-in rounded-xl border border-[var(--border)] bg-[var(--bg)] p-1.5 shadow-sm duration-100 fade-in-0 zoom-in-95 slide-in-from-top-2 motion-reduce:animate-none'

/**
 * A scrollable list body, added alongside {@link SUGGESTION_SURFACE_CLASS}. Caps the height and scrolls
 * — matching the chat composer's `@` menu — so a long workspace list never overflows its container.
 */
export const SUGGESTION_SCROLL_CLASS = 'max-h-[240px] scroll-py-1.5 overflow-y-auto overscroll-none'

/** A selectable row: icon + label, 14px icon in `--text-icon`, truncating label. */
export const SUGGESTION_ITEM_CLASS =
  'relative flex w-full min-w-0 cursor-pointer select-none items-center gap-2 rounded-[5px] px-2 py-1.5 text-left font-medium text-[var(--text-body)] text-caption outline-none transition-colors [&>span]:min-w-0 [&>span]:truncate [&_svg]:pointer-events-none [&_svg]:size-[14px] [&_svg]:shrink-0 [&_svg]:text-[var(--text-icon)]'

/** A group heading above a run of rows. */
export const SUGGESTION_GROUP_LABEL_CLASS =
  'px-2 pt-1.5 pb-1 font-medium text-[var(--text-muted)] text-micro uppercase tracking-wide'
