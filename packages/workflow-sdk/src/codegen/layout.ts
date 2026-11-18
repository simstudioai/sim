/**
 * The layout of the generated declarations (`generateSdkTypes`) and which of them a source
 * directory type-checks. A whole catalog is about 500 block files; `tsc` over all of them costs
 * hundreds of megabytes, so a directory's `tsconfig.json` includes only the blocks its source
 * uses, and `tsconfig.full.json` every current block for adding a new one.
 */

import { compareStrings } from '@sim/utils/string'
import type { BlockCatalog } from '@sim/workflow-code'
import { catalogBuilder, catalogBuilderPaths } from '@sim/workflow-code/catalog/view'
import { SDK_SPECIAL_BUILDERS } from '@sim/workflow-code/sdk'

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

/** Every block type with a builder, sorted: each has a `blocks/<type>.d.ts`. */
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

const CALL = /([A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*)\s*\(/g

/**
 * The block types `sources` (workflow files) name through a builder: every dotted call whose path
 * is a catalog builder (`slack.sendMessage(`) or its tool form (`slack.tool.sendMessage(`). A
 * text scan, not a compile, so it reads any source, broken or not; a builder named in a comment
 * only adds a file to the type-check. `block('type', …)` has untyped params, so needs no file.
 */
export function referencedBlockTypes(catalog: BlockCatalog, sources: Iterable<string>): string[] {
  const types = new Set<string>()
  for (const text of sources) {
    for (const match of text.matchAll(CALL)) {
      const path = match[1].replace(/\s+/g, '').split('.')
      if (path.length > 1 && path[path.length - 2] === 'tool') path.splice(path.length - 2, 1)
      else if (path.length > 1 && path[path.length - 1] === 'tool') path.pop()
      const builder = catalogBuilder(catalog, path.join('.'))
      if (builder) types.add(builder.type)
    }
  }
  return [...types].sort(compareStrings)
}

/**
 * The block files a directory's `tsconfig.json` includes, relative to the SDK directory: those of
 * the `used` types that have one, plus the {@link ALWAYS_CHECKED_BUILDERS}' blocks.
 */
export function defaultBlockFiles(catalog: BlockCatalog, used: Iterable<string>): string[] {
  const declared = declaredBlockTypes(catalog)
  const types = new Set<string>()
  for (const key of ALWAYS_CHECKED_BUILDERS) {
    const type = catalogBuilder(catalog, key)?.type
    if (type) types.add(type)
  }
  for (const type of used) if (declared.has(type)) types.add(type)
  return [...types].sort(compareStrings).map(blockTypesFile)
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
