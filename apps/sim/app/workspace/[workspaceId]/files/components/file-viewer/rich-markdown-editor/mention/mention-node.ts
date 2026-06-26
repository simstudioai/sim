import type { JSONContent, MarkdownToken } from '@tiptap/core'
import { Node } from '@tiptap/core'
import { toSimHref } from './sim-link'
import type { MentionKind } from './types'

export interface MentionAttrs {
  kind: MentionKind
  id: string
  label: string
}

/**
 * The markdown form of a mention — the chat's portable `[label](sim:<kind>/<id>)` link. The label
 * group accepts backslash-escaped characters so a label containing `[`/`]` (e.g. a file named
 * `data[1].csv`) still round-trips into a chip instead of degrading to a plain link.
 */
const MENTION_MD_RE = /^\[((?:\\.|[^\]\\])+)\]\(sim:([a-z_]+)\/([^)\s]+)\)/

/** Escape `\`, `[`, `]` in a mention label so brackets in entity names can't break the link syntax. */
function escapeLabel(label: string): string {
  return label.replace(/[\\[\]]/g, '\\$&')
}

/** Inverse of {@link escapeLabel}, applied when parsing a mention back from markdown. */
function unescapeLabel(label: string): string {
  return label.replace(/\\([\\[\]])/g, '$1')
}

/** Custom fields the mention tokenizer hangs on the marked token (all optional, like the image token). */
interface MentionTokenFields {
  label?: string
  kind?: string
  id?: string
}

/**
 * Inline atom node for an `@`-mention. Renders (live) as a chip with the entity's icon, but serializes
 * to the portable `[label](sim:<kind>/<id>)` markdown link — so the saved content is identical to a
 * plain link (agent-readable, round-trips through the chat's `chip-clipboard-codec`) while the editor
 * shows it as a chip rather than a blue link. This module is schema + markdown only (no React, no icon
 * registry) so the headless round-trip path stays light; the live {@link MentionChip} node view lives in
 * `mention-chip.tsx`, mirroring the image node's split. `renderText` emits the same portable link (an
 * atom otherwise contributes no text), so copying a chip into a plain-text target — e.g. the chat
 * composer — pastes back as a mention.
 */
export const MarkdownMention = Node.create({
  name: 'mention',
  inline: true,
  group: 'inline',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      kind: { default: '' },
      id: { default: '' },
      label: { default: '' },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-mention]',
        getAttrs: (element) => ({
          kind: element.getAttribute('data-kind') ?? '',
          id: element.getAttribute('data-id') ?? '',
          label: element.textContent ?? '',
        }),
      },
    ]
  },

  renderHTML({ node }) {
    const { kind, id, label } = node.attrs as MentionAttrs
    return ['span', { 'data-mention': '', 'data-kind': kind, 'data-id': id }, label]
  },

  markdownTokenizer: {
    name: 'mention',
    level: 'inline' as const,
    start: (src: string) => src.indexOf('['),
    tokenize: (src: string): (MentionTokenFields & { type: string; raw: string }) | undefined => {
      const match = MENTION_MD_RE.exec(src)
      if (!match) return undefined
      return { type: 'mention', raw: match[0], label: match[1], kind: match[2], id: match[3] }
    },
  },
  parseMarkdown: (token: MarkdownToken): JSONContent => {
    const { kind, id, label } = token as MentionTokenFields
    return {
      type: 'mention',
      attrs: { kind: kind ?? '', id: id ?? '', label: unescapeLabel(label ?? '') },
    }
  },
  renderMarkdown: (node: JSONContent): string => {
    const { kind, id, label } = (node.attrs ?? {}) as MentionAttrs
    return `[${escapeLabel(label)}](${toSimHref(kind, id)})`
  },

  renderText: ({ node }) => {
    const { kind, id, label } = node.attrs as MentionAttrs
    return `[${escapeLabel(label)}](${toSimHref(kind, id)})`
  },
})
