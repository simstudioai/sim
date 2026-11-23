/**
 * Names the `@sim/workflow-sdk` authoring surface fixes, shared by the printer (which must never
 * emit a block ident that shadows one), the compiler (which resolves them) and the lock
 * validator. `core.d.ts` in `@sim/workflow-sdk` must export exactly {@link SDK_CORE_EXPORTS}.
 */

import type { CatalogBlock, CatalogBuilder } from './catalog/types'
import type { ResourceKind } from './model'

/** The module a workflow file imports the SDK from: the only import compile accepts. */
export const SDK_MODULE = '@sim/workflow-sdk'

/**
 * The generic builder, `block(type, name, params, meta?)`. The printer uses it for any stored type
 * with no generated builder (legacy, unknown, or `custom_block_*` without a method), and the
 * compiler accepts it for every catalog type, so every type always prints and compiles.
 */
export const GENERIC_BUILDER = 'block'

/** The stored type of a workspace custom tool entry (the tool picker's `type: 'custom-tool'`). */
export const CUSTOM_TOOL_TYPE = 'custom-tool'

/**
 * The keys of the `response(name, { body, status?, headers? })` form. Writing `body` selects it;
 * without `body` the params are the block's own (`dataMode`, `builderData`, `data`, ...).
 */
export const RESPONSE_BODY_KEYS = ['body', 'status', 'headers'] as const

/**
 * The outputs of a response block: what a child workflow call's `result` holds when the child
 * responds, so a field of its body is `result.data.<field>`.
 */
export const RESPONSE_OUTPUTS: readonly string[] = ['data', 'status', 'headers']

/**
 * The SDK's tagged templates (`js\`...\``), each a core export. The printer and the
 * compiler's template check both read this list.
 */
export const TEMPLATE_TAGS = [
  't',
  'js',
  'py',
  'sh',
  'json',
  'md',
] as const satisfies readonly SdkCoreExport[]

export type TemplateTag = (typeof TEMPLATE_TAGS)[number]

/** Whether a name is one of the {@link TEMPLATE_TAGS}. */
export function isTemplateTag(name: string): name is TemplateTag {
  return TEMPLATE_TAGS.some((tag) => tag === name)
}

/**
 * The keys of a block call's `meta` argument (`BlockMeta` in `core.d.ts`, which the SDK's tests
 * hold to exactly this list): what the printer writes there and the compiler reads.
 */
export const BLOCK_META_KEYS = [
  'key',
  'disabled',
  'locked',
  'advancedMode',
  'triggerMode',
  'errorPort',
  'retry',
  'branches',
  'extra',
  'subflowData',
] as const

export type BlockMetaKey = (typeof BLOCK_META_KEYS)[number]

/**
 * Resource kinds with a call form, and the SDK function each prints as (`table('orders')`). A
 * kind without one prints as `raw(<the node>)`, which compiles back to the same node.
 */
export const SDK_RESOURCE_CALLS = {
  credential: 'credential',
  table: 'table',
  'knowledge-base': 'knowledgeBase',
  workflow: 'childWorkflow',
  skill: 'skill',
  'custom-tool': 'customTool',
  'mcp-server': 'mcp',
  file: 'file',
  'file-folder': 'folder',
} as const satisfies Partial<Record<ResourceKind, string>>

/**
 * The oldest SDK major the compiler reads. A header below it is `E_SDK_MAJOR_OLD`: no
 * down-migration exists, so such a file must be printed again for a supported major.
 */
export const OLDEST_SDK_MAJOR = 1

/** How the SDK treats one core export. An export with no traits is a value constructor or const. */
interface SdkCoreExportTraits {
  /**
   * A core block's builder (`condition(...)`, `table.queryRows(...)` by declaration merging): the
   * catalog maps a block namespace to it. Every other core export is a root no block may take.
   */
  readonly blockBuilder?: true
  /**
   * Set when `core.d.ts` declares the builder itself (named branches, function code files, a typed
   * human form): the params its core signature owns, dropped from the generated params type.
   */
  readonly coreParams?: readonly string[]
  /** A function or empty namespace a generated namespace may merge with (`table.insertRow`). */
  readonly mergeable?: true
}

