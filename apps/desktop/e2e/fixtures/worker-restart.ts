import { expect, test } from '@playwright/test'
import { recordCheck } from '../check-report'

/**
 * Two checks in one file, the first failing, run by `check-report.spec.ts` in a Playwright run of
 * its own. The failure makes Playwright start a new worker for the second, as it does mid-suite.
 */
const reportPath = process.env.WORKER_RESTART_REPORT_PATH

function record(name: string, status: string): void {
  recordCheck(reportPath, 'worker-restart', {
    name,
    status,
    durationMs: 0,
    error: `worker ${test.info().workerIndex}`,
  })
}

test('fails first', () => {
  record('fails first', 'failed')
  expect('failed').toBe('passed')
})

test('passes after the worker restarts', () => {
  record('passes after the worker restarts', 'passed')
})
