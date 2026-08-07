import { cn } from '@sim/emcn'
import { getDocumentIcon } from '@/components/icons/document-icons'
import type { ChatMessageAttachment } from '@/app/workspace/[workspaceId]/home/types'

function FileAttachmentPill(props: { mediaType: string; filename: string }) {
  const Icon = getDocumentIcon(props.mediaType, props.filename)
  return (
    <div className='flex max-w-[140px] items-center gap-[5px] rounded-lg bg-[var(--surface-5)] px-[6px] py-[3px]'>
      <Icon className='size-[14px] shrink-0 text-[var(--text-icon)]' />
      <span className='truncate text-[var(--text-body)] text-xs'>{props.filename}</span>
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
            <FileAttachmentPill key={att.id} mediaType={att.media_type} filename={att.filename} />
          )
        }
        const isVideo = att.media_type.startsWith('video/')
        if (isVideo) {
          const Icon = getDocumentIcon(att.media_type, att.filename)
          return (
            <div
              key={att.id}
              className='relative size-[56px] overflow-hidden rounded-lg bg-[var(--surface-5)]'
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
          <div key={att.id} className='size-[56px] overflow-hidden rounded-lg'>
            <img src={att.previewUrl} alt={att.filename} className='size-full object-cover' />
          </div>
        )
      })}
    </div>
  )
}
