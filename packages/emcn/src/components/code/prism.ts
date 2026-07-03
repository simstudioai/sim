import { type Grammar, languages, highlight as prismHighlight } from 'prismjs'
import 'prismjs/components/prism-javascript'
import 'prismjs/components/prism-python'
import 'prismjs/components/prism-json'

/**
 * Prism.js highlighting utilities isolated in a dedicated module.
 *
 * The grammar imports above are side-effectful (they register languages on the
 * shared `Prism.languages` registry), which marks any module that statically
 * imports them as having side effects and therefore non-tree-shakeable. Keeping
 * them here — rather than in `code.tsx` — ensures Prism only enters bundles that
 * actually import these utilities, instead of every consumer of the shared
 * `@sim/emcn` barrel (which re-exports `Code`).
 *
 * `code.tsx` itself never imports this module statically; it loads it lazily via
 * dynamic `import()` on first highlight.
 *
 * `highlight` is a local wrapper rather than a re-export of Prism's `highlight`.
 * A bare re-export lets bundlers resolve the binding straight from `prismjs` and
 * skip this module's body, dropping the grammar registrations above so
 * `languages.json` (etc.) become `undefined` at runtime. Owning the function
 * keeps the registrations in the dependency graph and lets us degrade to escaped
 * plaintext when a grammar is missing instead of throwing.
 */

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Highlights `code` with the given Prism `grammar`, returning HTML markup.
 * Falls back to escaped plaintext when `grammar` is undefined so a missing or
 * unregistered language never throws `The language "<x>" has no grammar.`.
 */
function highlight(code: string, grammar: Grammar | undefined, language: string): string {
  if (!grammar) return escapeHtml(code)
  return prismHighlight(code, grammar, language)
}

export { highlight, languages }
