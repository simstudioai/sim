import type { MouseEvent } from 'react'
import { cn } from '@sim/emcn'
import type { ReactNodeViewProps } from '@tiptap/react'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import { useParams, useRouter } from 'next/navigation'
import { getBareIconStyle, type StyleableIcon } from '@/blocks/icon-color'
import { mentionIcon } from './mention-icon'
import { MarkdownMention, type MentionAttrs } from './mention-node'
import { simLinkPath } from './sim-link'

/**
 * Mirrors the home chat input's mention rendering (the textarea mirror overlay
 * in `prompt-editor.tsx`): a borderless inline icon + label that flows with the
 * surrounding prose — no pill background, no padding, normal weight, body text
 * color, and a 12px icon. Integration icons keep their brand color via
 * {@link getBareIconStyle} (see {@link MentionChipView}); other kinds stay
 * monochrome through the `--text-icon` fallback below.
 *
 * No explicit label color — an element's own explicit `color` always wins over an inherited one
 * regardless of ancestor specificity, so hardcoding `--text-primary` here (redundant with the prose
 * default anyway) would silently override any ambient color a ancestor legitimately sets — a link's
 * blue, or `h6`'s dimmer `--text-secondary` — since a mention is inline content and can appear inside
 * either. Omitting it lets the label inherit correctly in both cases, same fix as `strong`/`em`/`code`
 * in rich-markdown-editor.css.
 */
const CHIP_CLASS =
  'mention-chip mx-px inline-flex items-center gap-1 align-middle leading-[1.5] [&>svg]:size-[12px] [&>svg]:shrink-0 [&>svg]:text-[var(--text-icon)]'

/**
 * Live chip: an entity icon + label matching the chat input's mention rendering. Where the host opted
 * into navigation (the file viewer), Cmd/Ctrl-click routes to the resource; in a modal field it stays
 * inert so a click can't navigate away from an unsaved edit. This view pulls the block registry (for
 * integration brand icons), so it's kept out of the headless {@link MarkdownMention} module.
 */
export function MentionChipView({ node, editor }: ReactNodeViewProps) {
  const router = useRouter()
  const params = useParams()
  const { kind, id, label } = node.attrs as MentionAttrs
  const Icon = mentionIcon(kind, id, label) as StyleableIcon | undefined
  const iconStyle = Icon ? getBareIconStyle(Icon) : undefined
  const navigable = editor.storage.mention?.navigable === true
  const workspaceId = typeof params.workspaceId === 'string' ? params.workspaceId : undefined
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
      {Icon && <Icon style={iconStyle} />}
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
