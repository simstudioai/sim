import type { CallExpression, Node, ObjectProperty } from '@babel/types'
import { isRecordLike, toRecordOrNull } from '@sim/utils/object'
import {
  buildMcpTool,
  buildWorkflowTool,
  MCP_RESERVED_ARGS,
  type McpToolForm,
} from '../agent-tools'
import { paramAliases } from '../catalog/surface'
import { catalogBlock, catalogBuilder, catalogBuilderPaths } from '../catalog/view'
import type { CanonicalTool, Json, ParamMode, ResourceNode, UnresolvedNode, Value } from '../model'
import { getOwn, setOwn } from '../records'
import { CUSTOM_TOOL_TYPE } from '../sdk'
import { type CompileContext, lookup, rangeOf } from './context'
import { didYouMean, hintForNode } from './hints'
import {
  calleePath,
  compileJsonLiteral,
  compileNested,
  compileValue,
  literalText,
  nestedValue as nestedToolValue,
  objectEntries,
  type ValueSite,
} from './values'

const USAGE_CONTROLS = new Set(['auto', 'force', 'none'])

const TOOL_OPTIONS = [
  'operation',
  'toolId',
  'title',
  'usageControl',
  'usageControlExpression',
  'modes',
  'customTool',
  'operationPolicy',
  'extra',
]

function unsupported(
  ctx: CompileContext,
  node: Node,
  message: string,
  hint: string,
  site: ValueSite
) {
  ctx.reporter.report('E_UNSUPPORTED_SYNTAX', message, rangeOf(ctx, node), {
    hint,
    blockKey: site.decl.key,
  })
  return null
}

type ToolUsage = Pick<CanonicalTool, 'usageControl' | 'usageControlExpression'>

/**
 * Sets `usageControl` or `usageControlExpression` on `usage` from its option. Returns `false`
 * after reporting a value of the wrong kind.
 */
function compileUsage(
  ctx: CompileContext,
  option: 'usageControl' | 'usageControlExpression',
  property: ObjectProperty,
  site: ValueSite,
  usage: ToolUsage
): boolean {
  if (option === 'usageControl') {
    const text = literalText(property.value)
    if (text !== 'auto' && text !== 'force' && text !== 'none') {
      unsupported(
        ctx,
        property.value,
        'Unknown usage control.',
        `Use ${[...USAGE_CONTROLS].join(', ')}.`,
        site
      )
      return false
    }
    usage.usageControl = text
    return true
  }
  const compiled = compileValue(ctx, property.value, site)
  if (!compiled || compiled.kind !== 'value' || typeof compiled.value !== 'string') {
    unsupported(ctx, property.value, 'usageControlExpression is text.', 'Write js`...`.', site)
    return false
  }
  usage.usageControlExpression = compiled.value
  return true
}

function isUsageOption(option: string): option is 'usageControl' | 'usageControlExpression' {
  return option === 'usageControl' || option === 'usageControlExpression'
}

/** A `raw(tool)` element: the canonical tool verbatim, checked for the fields every tool has. */
function isCanonicalTool(value: Value): value is CanonicalTool & Value {
  return (
    isRecordLike(value) &&
    !('$sim' in value) &&
    typeof value.type === 'string' &&
    isRecordLike(value.params) &&
    isRecordLike(value.modes)
  )
}

function isToolRef(value: Value): value is ResourceNode | UnresolvedNode {
  return isRecordLike(value) && (value.$sim === 'resource' || value.$sim === 'unresolved')
}

/**
 * The builder path a tool call names: `slack.tool.sendMessage(...)` → `slack.sendMessage`,
 * `agent.tool(...)` → `agent` (the printer's `printTools` forms).
 */
function toolBuilderPath(
  ctx: CompileContext,
  site: ValueSite,
  call: CallExpression
): string | null {
  const path = calleePath(call.callee)
  if (!path) return null
  const binding = lookup(site.scope, path.root)
  if (!binding || binding.kind !== 'sdk') return null
  const segments = [binding.name, ...path.rest]
  const toolIndex = segments.lastIndexOf('tool')
  if (toolIndex < 1 || toolIndex < segments.length - 2) return null
  segments.splice(toolIndex, 1)
  const builderPath = segments.join('.')
  return catalogBuilder(ctx.catalog, builderPath) ? builderPath : null
}

