import { readFileSync, writeFileSync } from 'node:fs'

/** One check's outcome in a suite's JSON report. */
export interface ReportCheck {
  name: string
  status: string
  durationMs: number
  error?: string
  retry?: number
}

interface Report {
  suite: string
  /** The Playwright run that wrote it: its workers' parent process. */
  run: number
  checks: ReportCheck[]
}

/**
 * Adds a check to the suite's report at `reportPath` as soon as its outcome is known, keeping the
 * checks already there from the same run.
 *
 * Playwright replaces a worker after a failure, and the new one starts with empty module state, so
 * a report kept in memory and written at the end would drop everything before the failure, the
 * failure included, and could read green. The file holds it instead. Every worker of one run is a
 * child of the same runner, so a report left by an earlier run is replaced rather than added to.
 */
export function recordCheck(
  reportPath: string | undefined,
  suite: string,
  check: ReportCheck
): void {
  if (!reportPath) return
  const run = process.ppid
  let checks: ReportCheck[] = []
  try {
    const existing = JSON.parse(readFileSync(reportPath, 'utf8')) as Report
    if (existing.suite === suite && existing.run === run) checks = existing.checks
  } catch {
    // No report yet from this run.
  }
  const report: Report = { suite, run, checks: [...checks, check] }
  writeFileSync(reportPath, JSON.stringify(report, null, 2))
}
