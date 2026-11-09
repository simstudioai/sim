import Prism from 'prismjs'
import 'prismjs/components/prism-python'
import 'prismjs/components/prism-json'
import 'prismjs/components/prism-bash'

/** A language the code field highlights. */
export type CodeFieldLanguage = 'javascript' | 'python' | 'json' | 'shell'

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
