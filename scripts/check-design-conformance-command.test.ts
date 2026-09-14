import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, expect, test } from 'vitest'
import { ciRefs, warningExitCode } from '#design-conformance/ci'
import { repositoryRoot } from '#design-conformance/command'
import { ConformanceLinter } from '#design-conformance/conformance'
import { contractsHash, isRegistry } from '#design-conformance/contracts'
import { compareGit, git } from '#design-conformance/io'
import { hash, type Report, TOKEN_FILE } from '#design-conformance/model'
import {
  escapeAnnotation,
  githubAnnotations,
  githubSummary,
  textReport,
} from '#design-conformance/reporting'
import { snapshotHash } from '#design-conformance/system-snapshot'

const temp = mkdtempSync(path.join(os.tmpdir(), 'design-command-'))
afterAll(() => rmSync(temp, { recursive: true, force: true }))
const cli = fileURLToPath(new URL('./check-design-conformance.ts', import.meta.url))
const ci = fileURLToPath(new URL('./design-conformance/ci.ts', import.meta.url))
const ui = 'apps/sim/components/example.tsx'

function fixture() {
  const repo = mkdtempSync(path.join(temp, 'repo-'))
  mkdirSync(path.join(repo, path.dirname(TOKEN_FILE)), { recursive: true })
  mkdirSync(path.join(repo, path.dirname(ui)), { recursive: true })
  git(repo, ['init', '-q'])
  writeFileSync(path.join(repo, TOKEN_FILE), ':root{--text-body:#434343}')
  writeFileSync(path.join(repo, ui), 'const A=()=> <p className="text-[var(--text-body)]"/>')
  const base = commit(repo)
  writeFileSync(path.join(repo, ui), 'const A=()=> <p className="text-[#434343]"/>')
  const head = commit(repo)
  return { repo, base, head }
}

function commit(repo: string) {
  git(repo, ['add', '.'])
  git(repo, [
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.invalid',
    'commit',
    '-qm',
    'fixture',
  ])
  return git(repo, ['rev-parse', 'HEAD']).toString().trim()
}

function run(args: string[], entry = cli, env: NodeJS.ProcessEnv = {}) {
  return spawnSync('bun', ['--no-env-file', entry, ...args], {
    cwd: temp,
    encoding: 'utf8',
    env: { ...process.env, GITHUB_ACTIONS: 'false', ...env },
  })
}

test('command defaults to the checkout repository and HEAD independently of the working directory', () => {
  const child = run(['--base', 'HEAD', '--format', 'json'])
  expect(child.status).toBe(0)
  expect(JSON.parse(child.stdout).commits.head).toBe(
    git(repositoryRoot, ['rev-parse', 'HEAD']).toString().trim()
  )
  expect(run([]).status).toBe(2)
  expect(run(['--help']).stdout).toContain('uncommitted edits are not inspected')
}, 30_000)

test('text, JSON and output files preserve finding identity and normal command exit codes', () => {
  const { repo, base, head } = fixture()
  const args = ['--repo', repo, '--base', base]
  const out = path.join(temp, 'finding.json')
  const human = run([...args, '--output', out])
  expect(human.status).toBe(1)
  expect(human.stdout).toContain('Usage violations')
  expect(human.stdout).toContain('permitted:')
  expect(human.stdout).toContain(`${ui}:`)
  const json = run([...args, '--format', 'json'])
  expect(json.status).toBe(1)
  expect(JSON.parse(json.stdout)).toEqual(JSON.parse(readFileSync(out, 'utf8')))
  expect(JSON.parse(json.stdout).commits.head).toBe(head)
  expect(run([...args, '--head', base]).status).toBe(0)
  expect(run([...args, '--format', 'invalid']).status).toBe(2)
  expect(run([...args, '--output', path.join(temp, 'missing/report.json')]).status).toBe(2)
})

test('CI tolerates genuine findings and preserves the report, but fails missing revisions and central inputs', () => {
  const { repo, base } = fixture()
  const summary = path.join(temp, 'summary.md')
  const child = run(['--repo', repo, '--base', base], ci, {
    GITHUB_ACTIONS: 'true',
    GITHUB_STEP_SUMMARY: summary,
  })
  expect(child.status).toBe(0)
  expect(child.stdout).toContain('findings reported')
  expect(child.stderr).toContain('::warning file=')
  expect(readFileSync(summary, 'utf8')).toContain('Warning-only rollout')
  expect(run(['--repo', repo, '--base', 'missing'], ci).status).toBe(2)
  rmSync(path.join(repo, TOKEN_FILE))
  const noCentral = commit(repo)
  expect(run(['--repo', repo, '--base', noCentral, '--head', noCentral], ci).status).toBe(2)
})

test.each([
  [0, null, { status: 'completed', flagged: false, findings: [] }, 0],
  [1, null, { status: 'completed', flagged: true, findings: [{}] }, 0],
  [1, null, undefined, 2],
  [1, null, { status: 'failed', flagged: null, findings: [] }, 2],
  [0, null, { status: 'failed', flagged: null, findings: [] }, 2],
  [2, null, { status: 'completed', flagged: true, findings: [{}] }, 2],
  [null, 'SIGTERM', { status: 'completed', flagged: true, findings: [{}] }, 2],
] as const)(
  'CI exit handling validates status %s and signal %s against completed evidence',
  (code, signal, report, expected) => {
    expect(
      warningExitCode(code, signal, report && { ...report, findings: [...report.findings] })
    ).toBe(expected)
  }
)

