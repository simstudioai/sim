import { type ParserOptions, parse } from '@babel/parser'
import type { File, Node } from '@babel/types'
import { utf8ByteLength } from '@sim/utils/paste'
import { type BabelErrorShape, babelErrorShape, childNodes } from '../babel'
import { codeFileLanguage } from '../code-files'
import { createJsContextScanner } from '../code-files/lexer'
import { SOURCE_LIMITS } from '../limits'
import type { Reporter } from './report'

/** Caps on hostile input. Defaults are the shared `SOURCE_LIMITS` (`limits.ts`). */
export interface CompileLimits {
  /** Block declarations in the workflow. */
  maxBlocks?: number
  /** Edges the wiring adds, implied subflow starts included. */
  maxEdges?: number
  /** Variables the workflow declares. */
  maxVariables?: number
  /** Bytes of the entry plus the distinct code files `codeFile()` references. */
  maxTotalBytes?: number
  /** Nesting depth of the entry file, and bracket depth of each JavaScript code file. */
  maxDepth?: number
  /** `codeFile()` references across the workflow, distinct or not. */
  maxCodeFileRefs?: number
}

/**
 * Default caps on hostile input: the shared source limits, so whatever a get prints
 * compiles, plus a nesting cap. A 200-block workflow nests under 20 levels. Syntax nodes need no
 * cap of their own: every node but an empty template element spans at least one byte, so the
 * byte cap bounds them.
 */
export const DEFAULT_LIMITS: Required<CompileLimits> = {
  maxBlocks: SOURCE_LIMITS.maxBlocks,
  maxEdges: SOURCE_LIMITS.maxEdges,
  maxVariables: SOURCE_LIMITS.maxVariables,
  maxTotalBytes: SOURCE_LIMITS.maxTotalBytes,
  maxDepth: SOURCE_LIMITS.maxDepth,
  /** One code file per block. */
  maxCodeFileRefs: SOURCE_LIMITS.maxBlocks,
}

const HEADER = /^\/\/ @sim-sdk ([0-9]{1,6})[ \t]*(?=\r\n|[\n\r\u2028\u2029]|$)/

/** Babel options for a workflow file, shared with the CLI's code-file scan (`code-files/references`). */
export const PARSER_OPTIONS: ParserOptions = {
  sourceType: 'module',
  plugins: ['typescript'],
  errorRecovery: true,
  attachComment: true,
  ranges: false,
  tokens: false,
}

/**
 * Offset at which bracket nesting first exceeds `maxDepth`, or -1. Runs before Babel, whose
 * recursive descent would otherwise overflow the stack on a depth bomb. Only brackets in code
 * count: strings, templates, regex literals and comments are skipped by the code-file lexer
 * (`createJsContextScanner`), so `/\(/` is not an open parenthesis. A template's `${` counts as
 * one level.
 */
export function bracketDepthOverflow(text: string, maxDepth: number): number {
  const scanner = createJsContextScanner(text)
  let depth = 0
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    const opens = char === '(' || char === '[' || char === '{'
    if (!opens && char !== ')' && char !== ']' && char !== '}') continue
    if (scanner.contextAt(i) !== 'code') continue
    if (opens) {
      depth++
      if (depth > maxDepth) return i
    } else {
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

/** A Babel error's message without its trailing `(line:column)`. */
export function babelMessage(error: BabelErrorShape): string {
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

/** The `// @sim-sdk N` header on the first line: its major and end offset. */
export function sdkHeader(text: string): Pick<ParsedSource, 'sdkMajor' | 'headerEnd'> {
  const header = HEADER.exec(text)
  return {
    sdkMajor: header ? Number(header[1]) : null,
    headerEnd: header ? header[0].length : 0,
  }
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
  const parsed: ParsedSource = { ast: null, ...sdkHeader(text) }

  if (utf8ByteLength(text, limits.maxTotalBytes) > limits.maxTotalBytes) {
    reporter.report(
      'E_LIMIT_EXCEEDED',
      `The file is larger than ${limits.maxTotalBytes} bytes, the limit for all source files together.`,
      { file, start: 0, end: 0 },
      { hint: 'Split the workflow, moving parts into child workflows.' }
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
    const shape = babelErrorShape(error)
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

/**
 * Whether compile refuses an entry file for nesting: its bracket depth, then its syntax tree's.
 * The tree is parsed only when `depthBound`, an upper bound on its depth, exceeds `maxDepth`.
 */
function entryTooDeep(text: string, maxDepth: number, depthBound: number): boolean {
  if (bracketDepthOverflow(text, maxDepth) !== -1) return true
  if (depthBound <= maxDepth) return false
  try {
    return depthOverflow(parse(text, PARSER_OPTIONS), maxDepth) !== null
  } catch (error) {
    return error instanceof RangeError
  }
}

/**
 * The first printed file compile would refuse for nesting deeper than `SOURCE_LIMITS.maxDepth`, or
 * `null`: the entry by its brackets and syntax tree, each JavaScript code file by its brackets. A
 * get checks its output with it, so it never returns source an apply would refuse.
 * `entryDepthBound` is the print's upper bound on the entry's tree depth (`entryDepth`); pass
 * `Infinity` for text the printer did not write.
 */
export function sourceDepthOverflow(
  files: Readonly<Record<string, string>>,
  entryDepthBound: number
): string | null {
  for (const [path, text] of Object.entries(files)) {
    const language = codeFileLanguage(path)
    const tooDeep =
      language === null
        ? entryTooDeep(text, SOURCE_LIMITS.maxDepth, entryDepthBound)
        : language === 'javascript' && bracketDepthOverflow(text, SOURCE_LIMITS.maxDepth) !== -1
    if (tooDeep) return path
  }
  return null
}
