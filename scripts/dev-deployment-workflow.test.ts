import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')
const tasks = readFileSync(
  new URL('../.github/workflows/deploy-trigger-dev.yml', import.meta.url),
  'utf8'
)

/** Evaluate the checked-in job condition for concrete GitHub job outcomes. */
function eligible(job: string, branch: string, results: Record<string, string> = {}) {
  const body = ci.split(`\n  ${job}:\n`)[1]?.split(/^ {2}[\w-]+:/m)[0]
  const expression = body?.match(/ {4}if: >-\n((?: {6}.*\n)+)/)?.[1]
  if (!expression) throw new Error(`Missing job condition: ${job}`)
  const needs = Object.fromEntries(
    Object.entries({
      migrate: 'success',
      'build-amd64': 'success',
      'migrate-dev': 'success',
      'build-dev': 'success',
      'prepare-trigger': 'success',
      'promote-images': 'success',
      ...results,
    }).map(([name, result]) => [name, { result, outputs: { promoted: 'true' } }])
  )
  return runInNewContext(expression.replace(/needs\.([\w-]+)/g, 'needs["$1"]'), {
    github: { event_name: 'push', ref: `refs/heads/${branch}` },
    needs,
    cancelled: () => false,
  })
}

const promotion = tasks.split('      - name: Promote current dev preview')[1]
const shell = promotion?.match(/ {8}run: \|\n((?: {10}.*\n)+)/)?.[1]
if (!shell) throw new Error('Missing dev task promotion step')
const script = shell.replace(/^ {10}/gm, '')

/** Run the real promotion shell with fake GitHub and Trigger commands. */
function promote(env: Record<string, string> = {}) {
  return spawnSync(
    'bash',
    [
      '-e',
      '-c',
      `gh() { printf '%s\\n' "$HEAD_SHA"; return "$GH_EXIT"; }
bunx() { printf 'PROMOTE %s\\n' "$*"; return "$TRIGGER_EXIT"; }
${script}`,
    ],
    {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        GITHUB_REPOSITORY: 'example/sim',
        GITHUB_SHA: 'current',
        HEAD_SHA: 'current',
        VERSION: '20260922.1',
        GH_EXIT: '0',
        TRIGGER_EXIT: '0',
        ...env,
      },
    }
  )
}

describe('dev deployment independence', () => {
  it('promotes dev images with the skipped Trigger jobs and no cutover waiter', () => {
    expect(eligible('prepare-trigger', 'dev')).toBe(false)
    expect(eligible('promote-trigger', 'dev')).toBe(false)
    expect(eligible('promote-images', 'dev', { 'prepare-trigger': 'skipped' })).toBe(true)
  })

  it.each(['migrate-dev', 'build-dev'])('still requires successful %s', (job) => {
    expect(eligible('promote-images', 'dev', { [job]: 'failure' })).toBe(false)
  })

  it.each(['staging', 'main'])('preserves the coordinated release gates for %s', (branch) => {
    expect(eligible('prepare-trigger', branch)).toBe(true)
    expect(eligible('promote-trigger', branch)).toBe(true)
    expect(eligible('promote-images', branch)).toBe(true)
    for (const job of ['prepare-trigger', 'migrate', 'build-amd64']) {
      expect(eligible('promote-images', branch, { [job]: 'failure' })).toBe(false)
    }
    expect(eligible('promote-trigger', branch, { 'promote-images': 'failure' })).toBe(false)
  })

  it('promotes the current task version only to the dev preview', () => {
    const result = promote()
    expect(result.status).toBe(0)
    expect(result.stdout).toContain(
      'PROMOTE trigger.dev@4.5.12 promote 20260922.1 --env preview --branch dev-sim'
    )
  })

  it('does not roll tasks back when an older push is retried', () => {
    const result = promote({ HEAD_SHA: 'newer' })
    expect(result.status).toBe(0)
    expect(result.stdout).not.toContain('PROMOTE ')
  })

  it('fails closed if the current branch cannot be read', () => {
    const result = promote({ GH_EXIT: '42' })
    expect(result.status).toBe(42)
    expect(result.stdout).not.toContain('PROMOTE ')
  })

  it('rejects an invalid task version', () => {
    const result = promote({ VERSION: '' })
    expect(result.status).toBe(1)
    expect(result.stdout).not.toContain('PROMOTE ')
  })

  it('reports task promotion failures in the independent workflow', () => {
    expect(promote({ TRIGGER_EXIT: '43' }).status).toBe(43)
  })
})
