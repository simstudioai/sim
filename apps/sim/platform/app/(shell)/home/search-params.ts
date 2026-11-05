import { createParser } from 'nuqs/server'

/** Nullable: a clean URL means today, which moves at midnight while a chosen day does not. */
export const homeDayParam = {
  key: 'day',
  parser: createParser({
    parse: (value) =>
      /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
        ? value
        : null,
    serialize: (value: string) => value,
  }),
} as const
