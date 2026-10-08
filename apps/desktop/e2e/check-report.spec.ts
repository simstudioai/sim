import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { omit } from '@sim/utils/object'
import type { ReportCheck } from './check-report'

/**
 * The suites' JSON reports against a real worker restart: a nested Playwright run of a fixture
 * whose first test fails, so the second runs in a fresh worker with fresh module state. The report
 * must keep the failure, and must not carry checks from an earlier run.
 */
const CLI = createRequire(import.meta.url).resolve('@playwright/test/cli')
const CONFIG = fileURLToPath(new URL('./fixtures/worker-restart.config.ts', import.meta.url))

test('a check that failed before the worker restarted stays in the report', () => {
  const reportPath = join(mkdtempSync(join(tmpdir(), 'sim-check-report-')), 'report.json')
  writeFileSync(
    reportPath,
    JSON.stringify({
      suite: 'worker-restart',
      run: -1,
      checks: [{ name: 'left by an earlier run', status: 'passed', durationMs: 0 }],
    })
  )
  // The outer run's worker variables would make the nested runner think it is a worker.
  const env = omit(
    process.env,
    Object.keys(process.env).filter((key) => /^(TEST_|PW_)/.test(key))
  )

  const run = spawnSync(process.execPath, [CLI, 'test', '--config', CONFIG], {
    env: { ...env, WORKER_RESTART_REPORT_PATH: reportPath },
    encoding: 'utf8',
    timeout: 60_000,
  })

  expect(run.status, run.stdout + run.stderr).toBe(1)
  const checks = (JSON.parse(readFileSync(reportPath, 'utf8')) as { checks: ReportCheck[] }).checks
  expect(checks.map(({ name, status }) => ({ name, status }))).toEqual([
    { name: 'fails first', status: 'failed' },
    { name: 'passes after the worker restarts', status: 'passed' },
  ])
  // Proof the second check ran in a replacement worker, not the one that failed.
  expect(checks[0]?.error).not.toBe(checks[1]?.error)
})
