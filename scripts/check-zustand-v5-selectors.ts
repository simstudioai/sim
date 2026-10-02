#!/usr/bin/env bun
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { parse } from '@babel/parser'
import { getErrorMessage } from '@sim/utils/errors'

const ROOT = path.resolve(import.meta.dir, '..')
const APP_DIR = path.join(ROOT, 'apps/sim')

const SKIP_DIRS = new Set(['node_modules', '.next', '.turbo', 'coverage', 'dist', 'build'])

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx'])
/**
 * Zustand store hooks are named `use<Name>Store` by convention, with one
 * exception: `useWorkflowRegistry`. Matching only the `Store` suffix left that
 * store — one of the hottest in the canvas — entirely unchecked.
 */
const STORE_HOOK_CALL_PATTERN = /\buse[A-Z][A-Za-z0-9_]*(?:Store|Registry)\s*\(/g
const SAFE_ANNOTATION = 'zustand-v5-safe:'
const UNSAFE_SELECTOR_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /=>\s*\(\s*\{/,
    reason: 'selector returns a fresh object literal; wrap it in useShallow',
  },
  {
    pattern: /\breturn\s+\{/,
    reason: 'selector returns a fresh object literal; wrap it in useShallow',
  },
  {
    pattern: /=>\s*\[/,
    reason: 'selector returns a fresh array literal; wrap it in useShallow',
  },
  {
    pattern: /\breturn\s+\[/,
    reason: 'selector returns a fresh array literal; wrap it in useShallow',
  },
  {
    pattern:
      /(?:=>|return)\s+Object\.(?:values|entries)\s*\([^)]*\)(?!\s*\.\s*(?:length|some|every)\b)/,
    reason:
      'selector allocates a derived collection; use useStoreWithEqualityFn or memoize outside',
  },
  {
    pattern: /\bObject\.fromEntries\s*\(/,
    reason: 'selector allocates a derived object; use useStoreWithEqualityFn or memoize outside',
  },
  {
    pattern: /\bObject\.keys\s*\([^)]*\)(?!\s*\.length\b)/,
    reason: 'selector allocates Object.keys; return a primitive or use useShallow',
  },
  {
    pattern: /(?:=>|return)\s+[^;{}]*\.(?:map|filter|reduce)\s*\(/,
    reason: 'selector allocates a derived value; use useStoreWithEqualityFn or memoize outside',
  },
  {
    pattern: /\bnew\s+(?:Set|Map)\s*\(/,
    reason:
      'selector returns a fresh collection; use useStoreWithEqualityFn or a stable store reference',
  },
  {
    pattern: /\?\?\s*(?:\(\s*\)\s*=>|\{\s*\}|\[\s*\])/,
    reason: 'selector uses an unstable fallback reference; move the fallback to module scope',
  },
  {
    pattern: /\|\|\s*(?:\(\s*\)\s*=>|\{\s*\}|\[\s*\])/,
    reason: 'selector uses an unstable fallback reference; move the fallback to module scope',
  },
]

interface Violation {
  file: string
  line: number
  description: string
  snippet: string
}

async function walk(dir: string, results: string[] = []): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue

    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      await walk(full, results)
      continue
    }

    if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      results.push(full)
    }
  }

  return results
}

function findMatchingParen(source: string, openIndex: number): number {
  let depth = 0
  let quote: '"' | "'" | '`' | null = null
  let escaped = false
  let lineComment = false
  let blockComment = false

  for (let index = openIndex; index < source.length; index++) {
    const char = source[index]
    const next = source[index + 1]

    if (lineComment) {
      if (char === '\n') lineComment = false
      continue
    }

    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false
        index++
      }
      continue
    }

    if (quote) {
      if (escaped) {
        escaped = false
        continue
      }
      if (char === '\\') {
        escaped = true
        continue
      }
      if (char === quote) {
        quote = null
      }
      continue
    }

    if (char === '/' && next === '/') {
      lineComment = true
      index++
      continue
    }

    if (char === '/' && next === '*') {
      blockComment = true
      index++
      continue
    }

    if (char === '"' || char === "'" || char === '`') {
      quote = char
      continue
    }

    if (char === '(') depth++
    if (char === ')') {
      depth--
      if (depth === 0) return index
    }
  }

  return -1
}

function splitTopLevelArguments(args: string): string[] {
  const result: string[] = []
  let start = 0
  let depth = 0
  let quote: '"' | "'" | '`' | null = null
  let escaped = false

  for (let index = 0; index < args.length; index++) {
    const char = args[index]

    if (quote) {
      if (escaped) {
        escaped = false
        continue
      }
      if (char === '\\') {
        escaped = true
        continue
      }
      if (char === quote) quote = null
      continue
    }

    if (char === '"' || char === "'" || char === '`') {
      quote = char
      continue
    }

    if (char === '(' || char === '[' || char === '{') depth++
    if (char === ')' || char === ']' || char === '}') depth--

    if (char === ',' && depth === 0) {
      result.push(args.slice(start, index).trim())
      start = index + 1
    }
  }

  const finalArg = args.slice(start).trim()
  if (finalArg) result.push(finalArg)

  return result
}

