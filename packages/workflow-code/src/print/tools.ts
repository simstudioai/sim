/**
 * Agent tool lists as source: each tool through its builder, an MCP or child-workflow tool form,
 * a custom tool call, or `raw(tool)`. Mirrors `compile/tools.ts`.
 */

import { compareStrings } from '@sim/utils/string'
import {
  type McpToolForm,
  readMcpTool,
  readWorkflowTool,
  type WorkflowToolForm,
} from '../agent-tools'
import { toolModeOverrides } from '../canonicalize/modes'
import { builderPins, buildFieldIndex, paramAliases, typedForBuilder } from '../catalog/surface'
import type { BlockCatalog, CatalogBlock, CatalogBuilder } from '../catalog/types'
import { catalogBlock, catalogBuildersOfType, declarationsOf } from '../catalog/view'
import { diagnostic } from '../diagnostics/factory'
import { isJson } from '../lock'
import {
  type CanonicalBlock,
  type CanonicalTool,
  isPlainRecord,
  type Json,
  type ParamMode,
  type Value,
} from '../model'
import { getOwn } from '../records'
import { CUSTOM_TOOL_TYPE, hasToolForm } from '../sdk'
import { holdsDetectedSecret, holdsSecret, isLiteralSecret, literalSecretFinding } from '../secrets'
import type { PrintContext } from './context'
import { printKey } from './strings'
import { arrayExpr, type Expr, objectExpr, type Property } from './syntax'
import type { FieldContext, PrintedValue } from './values'

/**
 * The catalog builder for a block, most specific first (operation, then pinned fields). A
 * builder's params type one surface, so a trigger-mode builder never prints an action block and an
 * action builder never prints a block in trigger mode; such a block prints through `block()`. A
 * trigger block (`category: 'triggers'`) serializes both surfaces, so its builders fit either
 * stored mode.
 */
export function findBuilder(
  catalog: BlockCatalog,
  type: string,
  triggerMode: boolean,
  read: (id: string) => string | undefined
): { path: string; builder: CatalogBuilder } | null {
  const triggerBlock = catalogBlock(catalog, type)?.category === 'triggers'
  const candidates = catalogBuildersOfType(catalog, type)
    .filter(([, builder]) => {
      if (!triggerBlock && (builder.triggerMode === true) !== triggerMode) return false
      if (builder.operation !== undefined && read('operation') !== builder.operation) return false
      return Object.entries(builder.fixed ?? {}).every(([id, value]) => read(id) === value)
    })
    .sort(([pathA, a], [pathB, b]) => {
      const modeA = (a.triggerMode === true) === triggerMode ? 0 : 1
      const modeB = (b.triggerMode === true) === triggerMode ? 0 : 1
      if (modeA !== modeB) return modeA - modeB
      const opA = a.operation === undefined ? 1 : 0
      const opB = b.operation === undefined ? 1 : 0
      if (opA !== opB) return opA - opB
      const fixedA = Object.keys(a.fixed ?? {}).length
      const fixedB = Object.keys(b.fixed ?? {}).length
      if (fixedA !== fixedB) return fixedB - fixedA
      return compareStrings(pathA, pathB)
    })
  const [first] = candidates
  return first ? { path: first[0], builder: first[1] } : null
}

/**
 * A tool entry, or one of its params, as JSON for `raw(...)`. The CWM is JSON by contract
 * (`canonicalHash` stringifies it with `stableStringify`, which throws otherwise), so a non-JSON
 * tool is a canonicalize bug.
 */
function asToolJson(tool: CanonicalTool, value: unknown): Json {
  if (!isJson(value)) throw new Error(`Tool entry of type "${tool.type}" is not plain JSON`)
  return value
}

/**
 * `customTool('key', options?)` for a custom tool stored as the picker's reference (a key, no
 * params, no snapshot); `null` for any other tool, which prints through its builder or `raw()`.
 */
function customToolCall(
  ctx: PrintContext,
  block: CanonicalBlock,
  tool: CanonicalTool
): Expr | null {
  const ref = tool.customTool?.ref
  const { type, params, modes, customTool, usageControl, usageControlExpression, ...rest } = tool
  if (
    type !== CUSTOM_TOOL_TYPE ||
    ref?.$sim !== 'resource' ||
    ref.kind !== 'custom-tool' ||
    customTool?.snapshot !== undefined ||
    Object.keys(params).length > 0 ||
    Object.keys(modes).length > 0 ||
    Object.values(rest).some((value) => value !== undefined)
  ) {
    return null
  }
  const options = usageOptions(ctx, block, { usageControl, usageControlExpression })
  const args: Expr[] = [ctx.values.string(ref.key)]
  if (options.length > 0) args.push(objectExpr(options))
  return ctx.values.call('customTool', args)
}

