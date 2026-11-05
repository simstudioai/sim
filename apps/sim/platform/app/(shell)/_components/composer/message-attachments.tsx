'use client'

import { useEffect, useState } from 'react'
import styles from '@/platform/app/(shell)/_components/composer/composer.module.css'
import type { ChatAttachment } from '@/platform/app/(shell)/_components/composer/model'
import { usePlatformTheme } from '@/platform/app/(shell)/_components/session/product-surface'
import { AttachmentGrid } from '@/platform/design-system/components/attachments/attachment-grid'
import { useFileUrl } from '@/platform/design-system/components/attachments/use-file-url'
import { OverlayDialog } from '@/platform/design-system/components/modal/overlay-dialog'
import { useScrollEdges } from '@/platform/design-system/components/scroll-area/use-scroll-edges'

interface MessageAttachmentsProps {
  items: readonly ChatAttachment[]
  onRemove?: (id: string) => void
}

export function MessageAttachments({ items, onRemove }: MessageAttachmentsProps) {
  const [expanded, setExpanded] = useState(false)
  const [preview, setPreview] = useState<ChatAttachment | null>(null)
  const theme = usePlatformTheme()
  if (!items.length) return null
  const batch = items.length > 3
  return (
    <div className={styles.tray}>
      {batch && (
        <button
          type='button'
          className={styles.batch}
          data-type='T060'
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          <span>{items.length} attachments</span>
          <span>{expanded ? 'Show less' : 'Show all'}</span>
        </button>
      )}
      <AttachmentGrid
        label='Attachments'
        attachments={(batch && !expanded ? items.slice(0, 3) : items).map((item) => ({
          id: item.id,
          name: item.name,
          description: item.metadata,
          kind: item.kind === 'image' ? 'image' : item.kind === 'text' ? 'paste' : 'pdf',
          preview: item.source,
          previewFile: item.file,
        }))}
        layout={expanded ? 'list' : 'grid'}
        theme={theme}
        onPreview={(id) => setPreview(items.find((item) => item.id === id) ?? null)}
        onRemove={onRemove}
      />
      <OverlayDialog
        open={preview !== null}
        title={preview?.name ?? 'Attachment'}
        description={preview?.metadata}
        onClose={() => setPreview(null)}
      >
        {preview && <AttachmentPreview key={preview.id} item={preview} />}
      </OverlayDialog>
    </div>
  )
}

interface AttachmentPreviewProps {
  item: ChatAttachment
}
function AttachmentPreview({ item }: AttachmentPreviewProps) {
  const preview = useScrollEdges<HTMLDivElement>()
  const local = useFileUrl(item.file)
  const source = item.source ?? local
  const [text, setText] = useState(item.content)
  useEffect(() => {
    if (item.kind !== 'text' || !item.file) return
    let active = true
    item.file
      .slice(0, 100_000)
      .text()
      .then(
        (content) => {
          if (active) setText(content)
        },
        () => {
          if (active) setText('The file could not be read.')
        }
      )
    return () => {
      active = false
    }
  }, [item])
  return (
    <div ref={preview} className={styles.preview} data-type='T048'>
      {item.kind === 'image' && source ? (
        <img src={source} alt={item.name} />
      ) : item.file?.type === 'application/pdf' && source ? (
        <object data={source} type='application/pdf' aria-label={item.name}>
          <a href={source} download={item.name}>
            Download file
          </a>
        </object>
      ) : (
        <>
          <p>{text ?? item.name}</p>
          {item.file && source && (
            <a href={source} download={item.name}>
              Download file
            </a>
          )}
        </>
      )}
    </div>
  )
}
