import { cn } from '@sim/emcn'
import { getDocumentIcon } from '@/components/icons/document-icons'
import type { ChatMessageAttachment } from '@/app/workspace/[workspaceId]/home/types'

/**
 * Tile geometry shared with the thumbnail branches so a mixed row stays uniform.
 *
 * The border is load-bearing, not decoration: this renders on both the home transcript
 * (`--bg`) and the workflow chat panel (`--surface-1`), and against the latter the fill
 * is only ~8/255 away in light mode. With an icon-only tile the surface *is* the
 * affordance, so it needs an edge — the same reason the user message bubble pairs
 * `--surface-5` with a border.
 */
const ATTACHMENT_TILE =
  'size-[56px] overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--surface-5)]'

/**
 * A sent document shows only its type icon. The filename was already read in the
 * composer before sending, so repeating it here costs a wide pill in the transcript
 * for information the hover title still carries.
 */
function FileAttachmentTile(props: { mediaType: string; filename: string }) {
  const Icon = getDocumentIcon(props.mediaType, props.filename)
  return (
    <div
      title={props.filename}
      // The icon carries no accessible name on its own, so without these the tile is
      // announced as nothing at all — the filename used to be real text.
      role='img'
      aria-label={props.filename}
      className={cn(ATTACHMENT_TILE, 'flex items-center justify-center text-[var(--text-icon)]')}
    >
      <Icon className='size-[18px]' />
    </div>
  )
}

export function ChatMessageAttachments(props: {
  attachments: ChatMessageAttachment[]
  align?: 'start' | 'end'
  className?: string
}) {
  const { attachments, align = 'end', className } = props

  if (!attachments.length) return null

  return (
    <div
      className={cn(
        'flex flex-wrap gap-[6px]',
        align === 'end' ? 'justify-end' : 'justify-start',
        className
      )}
    >
      {attachments.map((att) => {
        if (!att.previewUrl) {
          return (
            <FileAttachmentTile key={att.id} mediaType={att.media_type} filename={att.filename} />
          )
        }
        const isVideo = att.media_type.startsWith('video/')
        if (isVideo) {
          const Icon = getDocumentIcon(att.media_type, att.filename)
          return (
            <div
              key={att.id}
              title={att.filename}
              role='img'
              aria-label={att.filename}
              className={cn(ATTACHMENT_TILE, 'relative')}
            >
              <div className='absolute inset-0 flex items-center justify-center text-[var(--text-icon)]'>
                <Icon className='size-[18px]' />
              </div>
              <video
                src={att.previewUrl}
                muted
                playsInline
                preload='metadata'
                className='relative size-full object-cover'
              />
            </div>
          )
        }
        return (
          <div key={att.id} className={ATTACHMENT_TILE} title={att.filename}>
            <img src={att.previewUrl} alt={att.filename} className='size-full object-cover' />
          </div>
        )
      })}
    </div>
  )
}
