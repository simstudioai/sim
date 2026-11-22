/**
 * The layout of the generated declarations (`generateSdkTypes`) and which of them a source
 * directory holds and type-checks. A whole catalog is about 500 block files (over 13 MB), so a
 * directory holds and its `tsconfig.json` includes only the blocks its source uses; the whole set
 * lives once per catalog in the CLI's cache, which `tsconfig.full.json` includes for adding any
 * block.
 */

import { compareStrings } from '@sim/utils/string'
import type { BlockCatalog } from '@sim/workflow-code'
import { catalogBuilder, catalogBuilderPaths } from '@sim/workflow-code/catalog/view'
import { SDK_SPECIAL_BUILDERS } from '@sim/workflow-code/sdk'
import { TOOL_NAMESPACE } from './names'

/**
 * Builders whose blocks every directory type-checks: the ones `core.d.ts` declares itself, whose
 * params would otherwise type as loose records instead of failing, plus the agent and the start
 * trigger, which nearly every new workflow begins with.
 */
const ALWAYS_CHECKED_BUILDERS: readonly string[] = [
  ...Object.keys(SDK_SPECIAL_BUILDERS),
  'agent',
  'trigger.start',
]

/** Builders of hidden older block versions live under this namespace (`legacy.gmail.sendEmail`). */
const LEGACY_NAMESPACE = 'legacy'

/** The generated declarations always written beside the block files. */
export const SDK_MODELS_FILE = 'models.d.ts'
export const SDK_INDEX_FILE = 'index.d.ts'
/** The builder list an agent greps (`generateSdkIndex`). */
export const SDK_GUIDE_FILE = 'INDEX.md'

/** A block type's declaration file, relative to the SDK directory. */
export function blockTypesFile(type: string): string {
  return `blocks/${type}.d.ts`
}

/** Whether a builder path is a legacy builder. */
export function isLegacyBuilder(key: string): boolean {
  return key.startsWith(`${LEGACY_NAMESPACE}.`)
}

/** Every block type with a builder, in catalog order: each has a `blocks/<type>.d.ts`. */
function declaredBlockTypes(catalog: BlockCatalog): Map<string, { legacyOnly: boolean }> {
  const types = new Map<string, { legacyOnly: boolean }>()
  for (const key of catalogBuilderPaths(catalog)) {
    const builder = catalogBuilder(catalog, key)
    if (!builder) continue
    const legacy = isLegacyBuilder(key)
    const known = types.get(builder.type)
    types.set(builder.type, { legacyOnly: (known?.legacyOnly ?? true) && legacy })
  }
  return types
}

/** The block types only legacy builders create: `index.d.ts` leaves their files out. */
export function legacyOnlyBlockTypes(catalog: BlockCatalog): Set<string> {
  return new Set(
    [...declaredBlockTypes(catalog)].flatMap(([type, { legacyOnly }]) => (legacyOnly ? [type] : []))
  )
}

/** A dotted path (`slack . sendMessage`). It always succeeds greedily, so a scan never rescans one. */
const CHAIN = /[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*/g
const OPEN_PAREN = /\s*\(/y

/**
 * The segments of each dotted call in `text` (`slack . sendMessage (` → `['slack', 'sendMessage']`).
 * The `(` is checked after the chain matches, not inside its pattern: a pattern that can fail after
 * the chain retries from each of its characters, quadratic on a long identifier or `a.b.c…` run.
 */
function* calledPaths(text: string): Generator<string[]> {
  for (const match of text.matchAll(CHAIN)) {
    OPEN_PAREN.lastIndex = match.index + match[0].length
    if (OPEN_PAREN.test(text)) yield match[0].replace(/\s+/g, '').split('.')
  }
}

/**
 * The catalog builders `sources` (workflow files) call, sorted: every dotted call whose path is a
 * catalog builder (`slack.sendMessage(`) or its tool form (`slack.tool.sendMessage(`, read as
 * `slack.sendMessage`). A text scan, not a compile, so it reads any source, broken or not; a
 * builder named in a comment counts too. `block('type', …)` names no builder.
 */
export function referencedBuilders(catalog: BlockCatalog, sources: Iterable<string>): string[] {
  const keys = new Set<string>()
  for (const text of sources) {
    for (const path of calledPaths(text)) {
      if (path.length > 1 && path[path.length - 2] === TOOL_NAMESPACE)
        path.splice(path.length - 2, 1)
      else if (path.length > 1 && path[path.length - 1] === TOOL_NAMESPACE) path.pop()
      const key = path.join('.')
      if (catalogBuilder(catalog, key)) keys.add(key)
    }
  }
  return [...keys].sort(compareStrings)
}

/**
 * The block types `sources` name through a builder ({@link referencedBuilders}): the blocks a
 * directory's `tsconfig.json` type-checks.
 */
export function referencedBlockTypes(catalog: BlockCatalog, sources: Iterable<string>): string[] {
  const types = new Set<string>()
  for (const key of referencedBuilders(catalog, sources)) {
    const builder = catalogBuilder(catalog, key)
    if (builder) types.add(builder.type)
  }
  return [...types].sort(compareStrings)
}

/**
 * The block types a directory holds declarations for and its `tsconfig.json` type-checks: the
 * `used` types that have builders, plus the {@link ALWAYS_CHECKED_BUILDERS}' blocks.
 */
export function checkedBlockTypes(catalog: BlockCatalog, used: Iterable<string>): string[] {
  const declared = declaredBlockTypes(catalog)
  const types = new Set<string>()
  for (const key of ALWAYS_CHECKED_BUILDERS) {
    const type = catalogBuilder(catalog, key)?.type
    if (type) types.add(type)
  }
  for (const type of used) if (declared.has(type)) types.add(type)
  return [...types].sort(compareStrings)
}

/**
 * The block files a directory's `tsconfig.json` includes, relative to the SDK directory: those of
 * the {@link checkedBlockTypes}.
 */
export function defaultBlockFiles(catalog: BlockCatalog, used: Iterable<string>): string[] {
  return checkedBlockTypes(catalog, used).map(blockTypesFile)
}

/**
 * The files `tsconfig.full.json` includes beside the source, relative to the SDK directory:
 * `index.d.ts` (the models and every current block) and the legacy-only blocks among `used`.
 */
export function fullBlockFiles(catalog: BlockCatalog, used: Iterable<string>): string[] {
  const legacyOnly = legacyOnlyBlockTypes(catalog)
  const legacy = [...new Set(used)].filter((type) => legacyOnly.has(type)).sort(compareStrings)
  return [SDK_INDEX_FILE, ...legacy.map(blockTypesFile)]
}