function lineNumberAt(source: string, index: number): number {
  let line = 1
  for (let i = 0; i < index; i++) {
    if (source[i] === '\n') line++
  }
  return line
}

function hasSafeAnnotation(source: string, callStart: number): boolean {
  const before = source.slice(0, callStart)
  const lines = before.split('\n')
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 4); i--) {
    const trimmed = lines[i]?.trim()
    if (!trimmed) continue
    if (trimmed.includes(SAFE_ANNOTATION) && trimmed.split(SAFE_ANNOTATION)[1]?.trim()) {
      return true
    }
    if (!trimmed.startsWith('//') && !trimmed.startsWith('*') && !trimmed.startsWith('/*')) {
      return false
    }
  }
  return false
}

function oneLineSnippet(source: string, start: number, end: number): string {
  return source.slice(start, end).replace(/\s+/g, ' ').trim().slice(0, 180)
}

function auditFile(file: string, source: string): Violation[] {
  const violations: Violation[] = []
  STORE_HOOK_CALL_PATTERN.lastIndex = 0

  for (
    let match = STORE_HOOK_CALL_PATTERN.exec(source);
    match;
    match = STORE_HOOK_CALL_PATTERN.exec(source)
  ) {
    const callStart = match.index
    const callee = match[0].replace(/\s*\($/, '')
    if (callee === 'useSyncExternalStore') continue

    if (hasSafeAnnotation(source, callStart)) continue

    const openParenIndex = source.indexOf('(', callStart)
    const closeParenIndex = findMatchingParen(source, openParenIndex)
    if (closeParenIndex === -1) continue

    const args = splitTopLevelArguments(source.slice(openParenIndex + 1, closeParenIndex))
    const line = lineNumberAt(source, callStart)
    const snippet = oneLineSnippet(source, callStart, closeParenIndex + 1)

    if (args.length === 0) {
      violations.push({
        file,
        line,
        description: `${callee} subscribes to the entire store; select only the fields needed`,
        snippet,
      })
      continue
    }

    if (args.length > 1) {
      violations.push({
        file,
        line,
        description: `${callee} passes a second equality argument; Zustand v5 create() hooks ignore the v4 pattern. Use useShallow or useStoreWithEqualityFn.`,
        snippet,
      })
      continue
    }

    const selector = args[0]
    if (!selector || selector.startsWith('useShallow(')) continue

    for (const { pattern, reason } of UNSAFE_SELECTOR_PATTERNS) {
      pattern.lastIndex = 0
      if (pattern.test(selector)) {
        if (returnsPrimitiveDerivedValue(selector)) continue
        if (usesReferenceFallbackOnlyInsideBlockBody(selector)) continue
        violations.push({
          file,
          line,
          description: `${callee} ${reason}`,
          snippet,
        })
        break
      }
    }
  }

  return violations
}

/** The local name `persist` is imported under from `zustand/middleware`, including an alias. */
const PERSIST_IMPORT =
  /import\s*\{[^}]*\bpersist\b(?:\s+as\s+(\w+))?[^}]*\}\s*from\s*'zustand\/middleware'/

/** A Babel AST node, read structurally rather than through `@babel/types`. */
interface SyntaxNode extends Record<string, unknown> {
  type: string
  start: number
  end: number
}

function isSyntaxNode(value: unknown): value is SyntaxNode {
  return (
    typeof value === 'object' && value !== null && 'type' in value && typeof value.type === 'string'
  )
}

/** Visits `node` and every node beneath it, depth first; `visit` returning false skips a subtree. */
function walkNodes(node: SyntaxNode, visit: (node: SyntaxNode) => boolean | undefined): void {
  if (visit(node) === false) return
  for (const value of Object.values(node)) {
    if (isSyntaxNode(value)) walkNodes(value, visit)
    else if (Array.isArray(value))
      for (const item of value) if (isSyntaxNode(item)) walkNodes(item, visit)
  }
}

/** Strips the type-only wrappers (`as`, `satisfies`, `!`) around an expression. */
function unwrapExpression(node: unknown): unknown {
  let current = node
  while (
    isSyntaxNode(current) &&
    (current.type === 'TSAsExpression' ||
      current.type === 'TSSatisfiesExpression' ||
      current.type === 'TSNonNullExpression')
  ) {
    current = current.expression
  }
  return current
}

