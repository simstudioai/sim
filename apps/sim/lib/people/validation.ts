import { z } from 'zod'

export const PROFILE_TEXT_MAX_LENGTH = 200

/** A date, optionally with a time of day and offset, which are dropped. */
const ISO_DATE =
  /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/
const US_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/

function calendarDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day))
  const real =
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  if (!real || year < 1900 || year > 2100) return null
  return date.toISOString().slice(0, 10)
}

/**
 * A start date as HR systems export it: `2024-01-31` (optionally with a time, which is
 * dropped), `2024/1/31`, or the US `1/31/2024`. Anything else, including two-digit years and
 * day-first dates, is refused rather than guessed, and so is a date that doesn't exist.
 */
export function parseStartDate(value: string): string | null {
  const iso = ISO_DATE.exec(value.trim())
  if (iso) return calendarDate(Number(iso[1]), Number(iso[2]), Number(iso[3]))
  const us = US_DATE.exec(value.trim())
  if (us) return calendarDate(Number(us[3]), Number(us[1]), Number(us[2]))
  return null
}

const profileTextSchema = z
  .string()
  .trim()
  .max(PROFILE_TEXT_MAX_LENGTH, `Use at most ${PROFILE_TEXT_MAX_LENGTH} characters`)
  .transform((value) => value || null)
  .nullable()

/** A profile as an admin edits it, shared by the API contract and the editor; `null` means not recorded. */
export const memberProfileFieldsSchema = z
  .object({
    title: profileTextSchema,
    department: profileTextSchema,
    location: profileTextSchema,
    /** A calendar date, `YYYY-MM-DD`. */
    startDate: z
      .string()
      .trim()
      .transform((value, context) => {
        if (!value) return null
        const date = parseStartDate(value)
        if (!date) {
          context.addIssue({ code: 'custom', message: 'Use a date like 2024-01-31' })
          return z.NEVER
        }
        return date
      })
      .nullable(),
    managerMemberId: z.string().min(1).max(255).nullable(),
  })
  .strict()

export type MemberProfileFields = z.output<typeof memberProfileFieldsSchema>
