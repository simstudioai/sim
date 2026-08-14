'use client'

import { chipVariants } from '@sim/emcn'

interface OAuthReconnectLinkProps {
  href: string
}

export function OAuthReconnectLink({ href }: OAuthReconnectLinkProps) {
  return (
    <a href={href} className={chipVariants()}>
      Reconnect
    </a>
  )
}