/** `usageControl` and `usageControlExpression` options, as a tool form writes them. */
function usageOptions(
  ctx: PrintContext,
  block: CanonicalBlock,
  tool: Pick<CanonicalTool, 'usageControl' | 'usageControlExpression'>
): Property[] {
  const options: Property[] = []
  if (tool.usageControl !== undefined) {
    options.push({ key: 'usageControl', value: ctx.values.string(tool.usageControl) })
  }
  if (tool.usageControlExpression !== undefined) {
    options.push({
      key: 'usageControlExpression',
      value: ctx.values.value(tool.usageControlExpression, { tag: 'js', from: block.key }),
    })
  }
  return options
}

/** `mcp('server').tool('name', options?)` (agent-tools.ts). */
function mcpToolCall(ctx: PrintContext, block: CanonicalBlock, form: McpToolForm): Expr {
  const options: Property[] = []
  const args = Object.entries(form.args)
  if (args.length > 0) {
    const nested: FieldContext = { tag: 't', from: block.key }
    options.push({
      key: 'args',
      value: objectExpr(
        args.map(([name, value]) => ({
          key: printKey(name),
          value: holdsDetectedSecret(value)
            ? storedSecret(ctx, block, name, false)
            : ctx.values.value(value, nested),
        }))
      ),
    })
  }
  options.push(...usageOptions(ctx, block, form))
  if (Object.keys(form.snapshot).length > 0) {
    options.push({ key: 'snapshot', value: ctx.values.json(form.snapshot as Json) })
  }
  const methodArgs: Expr[] = [ctx.values.string(form.name)]
  if (options.length > 0) methodArgs.push(objectExpr(options))
  return ctx.values.methodCall('mcp', [ctx.values.string(form.server.key)], 'tool', methodArgs)
}

/** `childWorkflow('key').asTool(options?)` (agent-tools.ts). */
function workflowToolCall(ctx: PrintContext, block: CanonicalBlock, form: WorkflowToolForm): Expr {
  const options = usageOptions(ctx, block, form)
  return ctx.values.methodCall(
    'childWorkflow',
    [ctx.values.string(form.workflow.key)],
    'asTool',
    options.length > 0 ? [objectExpr(options)] : []
  )
}

/** A tool list: each tool through its builder or form, else `raw(tool)`. */
export function printTools(
  ctx: PrintContext,
  block: CanonicalBlock,
  tools: CanonicalTool[]
): PrintedValue {
  const elements = tools.map((tool) => {
    const code = tool.customTool?.snapshot?.code
    if (code !== undefined && holdsDetectedSecret(code)) {
      ctx.diagnostics.push(
        diagnostic(
          'W_LITERAL_SECRET',
          `A custom tool snapshot in ${block.key} holds what looks like a literal credential in its code, which this file carries.`,
          {
            hint: 'Move the credential into a workspace env variable and read it from the custom tool code, then save the custom tool again.',
            blockKey: block.key,
          }
        )
      )
    }
    const mcp = readMcpTool(ctx.catalog, tool)
    if (mcp) return mcpToolCall(ctx, block, mcp)
    const childWorkflow = readWorkflowTool(ctx.catalog, tool)
    if (childWorkflow) return workflowToolCall(ctx, block, childWorkflow)
    const custom = customToolCall(ctx, block, tool)
    if (custom) return custom
    const declared = catalogBlock(ctx.catalog, tool.type)
    const found = findBuilder(ctx.catalog, tool.type, false, (id) => {
      if (id === 'operation') return tool.operation
      const value = getOwn(tool.params, id)
      return typeof value === 'string' ? value : undefined
    })
    const aliases = declared ? paramAliases(declared, false) : new Map<string, string>()
    const aliasNames = new Set(aliases.values())
    // A stored key spelled like an alias would compile back to the param the alias names.
    if (
      !found ||
      !declared ||
      !hasToolForm(found.path, found.builder, declared) ||
      Object.keys(tool.params).some((id) => aliasNames.has(id)) ||
      !toolParamsTyped(tool, declared, found.builder)
    ) {
      return rawToolCall(ctx, block, tool, declared, aliases)
    }
    const pinned = builderPins(found.builder)
    const nested: FieldContext = { tag: 't', from: block.key }
    const params: Property[] = Object.entries(tool.params)
      .filter(([id]) => !pinned.has(id))
      .map(([id, value]) => {
        const sb = declared ? declarationsOf(declared, id)[0] : undefined
        return {
          key: printKey(aliases.get(id) ?? id),
          value: holdsSecret(sb, value)
            ? storedSecret(ctx, block, aliases.get(id) ?? id, sb?.password === true)
            : sb
              ? ctx.values.field(value, { ...nested, subBlock: sb })
              : ctx.values.value(value, nested),
        }
      })
    const options: Property[] = []
    if (tool.operation !== undefined && !pinned.has('operation')) {
      options.push({ key: 'operation', value: ctx.values.string(tool.operation) })
    }
    if (tool.toolId !== undefined)
      options.push({ key: 'toolId', value: ctx.values.string(tool.toolId) })
    if (tool.title !== undefined)
      options.push({ key: 'title', value: ctx.values.string(tool.title) })
    options.push(...usageOptions(ctx, block, tool))
    const modes = toolModeOverrides(ctx.catalog, tool)
    if (Object.keys(modes).length > 0) {
      options.push({ key: 'modes', value: modesExpr(ctx, modes) })
    }
    if (tool.customTool !== undefined) {
      options.push({
        key: 'customTool',
        value: ctx.values.value(tool.customTool as Value, nested),
      })
    }
    if (tool.operationPolicy !== undefined) {
      options.push({ key: 'operationPolicy', value: ctx.values.json(tool.operationPolicy) })
    }
    if (tool.extra !== undefined && Object.keys(tool.extra).length > 0) {
      options.push({ key: 'extra', value: ctx.values.json(tool.extra) })
    }
    const segments = found.path.split('.')
    const method = segments.pop()
    const callee = segments.length === 0 ? `${method}.tool` : `${segments.join('.')}.tool.${method}`
    const args: Expr[] = [objectExpr(params)]
    if (options.length > 0) args.push(objectExpr(options))
    return ctx.values.call(callee, args)
  })
  return arrayExpr(elements)
}

