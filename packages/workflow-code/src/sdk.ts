/**
 * Names the `@sim/workflow-sdk` authoring surface fixes, shared by the printer (which must never
 * emit a block binding that shadows one), the compiler (which resolves them) and the lock
 * validator. 2E's `core.d.ts` must export exactly {@link SDK_CORE_EXPORTS}.
 */

/**
 * The generic builder, `block(type, name, params, meta?)`. The printer uses it for any stored type
 * with no generated builder (legacy, unknown, or `custom_block_*` without a method), and the
 * compiler accepts it for every catalog type, so every type always prints and compiles.
 */
export const GENERIC_BUILDER = 'block'

/** Every value the SDK's core module exports (s2 §2 core types, build-spec decision 7). */
export const SDK_CORE_EXPORTS = [
  GENERIC_BUILDER,
  'binding',
  'condition',
  'customTool',
  'edge',
  'env',
  'file',
  'fn',
  'folder',
  'human',
  'js',
  'json',
  'kb',
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
  't',
  'table',
  'todo',
  'trigger',
  'upload',
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
 * Identifiers a block binding may never take: JS reserved words plus every SDK core export.
 * Catalog builder namespaces (`slack`, `agent`, ...) are catalog-dependent, so the printer avoids
 * those itself with a numeric suffix.
 */
export const SDK_RESERVED_IDENTIFIERS: ReadonlySet<string> = new Set<string>([
  ...JS_RESERVED_WORDS,
  ...SDK_CORE_EXPORTS,
])