function compileToolCall(
  ctx: CompileContext,
  call: CallExpression,
  site: ValueSite,
  storedTool: CanonicalTool | undefined
): CanonicalTool | null {
  const builderPath = toolBuilderPath(ctx, site, call)
  if (builderPath === null) {
    const path = calleePath(call.callee)
    ctx.reporter.report(
      'E_UNKNOWN_BUILDER',
      'This tool names no block builder.',
      rangeOf(ctx, call.callee),
      {
        ...(path && {
          hint:
            didYouMean(
              [path.root, ...path.rest].filter((segment) => segment !== 'tool').join('.'),
              catalogBuilderPaths(ctx.catalog)
            ) ?? 'Write namespace.tool.method(params, options), or raw(tool).',
        }),
        blockKey: site.decl.key,
      }
    )
    return null
  }
  const builder = catalogBuilder(ctx.catalog, builderPath)
  if (!builder) return null
  const [paramsNode, optionsNode, ...extra] = call.arguments
  for (const node of extra)
    unsupported(ctx, node, 'Too many arguments.', 'Write tool(params, options).', site)
  if (!paramsNode || paramsNode.type !== 'ObjectExpression') {
    return unsupported(
      ctx,
      paramsNode ?? call,
      'Tool params are an object literal.',
      'Write tool({ field: value }).',
      site
    )
  }
  const params: Record<string, Value> = {}
  for (const [id, value] of Object.entries(builder.fixed ?? {})) setOwn(params, id, value)
  const block = catalogBlock(ctx.catalog, builder.type)
  const paramOf = new Map<string, string>()
  for (const [param, alias] of block ? paramAliases(block, false) : []) paramOf.set(alias, param)
  for (const [key, property] of objectEntries(ctx, paramsNode)) {
    const param = paramOf.get(key) ?? key
    const compiled = compileValue(ctx, property.value, site)
    if (!compiled) return null
    const kept =
      compiled.kind === 'stored' && storedTool?.type === builder.type
        ? getOwn(storedTool.params, param)
        : undefined
    if (compiled.kind === 'stored' && kept === undefined) {
      ctx.reporter.report(
        'E_STORED_VALUE_MISSING',
        `stored() keeps ${key}, but the stored tool in this position has no value for it.`,
        rangeOf(ctx, property.value),
        { hint: `Write the value of ${key}.`, blockKey: site.decl.key }
      )
      return null
    }
    const value = kept ?? nestedToolValue(ctx, property.value, compiled, site)
    if (value === undefined) return null
    if (Object.hasOwn(params, param) && !Object.hasOwn(builder.fixed ?? {}, param)) {
      return unsupported(
        ctx,
        property,
        `${key} names a param that is already written.`,
        'Write each param once.',
        site
      )
    }
    setOwn(params, param, value)
  }
  const tool: CanonicalTool = { type: builder.type, params, modes: {} }
  if (builder.operation !== undefined) tool.operation = builder.operation
  if (!optionsNode) return tool
  if (optionsNode.type !== 'ObjectExpression') {
    return unsupported(
      ctx,
      optionsNode,
      'Tool options are an object literal.',
      "Write { usageControl: 'auto' }.",
      site
    )
  }
  for (const [key, property] of objectEntries(ctx, optionsNode)) {
    const text = literalText(property.value)
    switch (key) {
      case 'operation':
      case 'toolId':
      case 'title':
        if (text === null)
          return unsupported(
            ctx,
            property.value,
            `${key} is a string.`,
            `Write ${key}: '...'.`,
            site
          )
        tool[key] = text
        break
      case 'usageControl':
      case 'usageControlExpression':
        if (!compileUsage(ctx, key, property, site, tool)) return null
        break
      case 'modes': {
        if (property.value.type !== 'ObjectExpression') {
          return unsupported(
            ctx,
            property.value,
            'modes is an object literal.',
            "Write modes: { cid: 'basic' }.",
            site
          )
        }
        const modes: Record<string, ParamMode> = {}
        for (const [cid, modeProperty] of objectEntries(ctx, property.value)) {
          const mode = literalText(modeProperty.value)
          if (mode !== 'basic' && mode !== 'advanced') {
            return unsupported(
              ctx,
              modeProperty.value,
              "A mode is 'basic' or 'advanced'.",
              "Write 'basic' or 'advanced'.",
              site
            )
          }
          setOwn(modes, cid, mode)
        }
        tool.modes = modes
        break
      }
      case 'customTool': {
        const value = compileNested(ctx, property.value, site)
        if (value === undefined) return null
        if (!isRecordLike(value) || '$sim' in value) {
          return unsupported(
            ctx,
            property.value,
            'customTool is { ref?, snapshot? }.',
            'Write customTool: { ref: customTool(key) }.',
            site
          )
        }
        const { ref, snapshot, ...rest } = value
        const snapshotRecord = toRecordOrNull(snapshot)
        if (
          Object.keys(rest).length > 0 ||
          (ref !== undefined && !isToolRef(ref)) ||
          (snapshot !== undefined &&
            (!snapshotRecord ||
              typeof snapshotRecord.code !== 'string' ||
              !('schema' in snapshotRecord)))
        ) {
          return unsupported(
            ctx,
            property.value,
            'customTool is { ref?, snapshot? }.',
            'Write customTool: { ref: customTool(key) }.',
            site
          )
        }
        tool.customTool = {
          ...(ref !== undefined && isToolRef(ref) && { ref }),
          ...(snapshotRecord &&
            typeof snapshotRecord.code === 'string' && {
              snapshot: { schema: snapshotRecord.schema as Json, code: snapshotRecord.code },
            }),
        }
        break
      }
      case 'operationPolicy': {
        const json = compileJsonLiteral(ctx, property.value, site)
        if (json === undefined) return null
        tool.operationPolicy = json
        break
      }
      case 'extra': {
        const json = compileJsonLiteral(ctx, property.value, site)
        if (json === undefined) return null
        if (!isRecordLike(json))
          return unsupported(
            ctx,
            property.value,
            'extra is an object.',
            'Write extra: { key: value }.',
            site
          )
        tool.extra = json as Record<string, Json>
        break
      }
      default:
        ctx.reporter.report(
          'E_UNKNOWN_PARAM',
          `${key} is not a tool option.`,
          rangeOf(ctx, property),
          {
            ...(didYouMean(key, TOOL_OPTIONS) !== undefined && {
              hint: didYouMean(key, TOOL_OPTIONS),
            }),
            blockKey: site.decl.key,
          }
        )
        return null
    }
  }
  return tool
}

