import { isRecordLike } from '@sim/utils/object'
import { escapeRegExp } from '@sim/utils/string'
import { closest } from '../compile/hints'
import { diagnostic } from '../diagnostics/factory'
import {
  type BlockKey,
  type CanonicalBlock,
  type CanonicalParam,
  type CanonicalWorkflow,
  isSimNode,
  type Json,
  type LoopSpec,
  type ParallelSpec,
  type ResourceKind,
  type SimNode,
  type Value,
} from '../model'
import { setOwn } from '../records'
import type { MaterializeContext } from './context'

/** Where a value sits, for diagnostics. */
interface ValueLocation {
  blockKey?: BlockKey
  param?: string
}

/**
 * The stored form of a model value: the inverse of canonicalize's `toValue` plus its id-site
 * lifting. A `var` node becomes the variable's id, a `resource` node the
 * resolver's id, an `unresolved` node its verbatim id, a `csv` node its items joined with `,`, and
 * a `literal` node its wrapped JSON. A resource key the resolver cannot map is written as the key
 * itself with `E_MAT_UNKNOWN_RESOURCE`, which fails the apply.
 */
export function unliftValue(
  value: Value,
  context: MaterializeContext,
  location: ValueLocation
): unknown {
  if (Array.isArray(value)) return value.map((item) => unliftValue(item, context, location))
  if (!isRecordLike(value)) return value
  if (isSimNode(value)) return unliftNode(value, context, location)
  const result: Record<string, unknown> = {}
  for (const [key, member] of Object.entries(value)) {
    if (member !== undefined) setOwn(result, key, unliftValue(member, context, location))
  }
  return result
}

/** How many keys an unknown-key hint lists. */
const LISTED_KEYS = 20

/**
 * The `sim` command that creates a resource of each kind a source names by key, so an unknown-key
 * hint says how to make the one the source wants, not only that it is missing. A source names a
 * resource by the key its name slugs to; `sim workflows source resources` lists them.
 */
const CREATE_COMMANDS: Partial<Record<ResourceKind, string>> = {
  credential:
    '`sim credentials connect <provider> --name "<Name>"` (OAuth; hand the link to the person who owns the account) or `sim credentials create <provider> --name "<Name>" --credentials @<file>` (a service account)',
  table: '`sim tables create`',
  'knowledge-base': '`sim knowledge create`',
  skill: '`sim skills create`',
  'custom-tool': '`sim custom-tools create`',
  'mcp-server': '`sim mcp-servers create`',
  workflow: '`sim workflows source create --dir <new dir>`',
}

/** How to create a missing resource of `kind`, as a sentence, or empty when no command does. */
function createHint(kind: ResourceKind): string {
  const command = CREATE_COMMANDS[kind]
  return command
    ? ` Create it with ${command}; a source names it by its key, which \`sim workflows source resources\` lists.`
    : ''
}

/**
 * The hint of an unknown resource key: the closest available key, then the keys of that kind the
 * workspace holds (or that it holds none), then the command that creates one. `undefined` when the
 * caller loaded no keys.
 */
function availableKeysHint(
  kind: ResourceKind,
  keys: readonly string[] | undefined,
  written: string
): string | undefined {
  if (keys === undefined) return undefined
  if (keys.length === 0)
    return `This workspace has no ${kind} a source can name yet.${createHint(kind)}`
  const near = closest(written, keys)
  return `${near !== null ? `Did you mean ${near}? ` : ''}Keys: ${listed(keys)}.${near !== null ? '' : createHint(kind)}`
}

/** The first {@link LISTED_KEYS} keys, then how many more there are. */
function listed(keys: readonly string[]): string {
  const more = keys.length > LISTED_KEYS ? `, and ${keys.length - LISTED_KEYS} more` : ''
  return `${keys.slice(0, LISTED_KEYS).join(', ')}${more}`
}

/** The hint of an unknown variable: the closest declared variable, then the declared ones. */
function variableHint(written: string, keys: readonly string[]): string {
  if (keys.length === 0) {
    return "This workflow declares no variables; declare it in the workflow's variables option."
  }
  const near = closest(written, keys)
  return `${near !== null ? `Did you mean vars.${near}? ` : ''}Variables: ${listed(keys)}.`
}

function unliftNode(node: SimNode, context: MaterializeContext, location: ValueLocation): unknown {
  switch (node.$sim) {
    case 'literal':
      return node.value
    case 'unresolved':
      return node.id
    case 'csv':
      return node.items.map((item) => unliftNode(item, context, location)).join(',')
    case 'var': {
      const id = context.variableIdByKey.get(node.key)
      if (id !== undefined) return id
      const hint = variableHint(node.key, [...context.variableIdByKey.keys()])
      context.diagnostics.push(
        diagnostic(
          'E_MAT_UNKNOWN_VARIABLE',
          `Variable "${node.key}" does not exist in this workflow`,
          {
            hint,
            ...location,
          }
        )
      )
      return node.key
    }
    case 'resource': {
      const id = context.resources?.toId(node.kind, node.key) ?? null
      if (id !== null) return id
      const hint = availableKeysHint(node.kind, context.resources?.keysOf?.(node.kind), node.key)
      context.diagnostics.push(
        diagnostic('E_MAT_UNKNOWN_RESOURCE', `No ${node.kind} "${node.key}" in this workspace`, {
          ...(hint !== undefined ? { hint } : {}),
          ...location,
        })
      )
      return node.key
    }
  }
}

