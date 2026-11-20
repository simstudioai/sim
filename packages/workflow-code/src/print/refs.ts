/**
 * Reference printing. A stored string is literal text plus
 * tokens; each token that resolves to something in lexical scope becomes an interpolation, and
 * everything else stays literal text, which compiles back to the same bytes. Path segments map
 * exactly: `.seg` ↔ `.seg`, a non-identifier `.seg` ↔ `['seg']`, `[n]` ↔ `[n]`.
 */

import { findWorkflowReferenceTokens } from '@sim/utils/workflow-references'
import { isReservedWorkflowBlockName } from '@sim/workflow-types/workflow'
import {
  ENV_VAR_NAME,
  formatMemberPath,
  LOOP_PROPERTIES,
  PARALLEL_PROPERTIES,
  parseStoredPath,
} from '../code-files/ref-path'
import type { PrintDiagnosticCode } from '../diagnostics/codes'
import { diagnostic } from '../diagnostics/factory'
import type { Diagnostic } from '../diagnostics/frame'
import type { BlockKey } from '../model'

type RefPart = { kind: 'text'; text: string } | { kind: 'ref'; expr: string }

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
  subflowScope(from: BlockKey, kind: 'loop' | 'parallel'): string | null
  /** Records that the printed file uses an SDK import (`env`). */
  use(name: string): void
  /** Records that the printed file reads `vars`. */
  useVars(): void
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
    const parsed = parseStoredPath(token.slice(1, -1))
    if (!parsed) return this.unresolved(token, from, 'W_UNRESOLVED_REF')
    const [head, ...segments] = parsed
    if (head.kind !== 'name') return this.unresolved(token, from, 'W_UNRESOLVED_REF')
    const [first] = segments
    if (head.name === 'variable') {
      if (first?.kind !== 'name' || !this.scope.hasVariable(first.name)) {
        return this.unresolved(token, from, 'W_UNRESOLVED_REF')
      }
      this.scope.useVars()
      return formatMemberPath('vars', segments)
    }
    if (head.name === 'loop' || head.name === 'parallel') {
      const known = head.name === 'loop' ? LOOP_PROPERTIES : PARALLEL_PROPERTIES
      const param = from === null ? null : this.scope.subflowScope(from, head.name)
      if (first?.kind !== 'name' || !known.includes(first.name) || param === null) {
        return this.unresolved(token, from, 'W_UNRESOLVED_REF')
      }
      return formatMemberPath(param, segments)
    }
    if (!this.scope.hasBlock(head.name) || from === null) {
      return this.unresolved(token, from, 'W_UNRESOLVED_REF')
    }
    const visibility = this.scope.visibility(from, head.name)
    if (visibility === 'forward') return this.unresolved(token, from, 'W_FORWARD_REF_LITERALIZED')
    if (visibility === 'scope') return this.unresolved(token, from, 'W_UNRESOLVED_REF')
    return formatMemberPath(this.scope.identOf(head.name), segments)
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
    this.diagnostics.push(
      diagnostic(
        code,
        code === 'W_FORWARD_REF_LITERALIZED'
          ? `Reference ${token} would point at a block declared later; printed as literal text.`
          : `Reference ${token} does not resolve in scope; printed as literal text.`,
        {
          ...(from === null ? {} : { blockKey: from }),
        }
      )
    )
    return null
  }
}

/** Block keys a string refers to, for declaration-order dependencies. */
export function referencedHeads(text: string): string[] {
  const heads: string[] = []
  for (const token of findWorkflowReferenceTokens(text)) {
    if (token.kind !== 'workflow') continue
    const head = parseStoredPath(token.value.slice(1, -1))?.[0]
    if (head?.kind === 'name' && !isReservedWorkflowBlockName(head.name)) heads.push(head.name)
  }
  return heads
}