/**
 * `customTool('key', { usageControl?, usageControlExpression? })`: a workspace custom tool by
 * resource key, stored as the reference the tool picker writes (`customToolId`, no params). A tool
 * carrying anything else (a snapshot, a title, params) is written `raw(tool)`.
 */
function compileCustomTool(
  ctx: CompileContext,
  call: CallExpression,
  site: ValueSite
): CanonicalTool | null {
  const [keyNode, optionsNode, ...extra] = call.arguments
  const key = keyNode ? literalText(keyNode) : null
  if (key === null || extra.length > 0) {
    return unsupported(
      ctx,
      call,
      'customTool() takes a key and optional options.',
      "Write customTool('lookup-order', { usageControl: 'auto' }).",
      site
    )
  }
  const tool: CanonicalTool = {
    type: CUSTOM_TOOL_TYPE,
    params: {},
    modes: {},
    customTool: { ref: { $sim: 'resource', kind: 'custom-tool', key } },
  }
  if (!optionsNode) return tool
  if (optionsNode.type !== 'ObjectExpression') {
    return unsupported(
      ctx,
      optionsNode,
      'Tool options are an object literal.',
      "Write { usageControl: 'auto' }.",
      site
    )
  }
  for (const [option, property] of objectEntries(ctx, optionsNode)) {
    if (isUsageOption(option)) {
      if (!compileUsage(ctx, option, property, site, tool)) return null
    } else {
      return unsupported(
        ctx,
        property,
        `customTool() takes usageControl and usageControlExpression; ${option} is not one.`,
        'Write a tool with other stored fields as raw(tool).',
        site
      )
    }
  }
  return tool
}

const SNAPSHOT_KEYS = new Set(['serverName', 'serverUrl', 'schema'])

