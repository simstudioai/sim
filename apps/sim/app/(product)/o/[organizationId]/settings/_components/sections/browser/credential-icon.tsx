'use client'

import { useState } from 'react'
import { Icon } from '@sim/emcn/icon'
import styles from '@/app/(product)/o/[organizationId]/settings/_components/sections/browser/browser.module.css'

/** Uses only imported PNG data; fetching a logo would disclose a saved-login site. */
export function CredentialIcon({ icon }: { icon?: string }) {
  const [failedIcon, setFailedIcon] = useState<string>()
  if (!icon?.startsWith('data:image/png;base64,') || icon === failedIcon)
    return <Icon name='I137' />
  return <img className={styles.icon} src={icon} alt='' onError={() => setFailedIcon(icon)} />
}
