import styles from '@/platform/design-system/components/attachments/attachments.module.css'
import { FileThumbnail } from '@/platform/design-system/components/attachments/file-thumbnail'
import { IconButton } from '@/platform/design-system/components/button/button'
import { Icon } from '@/platform/design-system/components/icon/icon'
import { OverflowText } from '@/platform/design-system/components/overflow-text/overflow-text'

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
  const content = (
    <>
      <span className={styles.media} data-kind={item.kind}>
        {item.kind === 'image' ? (
          <FileThumbnail src={item.preview} file={item.previewFile} />
        ) : (
          <Icon name={item.kind === 'pdf' ? 'I015' : 'I075'} />
        )}
      </span>
      <span className={styles.copy}>
        <span data-type='T059'>
          <OverflowText text={item.name}>{item.name}</OverflowText>
        </span>
        <span className={styles.caption} data-type='T052'>
          <OverflowText text={item.description}>{item.description}</OverflowText>
        </span>
      </span>
    </>
  )
  return (
    <li className={styles.attachmentItem}>
      {onPreview ? (
        <button
          type='button'
          className={styles.tile}
          aria-label={`Preview ${item.name}`}
          onClick={() => onPreview(item.id)}
        >
          {content}
        </button>
      ) : (
        <div className={styles.tile}>{content}</div>
      )}
      {onRemove && (
        <span className={styles.removeFile}>
          <IconButton
            icon='I105'
            size='compact'
            label={`Remove ${item.name}`}
            onClick={() => onRemove(item.id)}
          />
        </span>
      )}
    </li>
  )
}
