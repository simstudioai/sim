import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import { afterAll, expect, test } from 'vitest'
import { git, writeJson } from '#design-conformance/io'
import { TOKEN_FILE } from '#design-conformance/model'
import { gitSnapshot, loadSnapshot } from '#design-conformance/system-snapshot'

const root = mkdtempSync(path.join(os.tmpdir(), 'conformance-io-'))
const repo = path.join(root, 'repo')
const ui = 'apps/sim/components/view.tsx'
mkdirSync(path.join(repo, path.dirname(TOKEN_FILE)), { recursive: true })
mkdirSync(path.join(repo, path.dirname(ui)), { recursive: true })
git(repo, ['init', '-q'])
const commit = () => {
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
writeFileSync(path.join(repo, TOKEN_FILE), ':root{--text-body:#434343}')
writeFileSync(path.join(repo, ui), 'const A=()=> <p className="text-[var(--text-body)]"/>')
const base = commit()
writeFileSync(
  path.join(repo, ui),
  'throw new Error("source must not execute");const A=()=> <p className="text-[#434343]"/>'
)
const head = commit()
const cli = new URL('./design-conformance/cli.ts', import.meta.url).pathname
const run = (args: string[]) =>
  spawnSync('bun', ['--no-env-file', cli, '--repo', repo, '--base', base, '--head', head, ...args])
afterAll(() => rmSync(root, { recursive: true, force: true }))
test('default CLI checks conformance with exits 0, 1 and explicit incompatible-input failure', () => {
  const dirty = run([])
  expect(dirty.status).toBe(1)
  const r = JSON.parse(dirty.stdout.toString())
  expect(r.policyVersion).toBe('design-conformance/1.3.0')
  expect(r.findings[0].kind).toBe('usage-violation')
  const clean = spawnSync('bun', [
    '--no-env-file',
    cli,
    '--repo',
    repo,
    '--base',
    base,
    '--head',
    base,
  ])
  expect(clean.status).toBe(0)
  const incompatible = run([
    '--catalogue',
    new URL('./design-conformance/catalogue.json', import.meta.url).pathname,
  ])
  expect(incompatible.status).toBe(2)
  expect(JSON.parse(incompatible.stderr.toString()).flagged).toBeNull()
})
test('frozen central snapshots replay without Git and detect corrupt source', () => {
  const snap = gitSnapshot(repo, base)
  const dest = path.join(root, 'snapshots')
  const dataset = path.join(root, 'dataset')
  mkdirSync(path.join(dest, 'commits'), { recursive: true })
  mkdirSync(path.join(dest, 'objects'), { recursive: true })
  mkdirSync(path.join(dataset, 'objects'), { recursive: true })
  for (const e of snap.snapshot.entries)
    writeFileSync(path.join(dest, 'objects', `${e.blob}.gz`), gzipSync(Buffer.from(snap.read(e))))
  writeJson(path.join(dest, 'commits', `${base}.json`), snap.snapshot)
  writeJson(path.join(dest, 'manifest.json'), {
    version: '1.0.0',
    snapshots: { [base]: snap.snapshot.hash },
  })
  const beforeBlob = git(repo, ['rev-parse', `${base}:${ui}`])
    .toString()
    .trim()
  const afterBlob = git(repo, ['rev-parse', `${head}:${ui}`])
    .toString()
    .trim()
  for (const blob of [beforeBlob, afterBlob])
    writeFileSync(
      path.join(dataset, 'objects', `${blob}.gz`),
      gzipSync(git(repo, ['cat-file', 'blob', blob]))
    )
  const comparisons = [1, 2].map((pr) => ({
    pr,
    cohort: 'synthetic',
    sampleOrder: pr - 1,
    base,
    head,
    mergeBase: base,
    files: [ui],
  }))
  writeJson(path.join(dataset, 'manifest.json'), { datasetId: 'conformance-fixture', comparisons })
  for (const c of comparisons) {
    const dir = path.join(dataset, 'cases', String(c.pr))
    mkdirSync(dir, { recursive: true })
    writeJson(path.join(dir, 'metadata.json'), { commits: { base, head, mergeBase: base } })
    writeJson(path.join(dir, 'changes.json'), [
      {
        status: 'M',
        before: { path: ui, blob: beforeBlob, mode: '100644' },
        after: { path: ui, blob: afterBlob, mode: '100644' },
      },
    ])
  }
  const evaluate = (workers: number) => {
    const out = path.join(root, `run-${workers}`)
    const p = spawnSync('bun', [
      '--no-env-file',
      new URL('./design-conformance/evaluate.ts', import.meta.url).pathname,
      '--dataset',
      dataset,
      '--system-snapshots',
      dest,
      '--output',
      out,
      '--workers',
      String(workers),
    ])
    expect(p.status).toBe(0)
    return out
  }
  // No repository argument is supplied to evaluation: all source comes from verified blobs.
  const one = evaluate(1)
  const two = evaluate(2)
  expect(readFileSync(path.join(one, '1.json'), 'utf8')).toBe(
    readFileSync(path.join(two, '1.json'), 'utf8')
  )
  expect(JSON.parse(readFileSync(path.join(one, '1.json'), 'utf8')).flagged).toBe(true)
  const e = snap.snapshot.entries[0]
  writeFileSync(path.join(dest, 'objects', `${e.blob}.gz`), gzipSync(Buffer.from('corrupt')))
  expect(() => loadSnapshot(dest, base).read(e)).toThrow('Source hash mismatch')
})