function isIdentifierNamed(node: unknown, name: string): boolean {
  const unwrapped = unwrapExpression(node)
  return isSyntaxNode(unwrapped) && unwrapped.type === 'Identifier' && unwrapped.name === name
}

/** `name` itself, or an object literal that spreads `...name` (extra keys still carry everything). */
function isWholeBinding(node: unknown, name: string): boolean {
  if (isIdentifierNamed(node, name)) return true
  const unwrapped = unwrapExpression(node)
  // `state || {}`, `state ?? {}`, and `cond ? state : {}` can each return the whole state;
  // `a && b` returns `a` only when it is falsy, which a state object never is.
  if (isSyntaxNode(unwrapped) && unwrapped.type === 'LogicalExpression') {
    if (isWholeBinding(unwrapped.right, name)) return true
    return unwrapped.operator !== '&&' && isWholeBinding(unwrapped.left, name)
  }
  if (isSyntaxNode(unwrapped) && unwrapped.type === 'ConditionalExpression') {
    return isWholeBinding(unwrapped.consequent, name) || isWholeBinding(unwrapped.alternate, name)
  }
  if (!isSyntaxNode(unwrapped) || unwrapped.type !== 'ObjectExpression') return false
  const properties = Array.isArray(unwrapped.properties) ? unwrapped.properties : []
  return properties.some(
    (property) =>
      isSyntaxNode(property) &&
      property.type === 'SpreadElement' &&
      isIdentifierNamed(property.argument, name)
  )
}

/** The expressions a function returns: its expression body, or every `return` in its own block. */
function returnedExpressions(fn: SyntaxNode): unknown[] {
  if (!isSyntaxNode(fn.body)) return []
  if (fn.body.type !== 'BlockStatement') return [fn.body]
  const returned: unknown[] = []
  walkNodes(fn.body, (node) => {
    if (node.type === 'ReturnStatement') returned.push(node.argument)
    return !/Function|ObjectMethod|ClassMethod/.test(node.type)
  })
  return returned
}

/**
 * The parameter binding that holds every state field: `s` in `(s) => …`, or `rest` in
 * `({ a, ...rest }) => …`, which holds every field but the ones named (a deny-list).
 */
function wholeStateBinding(rawParam: unknown): { name: string; reason: string } | null {
  // A default (`(state = {} as State) => …`) binds the same value.
  const param =
    isSyntaxNode(rawParam) && rawParam.type === 'AssignmentPattern' ? rawParam.left : rawParam
  if (!isSyntaxNode(param)) return null
  if (param.type === 'Identifier' && typeof param.name === 'string') {
    return { name: param.name, reason: 'persist partialize spreads the whole state' }
  }
  if (param.type !== 'ObjectPattern' || !Array.isArray(param.properties)) return null
  const rest = param.properties.find(
    (property): property is SyntaxNode => isSyntaxNode(property) && property.type === 'RestElement'
  )
  if (!rest || !isSyntaxNode(rest.argument) || typeof rest.argument.name !== 'string') return null
  return {
    name: rest.argument.name,
    reason: 'persist partialize persists everything but the fields it names (a deny-list)',
  }
}

/**
 * Why an inline `partialize` persists more than a whitelist, or null when it returns one:
 * any return of the whole-state binding itself or of `{ ...binding }`.
 */
function partializeLeak(fn: SyntaxNode): string | null {
  const binding = wholeStateBinding(Array.isArray(fn.params) ? fn.params[0] : undefined)
  if (!binding) return null
  return returnedExpressions(fn).some((expression) => isWholeBinding(expression, binding.name))
    ? `${binding.reason}; return an explicit whitelist of durable fields`
    : null
}

/** The top-level `partialize` of a persist options object literal, or null when it has none. */
function findPartialize(options: SyntaxNode): SyntaxNode | null {
  const properties = Array.isArray(options.properties) ? options.properties : []
  for (const property of properties) {
    if (!isSyntaxNode(property) || property.computed === true) continue
    if (property.type !== 'ObjectProperty' && property.type !== 'ObjectMethod') continue
    const key = property.key
    const keyName = isSyntaxNode(key) ? (key.type === 'Identifier' ? key.name : key.value) : null
    if (keyName !== 'partialize') continue
    if (property.type === 'ObjectMethod') return property
    // A cast such as `((s) => s) as Partialize<S>` still hands zustand the inner function.
    const value = unwrapExpression(property.value)
    return isSyntaxNode(value) ? value : null
  }
  return null
}

/**
 * `.claude/rules/sim-stores.md`: every `persist` names its durable fields in `partialize`.
 * Without one, zustand writes the whole state — transient flags, drag state, `_hasHydrated` —
 * to storage and rehydrates it on the next load.
 */