test('immutable PR event revisions, push-before and manual/new-branch fallback are explicit', () => {
  const a = 'a'.repeat(40)
  const b = 'b'.repeat(40)
  const syntheticMerge = 'c'.repeat(40)
  expect(
    ciRefs('pull_request', { pull_request: { base: { sha: a }, head: { sha: b } } }, syntheticMerge)
  ).toEqual({ base: a, head: b })
  expect(ciRefs('push', { before: a }, b)).toEqual({ base: a, head: b })
  expect(ciRefs('push', { before: '0'.repeat(40) }, b)).toEqual({ base: 'HEAD~1', head: b })
  expect(ciRefs('workflow_dispatch', {}, b)).toEqual({ base: 'HEAD~1', head: b })
  expect(() => ciRefs('pull_request', {}, b)).toThrow('CI commit')
  expect(() => ciRefs('push', { before: 'bad' }, b)).toThrow('CI commit')
})

test('a multi-commit push includes earlier changes and a divergent PR uses its merge-base', () => {
  const { repo, base, head } = fixture()
  writeFileSync(path.join(repo, 'backend.txt'), 'another pushed commit')
  const pushed = commit(repo)
  const push = compareGit(repo, base, pushed)
  expect(push.changes.some((change) => change.after?.path === ui)).toBe(true)
  git(repo, ['checkout', '-qb', 'target', base])
  writeFileSync(path.join(repo, 'target.txt'), 'target diverged')
  const target = commit(repo)
  expect(compareGit(repo, target, head).commits.mergeBase).toBe(base)
  expect(run(['--repo', repo, '--base', target, '--head', head], ci).stdout).toContain(
    'Usage violations: 1'
  )
})

test('shallow clones remain operational failures through the warning wrapper', () => {
  const { repo, head } = fixture()
  const shallow = path.join(temp, 'shallow')
  git(temp, ['clone', '--quiet', '--depth=1', `file://${repo}`, shallow])
  const child = run(['--repo', shallow, '--base', head, '--head', head], ci)
  expect(child.status).toBe(2)
  expect(child.stderr).toContain('Complete Git history is required')
})

function findingReport(): Report {
  const report = new ConformanceLinter().report(null)
  report.flagged = true
  report.findings.push({
    kind: 'usage-violation',
    rule: 'colour',
    contract: 'colour-provenance',
    category: 'colours',
    property: 'color',
    value: '#123456\n::error::injected',
    reason: 'Use central colour',
    file: 'a,b:c%file\n.tsx',
    line: 3,
    column: 4,
    context: '',
    provenance: {
      source: TOKEN_FILE,
      input: '#123456\n::error::injected',
      permitted: 'central variable',
    },
  })
  return report
}

test('GitHub annotations escape source values and normal logs cannot inject workflow commands', () => {
  const report = findingReport()
  expect(escapeAnnotation('a,b:c%\r\n', true)).toBe('a%2Cb%3Ac%25%0D%0A')
  const annotation = githubAnnotations(report)[0]
  expect(annotation).toContain('file=a%2Cb%3Ac%25file%0A.tsx,line=3,col=4')
  expect(annotation).toContain('%0A::error::injected')
  expect(annotation).not.toContain('\n')
  expect(textReport(report)).not.toContain('\n::error::injected')
  expect(githubSummary(report)).toContain('| Usage violations | 1 |')
})

test('system edits remain flagged but are reported as design review warnings', () => {
  const report = findingReport()
  report.findings[0].kind = 'system-change'
  expect(githubAnnotations(report)[0]).toContain('title=Design system review')
  expect(textReport(report)).toContain('Central-system changes')
  expect(githubSummary(report)).toContain('| Central-system changes | 1 |')
  expect(warningExitCode(1, null, report)).toBe(0)
})

test('the relocated registry remains a central-system change and formatting stays quiet', async () => {
  const file = 'scripts/design-conformance/contracts.json'
  expect(isRegistry(file)).toBe(true)
  expect(isRegistry('scripts/other/contracts.json')).toBe(false)
  const registry = readFileSync(
    new URL('./design-conformance/contracts.json', import.meta.url),
    'utf8'
  )
  expect(hash(registry)).toBe(contractsHash)
  const entry = { path: TOKEN_FILE, blob: 'a'.repeat(40), mode: '100644' }
  const compare = (before: string, after: string) =>
    new ConformanceLinter().analyze(
      [
        {
          status: 'M',
          before: { path: file, blob: 'b'.repeat(40), mode: '100644' },
          after: { path: file, blob: 'c'.repeat(40), mode: '100644' },
        },
      ],
      (e) => (e.blob.startsWith('b') ? before : after),
      { base: 'a'.repeat(40), head: 'b'.repeat(40), mergeBase: 'a'.repeat(40) },
      {
        snapshot: {
          version: '1.0.0',
          commit: 'a'.repeat(40),
          entries: [entry],
          hash: snapshotHash([entry]),
        },
        read: () => ':root{--ink:#434343}',
      }
    )
  expect((await compare('{"version":1}', '{"version":2}')).findings[0].kind).toBe('system-change')
  expect((await compare('{"version":1}', '{ "version": 1 }')).flagged).toBe(false)
})
