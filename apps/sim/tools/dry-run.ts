/**
 * The id a dry run's placeholder carries where the provider or stored state would assign one
 * (`dry_run_row_1`, `dry_run_record_2`): recognisably not real, and distinct per item the call
 * writes. `n` counts from 1.
 */
export function dryRunId(kind: string, n = 1): string {
  return `dry_run_${kind}_${n}`
}

/**
 * The first number a dry run's placeholder carries where the provider would assign one (an issue
 * number, a count it cannot know): every placeholder number is above it, recognisably not real yet
 * within a 32-bit integer.
 */
export const DRY_RUN_NUMBER_BASE = 900_000_000

/**
 * The `n`th placeholder number, counting from 1: `900000001`. Never put one in a `dryRunOutput`
 * echo: a number the echo carries is taken as given by the request, so a later call sending it is
 * not recognised as depending on a stub.
 */
export function dryRunNumber(n = 1): number {
  return DRY_RUN_NUMBER_BASE + n
}
