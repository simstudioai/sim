/**
 * Names the `@sim/workflow-sdk` authoring surface fixes, shared by the printer (which must never
 * emit a block ident that shadows one), the compiler (which resolves them) and the lock
 * validator. `core.d.ts` in `@sim/workflow-sdk` must export exactly {@link SDK_CORE_EXPORTS}.
 */

import type { ResourceKind } from './model'

/**
 * The generic builder, `block(type, name, params, meta?)`. The printer uses it for any stored type
 * with no generated builder (legacy, unknown, or `custom_block_*` without a method), and the
 * compiler accepts it for every catalog type, so every type always prints and compiles.
 */
export const GENERIC_BUILDER = 'block'

/** The stored type of a workspace custom tool entry (the tool picker's `type: 'custom-tool'`). */
export const CUSTOM_TOOL_TYPE = 'custom-tool'

/** The response block type, which also takes the `response(name, { body, ... })` form. */
export const RESPONSE_BLOCK_TYPE = 'response'

/**
 * The keys of the `response(name, { body, status?, headers? })` form. Writing `body` selects it;
 * without `body` the params are the block's own (`dataMode`, `builderData`, `data`, ...).
 */
export const RESPONSE_BODY_KEYS = ['body', 'status', 'headers'] as const

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
  sandbox: 'sandbox',
  file: 'file',
  'file-folder': 'folder',
} as const satisfies Partial<Record<ResourceKind, string>>

/**
 * The oldest SDK major the compiler reads. A header below it is `E_SDK_MAJOR_OLD`: no
 * down-migration exists, so such a file must be printed again for a supported major.
 */
export const OLDEST_SDK_MAJOR = 1

/** Every value the SDK's core module exports. */
export const SDK_CORE_EXPORTS = [
  GENERIC_BUILDER,
  'childWorkflow',
  'codeFile',
  'condition',
  'credential',
  'customTool',
  'edge',
  'env',
  'file',
  'fn',
  'folder',
  'human',
  'js',
  'json',
  'knowledgeBase',
  'legacy',
  'loop',
  'mcp',
  'md',
  'note',
  'parallel',
  'py',
  'raw',
  'ref',
  'response',
  'router',
  'runWorkflow',
  'sandbox',
  'setVariables',
  'sh',
  'skill',
  'stored',
  't',
  'table',
  'todo',
  'trigger',
  'vars',
  'workflow',
] as const

/** Reserved words and strict-mode restrictions: none can name a `const`. */
const JS_RESERVED_WORDS = [
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
] as const

/**
 * Identifiers a block ident may never take: JS reserved words plus every SDK core export.
 * Catalog builder namespaces (`slack`, `agent`, ...) are catalog-dependent, so the printer avoids
 * those itself with a numeric suffix.
 */
export const SDK_RESERVED_IDENTIFIERS: ReadonlySet<string> = new Set<string>([
  ...JS_RESERVED_WORDS,
  ...SDK_CORE_EXPORTS,
])
