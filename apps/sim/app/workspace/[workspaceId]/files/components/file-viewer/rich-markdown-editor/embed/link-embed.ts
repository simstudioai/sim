import { getEmbedInfo } from '@sim/utils/media-embed'
import { Extension } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { createEmbedDom } from './embed-dom'

const LINK_EMBED_PLUGIN_KEY = new PluginKey('linkEmbed')

/**
 * The href of a paragraph that is a single, whole-text link (a "standalone link"), or null if
 * the paragraph is empty, holds non-text content, or mixes a link with other text. Only
 * standalone links become media embeds — a link inline within a sentence stays a plain link,
 * matching how Notion and Linear auto-embed.
 */
function getStandaloneLinkHref(node: ProseMirrorNode): string | null {
  if (node.type.name !== 'paragraph' || node.childCount === 0) return null
  let href: string | null = null
  let isStandalone = true
  node.forEach((child) => {
    if (!isStandalone) return
    const linkMark = child.isText
      ? child.marks.find((mark) => mark.type.name === 'link')
      : undefined
    if (!linkMark) {
      isStandalone = false
      return
    }
    const childHref = linkMark.attrs.href as string
    if (href === null) href = childHref
    else if (href !== childHref) isStandalone = false
  })
  return isStandalone ? href : null
}

function buildDecorations(doc: ProseMirrorNode): DecorationSet {
  const decorations: Decoration[] = []
  /** Per-source occurrence count, so repeated embeds of the same URL get distinct, stable keys. */
  const sourceCounts = new Map<string, number>()
  doc.descendants((node, pos) => {
    if (node.type.name !== 'paragraph') return undefined
    const href = getStandaloneLinkHref(node)
    if (href) {
      const embedInfo = getEmbedInfo(href)
      if (embedInfo) {
        // Key by source + occurrence index so the iframe/video DOM is reused across unrelated
        // edits (no reload on keystroke) while two links to the same URL still render as two
        // distinct widgets rather than collapsing into one.
        const source = `embed:${embedInfo.type}:${embedInfo.url}`
        const index = sourceCounts.get(source) ?? 0
        sourceCounts.set(source, index + 1)
        decorations.push(
          Decoration.widget(pos + node.nodeSize, () => createEmbedDom(embedInfo), {
            side: 1,
            key: `${source}:${index}`,
          })
        )
      }
    }
    // Paragraphs hold only inline content — never another embeddable paragraph.
    return false
  })
  return DecorationSet.create(doc, decorations)
}

/**
 * Renders supported media links (YouTube, Vimeo, Spotify, Dropbox, …) as live players beneath a
 * standalone link, in both the editing and read-only surfaces. Implemented as widget decorations
 * so the underlying document stays a plain markdown link — embeds never enter the schema or the
 * serialized markdown, keeping round-trips lossless.
 */
export const LinkEmbed = Extension.create({
  name: 'linkEmbed',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: LINK_EMBED_PLUGIN_KEY,
        state: {
          init: (_, { doc }) => buildDecorations(doc),
          apply: (tr, current) => (tr.docChanged ? buildDecorations(tr.doc) : current),
        },
        props: {
          decorations(state) {
            return LINK_EMBED_PLUGIN_KEY.getState(state)
          },
        },
      }),
    ]
  },
})
