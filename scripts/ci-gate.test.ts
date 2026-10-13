import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const script = fileURLToPath(new URL('../.github/scripts/ci-gate.sh', import.meta.url))

type Result = 'success' | 'failure' | 'cancelled' | 'skipped'
type Job =
  | 'changes'
  | 'integration'
  | 'e2e'
  | 'e2e-build'
  | 'e2e-mobile'
  | 'desktop-live'
  | 'lint'
  | 'test'
  | 'test-types'
  | 'build'
type Results = Partial<Record<Job, Result>>

const GATED: Job[] = [
  'integration',
  'e2e',
  'e2e-build',
  'e2e-mobile',
  'desktop-live',
  'test',
  'test-types',
  'build',
]
const ALL_FALSE = { full: 'false', test: 'false', build: 'false', desktop_live: 'false' }

/**
 * The `needs` context GitHub gives the `ci` job: every job succeeded and `changes` set `outputs`,
 * with `results` overriding individual jobs.
 */
function needs(outputs: unknown, results: Results = {}) {
  const jobs: Job[] = ['changes', ...GATED, 'lint']
  return Object.fromEntries(
    jobs.map((job) => [
      job,
      {
        result: results[job] ?? 'success',
        outputs: job === 'changes' ? outputs : {},
      },
    ])
  )
}

const skipGated: Results = Object.fromEntries(GATED.map((job) => [job, 'skipped' as const]))

interface FailureCase {
  name: string
  outputs: unknown
  results: Results
  reported: string[]
}

/** Runs the gate; `reported` holds the `<job>: <result>` lines it failed on. */
function gate(context: string) {
  const result = spawnSync('bash', [script], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, NEEDS: context },
  })
  const reported = result.stdout
    .split('\n')
    .filter((line) => /^[a-z0-9-]+: [a-z]+$/.test(line))
    .sort()
  return { status: result.status, stdout: result.stdout, reported }
}

describe('CI gate', () => {
  it('passes when every job succeeded', () => {
    const { status, stdout } = gate(JSON.stringify(needs(ALL_FALSE)))
    expect(status).toBe(0)
    expect(stdout).toBe('All checks passed.\n')
  })

  it('passes gated jobs skipped because their flag is exactly false', () => {
    const { status, stdout } = gate(JSON.stringify(needs(ALL_FALSE, skipGated)))
    expect(status).toBe(0)
    expect(stdout).toBe('All checks passed.\n')
  })

  it.each<FailureCase>([
    {
      name: 'a skip whose flag is true',
      outputs: { ...ALL_FALSE, build: 'true' },
      results: skipGated,
      reported: ['build: skipped'],
    },
    {
      name: 'a skip whose flag is missing',
      outputs: { full: 'false', test: 'false', desktop_live: 'false' },
      results: skipGated,
      reported: ['build: skipped'],
    },
    {
      name: 'a skip whose flag is a misspelling',
      outputs: { ...ALL_FALSE, full: 'flase' },
      results: skipGated,
      reported: [
        'e2e-build: skipped',
        'e2e-mobile: skipped',
        'e2e: skipped',
        'integration: skipped',
      ],
    },
    {
      name: 'a skip whose flag is differently cased',
      outputs: { ...ALL_FALSE, test: 'False' },
      results: skipGated,
      reported: ['test-types: skipped', 'test: skipped'],
    },
    {
      name: 'a skip whose flag is empty',
      outputs: { ...ALL_FALSE, desktop_live: '' },
      results: skipGated,
      reported: ['desktop-live: skipped'],
    },
    {
      name: 'a skip whose flag is a boolean, not the string GitHub sets',
      outputs: { ...ALL_FALSE, build: false },
      results: skipGated,
      reported: ['build: skipped'],
    },
    {
      name: 'skips with no changes outputs',
      outputs: {},
      results: skipGated,
      reported: [
        'build: skipped',
        'desktop-live: skipped',
        'e2e-build: skipped',
        'e2e-mobile: skipped',
        'e2e: skipped',
        'integration: skipped',
        'test-types: skipped',
        'test: skipped',
      ],
    },
    {
      name: 'skips with a null changes outputs',
      outputs: null,
      results: skipGated,
      reported: [
        'build: skipped',
        'desktop-live: skipped',
        'e2e-build: skipped',
        'e2e-mobile: skipped',
        'e2e: skipped',
        'integration: skipped',
        'test-types: skipped',
        'test: skipped',
      ],
    },
    {
      name: 'a failed changes job',
      outputs: {},
      results: { ...skipGated, changes: 'failure' },
      reported: [
        'build: skipped',
        'changes: failure',
        'desktop-live: skipped',
        'e2e-build: skipped',
        'e2e-mobile: skipped',
        'e2e: skipped',
        'integration: skipped',
        'test-types: skipped',
        'test: skipped',
      ],
    },
    {
      name: 'a skipped changes job, even with flags that would allow the skips',
      outputs: ALL_FALSE,
      results: { ...skipGated, changes: 'skipped' },
      reported: ['changes: skipped'],
    },
    {
      name: 'a mobile skip after a failed e2e build, though its flag is true',
      outputs: { ...ALL_FALSE, full: 'true', build: 'true' },
      results: { 'e2e-build': 'failure', 'e2e-mobile': 'skipped' },
      reported: ['e2e-build: failure', 'e2e-mobile: skipped'],
    },
    {
      name: 'a failed job whose flag is false',
      outputs: ALL_FALSE,
      results: { test: 'failure' },
      reported: ['test: failure'],
    },
    {
      name: 'a failed ungated job',
      outputs: ALL_FALSE,
      results: { lint: 'failure' },
      reported: ['lint: failure'],
    },
    {
      name: 'a cancelled job whose flag is false',
      outputs: ALL_FALSE,
      results: { e2e: 'cancelled' },
      reported: ['e2e: cancelled'],
    },
    {
      name: 'a skipped lint, which is never gated',
      outputs: ALL_FALSE,
      results: { ...skipGated, lint: 'skipped' },
      reported: ['lint: skipped'],
    },
  ])('fails on $name', ({ outputs, results, reported }) => {
    const result = gate(JSON.stringify(needs(outputs, results)))
    expect(result.status, result.stdout).toBe(1)
    expect(result.stdout).toContain('::error::Checks did not pass:')
    expect(result.reported).toEqual(reported)
  })

  it.each(['', 'not json', '[]', 'null'])('fails on a needs context of %j', (context) => {
    const { status, stdout } = gate(context)
    expect(status).toBe(1)
    expect(stdout).toContain('::error::The needs context is not a JSON object')
  })
})
