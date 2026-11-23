import { type ParserOptions, parse } from '@babel/parser'
import type { Expression, MemberExpression, Node } from '@babel/types'
import { isLikelyWorkflowReferenceSegment } from '@sim/utils/workflow-references'
import { babelErrorShape, childNodes, memberSegment } from '../babel'
import { ENV_VAR_NAME, formatStoredPath, type RefSegment } from './ref-path'
import { type CodeFileLanguage, ENV_ROOT, REF_ROOT } from './to-file'

interface CodeFileSyntaxError {
  message: string
  /** UTF-16 offset into the file text. */
  start: number
  /** 1-based. */
  line: number
  /** 1-based, UTF-16 units. */
  column: number
}

/**
 * One `$ref` chain (`segments`) or `$env` name (`env`) read from the file, at its UTF-16 offsets
 * in the file text. `tag` marks a reference the file writes as stored text (`<key.path>`), which
 * the file keeps as written and the run resolves as it does a rewritten `$ref`.
 */
export type CodeFileRef = { start: number; end: number } & (
  | { kind: 'ref'; segments: RefSegment[]; tag?: true }
  | { kind: 'env'; name: string }
)

type FromCodeFileResult =
  | { ok: true; code: string; refs: CodeFileRef[] }
  | { ok: false; errors: CodeFileSyntaxError[] }

/**
 * Stored function code runs as a module-or-script body with top-level `return`, `await` and
 * `import`, so the parse allows all three.
 */
const FUNCTION_BODY_OPTIONS: ParserOptions = {
  sourceType: 'unambiguous',
  allowReturnOutsideFunction: true,
  allowAwaitOutsideFunction: true,
  allowImportExportEverywhere: true,
  allowSuperOutsideMethod: true,
  allowUndeclaredExports: true,
  errorRecovery: true,
  ranges: false,
}

interface Replacement {
  start: number
  end: number
  text: string
  ref: CodeFileRef
}

function toSyntaxError(error: unknown): CodeFileSyntaxError {
  const shape = babelErrorShape(error)
  const line = typeof shape.loc?.line === 'number' ? shape.loc.line : 1
  const column = typeof shape.loc?.column === 'number' ? shape.loc.column + 1 : 1
  return {
    message: typeof shape.message === 'string' ? shape.message : 'Invalid JavaScript',
    start: typeof shape.pos === 'number' ? shape.pos : 0,
    line,
    column,
  }
}

/**
 * Reads a code file back into stored function code: the inverse of `toCodeFile`. JavaScript is
 * parsed with Babel and every member chain rooted at `$ref` or `$env` is rewritten to its stored
 * token; nothing else in the text changes, so comments, strings and formatting survive.
 *
 * A `$ref` chain covers every member it can map (`.name`, `['name']`, `[n]`) and stops at the
 * first one it cannot (a computed expression, an optional `?.`) or at a parenthesis:
 * `($ref.a.b).length` reads `<a.b>` and keeps `.length` as code. `$env` maps one name only.
 * Python and shell files are stored verbatim (see `toCodeFile`).
 */
export function fromCodeFile(text: string, language: CodeFileLanguage): FromCodeFileResult {
  if (language !== 'javascript') return { ok: true, code: text, refs: [] }

  let program: Node
  try {
    const file = parse(text, FUNCTION_BODY_OPTIONS)
    if (file.errors && file.errors.length > 0) {
      return { ok: false, errors: file.errors.map(toSyntaxError) }
    }
    program = file.program
  } catch (error) {
    return { ok: false, errors: [toSyntaxError(error)] }
  }

  const replacements = collectReplacements(program)
  if (replacements.length === 0) return { ok: true, code: text, refs: [] }
  replacements.sort((left, right) => left.start - right.start)
  let code = ''
  let cursor = 0
  const refs: CodeFileRef[] = []
  for (const replacement of replacements) {
    code += text.slice(cursor, replacement.start) + replacement.text
    cursor = replacement.end
    refs.push(replacement.ref)
  }
  return { ok: true, code: code + text.slice(cursor), refs }
}

function isParenthesized(node: Node): boolean {
  return node.extra?.parenthesized === true
}

/** The members of a chain, innermost first, and its root; stops at a parenthesized object. */
function flattenChain(top: MemberExpression): { root: Expression; members: MemberExpression[] } {
  const members: MemberExpression[] = [top]
  let object = top.object
  while (object.type === 'MemberExpression' && !isParenthesized(object)) {
    members.push(object)
    object = object.object
  }
  members.reverse()
  return { root: object, members }
}

function envName(member: MemberExpression): string | null {
  const property = member.property
  const name =
    !member.computed && property.type === 'Identifier'
      ? property.name
      : member.computed && property.type === 'StringLiteral'
        ? property.value
        : null
  return name !== null && ENV_VAR_NAME.test(name) ? name : null
}

/**
 * The replacement for one chain, and the members it consumed. `null` when the chain is not
 * rooted at `$ref`/`$env` or maps no member.
 */
function chainReplacement(
  root: Expression,
  members: MemberExpression[]
): { replacement: Replacement; consumed: number } | null {
  if (root.type !== 'Identifier' || members.length === 0) return null
  if (root.name === ENV_ROOT) {
    const first = members[0]
    const name = envName(first)
    if (name === null || first.start == null || first.end == null) return null
    const span = { start: first.start, end: first.end }
    return {
      replacement: { ...span, text: `{{${name}}}`, ref: { ...span, kind: 'env', name } },
      consumed: 1,
    }
  }
  if (root.name !== REF_ROOT) return null

  const segments: RefSegment[] = []
  for (const member of members) {
    const segment = memberSegment(member)
    if (segment === null || (segments.length === 0 && segment.kind === 'index')) break
    segments.push(segment)
  }
  while (segments.length > 0) {
    const last = members[segments.length - 1]
    const token = `<${formatStoredPath(segments)}>`
    if (isLikelyWorkflowReferenceSegment(token) && last.start != null && last.end != null) {
      return {
        replacement: {
          start: last.start,
          end: last.end,
          text: token,
          ref: { start: last.start, end: last.end, kind: 'ref', segments: [...segments] },
        },
        consumed: segments.length,
      }
    }
    segments.pop()
  }
  return null
}

function collectReplacements(program: Node): Replacement[] {
  const replacements: Replacement[] = []
  const stack: Array<{ node: Node; isObjectOfMember: boolean }> = [
    { node: program, isObjectOfMember: false },
  ]
  while (stack.length > 0) {
    const entry = stack.pop()
    if (!entry) break
    const { node } = entry
    if (node.type === 'MemberExpression' && !entry.isObjectOfMember) {
      const { root, members } = flattenChain(node)
      const found = chainReplacement(root, members)
      if (found) {
        replacements.push(found.replacement)
        for (const member of members.slice(found.consumed)) {
          if (member.computed) stack.push({ node: member.property, isObjectOfMember: false })
        }
        continue
      }
    }
    for (const child of childNodes(node)) {
      const isObjectOfMember =
        node.type === 'MemberExpression' && child === node.object && !isParenthesized(child)
      stack.push({ node: child, isObjectOfMember })
    }
  }
  return replacements
}
