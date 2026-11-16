import { type ParserOptions, parse } from '@babel/parser'
import type { File, Node } from '@babel/types'
import type { CompileLimits } from '../api'
import { SOURCE_LIMITS, utf8Bytes } from '../limits'
import type { Reporter } from './report'

/**
 * Default caps on hostile input: the shared source limits, so whatever a get prints
 * compiles, plus a nesting cap. A 200-block workflow nests under 20 levels. Syntax nodes need no
 * cap of their own: every node but an empty template element spans at least one byte, so the
 * byte cap bounds them.
 */
export const DEFAULT_LIMITS: Required<CompileLimits> = {
  maxBlocks: SOURCE_LIMITS.maxBlocks,
  maxFileBytes: SOURCE_LIMITS.maxFileBytes,
  maxTotalBytes: SOURCE_LIMITS.maxTotalBytes,
  maxDepth: 200,
  /** One code file per block. */
  maxCodeFileRefs: SOURCE_LIMITS.maxBlocks,
}

const HEADER = /^\/\/ @sim-sdk ([0-9]{1,6})[ \t]*(?=\r\n|[\n\r\u2028\u2029]|$)/

const PARSER_OPTIONS: ParserOptions = {
  sourceType: 'module',
  plugins: ['typescript'],
  errorRecovery: true,
  attachComment: true,
  ranges: false,
  tokens: false,
}

const SKIPPED_KEYS = new Set([
  'leadingComments',
  'trailingComments',
  'innerComments',
  'loc',
  'extra',
])

function isNode(value: unknown): value is Node {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { type?: unknown }).type === 'string'
  )
}

/** Every child AST node of `node`, in no particular order. */
function childNodes(node: Node): Node[] {
  const children: Node[] = []
  for (const [key, value] of Object.entries(node)) {
    if (SKIPPED_KEYS.has(key)) continue
    if (Array.isArray(value)) {
      for (const item of value) if (isNode(item)) children.push(item)
    } else if (isNode(value)) {
      children.push(value)
    }
  }
  return children
}

/**
 * Offset at which bracket nesting first exceeds `maxDepth`, or -1. Runs before Babel, whose
 * recursive descent would otherwise overflow the stack on a depth bomb. Strings, templates and
 * comments are skipped well enough that their brackets never count; regex bodies may, which only
 * matters for pathological input that is rejected anyway.
 */
export function bracketDepthOverflow(text: string, maxDepth: number): number {
  const templateDepths: number[] = []
  let depth = 0
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    const next = text[i + 1]
    if (char === '/' && next === '/') {
      const end = text.indexOf('\n', i)
      i = end === -1 ? text.length : end
      continue
    }
    if (char === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2)
      i = end === -1 ? text.length : end + 1
      continue
    }
    if (char === "'" || char === '"') {
      for (i++; i < text.length && text[i] !== char && text[i] !== '\n'; i++) {
        if (text[i] === '\\') i++
      }
      continue
    }
    if (char === '`' || (char === '}' && templateDepths[templateDepths.length - 1] === depth)) {
      if (char === '}') {
        templateDepths.pop()
        depth--
      }
      for (i++; i < text.length && text[i] !== '`'; i++) {
        if (text[i] === '\\') {
          i++
        } else if (text[i] === '$' && text[i + 1] === '{') {
          depth++
          templateDepths.push(depth)
          i++
          break
        }
      }
      if (depth > maxDepth) return i
      continue
    }
    if (char === '(' || char === '[' || char === '{') {
      depth++
      if (depth > maxDepth) return i
    } else if (char === ')' || char === ']' || char === '}') {
      depth = Math.max(0, depth - 1)
    }
  }
  return -1
}

/** The first node deeper than `maxDepth`, iterative so a deep tree cannot overflow the stack. */
function depthOverflow(root: Node, maxDepth: number): Node | null {
  const stack: Array<{ node: Node; depth: number }> = [{ node: root, depth: 1 }]
  while (stack.length > 0) {
    const entry = stack.pop()
    if (!entry) break
    if (entry.depth > maxDepth) return entry.node
    for (const child of childNodes(entry.node)) stack.push({ node: child, depth: entry.depth + 1 })
  }
  return null
}

interface BabelErrorShape {
  message?: unknown
  pos?: unknown
}

function babelMessage(error: BabelErrorShape): string {
  const message = typeof error.message === 'string' ? error.message : 'Invalid syntax'
  return message.replace(/ \(\d+:\d+\)$/, '')
}

interface ParsedSource {
  ast: File | null
  /** The header's major, or `null` when the first line is not `// @sim-sdk N`. */
  sdkMajor: number | null
  /** End offset of the header line (0 when there is none). */
  headerEnd: number
}

/**
 * Parses a workflow file with Babel (typescript, errorRecovery, attachComment) after the
 * byte and bracket-depth caps, then checks the AST depth cap. Babel errors are
 * re-coded as `E_SYNTAX`. Nothing is evaluated.
 */
export function parseWorkflowSource(
  file: string,
  text: string,
  limits: Required<CompileLimits>,
  reporter: Reporter
): ParsedSource {
  const header = HEADER.exec(text)
  const parsed: ParsedSource = {
    ast: null,
    sdkMajor: header ? Number(header[1]) : null,
    headerEnd: header ? header[0].length : 0,
  }

  if (utf8Bytes(text, limits.maxFileBytes) > limits.maxFileBytes) {
    reporter.report(
      'E_LIMIT_EXCEEDED',
      `The file is larger than ${limits.maxFileBytes} bytes.`,
      { file, start: 0, end: 0 },
      { hint: 'Split the workflow, or move large text into a code file.' }
    )
    return parsed
  }
  const overflowAt = bracketDepthOverflow(text, limits.maxDepth)
  if (overflowAt !== -1) {
    reporter.report(
      'E_LIMIT_EXCEEDED',
      `Nesting is deeper than ${limits.maxDepth} levels.`,
      { file, start: overflowAt, end: overflowAt + 1 },
      { hint: 'Flatten the value; workflow files nest only a few levels.' }
    )
    return parsed
  }

  let ast: ReturnType<typeof parse>
  try {
    ast = parse(text, PARSER_OPTIONS)
  } catch (error) {
    const shape: BabelErrorShape = typeof error === 'object' && error !== null ? error : {}
    if (error instanceof RangeError) {
      reporter.report(
        'E_LIMIT_EXCEEDED',
        'The file is nested too deeply to parse.',
        { file, start: 0, end: 0 },
        { hint: 'Flatten long operator chains and deeply nested values.' }
      )
      return parsed
    }
    const pos = typeof shape.pos === 'number' ? shape.pos : 0
    reporter.report('E_SYNTAX', babelMessage(shape), { file, start: pos, end: pos + 1 })
    return parsed
  }

  for (const error of ast.errors ?? []) {
    const shape: BabelErrorShape = error
    const pos = typeof shape.pos === 'number' ? shape.pos : 0
    reporter.report('E_SYNTAX', babelMessage(shape), { file, start: pos, end: pos + 1 })
  }

  const tooDeep = depthOverflow(ast, limits.maxDepth)
  if (tooDeep) {
    const start = tooDeep.start ?? 0
    reporter.report(
      'E_LIMIT_EXCEEDED',
      `Nesting is deeper than ${limits.maxDepth} levels.`,
      { file, start, end: tooDeep.end ?? start },
      { hint: 'Flatten deeply nested values.' }
    )
    return parsed
  }

  parsed.ast = ast
  return parsed
}