function auditPersist(file: string, source: string): Violation[] {
  const persistImport = PERSIST_IMPORT.exec(source)
  if (!persistImport) return []
  const local = persistImport[1] ?? 'persist'
  let program: unknown
  try {
    program = parse(source, {
      sourceType: 'module',
      plugins: ['typescript', ...(/\.[jt]sx$/.test(file) ? (['jsx'] as const) : [])],
      errorRecovery: true,
    }).program
  } catch (error) {
    throw new Error(`Cannot parse ${file} to audit its persist calls: ${getErrorMessage(error)}`)
  }
  if (!isSyntaxNode(program)) return []

  const violations: Violation[] = []
  walkNodes(program, (node) => {
    if (node.type !== 'CallExpression' || !isIdentifierNamed(node.callee, local)) return
    if (hasSafeAnnotation(source, node.start)) return
    const args = Array.isArray(node.arguments) ? node.arguments : []
    const options = args.length > 1 ? unwrapExpression(args[args.length - 1]) : null
    const partialize =
      isSyntaxNode(options) && options.type === 'ObjectExpression' ? findPartialize(options) : null
    const isInlineFunction =
      partialize !== null &&
      /^(?:ArrowFunctionExpression|FunctionExpression|ObjectMethod)$/.test(partialize.type)
    const leak = partialize && isInlineFunction ? partializeLeak(partialize) : null
    if (partialize && !leak) return
    violations.push({
      file,
      line: lineNumberAt(source, node.start),
      description:
        leak ??
        `persist has no partialize; add \`partialize: (state) => ({ <durable fields> })\` (sim-stores.md). If the options object is hoisted into a variable that has one, mark the call // ${SAFE_ANNOTATION} <where>`,
      snippet: oneLineSnippet(source, node.start, Math.min(node.end, node.start + 180)),
    })
  })
  return violations
}

function returnsPrimitiveDerivedValue(selector: string): boolean {
  return (
    /\bObject\.(?:keys|values|entries)\s*\([^)]*\)\s*\.\s*(?:length|some|every)\b/.test(selector) ||
    /\bObject\.keys\s*\([^)]*\)\.length\b/.test(selector) ||
    /\.(?:map|filter)\s*\([^)]*\)\s*\.\s*(?:length|some|every|join)\b/.test(selector)
  )
}

function usesReferenceFallbackOnlyInsideBlockBody(selector: string): boolean {
  if (!/\)\s*=>\s*\{/.test(selector)) return false

  const returnExpressions = [...selector.matchAll(/\breturn\s+([^;\n}]+)/g)].map((match) =>
    match[1].trim()
  )

  return (
    returnExpressions.length > 0 &&
    returnExpressions.every((expression) => isPrimitiveReturnExpression(expression, selector))
  )
}

function isPrimitiveReturnExpression(expression: string, selector: string): boolean {
  const normalized = expression
    .trim()
    .replace(/^\((.*)\)$/, '$1')
    .trim()

  if (/^(?:true|false|null|undefined)\b/.test(normalized)) return true
  if (/^(?:['"`]|\d)/.test(normalized)) return true
  if (/^(?:!|typeof\b)/.test(normalized)) return true
  if (/^(?:Boolean|Number|String)\s*\(/.test(normalized)) return true
  if (/(?:===|!==|==|!=|>=|<=|>|<)/.test(normalized)) return true
  if (/\.(?:length|some|every|includes|has)\s*(?:\(|$)/.test(normalized)) return true

  if (/^[A-Za-z_$][\w$]*$/.test(normalized)) {
    return isIdentifierAssignedPrimitive(normalized, selector)
  }

  return false
}

function isIdentifierAssignedPrimitive(identifier: string, selector: string): boolean {
  const declarationPattern = new RegExp(`\\b(?:const|let)\\s+${identifier}\\s*=\\s*([^;\\n]+)`)
  const declaration = selector.match(declarationPattern)
  if (!declaration) return false

  return isPrimitiveReturnExpression(declaration[1], selector)
}

async function main() {
  const files = await walk(APP_DIR)
  const violations: Violation[] = []

  for (const file of files) {
    const source = await readFile(file, 'utf8')
    const relativeFile = path.relative(ROOT, file)
    violations.push(...auditFile(relativeFile, source))
    violations.push(...auditPersist(relativeFile, source))
  }

  if (violations.length === 0) {
    console.log('✅ Zustand store audit OK (selectors, persist partialize)')
    return
  }

  console.error('❌ Zustand store hazards found:')
  console.error(
    `Fix each as described, or document an intentional exception with // ${SAFE_ANNOTATION} <reason>.`
  )
  for (const violation of violations) {
    console.error(
      `  ${violation.file}:${violation.line} — ${violation.description}\n    ${violation.snippet}`
    )
  }
  process.exit(1)
}

void main().catch((error) => {
  console.error('Zustand v5 selector audit failed:', error)
  process.exit(1)
})
