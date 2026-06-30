'use client'

import { ChipLink } from '@sim/emcn'
import { ArrowRight } from 'lucide-react'
import type { PlatformPillCta as PlatformPillCtaConfig } from '@/app/(landing)/components/platform-page/types'

/**
 * The card-row pill CTA - a single primary `ChipLink` with a trailing arrow,
 * matching the reference image's "Learn about automations →". The chip owns its
 * own chrome and spacing; this component only wires the label, the href, and the
 * arrow icon, exposing no layout knobs.
 *
 * Client leaf: `ChipLink` is a Client Component and its `rightIcon` is a
 * component reference (`ArrowRight`), which cannot cross the server→client
 * boundary as a prop - so the icon must be wired from client code, exactly as the
 * navbar's `NavMenuChip` does. The props it receives ({@link PlatformPillCtaConfig})
 * are plain serializable data, so the surrounding layout stays Server Components.
 *
 * Link safety: an external href (absolute `http(s)://`) renders with
 * `rel='noopener noreferrer'` and `target='_blank'`; an internal href routes
 * through the Next `<Link>` that `ChipLink` is built on - so every link is
 * crawlable and safe with no per-page ceremony.
 */

interface PlatformPillCtaProps {
  cta: PlatformPillCtaConfig
}

/** Returns true for absolute external URLs (http/https), which need rel/target hardening. */
function isExternalHref(href: string): boolean {
  return /^https?:\/\//.test(href)
}

export function PlatformPillCta({ cta }: PlatformPillCtaProps) {
  const external = isExternalHref(cta.href)

  return (
    <ChipLink
      variant='primary'
      href={cta.href}
      rightIcon={ArrowRight}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
    >
      {cta.label}
    </ChipLink>
  )
}
