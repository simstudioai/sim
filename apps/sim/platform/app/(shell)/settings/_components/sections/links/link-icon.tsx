'use client'

import { useState } from 'react'
import styles from '@/platform/app/(shell)/settings/_components/sections/links/links-section.module.css'
import { Icon } from '@/platform/design-system/components'

/** The destination's favicon through Sim's own route, or a globe when it has none. */
export function LinkIcon({ src }: { src: string | null }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  if (!src || failedSrc === src) return <Icon name='I041' />
  return (
    <img
      className={styles.favicon}
      src={src}
      alt=''
      loading='lazy'
      decoding='async'
      onError={() => setFailedSrc(src)}
    />
  )
}
