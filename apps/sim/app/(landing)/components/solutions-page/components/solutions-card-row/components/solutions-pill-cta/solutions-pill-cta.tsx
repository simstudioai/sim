'use client'

import { ArrowRight } from '@sim/emcn/icons'
import { LandingCtaLink } from '@/app/(landing)/components/landing-cta-link'
import type { SolutionsPillCta as SolutionsPillCtaConfig } from '@/app/(landing)/components/solutions-page/types'

/**
 * The card-row pill CTA - a single primary `LandingCtaLink` with a trailing arrow,
 * matching the reference image's "Learn about automations →". The shared landing CTA owns its
 * pill geometry and chip colors; this component only wires the label, the href, and the
 * arrow icon, exposing no layout knobs.
 *
 * Client leaf: `ChipLink` is a Client Component and its `rightIcon` is a
 * component reference (`ArrowRight`), which cannot cross the server→client
 * boundary as a prop - so the icon must be wired from client code, exactly as the
 * navbar's `NavMenuCluster` does. The props it receives ({@link SolutionsPillCtaConfig})
 * are plain serializable data, so the surrounding layout stays Server Components.
 *
 * Link safety (external `rel`/`target`, internal Next `<Link>`) is owned by
 * `LandingCtaLink`, so every link is crawlable and safe with no per-page ceremony.
 */

interface SolutionsPillCtaProps {
  cta: SolutionsPillCtaConfig
}

export function SolutionsPillCta({ cta }: SolutionsPillCtaProps) {
  return (
    <LandingCtaLink size='compact' href={cta.href} rightIcon={ArrowRight}>
      {cta.label}
    </LandingCtaLink>
  )
}
