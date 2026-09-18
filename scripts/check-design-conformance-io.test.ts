import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import { afterAll, beforeAll, expect, test } from 'vitest'
import {
  compareGit,
  git,
  gitText,
  loadCatalogue,
  storedChanges,
  storedText,
  verifiedText,
} from '#design-conformance/io'
import { Linter } from '#design-conformance/lint'

const repo = mkdtempSync(path.join(os.tmpdir(), 'token-lint repo '))
const ui = 'apps/sim/components/a strange ü file.tsx'
const cli = new URL('./design-conformance/cli.ts', import.meta.url).pathname
let base: string
let head: string
let linter: Linter
const commit = (message: string) => {
  git(repo, ['add', '.'])
  git(repo, [
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.invalid',
    'commit',
    '-qm',
    message,
  ])
  return git(repo, ['rev-parse', 'HEAD']).toString().trim()
}
beforeAll(async () => {
  git(repo, ['init', '-q'])
  mkdirSync(path.dirname(path.join(repo, ui)), { recursive: true })
  writeFileSync(path.join(repo, ui), 'const A=()=> <button className="p-2"/>')
  base = commit('base')
  git(repo, ['checkout', '-qb', 'proposed'])
  writeFileSync(path.join(repo, ui), 'const A=()=> <button className="p-[777px]"/>')
  head = commit('appearance')
  git(repo, ['checkout', '-qb', 'staging', base])
  writeFileSync(path.join(repo, 'backend.txt'), 'unrelated divergence')
  commit('staging diverged')
  const cat = loadCatalogue()
  linter = await Linter.create(cat.catalogue, cat.hash)
})
afterAll(() => rmSync(repo, { recursive: true, force: true }))
test('immutable merge-base and unusual filenames', () => {
  const x = compareGit(repo, 'staging', head)
  expect(x.commits.mergeBase).toBe(base)
  expect(x.changes[0].after?.path).toBe(ui)
  const r = linter.analyze(x.changes, (e) => gitText(repo, e), x.commits)
  expect(r.flagged).toBe(true)
})
test('CLI reports findings with exit 1 and clean comparisons with 0', () => {
  const report = path.join(repo, 'report.json')
  const p = spawnSync('bun', [
    '--no-env-file',
    cli,
    '--policy',
    'appearance',
    '--repo',
    repo,
    '--base',
    base,
    '--head',
    head,
    '--output',
    report,
  ])
  expect(p.status).toBe(1)
  expect(JSON.parse(readFileSync(report, 'utf8')).flagged).toBe(true)
  const clean = spawnSync('bun', [
    '--no-env-file',
    cli,
    '--policy',
    'appearance',
    '--repo',
    repo,
    '--base',
    base,
    '--head',
    base,
  ])
  expect(clean.status).toBe(0)
})
test('CLI missing revision has explicit failure and exit 2', () => {
  const p = spawnSync('bun', [
    '--no-env-file',
    cli,
    '--policy',
    'appearance',
    '--repo',
    repo,
    '--base',
    'missing-ref',
    '--head',
    head,
  ])
  expect(p.status).toBe(2)
  const r = JSON.parse(p.stdout.toString())
  expect(r.status).toBe('failed')
  expect(r.flagged).toBeNull()
})
test('Git rename detection preserves old and new paths', () => {
  git(repo, ['checkout', '-qb', 'rename', base])
  const renamed = 'apps/sim/components/renamed file.tsx'
  git(repo, ['mv', ui, renamed])
  const sha = commit('rename')
  const x = compareGit(repo, base, sha)
  expect(x.changes[0].status.startsWith('R')).toBe(true)
  expect(x.changes[0].before?.path).toBe(ui)
  expect(x.changes[0].after?.path).toBe(renamed)
  expect(linter.analyze(x.changes, (e) => gitText(repo, e), x.commits).flagged).toBe(false)
})
test('deletion and binary data do not corrupt Git framing', () => {
  git(repo, ['checkout', '-qb', 'delete', base])
  rmSync(path.join(repo, ui))
  writeFileSync(path.join(repo, 'binary.bin'), Buffer.from([0, 255, 8, 0]))
  const sha = commit('delete and binary')
  const x = compareGit(repo, base, sha)
  expect(x.changes.some((c) => c.status === 'D')).toBe(true)
  expect(linter.analyze(x.changes, (e) => gitText(repo, e), x.commits).flagged).toBe(false)
})
test('stored source validates Git identities and refuses corruption', () => {
  const text = Buffer.from('const x=1')
  const blob = createHash('sha1').update(`blob ${text.length}\0`).update(text).digest('hex')
  const dataset = path.join(repo, 'dataset')
  mkdirSync(path.join(dataset, 'objects'), { recursive: true })
  writeFileSync(path.join(dataset, 'objects', `${blob}.gz`), gzipSync(text))
  expect(storedText(dataset, { path: ui, blob, mode: '100644' })).toBe(text.toString())
  expect(() => verifiedText(Buffer.from('wrong'), blob)).toThrow('Source hash mismatch')
  expect(() => storedText(dataset, { path: ui, blob: 'a'.repeat(40), mode: '100644' })).toThrow()
})
test('single and multi-process evaluation match on synthetic stored data', () => {
  const dataset = path.join(repo, 'fixture-dataset')
  mkdirSync(path.join(dataset, 'objects'), { recursive: true })
  const source = 'const A=()=> <button className="p-[777px]"/>'
  const bytes = Buffer.from(source)
  const blob = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
  writeFileSync(path.join(dataset, 'objects', `${blob}.gz`), gzipSync(bytes))
  const comparisons = [1, 2].map((pr) => ({
    pr,
    cohort: 'synthetic',
    sampleOrder: pr - 1,
    base,
    head,
    mergeBase: base,
    files: [ui],
  }))
  writeFileSync(
    path.join(dataset, 'manifest.json'),
    JSON.stringify({ datasetId: 'test', comparisons })
  )
  for (const c of comparisons) {
    const dir = path.join(dataset, 'cases', String(c.pr))
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      path.join(dir, 'metadata.json'),
      JSON.stringify({ commits: { base, head, mergeBase: base } })
    )
    writeFileSync(
      path.join(dir, 'changes.json'),
      JSON.stringify([{ status: 'A', before: null, after: { path: ui, blob, mode: '100644' } }])
    )
    expect(storedChanges(dataset, c)).toHaveLength(1)
  }
  const run = (workers: number) => {
    const out = path.join(repo, `evaluation-${workers}`)
    execFileSync(
      'bun',
      [
        '--no-env-file',
        new URL('./design-conformance/evaluate.ts', import.meta.url).pathname,
        '--policy',
        'appearance',
        '--dataset',
        dataset,
        '--output',
        out,
        '--workers',
        String(workers),
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    )
    return out
  }
  const one = run(1)
  const two = run(2)
  for (const pr of [1, 2])
    expect(readFileSync(path.join(one, `${pr}.json`), 'utf8')).toBe(
      readFileSync(path.join(two, `${pr}.json`), 'utf8')
    )
})
