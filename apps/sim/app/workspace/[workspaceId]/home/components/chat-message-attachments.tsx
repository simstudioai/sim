import { getDocumentIcon } from '@/components/icons/document-icons'
import { cn } from '@/lib/core/utils/cn'
import type { ChatMessageAttachment } from '../types'

function FileAttachmentPill(props: { mediaType: string; filename: string }) {
  const Icon = getDocumentIcon(props.mediaType, props.filename)
  return (
    <div className='flex max-w-[140px] items-center gap-[5px] rounded-[10px] bg-[var(--surface-5)] px-[6px] py-[3px]'>
      <Icon className='h-[14px] w-[14px] flex-shrink-0 text-[var(--text-icon)]' />
      <span className='truncate text-[11px] text-[var(--text-body)]'>{props.filename}</span>
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
        const isImage = att.media_type.startsWith('image/')
        return isImage && att.previewUrl ? (
          <div key={att.id} className='h-[56px] w-[56px] overflow-hidden rounded-[8px]'>
            <img src={att.previewUrl} alt={att.filename} className='h-full w-full object-cover' />
          </div>
        ) : (
          <FileAttachmentPill key={att.id} mediaType={att.media_type} filename={att.filename} />
        )
      })}
    </div>
  )
}
