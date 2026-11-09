'use client'
import { AuthLinkButton, type AuthLinkButtonProps } from '@sim/emcn-auth/button'

interface OAuthConnectLinkProps extends Pick<AuthLinkButtonProps, 'variant'> {
  href: string
  reconnect?: boolean
}
export function OAuthConnectLink({ href, reconnect = false, variant }: OAuthConnectLinkProps) {
  return (
    <AuthLinkButton href={href} variant={variant}>
      {reconnect ? 'Reconnect' : 'Connect'}
    </AuthLinkButton>
  )
}
