import { createParser } from 'nuqs/server'

/**
 * Parser for free-form date/datetime strings (`startDate`/`endDate`). Rejects
 * unparseable values at the URL boundary — an invalid date string reaching
 * `new Date(...).toISOString()` throws, so a malformed deep link must parse to
 * `null` (treated as a missing bound) instead of crashing the consumer.
 */
export const parseAsDateString = createParser<string>({
  parse(value) {
    return Number.isNaN(Date.parse(value)) ? null : value
  },
  serialize(value) {
    return value
  },
})
