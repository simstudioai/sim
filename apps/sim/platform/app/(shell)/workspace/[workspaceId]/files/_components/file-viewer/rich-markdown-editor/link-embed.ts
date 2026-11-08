import { type EmbedInfo, getEmbedInfo } from '@sim/utils/media-embed'
import { Extension } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/files/_components/file-viewer/rich-markdown-editor/editor-dom.module.css'

const LINK_EMBED_PLUGIN_KEY = new PluginKey('linkEmbed')

/** Players render at native size, then scale down so their layout fits the reading column. */
const EMBED_SCALE = 0.78
const EMBED_INVERSE_SCALE = `${(1 / EMBED_SCALE) * 100}%`

const IFRAME_ALLOW =
  'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share'

/** The non-editable player for a resolved media link, backing a widget decoration. */
function createEmbedDom(embedInfo: EmbedInfo): HTMLElement {
  const container = document.createElement('div')
  container.className = styles.embed
  container.contentEditable = 'false'

  if (embedInfo.type === 'iframe') {
    const frame = document.createElement('div')
    frame.className = styles.embedFrame
    frame.style.aspectRatio = embedInfo.aspectRatio || '16/9'
    const iframe = document.createElement('iframe')
    iframe.src = embedInfo.url
    iframe.title = 'Media'
    iframe.allow = IFRAME_ALLOW
    iframe.allowFullscreen = true
    iframe.loading = 'lazy'
    iframe.className = styles.embedIframe
    iframe.style.width = EMBED_INVERSE_SCALE
    iframe.style.height = EMBED_INVERSE_SCALE
    iframe.style.transform = `scale(${EMBED_SCALE})`
    frame.appendChild(iframe)
    container.appendChild(frame)
    return container
  }

  const media = document.createElement(embedInfo.type === 'video' ? 'video' : 'audio')
  media.src = embedInfo.url
  media.controls = true
  media.preload = 'metadata'
  media.className = embedInfo.type === 'video' ? styles.embedVideo : styles.embedAudio
  container.appendChild(media)
  return container
}

/** The href of a paragraph that is one whole-text link, or null. Only those become embeds. */
function getStandaloneLinkHref(paragraph: ProseMirrorNode): string | null {
  if (paragraph.childCount === 0) return null
  let href: string | null = null
  let isStandalone = true
  paragraph.forEach((child) => {
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
  const sourceCounts = new Map<string, number>()
  doc.descendants((node, pos) => {
    if (node.type.name !== 'paragraph') return undefined
    const href = getStandaloneLinkHref(node)
    const embedInfo = href ? getEmbedInfo(href) : null
    if (embedInfo) {
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
    return false
  })
  return DecorationSet.create(doc, decorations)
}

/**
 * Plays supported media links (YouTube, Vimeo, Spotify, Dropbox and more) beneath a standalone
 * link, as widget decorations: the document keeps a plain Markdown link, so it round-trips as is.
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
