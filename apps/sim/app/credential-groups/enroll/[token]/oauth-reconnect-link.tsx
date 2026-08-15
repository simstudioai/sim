'use client'

import { chipVariants } from '@sim/emcn'

interface OAuthConnectLinkProps {
  href: string
  reconnect?: boolean
}

export function OAuthConnectLink({ href, reconnect = false }: OAuthConnectLinkProps) {
  return (
    <a href={href} className={chipVariants()}>
      {reconnect ? 'Reconnect' : 'Connect'}
    </a>
  )
}
