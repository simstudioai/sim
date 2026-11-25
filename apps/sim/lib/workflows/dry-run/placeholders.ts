import { isPlainRecord } from '@sim/utils/object'
import { DRY_RUN_NUMBER_BASE } from '@/tools/dry-run'

/** Placeholders a run tracks at most; placeholders returned past it are not tracked. */
const MAX_TRACKED = 10_000
/** Nesting a scan follows, and values it reads, before it stops looking. */
const MAX_SCAN_DEPTH = 20
const MAX_SCAN_VALUES = 2000
/** Placeholder numbers run from just above {@link DRY_RUN_NUMBER_BASE} up to this many above it. */
const MAX_NUMBER_OFFSET = 1_000_000

/** The shape `dryRunId` mints, and the prefix that finds it inside a longer string. */
const TOKEN = /^dry_run_[a-z0-9_]+_\d+$/
const TOKEN_PREFIX = 'dry_run_'
const TOKEN_RUN = /^[a-z0-9_]+/
/** Where a token can end inside a run: after a whole `_<digits>`. */
const TOKEN_END = /_\d+/g
const DIGIT_RUN = /\d+/g
/** Longest token a scan reads at one `dry_run_`. */
const MAX_TOKEN_LENGTH = 256

/** Whether `value` is shaped like a number `dryRunNumber` mints. */
function isPlaceholderNumber(value: number): boolean {
  return (
    Number.isInteger(value) &&
    value > DRY_RUN_NUMBER_BASE &&
    value <= DRY_RUN_NUMBER_BASE + MAX_NUMBER_OFFSET
  )
}

/** The strings and numbers `value` holds, at any depth within the scan's bounds. */
function leavesOf(value: unknown): Array<string | number> {
  const found: Array<string | number> = []
  const visit = (node: unknown, depth: number): void => {
    if (found.length >= MAX_SCAN_VALUES || depth > MAX_SCAN_DEPTH) return
    if (typeof node === 'string' || typeof node === 'number') found.push(node)
    else if (Array.isArray(node)) for (const item of node) visit(item, depth + 1)
    else if (isPlainRecord(node)) for (const item of Object.values(node)) visit(item, depth + 1)
  }
  visit(value, 0)
  return found
}

/**
 * Every token `text` could hold: at each `dry_run_` (any case, anywhere, even mid-word), each
 * candidate the following run of token characters holds up to a `_<digits>` end, so
 * `file_dry_run_row_1.json` and `dry_run_row_1_copy` both hold `dry_run_row_1`, while
 * `dry_run_row_10` does not.
 */
function* tokensIn(text: string): Generator<string> {
  const lower = text.toLowerCase()
  let start = lower.indexOf(TOKEN_PREFIX)
  while (start !== -1) {
    const run = lower.slice(start, start + MAX_TOKEN_LENGTH).match(TOKEN_RUN)?.[0] ?? ''
    for (const end of run.matchAll(TOKEN_END)) yield run.slice(0, end.index + end[0].length)
    start = lower.indexOf(TOKEN_PREFIX, start + 1)
  }
}

/**
 * The placeholders a dry run's answers returned: every `dry_run_<kind>_<n>` string (see
 * `dryRunId`), minted by a tool's `dryRunOutput` for an id the provider would assign or by the
 * sample for a field the request cannot know, and every placeholder number (see `dryRunNumber`),
 * which only the sample mints. Only placeholder answers are registered, and a number the answer
 * echoes from its request is not, so a placeholder is a value the run made up, never one a real
 * call returned or the workflow was given. A read that would send one, as an id or inside
 * free text (a message quoting a placeholder title), depends on a write that was never sent.
 */
export class PlaceholderTokens {
  private readonly tokens = new Set<string>()
  private readonly numbers = new Set<number>()

  /**
   * Registers the placeholders of a placeholder answer, `returned`, except a number `echoed` (the
   * part of it a tool's `dryRunOutput` echoed from the request) carries: that one was given.
   */
  register(returned: unknown, echoed: unknown = null): void {
    const given = new Set(leavesOf(echoed).filter((value) => typeof value === 'number'))
    for (const value of leavesOf(returned)) {
      if (this.tokens.size + this.numbers.size >= MAX_TRACKED) return
      if (typeof value === 'number') {
        if (isPlaceholderNumber(value) && !given.has(value)) this.numbers.add(value)
      } else if (TOKEN.test(value.toLowerCase())) {
        this.tokens.add(value.toLowerCase())
      }
    }
  }

  /**
   * Whether `sent` holds a registered placeholder: a token anywhere in a string, or a number whole
   * or as a run of digits in a string (`/issues/900000001`).
   */
  occursIn(sent: unknown): boolean {
    if (this.tokens.size === 0 && this.numbers.size === 0) return false
    return leavesOf(sent).some((value) => {
      if (typeof value === 'number') return this.numbers.has(value)
      for (const token of tokensIn(value)) if (this.tokens.has(token)) return true
      for (const digits of value.match(DIGIT_RUN) ?? []) {
        if (this.numbers.has(Number(digits))) return true
      }
      return false
    })
  }
}
