/// <reference path="./prism-core.d.ts" />
import type { Grammar } from 'prismjs'
import { languages, highlight as prismHighlight } from 'prismjs/components/prism-core'
import 'prismjs/components/prism-markup'
import 'prismjs/components/prism-css'
import 'prismjs/components/prism-clike'
import 'prismjs/components/prism-javascript'
import 'prismjs/components/prism-python'
import 'prismjs/components/prism-json'
import 'prismjs/components/prism-bash'
import 'prismjs/components/prism-toml'

/**
 * Uses Prism's core build so server-side highlighting never loads DOM plugins,
 * including when a document converter has installed partial browser globals.
 * Explicit grammar prerequisites preserve the default Prism language set.
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