/** `mcp(key).tool(name, { args?, snapshot?, usageControl?, usageControlExpression? })`. */
function compileMcpTool(
  ctx: CompileContext,
  call: CallExpression,
  server: ResourceNode,
  site: ValueSite
): CanonicalTool | null {
  const [nameNode, optionsNode, ...extra] = call.arguments
  const name = nameNode ? literalText(nameNode) : null
  if (name === null || extra.length > 0) {
    return unsupported(
      ctx,
      call,
      'tool() takes the MCP tool name and optional options.',
      "Write mcp('server').tool('search', { usageControl: 'auto' }).",
      site
    )
  }
  const form: McpToolForm = { server, name, args: {}, snapshot: {} }
  if (!optionsNode) return buildMcpTool(ctx.catalog, form)
  if (optionsNode.type !== 'ObjectExpression') {
    return unsupported(
      ctx,
      optionsNode,
      'Tool options are an object literal.',
      "Write { usageControl: 'auto' }.",
      site
    )
  }
  for (const [option, property] of objectEntries(ctx, optionsNode)) {
    if (isUsageOption(option)) {
      if (!compileUsage(ctx, option, property, site, form)) return null
    } else if (option === 'args') {
      if (property.value.type !== 'ObjectExpression') {
        return unsupported(
          ctx,
          property.value,
          'args is an object literal.',
          'Write args: { name: value }.',
          site
        )
      }
      for (const [arg, argProperty] of objectEntries(ctx, property.value)) {
        if (MCP_RESERVED_ARGS.has(arg)) {
          return unsupported(
            ctx,
            argProperty,
            `${arg} is set by mcp().tool(), not an argument.`,
            'Name the server with mcp(key) and the tool with tool(name).',
            site
          )
        }
        const value = compileNested(ctx, argProperty.value, site)
        if (value === undefined) return null
        setOwn(form.args, arg, value)
      }
    } else if (option === 'snapshot') {
      const json = compileJsonLiteral(ctx, property.value, site)
      if (json === undefined) return null
      const snapshot = toRecordOrNull(json)
      const { serverName, serverUrl, schema } = snapshot ?? {}
      if (
        !snapshot ||
        Object.keys(snapshot).some((key) => !SNAPSHOT_KEYS.has(key)) ||
        (serverName !== undefined && typeof serverName !== 'string') ||
        (serverUrl !== undefined && typeof serverUrl !== 'string')
      ) {
        return unsupported(
          ctx,
          property.value,
          'snapshot is { serverName?, serverUrl?, schema? }.',
          "Write snapshot: { serverName: 'Docs', schema: { type: 'object' } }.",
          site
        )
      }
      form.snapshot = {
        ...(typeof serverName === 'string' && { serverName }),
        ...(typeof serverUrl === 'string' && { serverUrl }),
        ...(schema !== undefined && { schema: schema as Json }),
      }
    } else {
      return unsupported(
        ctx,
        property,
        `mcp().tool() takes args, snapshot, usageControl and usageControlExpression; ${option} is not one.`,
        'Write a tool with other stored fields as raw(tool).',
        site
      )
    }
  }
  return buildMcpTool(ctx.catalog, form)
}

/** `childWorkflow(key).asTool({ usageControl?, usageControlExpression? })`. */
function compileWorkflowTool(
  ctx: CompileContext,
  call: CallExpression,
  workflow: ResourceNode,
  site: ValueSite
): CanonicalTool | null {
  const [optionsNode, ...extra] = call.arguments
  if (extra.length > 0 || (optionsNode && optionsNode.type !== 'ObjectExpression')) {
    return unsupported(
      ctx,
      call,
      'asTool() takes optional options.',
      "Write childWorkflow('enrich').asTool({ usageControl: 'auto' }).",
      site
    )
  }
  const usage: ToolUsage = {}
  for (const [option, property] of optionsNode ? objectEntries(ctx, optionsNode) : []) {
    if (!isUsageOption(option)) {
      return unsupported(
        ctx,
        property,
        `asTool() takes usageControl and usageControlExpression; ${option} is not one.`,
        'Write a tool with other stored fields through runWorkflow.tool(), or raw(tool).',
        site
      )
    }
    if (!compileUsage(ctx, option, property, site, usage)) return null
  }
  return buildWorkflowTool(ctx.catalog, { workflow, ...usage })
}

