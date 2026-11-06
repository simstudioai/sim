import { createParser } from 'nuqs/server'
import { isCalendarDate } from '@/lib/core/utils/timezone'

/** Nullable: a clean URL means today, which moves at midnight while a chosen day does not. */
export const homeDayParam = {
  key: 'day',
  parser: createParser({
    parse: (value) => (isCalendarDate(value) ? value : null),
    serialize: (value: string) => value,
  }),
} as const
