import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const script = fileURLToPath(new URL('../.github/scripts/desktop-live-changes.sh', import.meta.url))
const fixtures: string[] = []

function git(cwd: string, ...args: string[]) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`)
  return result.stdout.trim()
}

function write(repo: string, file: string, content: string) {
  mkdirSync(dirname(join(repo, file)), { recursive: true })
  writeFileSync(join(repo, file), content)
}

/** Builds a clone whose base commit holds `apps/sim/x.ts` and whose origin is a local bare repo. */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'desktop-live-changes-'))
  fixtures.push(root)
  const origin = join(root, 'origin.git')
  const repo = join(root, 'repo')
  git(root, 'init', '--quiet', '--bare', origin)
  git(root, 'init', '--quiet', repo)
  git(repo, 'config', 'user.email', 'test@example.com')
  git(repo, 'config', 'user.name', 'Test')
  git(repo, 'config', 'commit.gpgsign', 'false')
  git(repo, 'remote', 'add', 'origin', origin)
  write(repo, 'apps/sim/x.ts', 'export const x = 1\n'.repeat(20))
  git(repo, 'add', '-A')
  git(repo, 'commit', '--quiet', '-m', 'base')
  const base = git(repo, 'rev-parse', 'HEAD')
  git(repo, 'push', '--quiet', 'origin', 'HEAD:refs/heads/base')
  return { repo, base }
}

function detect(repo: string, base: string) {
  return spawnSync('bash', [script, base], { cwd: repo, encoding: 'utf8' })
}

afterEach(() => {
  for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('desktop live change gate', () => {
  it('runs the suite when a live file moves into a skipped path', () => {
    const { repo, base } = fixture()
    mkdirSync(join(repo, 'apps/docs'), { recursive: true })
    git(repo, 'mv', 'apps/sim/x.ts', 'apps/docs/x.ts')
    git(repo, 'commit', '--quiet', '-m', 'move')

    const result = detect(repo, base)
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout.trim()).toBe('changed=true')
  })

  it('skips the suite when every change is in a skipped path', () => {
    const { repo, base } = fixture()
    write(repo, 'apps/docs/guide.mdx', '# Guide\n')
    git(repo, 'add', '-A')
    git(repo, 'commit', '--quiet', '-m', 'docs')

    const result = detect(repo, base)
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout.trim()).toBe('changed=false')
  })

  it('runs the suite when the base commit cannot be fetched', () => {
    const { repo } = fixture()
    const result = detect(repo, '0'.repeat(40))
    expect(result.stdout.trim()).toBe('changed=true')
  })
})
