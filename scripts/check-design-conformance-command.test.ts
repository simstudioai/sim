import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, expect, test } from 'vitest'
import { findingFingerprint } from '#control-analysis/review-ledger'
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
  writeFileSync(path.join(repo, 'README.md'), '# Fixture\n')
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
  expect(run(['--help']).stdout).toContain('--working-tree')
}, 30_000)

test('working-tree mode checks staged, unstaged and new product files without committing', () => {
  const { repo, head } = fixture()
  writeFileSync(path.join(repo, ui), 'const A=()=> <p className="text-[var(--text-body)]"/>')
  git(repo, ['add', ui])
  writeFileSync(path.join(repo, ui), 'const A=()=> <p className="text-[#123456]"/>')
  const newFile = 'apps/sim/components/new.tsx'
  writeFileSync(
    path.join(repo, newFile),
    'export const New=()=> <button className="text-[#123456]"/>'
  )
  const result = run(['--repo', repo, '--base', head, '--working-tree', '--format', 'json'])
  expect(result.status).toBe(1)
  const report = JSON.parse(result.stdout) as Report
  expect(report.commits?.head).toMatch(/^working-tree:[a-f\d]{64}$/)
  expect(report.findings.some((finding) => finding.file === ui)).toBe(true)
  expect(report.findings.some((finding) => finding.file === newFile)).toBe(true)
  expect(run(['--repo', repo, '--base', head, '--working-tree', '--head', 'HEAD']).status).toBe(2)
  expect(run(['--repo', repo, '--base', head, '--head', 'HEAD']).status).toBe(0)
})

test('working-tree mode ignores unrelated tracked and untracked files', () => {
  const { repo, head } = fixture()
  mkdirSync(path.join(repo, 'tools'), { recursive: true })
  writeFileSync(path.join(repo, 'tools/notes.txt'), 'Not product styling')
  const result = run(['--repo', repo, '--base', head, '--working-tree', '--format', 'json'])
  expect(result.status).toBe(0)
  const report = JSON.parse(result.stdout) as Report
  expect(report.status).toBe('completed')
  expect(report.findings).toHaveLength(0)
})

test('working-tree mode includes a changed central contract registry', () => {
  const { repo } = fixture()
  const file = 'scripts/design-conformance/contracts.json'
  mkdirSync(path.join(repo, path.dirname(file)), { recursive: true })
  writeFileSync(path.join(repo, file), '{"version":1}\n')
  const base = commit(repo)
  writeFileSync(path.join(repo, file), '{"version":2}\n')
  const result = run(['--repo', repo, '--base', base, '--working-tree', '--format', 'json'])
  expect(result.status).toBe(1)
  const report = JSON.parse(result.stdout) as Report
  expect(report.findings.some((finding) => finding.file === file)).toBe(true)
})

