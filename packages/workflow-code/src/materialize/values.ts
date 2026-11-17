import { isRecordLike } from '@sim/utils/object'
import { escapeRegExp } from '@sim/utils/string'
import {
  type BlockKey,
  type CanonicalBlock,
  type CanonicalParam,
  type CanonicalWorkflow,
  isSimNode,
  type Json,
  type LoopSpec,
  type ParallelSpec,
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
      context.diagnostics.push({
        code: 'E_MAT_UNKNOWN_RESOURCE',
        severity: 'error',
        message: `Variable "${node.key}" does not exist in this workflow`,
        ...location,
      })
      return node.key
    }
    case 'resource': {
      const id = context.resources?.toId(node.kind, node.key) ?? null
      if (id !== null) return id
      context.diagnostics.push({
        code: 'E_MAT_UNKNOWN_RESOURCE',
        severity: 'error',
        message: `No ${node.kind} "${node.key}" in this workspace`,
        ...location,
      })
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
 * Rewrites `<oldkey.` reference tokens to `<newkey.` after a rename. Case-insensitive,
 * because the block resolver lowercases names (`BlockResolver`). A
 * rename whose old key is still a key of `workflow` is skipped: the token still names that block.
 */
export function rewriteRenamedReferences(
  workflow: CanonicalWorkflow,
  renames: ReadonlyArray<{ from: BlockKey; to: BlockKey }>
): CanonicalWorkflow {
  const active = renames.filter(({ from }) => !Object.hasOwn(workflow.blocks, from))
  if (active.length === 0) return workflow
  const patterns = active.map(({ from, to }) => ({
    pattern: new RegExp(`<${escapeRegExp(from)}\\.`, 'gi'),
    replacement: `<${to}.`,
  }))
  const rewrite = (text: string): string =>
    text.includes('<')
      ? patterns.reduce((acc, { pattern, replacement }) => acc.replace(pattern, replacement), text)
      : text
  const blocks: CanonicalWorkflow['blocks'] = {}
  for (const [key, block] of Object.entries(workflow.blocks)) {
    setOwn(blocks, key, rewriteBlock(block, rewrite))
  }
  return { ...workflow, blocks }
}
