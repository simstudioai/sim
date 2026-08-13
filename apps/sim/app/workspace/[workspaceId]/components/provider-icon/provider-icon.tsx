'use client'

import { cn } from '@sim/emcn'
import { SquareArrowUpRight } from '@sim/emcn/icons'
import { OAUTH_PROVIDERS, type OAuthProvider, parseProvider } from '@/lib/oauth'
import { getBareIconStyle, type StyleableIcon } from '@/blocks/brand-icon-style'

interface ProviderIconProps {
  provider: OAuthProvider
  className?: string
}

/**
 * The mark for an OAuth provider, tinted with the brand colour its block
 * config registers. Credential rows show a bare icon rather than the filled
 * tile the canvas uses, so the colour has to come through `iconColor` — but it
 * still comes from the same registry, which is what keeps a provider looking
 * like itself everywhere it is listed.
 *
 * `OAUTH_PROVIDERS` carries the icon and no colour at all, so rendering
 * straight from it is what left credential surfaces grey while the same
 * service was branded a panel away. Falls back to a generic mark for a
 * provider that map does not know.
 */
export function ProviderIcon({ provider, className }: ProviderIconProps) {
  const { baseProvider } = parseProvider(provider)
  const config = OAUTH_PROVIDERS[baseProvider]

  if (!config) return <SquareArrowUpRight className={className} />

  const Icon = config.icon as StyleableIcon
  return (
    <Icon className={cn('text-[var(--text-icon)]', className)} style={getBareIconStyle(Icon)} />
  )
}
