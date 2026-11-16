/**
 * Reference printing (build-spec decision 8, s3 D3/D4). A stored string is literal text plus
 * tokens; each token that resolves to something in lexical scope becomes an interpolation, and
 * everything else stays literal text, which compiles back to the same bytes. Path segments map
 * exactly: `.seg` ↔ `.seg`, a non-identifier `.seg` ↔ `['seg']`, `[n]` ↔ `[n]`.
 */

import { findWorkflowReferenceTokens } from '@sim/utils/workflow-references'
import type { PrintDiagnosticCode } from '../diagnostics/codes'
import type { Diagnostic } from '../diagnostics/frame'
import type { BlockKey } from '../model'
import { printMember } from './strings'

const ENV_VAR_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/
const LOOP_PROPERTIES = new Set(['iteration', 'index', 'item', 'currentItem', 'items'])
const PARALLEL_PROPERTIES = new Set(['index', 'currentItem', 'items'])

export type RefPart = { kind: 'text'; text: string } | { kind: 'ref'; expr: string }

/** What reference printing needs to know about declarations and scopes. */
export interface RefScope {
  hasBlock(key: BlockKey): boolean
  hasVariable(key: string): boolean
  /**
   * Whether `target` can be named from inside `from`'s params: `ok`, `forward` (declared later or
   * self, a TS2448 cycle) or `scope` (inside another subflow).
   */
  visibility(from: BlockKey, target: BlockKey): 'ok' | 'forward' | 'scope'
  identOf(key: BlockKey): string
  /** The param name of the nearest `kind` container enclosing `from`, if any. */
  loopParam(from: BlockKey, kind: 'loop' | 'parallel'): string | null
  /** Records that the printed file uses an SDK import (`env`). */
  use(name: string): void
  /** Records that the printed file reads `vars`. */
  useVars(): void
}

interface ParsedPath {
  head: string
  segments: Array<{ kind: 'member'; name: string } | { kind: 'index'; index: string }>
}

/** Splits `head.a[0].b-c` into a head and exact segments; `null` when the grammar does not fit. */
function parseRefPath(inner: string): ParsedPath | null {
  const headMatch = /^[^.[\]]+/.exec(inner)
  if (!headMatch) return null
  const head = headMatch[0]
  const segments: ParsedPath['segments'] = []
  let rest = inner.slice(head.length)
  while (rest.length > 0) {
    const member = /^\.([^.[\]]+)/.exec(rest)
    if (member?.[1] !== undefined) {
      segments.push({ kind: 'member', name: member[1] })
      rest = rest.slice(member[0].length)
      continue
    }
    const index = /^\[(0|[1-9][0-9]*)\]/.exec(rest)
    if (index?.[1] !== undefined) {
      segments.push({ kind: 'index', index: index[1] })
      rest = rest.slice(index[0].length)
      continue
    }
    return null
  }
  return { head, segments }
}

function printSegments(segments: ParsedPath['segments']): string {
  return segments
    .map((segment) =>
      segment.kind === 'member' ? printMember(segment.name) : `[${segment.index}]`
    )
    .join('')
}

export class RefPrinter {
  readonly diagnostics: Diagnostic<PrintDiagnosticCode>[] = []

  constructor(private readonly scope: RefScope) {}

  /** The interpolation for one token, or `null` (with a warning) to keep it literal. */
  resolveToken(token: string, from: BlockKey | null): string | null {
    if (token.startsWith('{{')) {
      const name = token.slice(2, -2)
      if (!ENV_VAR_NAME.test(name)) return null
      this.scope.use('env')
      return `env.${name}`
    }
    const parsed = parseRefPath(token.slice(1, -1))
    if (!parsed) return this.unresolved(token, from, 'W_UNRESOLVED_REF')
    const { head, segments } = parsed
    if (head === 'variable') {
      const [first, ...rest] = segments
      if (first?.kind !== 'member' || !this.scope.hasVariable(first.name)) {
        return this.unresolved(token, from, 'W_UNRESOLVED_REF')
      }
      this.scope.useVars()
      return `vars${printMember(first.name)}${printSegments(rest)}`
    }
    if (head === 'loop' || head === 'parallel') {
      const [first] = segments
      const known = head === 'loop' ? LOOP_PROPERTIES : PARALLEL_PROPERTIES
      const param = from === null ? null : this.scope.loopParam(from, head)
      if (first?.kind !== 'member' || !known.has(first.name) || param === null) {
        return this.unresolved(token, from, 'W_UNRESOLVED_REF')
      }
      return `${param}${printSegments(segments)}`
    }
    if (!this.scope.hasBlock(head) || from === null) {
      return this.unresolved(token, from, 'W_UNRESOLVED_REF')
    }
    const visibility = this.scope.visibility(from, head)
    if (visibility === 'forward') return this.unresolved(token, from, 'W_FORWARD_REF_LITERALIZED')
    if (visibility === 'scope') return this.unresolved(token, from, 'W_UNRESOLVED_REF')
    return `${this.scope.identOf(head)}${printSegments(segments)}`
  }

  /** Splits text into literal runs and resolved interpolations. */
  parts(text: string, from: BlockKey | null): RefPart[] {
    const parts: RefPart[] = []
    let cursor = 0
    const pushText = (value: string) => {
      if (value.length === 0) return
      const last = parts.at(-1)
      if (last?.kind === 'text') last.text += value
      else parts.push({ kind: 'text', text: value })
    }
    for (const token of findWorkflowReferenceTokens(text)) {
      const expr = this.resolveToken(token.value, from)
      if (expr === null) continue
      pushText(text.slice(cursor, token.start))
      parts.push({ kind: 'ref', expr })
      cursor = token.end
    }
    pushText(text.slice(cursor))
    return parts
  }

  private unresolved(
    token: string,
    from: BlockKey | null,
    code: 'W_UNRESOLVED_REF' | 'W_FORWARD_REF_LITERALIZED'
  ): null {
    this.diagnostics.push({
      code,
      severity: 'warning',
      message:
        code === 'W_FORWARD_REF_LITERALIZED'
          ? `Reference ${token} would point at a block declared later; printed as literal text.`
          : `Reference ${token} does not resolve in scope; printed as literal text.`,
      ...(from === null ? {} : { blockKey: from }),
    })
    return null
  }
}

/** Block keys a string refers to, for declaration-order dependencies. */
export function referencedHeads(text: string): string[] {
  const heads: string[] = []
  for (const token of findWorkflowReferenceTokens(text)) {
    if (token.kind !== 'workflow') continue
    const parsed = parseRefPath(token.value.slice(1, -1))
    if (
      parsed &&
      parsed.head !== 'variable' &&
      parsed.head !== 'loop' &&
      parsed.head !== 'parallel'
    ) {
      heads.push(parsed.head)
    }
  }
  return heads
}
