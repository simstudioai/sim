'use client'

import styles from '@/platform/design-system/components/attachments/attachments.module.css'
import { useFileUrl } from '@/platform/design-system/components/attachments/use-file-url'

interface FileThumbnailProps {
  src?: string
  file?: File
}
export function FileThumbnail({ src, file }: FileThumbnailProps) {
  const local = useFileUrl(file)
  const image = src ?? local
  return image ? <img className={styles.thumbnail} src={image} loading='lazy' alt='' /> : null
}