/** Every value the SDK's core module exports, and how codegen and naming treat each. */
const SDK_CORE = {
  [GENERIC_BUILDER]: {},
  childWorkflow: { mergeable: true },
  codeFile: {},
  condition: { blockBuilder: true, coreParams: ['conditions'] },
  credential: { blockBuilder: true, mergeable: true },
  customTool: { mergeable: true },
  edge: {},
  env: {},
  file: { blockBuilder: true, mergeable: true },
  fn: { blockBuilder: true, coreParams: ['code'] },
  folder: { mergeable: true },
  human: { blockBuilder: true, coreParams: ['inputFormat'] },
  js: {},
  json: {},
  knowledgeBase: { mergeable: true },
  legacy: { mergeable: true },
  loop: {},
  mcp: { mergeable: true },
  md: {},
  note: { blockBuilder: true, coreParams: [] },
  parallel: {},
  py: {},
  raw: {},
  ref: {},
  response: { blockBuilder: true, coreParams: [] },
  router: { blockBuilder: true, coreParams: ['routes'] },
  runWorkflow: { blockBuilder: true, coreParams: [] },
  setVariables: { blockBuilder: true, coreParams: [] },
  sh: {},
  skill: { mergeable: true },
  stored: {},
  t: {},
  table: { blockBuilder: true, mergeable: true },
  todo: {},
  trigger: { mergeable: true },
  vars: {},
  workflow: { mergeable: true },
} as const satisfies Record<string, SdkCoreExportTraits>

/** The name of one SDK core export. */
export type SdkCoreExport = keyof typeof SDK_CORE

const SDK_CORE_ENTRIES = Object.entries(SDK_CORE) as Array<[SdkCoreExport, SdkCoreExportTraits]>

/** Every value the SDK's core module exports. */
export const SDK_CORE_EXPORTS: readonly SdkCoreExport[] = SDK_CORE_ENTRIES.map(([name]) => name)

/** Whether `name` is a value the SDK's core module exports. */
export function isSdkCoreExport(name: string): name is SdkCoreExport {
  return Object.hasOwn(SDK_CORE, name)
}

/** Core exports that are core blocks' builders; every other core export is an SDK-owned root. */
export const SDK_CORE_BLOCK_BUILDERS: ReadonlySet<string> = new Set(
  SDK_CORE_ENTRIES.filter(([, traits]) => traits.blockBuilder).map(([name]) => name)
)

/** Builders `core.d.ts` declares itself, with the params each core signature owns. */
export const SDK_SPECIAL_BUILDERS: Readonly<Record<string, { coreParams: readonly string[] }>> =
  Object.fromEntries(
    SDK_CORE_ENTRIES.flatMap(([name, { coreParams }]) =>
      coreParams ? [[name, { coreParams }]] : []
    )
  )

/** Core exports a generated namespace may merge with; consts (`env`, `loop`, `js`) cannot. */
export const SDK_MERGEABLE_CORE_EXPORTS: ReadonlySet<string> = new Set(
  SDK_CORE_ENTRIES.filter(([, traits]) => traits.mergeable).map(([name]) => name)
)

/** Reserved words and strict-mode restrictions: none can name a `const`. */
export const JS_RESERVED_WORDS: ReadonlySet<string> = new Set([
  'arguments',
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'eval',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'implements',
  'import',
  'in',
  'instanceof',
  'interface',
  'let',
  'new',
  'null',
  'package',
  'private',
  'protected',
  'public',
  'return',
  'static',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'undefined',
  'var',
  'void',
  'while',
  'with',
  'yield',
])

/**
 * Identifiers a block ident may never take: JS reserved words plus every SDK core export.
 * Catalog builder namespaces (`slack`, `agent`, ...) are catalog-dependent, so the printer avoids
 * those itself with a numeric suffix.
 */
export const SDK_RESERVED_IDENTIFIERS: ReadonlySet<string> = new Set<string>([
  ...JS_RESERVED_WORDS,
  ...SDK_CORE_EXPORTS,
])

/**
 * Whether the SDK declares a builder's agent-tool form, `namespace.tool.method(params, options)`:
 * a namespaced builder of a tools-category block outside trigger mode. SDK codegen emits exactly
 * these, and the printer writes any other tool as `raw(tool)`.
 */
export function hasToolForm(
  path: string,
  builder: Pick<CatalogBuilder, 'triggerMode'>,
  block: Pick<CatalogBlock, 'category'>
): boolean {
  return block.category === 'tools' && builder.triggerMode !== true && path.includes('.')
}
