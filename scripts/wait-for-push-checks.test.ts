import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const script = fileURLToPath(new URL('../.github/scripts/wait-for-push-checks.sh', import.meta.url))
const repository = 'example/project'
const sha = 'a'.repeat(40)

function validation(overrides: Record<string, unknown> = {}) {
  return {
    id: 101,
    workflow_id: 11,
    path: '.github/workflows/validation.yml',
    event: 'push',
    head_sha: sha,
    head_branch: 'staging',
    repository: { id: 23, full_name: repository },
    head_repository: { id: 23, full_name: repository },
    status: 'completed',
    conclusion: 'success',
    ...overrides,
  }
}

interface GateOptions {
  listings?: unknown[]
  terminal?: unknown
  listStatus?: number
  terminalStatus?: number
  watchStatus?: number
}

/** Executes the real admission shell and jq against independent CLI response fixtures. */
function runGate(options: GateOptions = {}) {
  const initial = options.listings ?? [{ total_count: 1, workflow_runs: [validation()] }]
  const fixtures = initial.map((value) => JSON.stringify(value))
  return spawnSync(
    'bash',
    [
      '-c',
      `set -euo pipefail
       poll=0
       gh() {
         if [ "$1" = run ] && [ "$2" = watch ]; then
           printf 'WATCH %s\\n' "$3"
           return "$WATCH_STATUS"
         fi
         case "$2" in
           repos/example/project/actions/runs)
             if [ "$LIST_STATUS" -ne 0 ]; then return "$LIST_STATUS"; fi
             if [ "$poll" -eq 0 ]; then printf '%s\\n' "$FIRST_LIST";
             else printf '%s\\n' "$NEXT_LIST"; fi
             ;;
           repos/example/project/actions/runs/101)
             if [ "$TERMINAL_STATUS" -ne 0 ]; then return "$TERMINAL_STATUS"; fi
             printf '%s\\n' "$TERMINAL_RESPONSE"
             ;;
           *) return 97 ;;
         esac
       }
       sleep() {
         poll=$((poll + 1))
         if [ "$poll" -gt 1 ]; then SECONDS=$((SECONDS + 121)); fi
       }
       source "$1"`,
      'push-validation-fixture',
      script,
    ],
    {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        GITHUB_REPOSITORY: repository,
        GITHUB_REPOSITORY_ID: '23',
        GITHUB_REF_NAME: 'staging',
        GITHUB_SHA: sha,
        FIRST_LIST: fixtures[0],
        NEXT_LIST: fixtures[1] ?? fixtures[0],
        TERMINAL_RESPONSE: JSON.stringify(options.terminal ?? validation()),
        LIST_STATUS: String(options.listStatus ?? 0),
        TERMINAL_STATUS: String(options.terminalStatus ?? 0),
        WATCH_STATUS: String(options.watchStatus ?? 0),
      },
      timeout: 3_000,
    }
  )
}

const unrelatedRuns = [
  ['another workflow', { path: '.github/workflows/ci.yml' }],
  ['a manual run', { event: 'workflow_dispatch' }],
  ['another commit', { head_sha: 'b'.repeat(40) }],
  ['another branch', { head_branch: 'main' }],
  ['another repository name', { repository: { id: 23, full_name: 'other/project' } }],
  ['another repository ID', { repository: { id: 24, full_name: repository } }],
  ['another source repository name', { head_repository: { id: 23, full_name: 'other/project' } }],
  ['another source repository ID', { head_repository: { id: 24, full_name: repository } }],
  ['missing source repository', { head_repository: null }],
  ['missing workflow path', { path: undefined }],
  ['a string run ID', { id: '101' }],
  ['a nonpositive run ID', { id: 0 }],
  ['a fractional run ID', { id: 101.5 }],
  ['a string workflow ID', { workflow_id: '11' }],
  ['a nonpositive workflow ID', { workflow_id: 0 }],
  ['a fractional workflow ID', { workflow_id: 11.5 }],
] as const

describe('independent push-validation admission', () => {
  it('admits the matching trusted successful validation', () => {
    const result = runGate()
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain(`Push validation 101 passed for ${sha}.`)
  })

  it('waits for the matching run to register without admitting another workflow', () => {
    const result = runGate({
      listings: [
        { total_count: 1, workflow_runs: [validation({ path: '.github/workflows/ci.yml' })] },
        {
          total_count: 1,
          workflow_runs: [validation({ status: 'in_progress', conclusion: null })],
        },
      ],
    })
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('WATCH 101')
  })

  it('selects the validation among unrelated runs for the same commit', () => {
    const result = runGate({
      listings: [
        {
          total_count: 2,
          workflow_runs: [validation({ id: 102, path: '.github/workflows/ci.yml' }), validation()],
        },
      ],
    })
    expect(result.status, result.stderr).toBe(0)
  })

  it.each(unrelatedRuns)('denies admission based on %s', (_name, overrides) => {
    const result = runGate({
      listings: [{ total_count: 1, workflow_runs: [validation(overrides)] }],
    })
    expect(result.status).not.toBe(0)
    expect(result.stdout).not.toContain('WATCH')
    expect(result.stderr).toContain('No trusted push validation')
  })

  it.each([
    ['no registered run', { total_count: 0, workflow_runs: [] }],
    [
      'an ambiguous run',
      { total_count: 2, workflow_runs: [validation(), validation({ id: 102 })] },
    ],
    ['a truncated listing', { total_count: 2, workflow_runs: [validation()] }],
    ['a missing count', { workflow_runs: [validation()] }],
    ['malformed runs', { total_count: 1, workflow_runs: null }],
  ])('denies admission with %s', (_name, listing) => {
    const result = runGate({ listings: [listing] })
    expect(result.status).not.toBe(0)
    expect(result.stdout).not.toContain('WATCH')
  })

  it('propagates a listing API failure', () => {
    const result = runGate({ listStatus: 42 })
    expect(result.status).toBe(42)
    expect(result.stdout).not.toContain('WATCH')
  })

  it('propagates the official watcher failure', () => {
    const result = runGate({ watchStatus: 43 })
    expect(result.status).toBe(43)
    expect(result.stdout).not.toContain('passed for')
  })

  it('propagates a terminal API failure', () => {
    const result = runGate({ terminalStatus: 44 })
    expect(result.status).toBe(44)
    expect(result.stdout).not.toContain('passed for')
  })

  it.each(['failure', 'cancelled', 'skipped', 'neutral', 'timed_out', null])(
    'rejects a terminal conclusion of %s even if the watcher exits successfully',
    (conclusion) => {
      const result = runGate({ terminal: validation({ conclusion }) })
      expect(result.status).not.toBe(0)
      expect(result.stdout).not.toContain('passed for')
    }
  )

  it.each([
    ['a run still in progress', { status: 'in_progress' }],
    ['a replaced run', { id: 102 }],
    ['a replaced workflow', { workflow_id: 12 }],
    ...unrelatedRuns,
  ])('revalidates terminal provenance against %s', (_name, overrides) => {
    const result = runGate({ terminal: validation(overrides) })
    expect(result.status).not.toBe(0)
    expect(result.stdout).not.toContain('passed for')
  })
})
