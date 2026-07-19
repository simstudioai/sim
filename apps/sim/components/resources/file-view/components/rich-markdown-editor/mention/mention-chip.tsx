import type { MouseEvent } from 'react'
import { cn } from '@sim/emcn'
import type { ReactNodeViewProps } from '@tiptap/react'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import { resolveFileCategory } from '@/components/resources/file-view/utils/file-category'
import { useOptionalResourceOfKind } from '@/components/resources/resource-provider'
import { getBareIconStyle, type StyleableIcon } from '@/blocks/icon-color'
import { mentionIcon } from './mention-icon'
import { MarkdownMention, type MentionAttrs } from './mention-node'
import { simLinkPath } from './sim-link'

/**
 * Whether a mentioned file plays rather than links, resolved from the label's
 * extension — the mention already carries the filename, so a player needs no
 * record lookup. Categories come from the same resolver the file view dispatches
 * on, so what plays in a document is exactly what plays when the file is opened.
 */
function mentionMediaKind(kind: string, label: string): 'audio' | 'video' | null {
  if (kind !== 'file') return null
  const category = resolveFileCategory(null, label)
  if (category === 'video-previewable') return 'video'
  if (category === 'audio-previewable') return 'audio'
  return null
}

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
  const resource = useOptionalResourceOfKind('file')
  const { kind, id, label } = node.attrs as MentionAttrs
  const Icon = mentionIcon(kind, id) as StyleableIcon
  const iconStyle = getBareIconStyle(Icon)
  const navigable = editor.storage.mention?.navigable === true
  /**
   * The destination comes from the file this mention is written in, never from
   * the route: on `/f/[token]` there is no `[workspaceId]` segment to read, and
   * a share source resolves every link to `null` so the chip stays inert rather
   * than pointing at a workspace an anonymous visitor cannot reach.
   */
  const path = navigable && resource ? simLinkPath(resource.source, kind, id) : null

  const handleClick = (event: MouseEvent) => {
    if (!path || !(event.metaKey || event.ctrlKey)) return
    event.preventDefault()
    resource?.navigate(path)
  }

  /**
   * A mentioned audio or video file plays in place instead of rendering as a
   * link — seeing the clip is the point of referencing it.
   *
   * Workspace scope only. The bytes come from `/api/files/view/<id>`, which
   * redirects to the byte-serving route, so the player streams and seeks rather
   * than downloading. A share has no equivalent: its inline cascade serves only
   * the raster images the document embeds, and a `sim:` mention is a link the
   * referenced-by-doc gate does not recognise — so a shared document keeps the
   * chip rather than pointing at bytes the token was never granted.
   */
  const mediaKind = mentionMediaKind(kind, label)
  const mediaSrc =
    mediaKind && resource?.source.via === 'workspace'
      ? `/api/files/view/${encodeURIComponent(id)}`
      : null

  if (mediaSrc) {
    return (
      <NodeViewWrapper as='span' className='my-2 block' title={label} contentEditable={false}>
        {mediaKind === 'video' ? (
          /**
           * A reserved 16:9 box, not an intrinsically-sized element. A `<video>`
           * reports 300x150 until its metadata loads, so sizing to the intrinsics
           * would paint a small player and reflow the document around it once the
           * first bytes arrive. The box is fixed from first paint and
           * `object-contain` letterboxes whatever ratio the file turns out to be.
           */
          // biome-ignore lint/a11y/useMediaCaption: video from workspace files
          <video
            src={mediaSrc}
            controls
            preload='metadata'
            className='aspect-video w-full max-w-[640px] rounded-[8px] bg-[var(--surface-1)] object-contain'
          />
        ) : (
          // biome-ignore lint/a11y/useMediaCaption: audio from workspace files
          <audio src={mediaSrc} controls preload='metadata' className='w-full max-w-[480px]' />
        )}
      </NodeViewWrapper>
    )
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
