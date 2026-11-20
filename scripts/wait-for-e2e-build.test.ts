import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const script = fileURLToPath(new URL('../.github/scripts/wait-for-e2e-build.sh', import.meta.url))

interface Job {
  name: string
  status: string
  conclusion: string | null
}

const job = (status: string, conclusion: string | null = null, name = 'checks / build (e2e)') => ({
  name,
  status,
  conclusion,
})

/**
 * Runs the real script against a `gh` stub whose jq filter is the script's own: each poll answers
 * with the next listing (the last one repeats), and `sleep` only counts polls.
 */
function runWait(listings: Job[][], apiStatus = 0) {
  return spawnSync(
    'bash',
    [
      '-c',
      `set -euo pipefail
       poll=0
       gh() {
         [ "$1" = api ] && [ "$2" = --paginate ] || return 97
         case "$3" in
           'repos/example/project/actions/runs/7/jobs?filter=latest&per_page=100') ;;
           *) return 98 ;;
         esac
         if [ "$API_STATUS" -ne 0 ]; then return "$API_STATUS"; fi
         local listings count
         listings=$(jq -c '.' <<< "$LISTINGS")
         count=$(jq 'length' <<< "$listings")
         local index=$(( poll < count ? poll : count - 1 ))
         jq -r "{jobs: .[$index]} | $5" <<< "$listings"
       }
       sleep() { poll=$((poll + 1)); }
       source "$1"`,
      'wait-for-e2e-build-fixture',
      script,
    ],
    {
      timeout: 5_000,
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        GITHUB_REPOSITORY: 'example/project',
        GITHUB_RUN_ID: '7',
        LISTINGS: JSON.stringify(listings),
        API_STATUS: String(apiStatus),
      },
    }
  )
}

describe('wait-for-e2e-build.sh', () => {
  it('returns once an in-progress build succeeds', () => {
    const result = runWait([
      [job('queued'), job('in_progress', null, 'checks / lint')],
      [job('in_progress')],
      [job('completed', 'success')],
    ])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('build (e2e) finished')
  })

  it('accepts the unprefixed job name of a directly dispatched checks run', () => {
    expect(runWait([[job('completed', 'success', 'build (e2e)')]]).status).toBe(0)
  })

  it.each(['failure', 'cancelled', 'skipped', 'timed_out'])(
    'fails when the build ends %s',
    (end) => {
      const result = runWait([[job('in_progress')], [job('completed', end)]])
      expect(result.status).toBe(1)
      expect(result.stdout).toContain(`finished with '${end}'`)
    }
  )

  it('fails when the run has no build job instead of waiting forever', () => {
    const result = runWait([[job('completed', 'success', 'checks / build')]])
    expect(result.status).toBe(1)
    expect(result.stdout).toContain('found 0')
  })

  it('fails when two jobs claim the build name', () => {
    const result = runWait([
      [job('completed', 'success'), job('completed', 'success', 'build (e2e)')],
    ])
    expect(result.status).toBe(1)
    expect(result.stdout).toContain('found 2')
  })

  it('fails on an API error rather than treating it as still building', () => {
    const result = runWait([[job('in_progress')]], 1)
    expect(result.status).not.toBe(0)
    expect(result.stdout).not.toContain('build (e2e) finished')
  })
})