/** The resource method a tool element calls on an SDK resource: `mcp().tool`, `childWorkflow().asTool`. */
const RESOURCE_TOOL_METHODS: Record<string, string> = { mcp: 'tool', childWorkflow: 'asTool' }

/**
 * `mcp(key).tool(...)` or `childWorkflow(key).asTool(...)`: the tool, `null` after an error, or
 * `undefined` when the element is neither form.
 */
function compileResourceTool(
  ctx: CompileContext,
  call: CallExpression,
  site: ValueSite
): CanonicalTool | null | undefined {
  const { callee } = call
  if (
    callee.type !== 'MemberExpression' ||
    callee.computed ||
    callee.property.type !== 'Identifier' ||
    callee.object.type !== 'CallExpression' ||
    callee.object.callee.type !== 'Identifier'
  ) {
    return undefined
  }
  const binding = lookup(site.scope, callee.object.callee.name)
  if (binding?.kind !== 'sdk' || RESOURCE_TOOL_METHODS[binding.name] !== callee.property.name) {
    return undefined
  }
  const resource = compileValue(ctx, callee.object, site)
  if (resource?.kind !== 'value' || !isToolRef(resource.value)) return null
  if (resource.value.$sim !== 'resource') return null
  return binding.name === 'mcp'
    ? compileMcpTool(ctx, call, resource.value, site)
    : compileWorkflowTool(ctx, call, resource.value, site)
}

/**
 * A tool-input value: an array of `ns.tool.method(params, options?)` calls (the printer's
 * `printTools`), `customTool(key)`, `mcp(key).tool(name)`, `childWorkflow(key).asTool()` or
 * `raw(tool)` elements. `raw([...])` for the whole list is accepted too.
 */
export function compileToolList(
  ctx: CompileContext,
  node: Node,
  site: ValueSite,
  storedTools: readonly CanonicalTool[]
): CanonicalTool[] | null {
  if (node.type !== 'ArrayExpression') {
    const compiled = compileValue(ctx, node, site)
    if (compiled?.kind === 'value' && compiled.form === 'raw' && Array.isArray(compiled.value)) {
      const tools: CanonicalTool[] = []
      for (const tool of compiled.value) if (isCanonicalTool(tool)) tools.push(tool)
      if (tools.length === compiled.value.length) return tools
    }
    if (compiled)
      unsupported(
        ctx,
        node,
        'A tool list is an array.',
        'Write tools: [slack.tool.sendMessage({ ... })].',
        site
      )
    return null
  }
  const tools: CanonicalTool[] = []
  for (const element of node.elements) {
    if (!element || element.type === 'SpreadElement') {
      return unsupported(
        ctx,
        element ?? node,
        'Write each tool explicitly.',
        'Write each tool explicitly.',
        site
      )
    }
    if (element.type !== 'CallExpression') {
      return unsupported(ctx, element, `${element.type} is not a tool.`, hintForNode(element), site)
    }
    const resourceTool = compileResourceTool(ctx, element, site)
    if (resourceTool !== undefined) {
      if (!resourceTool) return null
      tools.push(resourceTool)
      continue
    }
    const compiled = calleePath(element.callee)?.root
    const rootBinding = compiled === undefined ? null : lookup(site.scope, compiled)
    if (
      rootBinding?.kind === 'sdk' &&
      rootBinding.name === 'customTool' &&
      element.callee.type === 'Identifier'
    ) {
      const tool = compileCustomTool(ctx, element, site)
      if (!tool) return null
      tools.push(tool)
      continue
    }
    if (
      rootBinding?.kind === 'sdk' &&
      rootBinding.name === 'raw' &&
      element.callee.type === 'Identifier'
    ) {
      const value = compileValue(ctx, element, site)
      if (!value || value.kind !== 'value') return null
      if (!isCanonicalTool(value.value)) {
        return unsupported(
          ctx,
          element,
          'raw(tool) needs type, params and modes.',
          'Write raw({ type, params: {}, modes: {} }).',
          site
        )
      }
      tools.push(value.value)
      continue
    }
    const tool = compileToolCall(ctx, element, site, storedTools[tools.length])
    if (!tool) return null
    tools.push(tool)
  }
  return tools
}
