/**
 * Builder names come from the catalog's frozen `builders` map (`apps/sim/blocks/sdk-names.json`,
 * owned by Wave 2A; build-spec decision 7). Codegen never invents a method name: it validates the
 * map, splits each dotted path into namespaces, and names the generated type aliases after it.
 */

import {
  type BlockCatalog,
  type CatalogBuilder,
  catalogBlock,
  catalogBuilder,
  catalogBuilderPaths,
  SDK_CORE_EXPORTS,
} from '@sim/workflow-code'
import { isIdentifier, pascal, RESERVED_WORDS } from './emit'

/**
 * Builders `core.d.ts` declares itself, because their source form is special (named branches,
 * function code files, a typed human form). Generated files type their params and outputs through
 * `SpecialBuilderTypes`. `coreParams` are the params the core signature owns, dropped from the
 * generated params type.
 */
const SPECIAL_BUILDERS: Readonly<Record<string, { coreParams: readonly string[] }>> = {
  condition: { coreParams: ['conditions'] },
  router: { coreParams: ['routes'] },
  fn: { coreParams: ['code'] },
  runWorkflow: { coreParams: [] },
  human: { coreParams: ['inputFormat'] },
  response: { coreParams: [] },
  setVariables: { coreParams: [] },
  note: { coreParams: [] },
}

/** The builder paths `core.d.ts` declares itself; the catalog must map each to its block type. */
export const SPECIAL_BUILDER_KEYS: readonly string[] = Object.keys(SPECIAL_BUILDERS)

/**
 * Core exports a generated namespace may merge with: functions (`table.insertRow` beside
 * `table('leads')`) and the empty `trigger` / `legacy` namespaces. Consts (`env`, `loop`, `js`,
 * ...) cannot merge.
 */
const MERGEABLE_CORE_EXPORTS: ReadonlySet<string> = new Set([
  'binding',
  'customTool',
  'folder',
  'kb',
  'legacy',
  'mcp',
  'picked',
  'sandbox',
  'skill',
  'table',
  'trigger',
  'upload',
  'workflow',
])

const CORE_EXPORTS: ReadonlySet<string> = new Set(SDK_CORE_EXPORTS)

/** The namespace each tool-form builder is exposed under: `slack.tool.sendMessage(...)`. */
export const TOOL_NAMESPACE = 'tool'

export interface BuilderEntry {
  /** The dotted SDK path (`slack.sendMessage`). */
  key: string
  /** `key` split on dots. */
  path: string[]
  builder: CatalogBuilder
  /** Set for builders `core.d.ts` declares. */
  special?: { coreParams: readonly string[] }
  /** Prefix for generated type aliases (`SlackSendMessage`). */
  typeName: string
}

function compareKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Validates the builders map and returns its entries sorted by key. Throws on a name the emitter
 * cannot declare: a non-identifier or reserved segment, a root that redeclares a core value, a
 * `tool` segment that would hide the tool form, or a builder whose block type is missing.
 */
export function builderEntries(catalog: BlockCatalog): BuilderEntry[] {
  const keys = catalogBuilderPaths(catalog).sort(compareKeys)
  const entries: BuilderEntry[] = []
  const namespaces = new Set<string>()
  for (const key of keys) {
    const path = key.split('.')
    for (let depth = 1; depth < path.length; depth++) namespaces.add(path.slice(0, depth).join('.'))
  }
  for (const key of keys) {
    const builder = catalogBuilder(catalog, key)
    if (!builder) continue
    const path = key.split('.')
    for (const segment of path) {
      if (!isIdentifier(segment) || RESERVED_WORDS.has(segment)) {
        throw new Error(
          `sdk codegen: builder \`${key}\` has segment \`${segment}\`, which cannot name a declaration`
        )
      }
    }
    if (!catalogBlock(catalog, builder.type)) {
      throw new Error(
        `sdk codegen: builder \`${key}\` names unknown block type \`${builder.type}\``
      )
    }
    if (namespaces.has(key)) {
      throw new Error(`sdk codegen: builder \`${key}\` is also a namespace of other builders`)
    }
    if (path.length > 1 && path[path.length - 1] === TOOL_NAMESPACE) {
      throw new Error(
        `sdk codegen: builder \`${key}\` collides with the \`${TOOL_NAMESPACE}\` namespace`
      )
    }
    const root = path[0]
    const special = path.length === 1 ? SPECIAL_BUILDERS[root] : undefined
    if (path.length === 1 && !special && CORE_EXPORTS.has(root)) {
      throw new Error(`sdk codegen: builder \`${key}\` redeclares a core export`)
    }
    if (path.length > 1 && CORE_EXPORTS.has(root) && !MERGEABLE_CORE_EXPORTS.has(root)) {
      throw new Error(`sdk codegen: namespace \`${root}\` collides with a core export`)
    }
    entries.push({ key, path, builder, special, typeName: pascal(path) })
  }
  return entries
}
