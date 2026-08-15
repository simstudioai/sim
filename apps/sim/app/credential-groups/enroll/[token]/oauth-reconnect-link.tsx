'use client'

import { chipVariants } from '@sim/emcn'

interface OAuthConnectLinkProps {
  href: string
}

export function OAuthConnectLink({ href }: OAuthConnectLinkProps) {
  return (
    <a href={href} className={chipVariants()}>
      Connect
    </a>
  )
}
