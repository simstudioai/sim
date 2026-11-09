import Prism from 'prismjs'
import 'prismjs/components/prism-python'
import 'prismjs/components/prism-json'
import 'prismjs/components/prism-bash'
import { findWorkflowReferenceTokens } from '@sim/utils/workflow-references'
import type { CodePreviewLanguage } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/canvas/workflow-block/types'

/** Matches Prism's own escaping, for the plaintext fallback. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function highlightSource(source: string, language: CodePreviewLanguage): string {
  const grammar = Prism.languages[language] || Prism.languages.javascript
  return Prism.highlight(source, grammar, language)
}

/**
 * One line of the legacy `Code.Viewer` with `highlightWorkflowReferences`: Prism markup with every
 * `{{ENV}}` and `<block.output>` reference masked before highlighting and restored as a
 * `data-code-reference` span, so the grammar never splits one.
 */
export function highlightCodeLine(source: string, language: CodePreviewLanguage): string {
  const placeholders: Array<{ original: string; placeholder: string }> = []
  let cursor = 0
  let maskedSource = ''

  const maskReference = (original: string) => {
    let placeholder = `__SIM_CODE_REFERENCE_${placeholders.length}__`
    while (source.includes(placeholder)) placeholder += '_'
    placeholders.push({ original, placeholder })
    return placeholder
  }

  for (const token of findWorkflowReferenceTokens(source)) {
    maskedSource += source.slice(cursor, token.start)
    maskedSource += maskReference(token.value)
    cursor = token.end
  }
  maskedSource += source.slice(cursor)

  let highlighted = highlightSource(maskedSource, language)
  for (const { original, placeholder } of placeholders) {
    highlighted = highlighted.replace(
      placeholder,
      () => `<span data-code-reference="">${escapeHtml(original)}</span>`
    )
  }
  return highlighted
}

/** Gutter widths by line-number digit count, as every legacy code surface uses. */
const GUTTER_WIDTHS = [20, 20, 30, 38, 46, 54] as const

/** The legacy gutter width for a line count. */
export function calculateGutterWidth(lineCount: number): number {
  const digits = String(lineCount).length
  return GUTTER_WIDTHS[Math.min(digits - 1, GUTTER_WIDTHS.length - 1)]
}
