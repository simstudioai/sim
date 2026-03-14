import type { ResourceCell } from '@/app/workspace/[workspaceId]/components/resource/resource'

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const ORDINAL_RULES: [number, string][] = [
  [1, 'st'],
  [2, 'nd'],
  [3, 'rd'],
]

function ordinalSuffix(day: number): string {
  if (day >= 11 && day <= 13) return 'th'
  return ORDINAL_RULES.find(([d]) => day % 10 === d)?.[1] ?? 'th'
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const

function formatFullDate(date: Date): string {
  const month = MONTH_NAMES[date.getMonth()]
  const day = date.getDate()
  const year = date.getFullYear()
  return `${month} ${day}${ordinalSuffix(day)}, ${year}`
}

function pluralize(value: number, unit: string): string {
  return `${value} ${unit}${value === 1 ? '' : 's'}`
}

/**
 * Formats a date string into a human-friendly relative time label.
 *
 * - Within ~1 minute of now: "Now"
 * - Under 1 hour: "X minute(s) ago" / "X minute(s)"
 * - Under 24 hours: "X hour(s) ago" / "X hour(s)"
 * - Under 2 days: "X day(s) ago" / "X day(s)"
 * - Beyond 2 days: full date (e.g. "March 4th, 2026")
 */
export function timeCell(dateValue: string | Date | null | undefined): ResourceCell {
  if (!dateValue) return { label: null }

  const date = dateValue instanceof Date ? dateValue : new Date(dateValue)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const absDiff = Math.abs(diff)
  const isPast = diff > 0

  if (absDiff < MINUTE) return { label: 'Now' }

  if (absDiff < HOUR) {
    const minutes = Math.floor(absDiff / MINUTE)
    return { label: isPast ? `${pluralize(minutes, 'minute')} ago` : pluralize(minutes, 'minute') }
  }

  if (absDiff < DAY) {
    const hours = Math.floor(absDiff / HOUR)
    return { label: isPast ? `${pluralize(hours, 'hour')} ago` : pluralize(hours, 'hour') }
  }

  if (absDiff < 2 * DAY) {
    const days = Math.floor(absDiff / DAY)
    return { label: isPast ? `${pluralize(days, 'day')} ago` : pluralize(days, 'day') }
  }

  return { label: formatFullDate(date) }
}
