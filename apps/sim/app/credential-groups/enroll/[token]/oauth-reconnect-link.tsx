'use client'

import { type ChipLinkProps, chipVariants } from '@sim/emcn'

interface OAuthConnectLinkProps extends Pick<ChipLinkProps, 'variant'> {
  href: string
  reconnect?: boolean
}

export function OAuthConnectLink({ href, reconnect = false, variant }: OAuthConnectLinkProps) {
  return (
    <a href={href} className={chipVariants({ variant })}>
      {reconnect ? 'Reconnect' : 'Connect'}
    </a>
  )
}
