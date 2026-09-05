'use client'

import { useState } from 'react'
import { Key } from '@sim/emcn/icons'

interface BrowserCredentialIconProps {
  icon?: string
}

/** Uses only imported PNG data; fetching a logo would disclose a saved-login site. */
export function BrowserCredentialIcon({ icon }: BrowserCredentialIconProps) {
  const [failedIcon, setFailedIcon] = useState<string>()

  if (!icon?.startsWith('data:image/png;base64,') || icon === failedIcon) {
    return <Key className='size-5 text-[var(--text-icon)]' />
  }

  return (
    <img
      src={icon}
      alt=''
      className='size-full object-contain'
      onError={() => setFailedIcon(icon)}
    />
  )
}
