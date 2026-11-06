'use client'

import { useState } from 'react'
import { Favicon } from '@/components/favicon'
import { Icon } from '@/platform/design-system/components/icon/icon'
import styles from '@/platform/embedded/app/(shell)/_components/site-mark/site-mark.module.css'

interface SiteMarkProps {
  host: string | null
}

/** A site's favicon, held by the globe until it paints and replaced by it when there is none, so a row never shows an empty slot. */
export function SiteMark({ host }: SiteMarkProps) {
  const [loaded, setLoaded] = useState(false)
  return (
    <span className={styles.mark}>
      {!loaded && <Icon name='I041' />}
      <Favicon
        host={host}
        fallback={null}
        className={styles.favicon}
        onLoad={() => setLoaded(true)}
      />
    </span>
  )
}