test('text, JSON and output files preserve finding identity and normal command exit codes', () => {
  const { repo, base, head } = fixture()
  const args = ['--repo', repo, '--base', base]
  const out = path.join(temp, 'finding.json')
  const human = run([...args, '--output', out])
  expect(human.status).toBe(1)
  expect(human.stdout).toContain('Product findings')
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

test('external review decisions annotate but never remove a diff finding', () => {
  const { repo, base } = fixture()
  const args = ['--repo', repo, '--base', base, '--format', 'json']
  const raw = JSON.parse(run(args).stdout) as Report
  const reviews = path.join(temp, 'reviews.json')
  const decision = JSON.stringify({
    version: '1.0.0',
    entries: [
      {
        fingerprint: findingFingerprint(raw.findings[0]),
        status: 'retained-extra',
        rationale: 'Reviewed test treatment',
        evidence: '/external/review',
      },
    ],
  })
  writeFileSync(reviews, decision)
  const annotated = JSON.parse(run([...args, '--reviews', reviews]).stdout) as Report
  expect(annotated.findings).toEqual(raw.findings)
  expect(annotated.reviewDecisions?.matches).toHaveLength(1)
  const internal = path.join(repo, 'reviews.json')
  writeFileSync(internal, decision)
  expect(run([...args, '--reviews', internal]).status).toBe(2)
})

test('landing and docs edits stay out of the diff while product reuse restores helper checks', () => {
  const repo = mkdtempSync(path.join(temp, 'scope-'))
  git(repo, ['init', '-q'])
  const write = (file: string, text: string) => {
    mkdirSync(path.dirname(path.join(repo, file)), { recursive: true })
    writeFileSync(path.join(repo, file), text)
  }
  const mdx = 'apps/sim/lib/content/mdx.tsx'
  const landing = 'apps/sim/app/(landing)/page.tsx'
  const docs = 'apps/docs/app/page.tsx'
  const simDocs = 'apps/sim/app/(docs)/page.tsx'
  write(TOKEN_FILE, ':root{--text-body:#434343}')
  write(mdx, 'export const mdxComponents={code:()=> <code className="rounded-[4px] text-[19px]"/>}')
  write(
    landing,
    'import {mdxComponents} from "@/lib/content/mdx"; export const Page=()=> <p>Landing</p>'
  )
  write(docs, 'export const Page=()=> <p className="text-[#123456]">Docs</p>')
  write(simDocs, 'export const Page=()=> <p className="text-[#123456]">Docs</p>')
  const base = commit(repo)
  write(mdx, 'export const mdxComponents={code:()=> <code className="rounded-[5px] text-[20px]"/>}')
  write(
    landing,
    'import {mdxComponents} from "@/lib/content/mdx"; export const Page=()=> <p className="text-[#123456]">Landing</p>'
  )
  write(docs, 'export const Page=()=> <p className="text-[#abcdef]">Docs</p>')
  write(simDocs, 'export const Page=()=> <p className="text-[#abcdef]">Docs</p>')
  const landingHead = commit(repo)
  const scoped = run(['--repo', repo, '--base', base, '--format', 'json'])
  expect(scoped.status).toBe(0)
  expect((JSON.parse(scoped.stdout) as Report).findings).toEqual([])

  write(
    'apps/sim/components/product.tsx',
    'import {mdxComponents} from "@/lib/content/mdx"; export const Product=()=> <div>{mdxComponents.code()}</div>'
  )
  write(mdx, 'export const mdxComponents={code:()=> <code className="rounded-[6px] text-[21px]"/>}')
  commit(repo)
  const mixed = run(['--repo', repo, '--base', landingHead, '--format', 'json'])
  expect(mixed.status).toBe(0)
  const mixedReport = JSON.parse(mixed.stdout) as Report
  expect(mixedReport.findings.some((finding) => finding.file === mdx)).toBe(false)
  expect(
    mixedReport.unchecked.some(
      (note) =>
        note.file === 'apps/sim/components/product.tsx' &&
        note.reason.includes('excluded landing source')
    )
  ).toBe(true)
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
  { label: 'parser failure', source: 'const A=()=> <p className={', reason: 'Parser failure' },
  {
    label: 'source limit',
    source: ' '.repeat(2 * 1024 * 1024 + 1),
    reason: 'Source exceeds the 2 MiB parsing limit',
  },
])('changed product inspection failures fail the comparison: $label', ({ source, reason }) => {
  const { repo, head: base } = fixture()
  writeFileSync(path.join(repo, ui), source)
  commit(repo)
  const args = ['--repo', repo, '--base', base]
  const output = path.join(repo, 'report.json')
  const human = run([...args, '--output', output])
  expect(human.status).toBe(2)
  expect(human.stderr).toContain('comparison incomplete')
  const report: Report = JSON.parse(readFileSync(output, 'utf8'))
  expect(report.status).toBe('failed')
  expect(report.flagged).toBe(null)
  expect(report.findings).toEqual([])
  expect(report.coverageFailures).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ file: ui, side: 'after', reason: expect.stringContaining(reason) }),
    ])
  )
  expect(report.unchecked).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ file: ui, side: 'after', reason: expect.stringContaining(reason) }),
    ])
  )
  const summary = path.join(repo, 'summary.md')
  const child = run(args, ci, { GITHUB_ACTIONS: 'true', GITHUB_STEP_SUMMARY: summary })
  expect(child.status).toBe(2)
  expect(child.stderr).toContain('comparison incomplete')
  const markdown = readFileSync(summary, 'utf8')
  expect(markdown).toContain('Operational failure')
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
    'Product findings: 1'
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
  expect(githubSummary(report)).toContain('| Product findings | 1 |')
})

test('unchecked diagnostics preserve both sides and safely render source-authored text', () => {
  const report = new ConformanceLinter().report(null)
  for (const side of ['before', 'after'])
    report.unchecked.push({
      file: 'path`|</pre>\n::error::injected.tsx',
      line: 7,
      side,
      context: 'className',
      reason: 'Unknown helper: <script>& value\r\n::warning::injected',
    })
  const original = JSON.stringify(report)
  const text = textReport(report)
  const markdown = githubSummary(report)
  expect(text).toContain(':7 (before; className)')
  expect(text).toContain(':7 (after; className)')
  expect(text).not.toMatch(/[\r\n]::(?:error|warning)::/)
  expect(markdown).toContain('&lt;/pre&gt;')
  expect(markdown).toContain('&lt;script&gt;&amp; value')
  expect(markdown).not.toContain('<script>')
  expect(markdown).not.toMatch(/[\r\n]::(?:error|warning)::/)
  expect(githubAnnotations(report)).toEqual([])
  expect(JSON.stringify(report)).toBe(original)
})

test('large unchecked summaries show explicit limits while logs retain every complete diagnostic', () => {
  const report = new ConformanceLinter().report(null)
  report.unchecked = Array.from({ length: 101 }, (_, index) => ({
    file: `component-${index}.tsx`,
    line: 1,
    side: 'after',
    context: '',
    reason: index === 0 ? `${'&'.repeat(2000)} complete-long-diagnostic` : `reason-${index}`,
  }))
  const markdown = githubSummary(report)
  const text = textReport(report)
  expect(markdown).toContain('Showing 100 of 101 diagnostics')
  expect(markdown).toContain('[truncated; see check log]')
  expect(markdown).not.toContain('complete-long-diagnostic')
  expect(markdown).not.toContain('component-100.tsx')
  expect(text).toContain('complete-long-diagnostic')
  expect(text).toContain('component-100.tsx:1 (after) — reason-100')
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
