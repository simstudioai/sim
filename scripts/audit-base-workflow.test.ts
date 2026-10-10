import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const script = fileURLToPath(new URL('../.github/scripts/resolve-audit-base.sh', import.meta.url))
const fixtures: string[] = []

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`)
  return result.stdout.trim()
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'audit-base-'))
  fixtures.push(root)
  const origin = join(root, 'origin.git')
  const repo = join(root, 'repo')
  git(root, 'init', '--quiet', '--bare', origin)
  git(root, 'init', '--quiet', '-b', 'foundation', repo)
  git(repo, 'config', 'user.email', 'test@example.com')
  git(repo, 'config', 'user.name', 'Test')
  git(repo, 'config', 'commit.gpgsign', 'false')
  git(repo, 'remote', 'add', 'origin', origin)
  git(repo, 'commit', '--quiet', '--allow-empty', '-m', 'initial')
  git(repo, 'branch', 'parent')
  writeFileSync(join(repo, 'foundation.sql'), 'SELECT 1;\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '--quiet', '-m', 'foundation')
  const before = git(repo, 'rev-parse', 'HEAD')
  git(repo, 'checkout', '--quiet', 'parent')
  writeFileSync(join(repo, 'upstream.sql'), 'SELECT 2;\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '--quiet', '-m', 'upstream')
  const base = git(repo, 'rev-parse', 'HEAD')
  git(repo, 'checkout', '--quiet', 'foundation')
  git(repo, 'merge', '--quiet', '--no-ff', 'parent', '-m', 'merge parent')
  const head = git(repo, 'rev-parse', 'HEAD')
  git(repo, 'push', '--quiet', 'origin', 'parent', 'foundation')
  const pr = {
    state: 'open',
    head: { ref: 'foundation', sha: head, repo: { full_name: 'example/repo' } },
    base: { ref: 'parent', sha: base },
  }
  return { root, repo, base, before, head, pr }
}

function resolveBase(data: ReturnType<typeof fixture>, overrides: Record<string, string> = {}) {
  const output = join(data.root, 'output')
  writeFileSync(output, '')
  const result = spawnSync(
    'bash',
    [
      '--noprofile',
      '--norc',
      '-c',
      'gh() { printf "%s" "$PR_RESPONSE"; return "$API_EXIT"; }; source "$AUDIT_SCRIPT"',
    ],
    {
      cwd: data.repo,
      encoding: 'utf8',
      env: {
        ...process.env,
        AUDIT_SCRIPT: script,
        GITHUB_EVENT_NAME: 'workflow_dispatch',
        GITHUB_REPOSITORY: 'example/repo',
        GITHUB_REF_TYPE: 'branch',
        GITHUB_REF_NAME: 'foundation',
        GITHUB_SHA: data.head,
        GITHUB_BASE_REF: 'parent',
        GITHUB_BEFORE: '',
        GITHUB_OUTPUT: output,
        PR_RESPONSE: JSON.stringify([[data.pr]]),
        API_EXIT: '0',
        ...overrides,
      },
    }
  )
  return { ...result, output: readFileSync(output, 'utf8').trim() }
}

afterEach(() => {
  for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('diff audit base selection', () => {
  it('pins the actual PR base for a dispatched merge head instead of its first parent', () => {
    const data = fixture()
    const result = resolveBase(data)
    expect(result.status, result.stderr).toBe(0)
    expect(result.output).toBe(`ref=${data.base}`)
    expect(git(data.repo, 'diff', '--name-only', data.base, 'HEAD')).toBe('foundation.sql')
    expect(git(data.repo, 'diff', '--name-only', data.before, 'HEAD')).toBe('upstream.sql')
  })

  it('pins the current base branch when the PR snapshot still reports an older base SHA', () => {
    const data = fixture()
    const cachedBase = git(data.repo, 'rev-parse', `${data.base}^`)
    const result = resolveBase(data, {
      PR_RESPONSE: JSON.stringify([[{ ...data.pr, base: { ...data.pr.base, sha: cachedBase } }]]),
    })
    expect(result.status, result.stderr).toBe(0)
    expect(result.output).toBe(`ref=${data.base}`)
    expect(git(data.repo, 'rev-parse', 'FETCH_HEAD')).toBe(data.base)
  })

  it('fails closed when multiple open PRs across pages claim the dispatched branch', () => {
    const data = fixture()
    const result = resolveBase(data, { PR_RESPONSE: JSON.stringify([[data.pr], [data.pr]]) })
    expect(result.status).not.toBe(0)
    expect(result.output).toBe('')
  })

  it.each(['missing', 'moved', 'foreign', 'tag', 'api', 'invalid-base', 'fetch'] as const)(
    'does not publish an audit base when resolution is %s',
    (failure) => {
      const data = fixture()
      const overrides: Record<string, string> = {}
      if (failure === 'missing') overrides.PR_RESPONSE = '[[]]'
      if (failure === 'moved') overrides.GITHUB_SHA = data.before
      if (failure === 'foreign') overrides.GITHUB_REPOSITORY = 'another/repo'
      if (failure === 'tag') overrides.GITHUB_REF_TYPE = 'tag'
      if (failure === 'api') overrides.API_EXIT = '73'
      if (failure === 'invalid-base')
        overrides.PR_RESPONSE = JSON.stringify([
          [{ ...data.pr, base: { ref: 'HEAD~1', sha: 'HEAD~1' } }],
        ])
      if (failure === 'fetch')
        git(data.repo, 'remote', 'set-url', 'origin', join(data.root, 'missing.git'))
      const result = resolveBase(data, overrides)
      expect(result.status).not.toBe(0)
      expect(result.output).toBe('')
    }
  )

  it('keeps the normal PR base branch even if no API association is available', () => {
    const data = fixture()
    const result = resolveBase(data, { GITHUB_EVENT_NAME: 'pull_request', API_EXIT: '73' })
    expect(result.status, result.stderr).toBe(0)
    expect(result.output).toBe('ref=origin/parent')
    expect(git(data.repo, 'rev-parse', 'origin/parent')).toBe(data.base)
  })

  it('keeps the pre-push SHA for an existing branch', () => {
    const data = fixture()
    const result = resolveBase(data, { GITHUB_EVENT_NAME: 'push', GITHUB_BEFORE: data.before })
    expect(result.status, result.stderr).toBe(0)
    expect(result.output).toBe(`ref=${data.before}`)
  })

  it('keeps the first-parent fallback for a new branch push', () => {
    const data = fixture()
    const shallow = join(data.root, 'shallow')
    git(
      data.root,
      'clone',
      '--quiet',
      '--depth=1',
      '--branch=foundation',
      `file://${join(data.root, 'origin.git')}`,
      shallow
    )
    data.repo = shallow
    const result = resolveBase(data, { GITHUB_EVENT_NAME: 'push', GITHUB_BEFORE: '0'.repeat(40) })
    expect(result.status, result.stderr).toBe(0)
    expect(result.output).toBe('ref=HEAD~1')
    expect(git(data.repo, 'rev-parse', 'HEAD~1')).toBe(data.before)
  })
})
