import { LandingCtaLink, type LandingCtaSection } from '@/app/(landing)/components/landing-cta-link'
import { DEMO_HREF, SIGNUP_HREF } from '@/app/(landing)/constants'

const DEMO_LABEL = 'Request a demo'

interface HeroCtaProps {
  /** Standard 36px actions for platform heroes; 40px display actions for the homepage. */
  size?: 'default' | 'display'
  /** Platform and solutions heroes use "Sign up"; the homepage uses "Start building". */
  secondaryLabel?: 'Start building' | 'Sign up'
  /** Reports each click as a `landing_cta_clicked` event under this section. */
  trackingSection?: LandingCtaSection
}

/** Shared filled demo action and outlined self-serve action, stacked on phones. */
export function HeroCta({
  size = 'default',
  secondaryLabel = 'Sign up',
  trackingSection,
}: HeroCtaProps) {
  return (
    <div className='flex items-center gap-2 max-sm:w-full max-sm:flex-col max-sm:items-stretch'>
      <LandingCtaLink
        href={DEMO_HREF}
        size={size}
        withArrow
        track={trackingSection && { label: DEMO_LABEL, section: trackingSection }}
      >
        {DEMO_LABEL}
      </LandingCtaLink>
      <LandingCtaLink
        variant='outline'
        href={SIGNUP_HREF}
        prefetch={false}
        size={size}
        track={trackingSection && { label: secondaryLabel, section: trackingSection }}
      >
        {secondaryLabel}
      </LandingCtaLink>
    </div>
  )
}
