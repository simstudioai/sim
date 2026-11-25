/**
 * The id a dry run's placeholder carries where the provider or stored state would assign one
 * (`dry_run_row_1`, `dry_run_record_2`): recognisably not real, and distinct per item the call
 * writes. `n` counts from 1.
 */
export function dryRunId(kind: string, n = 1): string {
  return `dry_run_${kind}_${n}`
}
