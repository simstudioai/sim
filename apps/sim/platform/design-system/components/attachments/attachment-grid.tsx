import {
  type AttachmentItem,
  AttachmentTile,
} from '@/platform/design-system/components/attachments/attachment-tile'
import styles from '@/platform/design-system/components/attachments/attachments.module.css'
import { ScrollArea } from '@/platform/design-system/components/scroll-area/scroll-area'

interface AttachmentGridProps {
  label: string
  attachments: readonly AttachmentItem[]
  layout?: 'grid' | 'list'
  onPreview?: (id: string) => void
  onRemove?: (id: string) => void
}

export function AttachmentGrid({
  label,
  attachments,
  onPreview,
  onRemove,
  layout = 'grid',
}: AttachmentGridProps) {
  const content = (
    <ul className={styles.attachmentItems} aria-label={label} data-layout={layout}>
      {attachments.map((item) => (
        <AttachmentTile key={item.id} item={item} onPreview={onPreview} onRemove={onRemove} />
      ))}
    </ul>
  )
  return layout === 'list' ? (
    <div className={styles.attachmentViewport}>
      <ScrollArea label={label}>{content}</ScrollArea>
    </div>
  ) : (
    content
  )
}
