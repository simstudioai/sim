import { Extension } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import Prism, { type Token, type TokenStream } from 'prismjs'
import 'prismjs/components/prism-bash'
import 'prismjs/components/prism-css'
import 'prismjs/components/prism-markup'
import 'prismjs/components/prism-javascript'
import 'prismjs/components/prism-typescript'
import 'prismjs/components/prism-yaml'
import 'prismjs/components/prism-sql'
import 'prismjs/components/prism-python'
import 'prismjs/components/prism-json'
import 'prismjs/components/prism-c'
import 'prismjs/components/prism-cpp'
import 'prismjs/components/prism-csharp'
import 'prismjs/components/prism-go'
import 'prismjs/components/prism-java'
import 'prismjs/components/prism-markup-templating'
import 'prismjs/components/prism-php'
import 'prismjs/components/prism-ruby'
import 'prismjs/components/prism-rust'
import { detectLanguage } from './detect-language'

const HIGHLIGHT_PLUGIN_KEY = new PluginKey('codeBlockHighlight')

function tokenClasses(token: Token): string {
  const classes = ['token', token.type]
  if (token.alias) classes.push(...(Array.isArray(token.alias) ? token.alias : [token.alias]))
  return classes.join(' ')
}

/**
 * Walks Prism's token tree, emitting one inline decoration per token over its text range.
 * Nested tokens stack (ProseMirror nests overlapping inline decorations), reproducing the
 * `.token`-class structure Prism would render as HTML.
 */
function collectTokenDecorations(
  stream: TokenStream,
  base: number,
  offset: { value: number },
  decorations: Decoration[],
  limit: number
) {
  const tokens = Array.isArray(stream) ? stream : [stream]
  for (const token of tokens) {
    if (typeof token === 'string') {
      offset.value += token.length
      continue
    }
    const start = offset.value
    collectTokenDecorations(token.content, base, offset, decorations, limit)
    const from = base + start
    const to = Math.min(base + offset.value, limit)
    if (to > from) decorations.push(Decoration.inline(from, to, { class: tokenClasses(token) }))
  }
}

export function buildDecorations(doc: ProseMirrorNode): DecorationSet {
  const decorations: Decoration[] = []
  doc.descendants((node, pos) => {
    if (node.type.name !== 'codeBlock') return
    const language = (node.attrs.language as string | null) ?? detectLanguage(node.textContent)
    const grammar = language ? Prism.languages[language] : undefined
    if (!grammar) return
    // Defensive: a malformed grammar or a token/position mismatch must never throw here — a throw
    // in the decorations plugin blanks the whole editor. The `limit` clamps any over-long token.
    try {
      const base = pos + 1
      collectTokenDecorations(
        Prism.tokenize(node.textContent, grammar),
        base,
        { value: 0 },
        decorations,
        base + node.content.size
      )
    } catch {}
  })
  return DecorationSet.create(doc, decorations)
}

/**
 * Whether the transaction's changed ranges intersect any code block in the new doc — including
 * a `setNodeMarkup` language change (whose step range covers the node). When false, the cheap
 * path just maps existing decorations instead of re-tokenizing.
 */
export function changeTouchesCodeBlock(tr: Transaction, doc: ProseMirrorNode): boolean {
  let touches = false
  for (const map of tr.mapping.maps) {
    map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      if (touches) return
      const from = Math.max(0, Math.min(newStart, doc.content.size))
      const to = Math.max(from, Math.min(newEnd, doc.content.size))
      doc.nodesBetween(from, to, (node) => {
        if (node.type.name === 'codeBlock') touches = true
        return !touches
      })
    })
  }
  return touches
}

/**
 * Syntax-highlights fenced code blocks with Prism, emitting the same `.token` classes the
 * rest of the app uses so the `code-editor-theme` styles (light + dark) apply unchanged.
 * Re-tokenizes only when a change actually touches a code block (typing in prose just maps
 * the existing decorations), keeping the cost off the common keystroke path.
 */
export const CodeBlockHighlight = Extension.create({
  name: 'codeBlockHighlight',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: HIGHLIGHT_PLUGIN_KEY,
        state: {
          init: (_, { doc }) => buildDecorations(doc),
          apply: (tr, current) => {
            if (tr.steps.length === 0) return current
            if (!changeTouchesCodeBlock(tr, tr.doc)) return current.map(tr.mapping, tr.doc)
            return buildDecorations(tr.doc)
          },
        },
        props: {
          decorations(state) {
            return HIGHLIGHT_PLUGIN_KEY.getState(state)
          },
        },
      }),
    ]
  },
})
