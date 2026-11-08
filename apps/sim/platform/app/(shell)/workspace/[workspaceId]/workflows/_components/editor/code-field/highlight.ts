import Prism from 'prismjs'
import 'prismjs/components/prism-python'
import 'prismjs/components/prism-json'
import 'prismjs/components/prism-bash'
import type { WorkflowSearchTextHighlight } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/formatted-text/formatted-text'
import { getValidWorkflowSearchRange } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/formatted-text/formatted-text'
import { maskSecretText } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/formatted-text/password-mask'
import { createEnvVarPattern, createReferencePattern } from '@/platform/lib/data/workflow-editor'

/** A language the code field highlights. */
export type CodeFieldLanguage = 'javascript' | 'python' | 'json' | 'shell'

const SEARCH_MATCH_PLACEHOLDER = '__WORKFLOW_SEARCH_MATCH__'

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function prismLanguage(language: CodeFieldLanguage): string {
  if (language === 'python') return 'python'
  if (language === 'shell') return 'bash'
  if (language === 'json') return 'json'
  return 'javascript'
}

/**
 * Prism markup for `code`, or escaped text when the grammar is missing. Token classes become
 * `data-token` attributes, which the field's module styles without reaching for global classes.
 */
export function highlightSyntax(code: string, language: CodeFieldLanguage | 'plain'): string {
  if (language === 'plain') return escapeHtml(code)
  const name = prismLanguage(language)
  // The route also bundles Prism's core build for Notes; a grammar registers on whichever instance
  // held `window.Prism` when it evaluated.
  const shared = (globalThis as { Prism?: typeof Prism }).Prism
  const grammar = Prism.languages[name] ?? shared?.languages[name]
  if (!grammar) return escapeHtml(code)
  return Prism.highlight(code, grammar, name).replace(
    /class="token ([^"]*)"/g,
    (_, kinds: string) => `data-token="${kinds}"`
  )
}

interface ReferenceHighlightOptions {
  /** Whether a `<...>` segment reads as a reachable reference. */
  isReference: (segment: string) => boolean
  /** Whether a `{{NAME}}` names a secret the viewer has. */
  isEnvVar: (name: string) => boolean
  search?: WorkflowSearchTextHighlight | null
}

/**
 * Syntax markup with `<block.output>` references and `{{SECRET}}` names marked in the reference
 * color and the active workflow-search match marked, the way every code field in the editor
 * highlights.
 */
export function highlightCode(
  code: string,
  language: CodeFieldLanguage | 'plain',
  { isReference, isEnvVar, search }: ReferenceHighlightOptions
): string {
  const placeholders: Array<{ placeholder: string; original: string }> = []
  const range = getValidWorkflowSearchRange(code, search)
  let processed = range
    ? `${code.slice(0, range.start)}${SEARCH_MATCH_PLACEHOLDER}${code.slice(range.end)}`
    : code
  processed = processed.replace(createEnvVarPattern(), (match) => {
    if (!isEnvVar(match.slice(2, -2).trim())) return match
    const placeholder = `__ENV_VAR_${placeholders.length}__`
    placeholders.push({ placeholder, original: match })
    return placeholder
  })
  processed = processed.replace(createReferencePattern(), (match) => {
    if (!isReference(match)) return match
    const placeholder = `__VAR_REF_${placeholders.length}__`
    placeholders.push({ placeholder, original: match })
    return placeholder
  })
  let html = highlightSyntax(processed, language)
  for (const { placeholder, original } of placeholders) {
    html = html.replace(
      placeholder,
      () => `<span data-code-reference="">${escapeHtml(original)}</span>`
    )
  }
  if (range) {
    html = html.replace(
      SEARCH_MATCH_PLACEHOLDER,
      () => `<mark data-code-search="">${escapeHtml(code.slice(range.start, range.end))}</mark>`
    )
  }
  return html
}

/** Conceals a secret: the editor shows this markup over its transparent text. */
export function highlightMaskedCode(code: string): string {
  return escapeHtml(maskSecretText(code))
}
