/**
 * Compact date labels for dense table rows (`Jul 31`, `Jul 31 14:22`).
 *
 * Lives in `lib/` rather than beside the logs table because three unrelated
 * features render it — logs, credit usage, and audit logs — and the previous
 * home (`app/workspace/[workspaceId]/logs/utils.ts`) also exports registry-backed
 * badge components. Importing a date formatter from there pulled
 * `@/blocks/registry` → all 282 block configs → the tool registry into every
 * consumer's bundle.
 */

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const

/**
 * Formats an ISO-ish date string as `MMM D`, appending `HH:mm` when the input
 * carries a time component. Parsed by string split rather than `Date` so the
 * label reflects the timestamp exactly as stored, with no timezone shifting.
 */
export function formatDateShort(dateStr: string): string {
  const hasTime = dateStr.includes('T')
  const [datePart, timePart] = dateStr.split('T')
  const [, month, day] = datePart.split('-').map(Number)
  const dateLabel = `${MONTHS[month - 1]} ${day}`
  if (hasTime && timePart) {
    return `${dateLabel} ${timePart.slice(0, 5)}`
  }
  return dateLabel
}