/**
 * Whether every stored param of a tool is one its builder's tool type declares: a field written
 * under its own id (a pair under its canonical id) that the builder's pinned values leave
 * visible (`typedForBuilder`). Anything else prints the tool as `raw(tool)`.
 */
function toolParamsTyped(
  tool: CanonicalTool,
  declared: CatalogBlock,
  builder: CatalogBuilder
): boolean {
  const pins = builderPins(builder)
  const pinned = new Set(pins.keys())
  const index = buildFieldIndex(declared, false, pinned)
  const pinnedValues = Object.fromEntries(pins)
  return Object.keys(tool.params).every((id) => {
    if (pinned.has(id)) return true
    const field = index.fields.get(id) ?? index.aliased.get(id)
    if (!field || field.param !== id) return false
    const members = field.kind === 'pair' ? field.members : [field.sub]
    return typedForBuilder(
      members.flatMap((member) => index.declarations.get(member.id) ?? [member]),
      pinnedValues
    )
  })
}

/**
 * `raw(tool)`: the tool verbatim, except that a password param holding literal text prints as
 * `stored()`, as it does through a builder. A param spelled like an alias is a password when the
 * param the alias names is one.
 */
function rawToolCall(
  ctx: PrintContext,
  block: CanonicalBlock,
  tool: CanonicalTool,
  declared: CatalogBlock | undefined,
  aliases: ReadonlyMap<string, string>
): Expr {
  const passwordIds = new Set<string>()
  for (const subBlock of declared?.subBlocks ?? []) {
    if (!subBlock.password) continue
    passwordIds.add(subBlock.id)
    const alias = aliases.get(subBlock.id)
    if (alias !== undefined) passwordIds.add(alias)
  }
  const secret = (id: string, value: Value) =>
    passwordIds.has(id) ? isLiteralSecret(value) : holdsDetectedSecret(value)
  const json = asToolJson(tool, tool)
  if (!isPlainRecord(json) || !Object.entries(tool.params).some(([id, v]) => secret(id, v))) {
    return ctx.values.call('raw', [ctx.values.json(json)])
  }
  const params = objectExpr(
    Object.entries(tool.params).map(([id, value]) => ({
      key: printKey(id),
      value: secret(id, value)
        ? storedSecret(ctx, block, id, passwordIds.has(id))
        : ctx.values.json(asToolJson(tool, value)),
    }))
  )
  return ctx.values.call('raw', [
    objectExpr(
      Object.entries(json).map(([key, value]) => ({
        key: printKey(key),
        value: key === 'params' ? params : ctx.values.json(value),
      }))
    ),
  ])
}

function modesExpr(ctx: PrintContext, modes: Record<string, ParamMode>): Expr {
  return objectExpr(
    Object.keys(modes)
      .sort(compareStrings)
      .map((cid) => ({
        key: printKey(cid),
        value: ctx.values.string(getOwn(modes, cid) ?? 'basic'),
      }))
  )
}

/**
 * `stored()` for a password field holding literal text (`isLiteralSecret`), which keeps the
 * secret out of source, with the `W_LITERAL_SECRET` warning that it is stored as text.
 */
export function storedSecret(
  ctx: PrintContext,
  block: CanonicalBlock,
  name: string,
  password = true
): Expr {
  const { message, hint } = literalSecretFinding(name, { password })
  ctx.diagnostics.push(
    diagnostic('W_LITERAL_SECRET', message, { hint, blockKey: block.key, param: name })
  )
  return ctx.values.call('stored', [])
}
