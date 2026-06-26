import type { MouseEvent } from 'react'
import type { JSONContent, MarkdownToken } from '@tiptap/core'
import { Node } from '@tiptap/core'
import type { ReactNodeViewProps } from '@tiptap/react'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import { useParams, useRouter } from 'next/navigation'
import { cn } from '@/lib/core/utils/cn'
import { getBareIconStyle, type StyleableIcon } from '@/blocks/icon-color'
import { mentionIcon } from './mention-icon'
import { simLinkPath, toSimHref } from './sim-link'
import type { MentionKind } from './types'

interface MentionAttrs {
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
 * shows it as a chip rather than a blue link. Shared by the headless round-trip path (no node view)
 * and the live {@link MentionChip}, mirroring the image node's split. `renderText` emits the same
 * portable link (an atom otherwise contributes no text), so copying a chip into a plain-text target —
 * e.g. the chat composer — pastes back as a mention.
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

/**
 * Mirrors the home chat input's mention rendering (the textarea mirror overlay
 * in `prompt-editor.tsx`): a borderless inline icon + label that flows with the
 * surrounding prose — no pill background, no padding, normal weight, body text
 * color, and a 12px icon. Integration icons keep their brand color via
 * {@link getBareIconStyle} (see {@link MentionChipView}); other kinds stay
 * monochrome through the `--text-icon` fallback below.
 */
const CHIP_CLASS =
  'mention-chip mx-px inline-flex items-center gap-1 align-middle text-[var(--text-primary)] leading-[1.5] [&>svg]:size-[12px] [&>svg]:shrink-0 [&>svg]:text-[var(--text-icon)]'

/**
 * Live chip: an entity icon + label matching the chat input's mention rendering. Where the host opted
 * into navigation (the file viewer), Cmd/Ctrl-click routes to the resource; in a modal field it stays
 * inert so a click can't navigate away from an unsaved edit.
 */
function MentionChipView({ node, editor }: ReactNodeViewProps) {
  const router = useRouter()
  const params = useParams()
  const { kind, id, label } = node.attrs as MentionAttrs
  const Icon = mentionIcon(kind, id) as StyleableIcon
  const iconStyle = getBareIconStyle(Icon)
  const navigable = editor.storage.mention?.navigable === true
  const workspaceId = typeof params.workspaceId === 'string' ? params.workspaceId : undefined
  // Only show the pointer / route on a kind that actually resolves to a page (e.g. not an integration).
  const path = navigable && workspaceId ? simLinkPath(workspaceId, kind, id) : null

  const handleClick = (event: MouseEvent) => {
    if (!path || !(event.metaKey || event.ctrlKey)) return
    event.preventDefault()
    router.push(path)
  }

  return (
    <NodeViewWrapper
      as='span'
      className={cn(CHIP_CLASS, path && 'cursor-pointer')}
      onClick={path ? handleClick : undefined}
      title={label}
    >
      <Icon style={iconStyle} />
      <span>{label}</span>
    </NodeViewWrapper>
  )
}

/** Live mention node with the chip view; same schema + markdown output as the headless one. */
export const MentionChip = MarkdownMention.extend({
  addNodeView() {
    return ReactNodeViewRenderer(MentionChipView)
  },
})
