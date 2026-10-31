'use client'

import { useState } from 'react'
import { Globe } from '@sim/emcn/icons'
import { faviconUrl } from '@/lib/core/utils/favicon'
import { simLinkOrigin } from '@/lib/sim-links/validation'

interface SimLinkIconProps {
  /** The link's destination; a variable link's `{*}` never changes its host. */
  url: string
}

/** The destination site's favicon, or a globe when the site has none. */
export function SimLinkIcon({ url }: SimLinkIconProps) {
  const [failedHostname, setFailedHostname] = useState<string | null>(null)
  const origin = simLinkOrigin(url)
  const hostname = origin ? new URL(origin).hostname : null
  if (!hostname || failedHostname === hostname) return <Globe />
  return (
    <img
      src={faviconUrl(hostname, 64)}
      alt=''
      referrerPolicy='no-referrer'
      loading='lazy'
      decoding='async'
      className='rounded-sm'
      onError={() => setFailedHostname(hostname)}
    />
  )
}
