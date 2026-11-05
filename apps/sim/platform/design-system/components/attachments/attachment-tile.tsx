import styles from '@/platform/design-system/components/attachments/attachments.module.css'
import { FileThumbnail } from '@/platform/design-system/components/attachments/file-thumbnail'
import { IconButton } from '@/platform/design-system/components/button/button'
import { ControlRow } from '@/platform/design-system/components/button/control-row'

export type AttachmentItem = {
  id: string
  name: string
  description: string
  previewFile?: File
} & ({ kind: 'image'; preview?: string } | { kind: 'paste' | 'pdf' })

interface AttachmentTileProps {
  item: AttachmentItem
  onPreview?: (id: string) => void
  onRemove?: (id: string) => void
}

export function AttachmentTile({ item, onPreview, onRemove }: AttachmentTileProps) {
  const hasImage = item.kind === 'image' && (item.preview || item.previewFile)
  return (
    <li className={styles.attachmentItem}>
      <ControlRow
        label={item.name}
        accessibleLabel={onPreview ? `Preview ${item.name}` : undefined}
        icon={item.kind === 'paste' ? 'I075' : 'I015'}
        leading={
          hasImage ? <FileThumbnail src={item.preview} file={item.previewFile} /> : undefined
        }
        render={
          onPreview ? (
            <button
              type='button'
              aria-description={item.description}
              onClick={() => onPreview(item.id)}
            />
          ) : (
            <span aria-description={item.description} />
          )
        }
        action={
          onRemove && (
            <IconButton
              icon='I105'
              size='compact'
              label={`Remove ${item.name}`}
              onClick={() => onRemove(item.id)}
            />
          )
        }
      />
    </li>
  )
}
