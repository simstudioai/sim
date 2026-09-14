import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { gunzipSync } from 'node:zlib'
import type { Catalogue, Change, Commits, Entry } from '#design-conformance/model'
import { hash, type Policy } from '#design-conformance/model'
export function policyOption(value: string | boolean | undefined): Policy {
  if (value === undefined || value === 'conformance') return 'conformance'
  if (value === 'appearance') return 'appearance'
  if (value === 'tokens') return 'tokens'
  throw new Error('Policy must be conformance, appearance or tokens')
}

export function options(
  extra: Record<string, { type: 'string' | 'boolean' }> = {},
  args = process.argv.slice(2)
): Record<string, string | boolean | undefined> {
  return parseArgs({
    args,
    strict: true,
    options: {
      repo: { type: 'string' },
      base: { type: 'string' },
      head: { type: 'string' },
      catalogue: { type: 'string' },
      output: { type: 'string' },
      policy: { type: 'string' },
      ...extra,
    },
  }).values
}
export function loadCatalogue(file?: string): { catalogue: Catalogue; hash: string } {
  const raw = readFileSync(file ?? new URL('./catalogue.json', import.meta.url), 'utf8')
  return { catalogue: JSON.parse(raw), hash: hash(raw) }
}
export function writeJson(file: string, data: unknown): void {
  const temp = `${file}.${process.pid}.tmp`
  writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`)
  renameSync(temp, file)
}
export function git(repo: string, args: string[]): Buffer {
  try {
    return execFileSync('git', ['--no-pager', ...args], {
      cwd: repo,
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GIT_NO_REPLACE_OBJECTS: '1', GIT_CONFIG_NOSYSTEM: '1' },
    })
  } catch {
    throw new Error(`Git operation failed: ${args[0]}`)
  }
}
export function compareGit(
  repo: string,
  baseRef: string,
  headRef: string
): { commits: Commits; changes: Change[] } {
  if (git(repo, ['rev-parse', '--is-shallow-repository']).toString().trim() === 'true')
    throw new Error('Complete Git history is required')
  const resolve = (ref: string) => {
    const value = git(repo, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`])
      .toString()
      .trim()
    if (!/^[a-f\d]{40}$/.test(value)) throw new Error('Invalid immutable commit')
    return value
  }
  const base = resolve(baseRef)
  const head = resolve(headRef)
  const mergeBase = git(repo, ['merge-base', '--all', base, head]).toString().trim()
  if (!/^[a-f\d]{40}$/.test(mergeBase)) throw new Error('A unique merge-base is required')
  const raw = git(repo, [
    'diff',
    '--no-ext-diff',
    '--no-textconv',
    '--raw',
    '--no-abbrev',
    '-z',
    '-M',
    mergeBase,
    head,
    '--',
  ])
    .toString()
    .split('\0')
  const changes: Change[] = []
  for (let i = 0; i < raw.length - 1; ) {
    const [bm, am, bb, ab, status] = raw[i++].slice(1).split(' ')
    const from = raw[i++]
    const to = /^[RC]/.test(status) ? raw[i++] : from
    changes.push({
      status,
      before: bm === '000000' ? null : { path: from, blob: bb, mode: bm },
      after: am === '000000' ? null : { path: to, blob: ab, mode: am },
    })
  }
  return { commits: { base, head, mergeBase }, changes }
}
export function verifiedText(bytes: Buffer, blob: string): string {
  if (!/^[a-f\d]{40}$/.test(blob)) throw new Error('Invalid Git blob identity')
  const actual = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
  if (actual !== blob) throw new Error(`Source hash mismatch: ${blob}`)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Error(`Unreadable UTF-8 source: ${blob}`)
  }
}
export function gitText(repo: string, entry: Entry): string {
  return verifiedText(git(repo, ['cat-file', 'blob', entry.blob]), entry.blob)
}
export interface Comparison extends Commits {
  pr: number
  cohort: string
  sampleOrder: number
  files: string[]
}
export interface Manifest {
  datasetId: string
  comparisons: Comparison[]
}
export function manifest(dataset: string, file?: string): { data: Manifest; hash: string } {
  const source = readFileSync(file ?? path.join(dataset, 'manifest.json'), 'utf8')
  const data = JSON.parse(source) as Manifest
  if (
    !Array.isArray(data.comparisons) ||
    data.comparisons.length === 0 ||
    new Set(data.comparisons.map((x) => x.pr)).size !== data.comparisons.length
  )
    throw new Error('Invalid comparison manifest')
  for (const c of data.comparisons)
    if (
      !Number.isSafeInteger(c.pr) ||
      c.pr <= 0 ||
      ![c.base, c.head, c.mergeBase].every((x) => /^[a-f\d]{40}$/.test(x))
    )
      throw new Error('Invalid frozen comparison identity')
  return { data, hash: hash(source) }
}
export function storedChanges(dataset: string, c: Comparison): Change[] {
  const dir = path.join(dataset, 'cases', String(c.pr))
  const changes = JSON.parse(readFileSync(path.join(dir, 'changes.json'), 'utf8')) as Change[]
  const metadata = JSON.parse(readFileSync(path.join(dir, 'metadata.json'), 'utf8'))
  if (
    JSON.stringify(metadata.commits) !==
    JSON.stringify({ base: c.base, head: c.head, mergeBase: c.mergeBase })
  ) {
    if (!['base', 'head', 'mergeBase'].every((k) => metadata.commits[k] === c[k as keyof Commits]))
      throw new Error('Frozen comparison commit mismatch')
  }
  const files = changes.map((x) => (x.after ?? x.before)?.path).sort()
  if (JSON.stringify(files) !== JSON.stringify([...c.files].sort()))
    throw new Error('Frozen comparison file-set mismatch')
  return changes
}
export function storedText(dataset: string, entry: Entry): string {
  if (!/^[a-f\d]{40}$/.test(entry.blob)) throw new Error('Invalid stored blob identity')
  return verifiedText(
    gunzipSync(readFileSync(path.join(dataset, 'objects', `${entry.blob}.gz`))),
    entry.blob
  )
}
