/** Status implied by a fact's leading "Yes"/"No" token, if any. */
export type FactStatus = 'yes' | 'no' | 'neutral'

export interface ParsedFact {
  status: FactStatus
  /** The value with any leading "Yes:"/"No:" token stripped, ready to render next to a status icon. */
  text: string
}

const STATUS_PREFIX = /^(Yes|No)(?::\s*)?(.*)$/s

/**
 * Splits a {@link Fact.value} string into a status (for a compact icon) and
 * the remaining descriptive text. Every fact in `apps/sim/lib/compare/data`
 * that represents a yes/no capability is written as `"Yes: ..."` / `"No:
 * ..."`. This is the single place that convention is parsed, so the
 * comparison table and the key-differences strip render it identically.
 */
export function parseFactValue(value: string): ParsedFact {
  const match = value.match(STATUS_PREFIX)
  if (!match) {
    return { status: 'neutral', text: value }
  }
  const [, token, rest] = match
  const trimmedRest = rest.trim()
  return {
    status: token === 'Yes' ? 'yes' : 'no',
    text: trimmedRest.length > 0 ? trimmedRest : token,
  }
}
