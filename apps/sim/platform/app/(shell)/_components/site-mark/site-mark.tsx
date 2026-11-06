'use client'

import { useState } from 'react'
import { Favicon } from '@/components/favicon'
import styles from '@/platform/app/(shell)/_components/site-mark/site-mark.module.css'
import { Icon } from '@/platform/design-system/components/icon/icon'

interface SiteMarkProps {
  host: string | null
  /** An icon already in hand, which takes the place of looking one up. */
  iconUrl?: string
}

/**
 * A site's favicon, held by the globe until it paints and replaced by it when there is none, so a
 * row never shows an empty slot.
 */
export function SiteMark({ host, iconUrl }: SiteMarkProps) {
  const [loaded, setLoaded] = useState(false)
  return (
    <span className={styles.mark}>
      {iconUrl ? (
        <img src={iconUrl} alt='' className={styles.favicon} />
      ) : (
        <>
          {!loaded && <Icon name='I041' />}
          <Favicon
            host={host}
            fallback={null}
            className={styles.favicon}
            onLoad={() => setLoaded(true)}
          />
        </>
      )}
    </span>
  )
}
