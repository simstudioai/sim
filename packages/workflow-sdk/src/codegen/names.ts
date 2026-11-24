/**
 * Builder names come from the catalog's frozen `builders` map (`apps/sim/blocks/sdk-names/<type>.json`).
 * Codegen never invents a method name: it validates the map, splits each dotted path into
 * namespaces, and names the generated type aliases after it.
 */

import { compareStrings } from '@sim/utils/string'
import type { BlockCatalog, CatalogBuilder } from '@sim/workflow-code'
import { isIdentifierName, JS_RESERVED_WORDS } from '@sim/workflow-code'
import { catalogBlock, catalogBuilder, catalogBuilderPaths } from '@sim/workflow-code/catalog/view'
import {
  SDK_CORE_EXPORTS,
  SDK_MERGEABLE_CORE_EXPORTS,
  SDK_SPECIAL_BUILDERS,
} from '@sim/workflow-code/sdk'
import { pascal } from './emit'

/** The builder paths `core.d.ts` declares itself; the catalog must map each to its block type. */
export const SPECIAL_BUILDER_KEYS: readonly string[] = Object.keys(SDK_SPECIAL_BUILDERS)

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

/**
 * Validates the builders map and returns its entries sorted by key. Throws on a name the emitter
 * cannot declare: a non-identifier or reserved segment, a root that redeclares a core value, a
 * `tool` segment that would hide the tool form, or a builder whose block type is missing.
 */
export function builderEntries(catalog: BlockCatalog): BuilderEntry[] {
  const keys = catalogBuilderPaths(catalog).sort(compareStrings)
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
      if (!isIdentifierName(segment) || JS_RESERVED_WORDS.has(segment)) {
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
    const special = path.length === 1 ? SDK_SPECIAL_BUILDERS[root] : undefined
    if (path.length === 1 && !special && CORE_EXPORTS.has(root)) {
      throw new Error(`sdk codegen: builder \`${key}\` redeclares a core export`)
    }
    if (path.length > 1 && CORE_EXPORTS.has(root) && !SDK_MERGEABLE_CORE_EXPORTS.has(root)) {
      throw new Error(`sdk codegen: namespace \`${root}\` collides with a core export`)
    }
    entries.push({ key, path, builder, special, typeName: pascal(path) })
  }
  return entries
}

/**
 * The entry of the catalog builder `key`, or `null` when the catalog has none, named as
 * {@link builderEntries} names it. It does not validate the rest of the map.
 */
export function builderEntry(catalog: BlockCatalog, key: string): BuilderEntry | null {
  const builder = catalogBuilder(catalog, key)
  if (!builder || !catalogBlock(catalog, builder.type)) return null
  const path = key.split('.')
  const special = path.length === 1 ? SDK_SPECIAL_BUILDERS[path[0]] : undefined
  return { key, path, builder, special, typeName: pascal(path) }
}
