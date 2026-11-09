'use client'

import { useState } from 'react'
import { Icon } from '@sim/emcn/icon'
import styles from '@/app/(product)/_components/links-page/links-page.module.css'

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
