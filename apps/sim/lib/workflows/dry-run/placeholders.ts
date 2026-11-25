import { isPlainRecord } from '@sim/utils/object'
import { DRY_RUN_NUMBER_BASE } from '@/tools/dry-run'

/** Placeholders a run tracks at most; placeholders returned past it are not tracked. */
const MAX_TRACKED = 10_000
/** Nesting a scan follows, and values it reads, before it stops looking. */
const MAX_SCAN_DEPTH = 20
const MAX_SCAN_VALUES = 2000
/**
 * Placeholder numbers run from just above {@link DRY_RUN_NUMBER_BASE} up to this many above it:
 * each output counts its own from 1, and a run tracks at most {@link MAX_TRACKED}, so none reaches it.
 */
const MAX_NUMBER_OFFSET = 1_000_000

/** The shape `dryRunId` mints, and the prefix that finds it inside a longer string. */
const TOKEN = /^dry_run_[a-z0-9_]+_\d+$/
const TOKEN_PREFIX = 'dry_run_'
const TOKEN_RUN = /^[a-z0-9_]+/
/** Where a token can end inside a run: after a whole `_<digits>`. */
const TOKEN_END = /_\d+/g
const DIGIT_RUN = /\d+/g
/** Digits a placeholder number has: every one is above {@link DRY_RUN_NUMBER_BASE}. */
const PLACEHOLDER_NUMBER_DIGITS = String(DRY_RUN_NUMBER_BASE).length
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
    if (typeof node === 'string' || typeof node === 'number') {
      found.push(node)
      return
    }
    const items = Array.isArray(node) ? node : isPlainRecord(node) ? Object.values(node) : []
    for (const item of items) {
      if (found.length >= MAX_SCAN_VALUES) return
      visit(item, depth + 1)
    }
  }
  visit(value, 0)
  return found
}

/**
 * Every token `text` could hold: at each `dry_run_` (any case, anywhere, even mid-word), each
 * candidate the following run of token characters holds up to a `_<digits>` end, so
 * `file_dry_run_row_1.json` and `dry_run_row_1_copy` both hold `dry_run_row_1`, while
 * `dry_run_row_10` does not. A run is read at most `window` characters long: one past the longest
 * token sought, so a longer run of digits is still seen to continue past it.
 */
function* tokensIn(text: string, window: number): Generator<string> {
  const lower = text.toLowerCase()
  let start = lower.indexOf(TOKEN_PREFIX)
  while (start !== -1) {
    const run = lower.slice(start, start + window).match(TOKEN_RUN)?.[0] ?? ''
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
  /** How far {@link tokensIn} reads at one `dry_run_`: one past the longest token registered. */
  private tokenWindow = 0

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
        const token = value.toLowerCase()
        this.tokens.add(token)
        this.tokenWindow = Math.max(this.tokenWindow, Math.min(token.length + 1, MAX_TOKEN_LENGTH))
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
      if (this.tokens.size > 0) {
        for (const token of tokensIn(value, this.tokenWindow))
          if (this.tokens.has(token)) return true
      }
      if (this.numbers.size === 0) return false
      for (const digits of value.match(DIGIT_RUN) ?? []) {
        if (digits.length >= PLACEHOLDER_NUMBER_DIGITS && this.numbers.has(Number(digits))) {
          return true
        }
      }
      return false
    })
  }
}
