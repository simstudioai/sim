import { compareStrings } from '@sim/utils/string'
import { git, verifiedText } from '#design-conformance/shared/io'
import { canonical, type Entry, hash, TOKEN_FILE } from '#design-conformance/shared/model'
import { centralInventory, registry } from '#design-conformance/system/contracts'

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
