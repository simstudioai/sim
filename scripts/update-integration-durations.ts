#!/usr/bin/env bun
/**
 * Rewrites `vitest.integration-durations.json`, the per-file weights the integration shards are
 * balanced by (`DurationBalancedSequencer` in `vitest.shared.ts`), from a CI run's integration reports.
 *
 *   gh run download <run-id> -p 'integration-reports-*' -D /tmp/integration-reports
 *   bun run scripts/update-integration-durations.ts /tmp/integration-reports
 *
 * A file's weight is its wall time including the import and collection that precede its first
 * test (the gap since the previous file in the same shard ended), averaged across the push and
 * migrate provisioning runs. apps/sim runs its files one at a time, so those gaps are real shard
 * time; where files overlap, a file counts only its own time. Weights only steer balance; a stale
 * file never changes what runs.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createLogger } from '@sim/logger'

interface JsonReport {
  testResults: { name: string; startTime: number; endTime: number }[]
}

const logger = createLogger('UpdateIntegrationDurations')
const REPORT_NAME = 'integration.json'
const ROOT = path.resolve(import.meta.dir, '..')
const OUTPUT = path.join(ROOT, 'vitest.integration-durations.json')

async function findReports(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true })
  return entries
    .filter((entry) => entry.isFile() && entry.name === REPORT_NAME)
    .map((entry) => path.join(entry.parentPath, entry.name))
}

/** `/home/runner/_work/sim/sim/apps/sim/lib/x.integration.ts` → `apps/sim/lib/x.integration.ts` */
function repoPath(absolute: string): string | null {
  const match = absolute.match(/\/((?:apps|packages)\/.+)$/)
  return match ? match[1] : null
}

const source = process.argv[2]
if (!source) {
  logger.error('Usage: bun run scripts/update-integration-durations.ts <downloaded-reports-dir>')
  process.exit(1)
}

const samples = new Map<string, number[]>()
const reports = await findReports(path.resolve(source))
for (const reportPath of reports) {
  const report = JSON.parse(await readFile(reportPath, 'utf8')) as JsonReport
  const files = [...report.testResults].sort((a, b) => a.startTime - b.startTime)
  let previousEnd = Number.NEGATIVE_INFINITY
  for (const file of files) {
    const key = repoPath(file.name)
    // The gap before a file is its import time only when nothing else was running: in a run
    // with file parallelism (packages/db) files overlap, and a file then counts its own time.
    const start =
      previousEnd > Number.NEGATIVE_INFINITY && previousEnd <= file.startTime
        ? previousEnd
        : file.startTime
    if (key) samples.set(key, [...(samples.get(key) ?? []), (file.endTime - start) / 1000])
    previousEnd = Math.max(previousEnd, file.endTime)
  }
}

if (samples.size === 0) {
  logger.error(`No ${REPORT_NAME} reports with test results under ${source}`)
  process.exit(1)
}

const durations = Object.fromEntries(
  [...samples.keys()].sort().map((key) => {
    const values = samples.get(key) ?? []
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length
    return [key, Math.round(mean * 10) / 10]
  })
)
await writeFile(OUTPUT, `${JSON.stringify(durations, null, 2)}\n`)
logger.info(`Wrote ${samples.size} file weights from ${reports.length} reports to ${OUTPUT}`)
