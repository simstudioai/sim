import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')
const job = workflow.split('  prune-desktop-prereleases:')[1]
const step = job?.match(/^ {8}run: \|\r?\n((?: {10}.*(?:\r?\n|$)|\r?\n)+)/m)?.[1]
if (!step) throw new Error('Desktop pruning shell step is missing')
const script = step.replace(/^ {10}/gm, '')
const detector = workflow.split('      - name: Diff desktop paths')[1]?.split('\n  migrate:')[0]
const detectorStep = detector?.match(/^ {8}run: \|\r?\n((?: {10}.*(?:\r?\n|$)|\r?\n)+)/m)?.[1]
if (!detectorStep) throw new Error('Desktop change detection shell step is missing')
const detectorScript = detectorStep.replace(/^ {10}/gm, '')

function release(tagName: string, publishedAt: string, isDraft = false, isPrerelease = true) {
  return {
    tagName,
    publishedAt,
    createdAt: '2026-08-13T04:57:48Z',
    isDraft,
    isPrerelease,
  }
}

function prune(
  releases: ReturnType<typeof release>[],
  currentTag = 'v1-dev.6',
  ref = 'refs/heads/dev',
  listExit = '0'
) {
  return spawnSync(
    'bash',
    [
      '-e',
      '-c',
      `
      gh() {
        if [ "$1 $2" = 'release list' ]; then
          [ "$LIST_EXIT" = 0 ] || return "$LIST_EXIT"
          while [ "$1" != '--jq' ]; do shift; done
          printf '%s' "$RELEASES" | jq -r "$2"
        elif [ "$1 $2" = 'release delete' ]; then
          printf 'DELETE %s\n' "$3"
        else
          return 99
        fi
      }
      ${script}
    `,
    ],
    {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        GH_TOKEN: 'test-placeholder',
        GITHUB_REF: ref,
        CURRENT_TAG: currentTag,
        RELEASES: JSON.stringify(releases),
        LIST_EXIT: listExit,
      },
    }
  )
}

const devReleases = Array.from({ length: 6 }, (_, index) =>
  release(`v1-dev.${6 - index}`, `2026-09-${String(16 - index).padStart(2, '0')}T00:00:00Z`)
)

describe('desktop release retention shell', () => {
  it('keeps the newest five publications when every tag points to the same commit', () => {
    const result = prune(devReleases)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('DELETE v1-dev.1')
    expect(result.stdout).not.toContain('DELETE v1-dev.6')
    expect(result.stdout.match(/^DELETE /gm)).toHaveLength(1)
  })

  it('never deletes this run’s publication even when older than the five retained releases', () => {
    const result = prune(devReleases, 'v1-dev.1')
    expect(result.status).toBe(0)
    expect(result.stdout).not.toContain('DELETE ')
  })

  it('fails when listing fails instead of reporting successful cleanup', () => {
    const result = prune(devReleases, 'v1-dev.6', 'refs/heads/dev', '42')
    expect(result.status).toBe(42)
    expect(result.stdout).not.toContain('DELETE ')
  })

  it('refuses to prune without the current publication tag', () => {
    const result = prune(devReleases, '')
    expect(result.status).not.toBe(0)
    expect(result.stdout).not.toContain('DELETE ')
  })
})

describe('desktop release change detection shell', () => {
  it.each([
    ['.github/workflows/ci.yml', true],
    ['.github/workflows/desktop-release.yml', true],
    ['apps/desktop/src/main/index.ts', true],
    ['packages/desktop-bridge/src/index.ts', true],
    ['packages/browser-protocol/src/index.ts', true],
    ['.github/workflows/migrations.yml', false],
    ['.github/workflows/ci.yml.backup', false],
    ['apps/sim/app/page.tsx', false],
  ])('classifies %s as desktop change=%s', (path, changed) => {
    const directory = mkdtempSync(join(tmpdir(), 'desktop-detect-'))
    const output = join(directory, 'outputs')
    try {
      const result = spawnSync(
        'bash',
        [
          '-e',
          '-c',
          `
        git() {
          case "$1" in
            cat-file) return 0 ;;
            diff) printf '%s\n' "$CHANGED_PATH" ;;
            *) return 99 ;;
          esac
        }
        ${detectorScript}
      `,
        ],
        {
          encoding: 'utf8',
          env: {
            PATH: process.env.PATH,
            BEFORE: 'previous-commit',
            GITHUB_OUTPUT: output,
            CHANGED_PATH: path,
          },
        }
      )
      expect(result.status).toBe(0)
      expect(readFileSync(output, 'utf8')).toBe(`changed=${changed}\n`)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