/** Rewrites every string inside a model value; nodes and their payloads are left alone. */
function mapStrings(value: Value, rewrite: (text: string) => string): Value {
  if (typeof value === 'string') return rewrite(value)
  if (Array.isArray(value)) return value.map((item) => mapStrings(item, rewrite))
  if (!isRecordLike(value) || isSimNode(value)) return value
  const result: Record<string, Value> = {}
  for (const [key, member] of Object.entries(value))
    setOwn(result, key, mapStrings(member, rewrite))
  return result
}

function rewriteParam(param: CanonicalParam, rewrite: (text: string) => string): CanonicalParam {
  if (param.kind === 'value') return { kind: 'value', value: mapStrings(param.value, rewrite) }
  return {
    kind: 'tools',
    tools: param.tools.map((tool) => {
      const params: Record<string, Value> = {}
      for (const [key, member] of Object.entries(tool.params)) {
        setOwn(params, key, mapStrings(member, rewrite))
      }
      return { ...tool, params }
    }),
  }
}

function rewriteSubflow(
  subflow: LoopSpec | ParallelSpec,
  rewrite: (text: string) => string
): LoopSpec | ParallelSpec {
  if (subflow.kind === 'parallel') {
    return subflow.distribution === undefined
      ? subflow
      : { ...subflow, distribution: mapStrings(subflow.distribution, rewrite) as Json }
  }
  const loop: LoopSpec = { ...subflow }
  if (loop.forEachItems !== undefined) {
    loop.forEachItems = mapStrings(loop.forEachItems, rewrite) as Json
  }
  if (loop.whileCondition !== undefined) loop.whileCondition = rewrite(loop.whileCondition)
  if (loop.doWhileCondition !== undefined) loop.doWhileCondition = rewrite(loop.doWhileCondition)
  return loop
}

function rewriteBlock(block: CanonicalBlock, rewrite: (text: string) => string): CanonicalBlock {
  const params: CanonicalBlock['params'] = {}
  for (const [id, param] of Object.entries(block.params))
    setOwn(params, id, rewriteParam(param, rewrite))
  const result: CanonicalBlock = { ...block, params }
  if (block.branches?.rows) {
    result.branches = {
      kind: block.branches.kind,
      rows: block.branches.rows.map((row) => ({ ...row, value: rewrite(row.value) })),
    }
  }
  if (block.subflow) result.subflow = rewriteSubflow(block.subflow, rewrite)
  return result
}

/**
 * A function rewriting every `<from.` reference token in a text to `<to.`, case-insensitively, as
 * an apply rewrites the references to a renamed block. Every rename applies in one pass, so a
 * token one rename wrote is never rewritten again by another (swapped or chained renames).
 */
export function renamedReferenceRewriter(
  renames: ReadonlyArray<{ from: BlockKey; to: BlockKey }>
): (text: string) => string {
  const targets = new Map<string, BlockKey>()
  for (const { from, to } of renames) {
    const key = from.toLowerCase()
    if (!targets.has(key)) targets.set(key, to)
  }
  if (targets.size === 0) return (text) => text
  const pattern = new RegExp(`<(${[...targets.keys()].map(escapeRegExp).join('|')})\\.`, 'gi')
  return (text) =>
    text.includes('<')
      ? text.replace(pattern, (token, from: string) => {
          const to = targets.get(from.toLowerCase())
          return to === undefined ? token : `<${to}.`
        })
      : text
}

/**
 * Rewrites `<oldkey.` reference tokens in source text to `<newkey.` after a rename.
 * Case-insensitive, because the block resolver lowercases names (`BlockResolver`). A rename whose
 * old key is still a key of `workflow` is skipped: in source the token names the block declared
 * under that key, as compile resolves it. Text that holds stored keys only (a value restored from
 * the stored block) goes through {@link rewriteStoredBlockReferences} instead.
 */
export function rewriteRenamedReferences(
  workflow: CanonicalWorkflow,
  renames: ReadonlyArray<{ from: BlockKey; to: BlockKey }>
): CanonicalWorkflow {
  const active = renames.filter(({ from }) => !Object.hasOwn(workflow.blocks, from))
  if (active.length === 0) return workflow
  const rewrite = renamedReferenceRewriter(active)
  const blocks: CanonicalWorkflow['blocks'] = {}
  for (const [key, block] of Object.entries(workflow.blocks)) {
    setOwn(blocks, key, rewriteBlock(block, rewrite))
  }
  return { ...workflow, blocks }
}

/**
 * `block` (a stored block, whose text names blocks by their stored keys) with every `<oldkey.`
 * token rewritten to its new key through all `renames` at once, so a chain or swap of renames
 * lands each token on the block it named.
 */
export function rewriteStoredBlockReferences(
  block: CanonicalBlock,
  renames: ReadonlyArray<{ from: BlockKey; to: BlockKey }>
): CanonicalBlock {
  return renames.length === 0 ? block : rewriteBlock(block, renamedReferenceRewriter(renames))
}
