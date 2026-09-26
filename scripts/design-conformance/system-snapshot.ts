import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import { compareStrings } from '@sim/utils/string'
import { centralInventory, registry } from '#design-conformance/contracts'
import { git, manifest, options, storedText, verifiedText, writeJson } from '#design-conformance/io'
import { canonical, type Entry, hash, TOKEN_FILE } from '#design-conformance/model'

export interface SystemSnapshot {
  version: '1.0.0'
  commit: string
  hash: string
  entries: Entry[]
  recipeInventory?: string[]
}
export interface SystemInput {
  snapshot: SystemSnapshot
  read: (entry: Entry) => string
  unchecked?: string[]
}
export function snapshotHash(entries: Entry[], recipeInventory?: string[]): string {
  return hash(canonical(recipeInventory ? { entries, recipeInventory } : entries))
}
export function gitSnapshot(repo: string, commit: string): SystemInput {
  const entries = git(repo, [
    'ls-tree',
    '-r',
    '-z',
    commit,
    '--',
    'apps/sim/app/_styles',
    'apps/sim/tailwind.config.ts',
    'apps/sim/postcss.config.mjs',
    'apps/sim/lib/postcss',
    'packages/emcn/src',
    '.claude/rules',
    ...Object.keys(registry.centralRecipes ?? {}),
  ])
    .toString()
    .split('\0')
    .filter(Boolean)
    .flatMap((line) => {
      const tab = line.indexOf('\t')
      const [mode, kind, blob] = line.slice(0, tab).split(' ')
      const file = line.slice(tab + 1)
      return kind === 'blob' && centralInventory(file) ? [{ path: file, blob, mode }] : []
    })
    .sort((a, b) => compareStrings(a.path, b.path))
  if (!entries.some((e) => e.path === TOKEN_FILE))
    throw new Error('Required central globals.css is missing')
  const recipeInventory = Object.keys(registry.centralRecipes ?? {}).sort()
  return {
    snapshot: {
      version: '1.0.0',
      commit,
      hash: snapshotHash(entries, recipeInventory),
      entries,
      recipeInventory,
    },
    read: (e) => verifiedText(git(repo, ['cat-file', 'blob', e.blob]), e.blob),
  }
}
/** Reject incomplete historical inventories when immutable input proves a recipe existed. */
export function assertRecipeSnapshot(snapshot: SystemSnapshot, knownEntries: Entry[]): void {
  for (const entry of knownEntries) {
    if (!registry.centralRecipes?.[entry.path]) continue
    const stored = snapshot.entries.find((e) => e.path === entry.path)
    if (!stored)
      throw new Error(
        `Central snapshot omits registered recipe known to exist: ${entry.path}; regenerate central snapshots from the merge-base`
      )
  }
}
export function loadSnapshot(root: string, commit: string, repo?: string): SystemInput {
  if (!/^[a-f\d]{40}$/.test(commit)) throw new Error('Invalid central snapshot commit')
  const index = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8'))
  if (index.version !== '1.0.0' || !index.snapshots)
    throw new Error('Invalid central snapshot manifest')
  const s: SystemSnapshot = JSON.parse(
    readFileSync(path.join(root, 'commits', `${commit}.json`), 'utf8')
  )
  if (
    s.version !== '1.0.0' ||
    s.commit !== commit ||
    index.snapshots[commit] !== s.hash ||
    new Set(s.entries.map((e) => e.path)).size !== s.entries.length ||
    s.hash !== snapshotHash(s.entries, s.recipeInventory) ||
    !s.entries.some((e) => e.path === TOKEN_FILE)
  )
    throw new Error('Invalid or incompatible central source snapshot')
  if (
    s.recipeInventory !== undefined &&
    (!Array.isArray(s.recipeInventory) ||
      s.recipeInventory.some((p) => typeof p !== 'string') ||
      new Set(s.recipeInventory).size !== s.recipeInventory.length)
  )
    throw new Error('Invalid central recipe snapshot inventory evidence')
  if (repo) assertRecipeSnapshot(s, gitSnapshot(repo, commit).snapshot.entries)
  const unchecked = Object.keys(registry.centralRecipes ?? {})
    .filter((file) => !s.entries.some((e) => e.path === file) && !s.recipeInventory?.includes(file))
    .map(
      (file) =>
        `Central snapshot completeness is unverified for registered recipe ${file}; regenerate snapshots to establish merge-base presence or absence`
    )
  return { snapshot: s, read: (e) => storedText(root, e), unchecked: repo ? [] : unchecked }
}
if (import.meta.main) {
  const args = options({ dataset: { type: 'string' }, manifest: { type: 'string' } })
  if (!args.repo || !args.dataset || !args.output)
    throw new Error(
      'Usage: snapshot:system --repo <git repo> --dataset <frozen dataset> --output <fresh directory>'
    )
  const start = performance.now()
  const out = path.resolve(args.output as string)
  mkdirSync(path.join(out, 'commits'), { recursive: true })
  mkdirSync(path.join(out, 'objects'), { recursive: true })
  const data = manifest(args.dataset as string, args.manifest as string | undefined)
  const commits = [...new Set(data.data.comparisons.map((c) => c.mergeBase))].sort()
  const snapshots: Record<string, string> = {}
  let objects = 0
  for (const commit of commits) {
    const input = gitSnapshot(args.repo as string, commit)
    for (const e of input.snapshot.entries) {
      const dest = path.join(out, 'objects', `${e.blob}.gz`)
      if (!existsSync(dest)) {
        await Bun.write(dest, gzipSync(Buffer.from(input.read(e))))
        objects++
      }
    }
    writeJson(path.join(out, 'commits', `${commit}.json`), input.snapshot)
    snapshots[commit] = input.snapshot.hash
  }
  writeJson(path.join(out, 'manifest.json'), {
    version: '1.0.0',
    datasetHash: data.hash,
    snapshots,
  })
  const metrics = {
    milliseconds: performance.now() - start,
    commits: commits.length,
    objects,
    peakMemoryBytes: process.resourceUsage().maxRSS * 1024,
  }
  writeJson(path.join(out, 'preparation.json'), metrics)
  process.stdout.write(`${JSON.stringify(metrics)}\n`)
}
