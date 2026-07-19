/**
 * The rhythm of one chat turn, shared by every surface that draws a transcript.
 *
 * Only the turn itself lives here — the row gap, the user bubble, the
 * attachment strip. The chrome AROUND the transcript (scroll container, sizer,
 * composer footer) stays with the surface, because that is the part that
 * legitimately differs between a full-page chat, a docked panel, and an
 * interface module sitting in a canvas cell.
 *
 * Two widths, chosen by how much horizontal room the transcript has, never by
 * which product surface it is:
 *
 * - `wide` — a full-page transcript inside a `max-w-[48rem]` column.
 * - `narrow` — a side panel or an interface module cell.
 */
export const CHAT_TURN_LAYOUT = {
  wide: {
    rowGap: 'pb-6',
    userRow: 'flex flex-col items-end gap-[6px] pt-3',
    attachmentWidth: 'max-w-[70%]',
    userBubble: 'max-w-[70%] overflow-hidden rounded-[16px] bg-[var(--surface-5)] px-3.5 py-2',
    assistantRow: 'group/msg',
  },
  narrow: {
    rowGap: 'pb-4',
    userRow: 'flex flex-col items-end gap-[6px] pt-2',
    attachmentWidth: 'max-w-[85%]',
    userBubble: 'max-w-[85%] overflow-hidden rounded-[16px] bg-[var(--surface-5)] px-3 py-2',
    assistantRow: 'group/msg',
  },
} as const

export type ChatTurnWidth = keyof typeof CHAT_TURN_LAYOUT

/**
 * Space between an assistant turn's last line and its action row.
 *
 * Smaller than it looks like it should be, deliberately: the 26px action button
 * carries 6px of its own transparent padding above a 14px icon, and the prose
 * line-height (`text-base` inside `leading-[25px]`) leaves ~5px of half-leading
 * under the glyphs. Both are invisible but occupy real space, so a nominal 10px
 * margin renders as ~21px of void — unnoticeable under a wide paragraph, but it
 * reads as a floating button in a narrow column.
 */
export const CHAT_ACTION_ROW_GAP = 'mt-1'

/** The icon-button chrome every per-message action uses (copy, feedback, fork). */
export const CHAT_ACTION_ICON_CLASS = 'size-[14px]'
export const CHAT_ACTION_BUTTON_CLASS =
  'flex size-[26px] items-center justify-center rounded-[6px] text-[var(--text-icon)] transition-colors hover-hover:bg-[var(--surface-hover)] focus-visible:outline-none'
