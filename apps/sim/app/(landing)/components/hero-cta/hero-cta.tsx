import { LandingCtaLink } from '@/app/(landing)/components/landing-cta-link'
import { DEMO_HREF, SIGNUP_HREF } from '@/app/(landing)/constants'

interface HeroCtaProps {
  /** Standard 36px actions for platform heroes; 40px display actions for the homepage. */
  size?: 'default' | 'display'
  /** Platform and solutions heroes use "Sign up"; the homepage uses "Start building". */
  secondaryLabel?: 'Start building' | 'Sign up'
}

/** Shared filled demo action and outlined self-serve action, stacked on phones. */
export function HeroCta({ size = 'default', secondaryLabel = 'Sign up' }: HeroCtaProps) {
  return (
    <div className='flex items-center gap-2 max-sm:w-full max-sm:flex-col max-sm:items-stretch'>
      <LandingCtaLink href={DEMO_HREF} size={size} withArrow>
        Request a demo
      </LandingCtaLink>
      <LandingCtaLink variant='outline' href={SIGNUP_HREF} prefetch={false} size={size}>
        {secondaryLabel}
      </LandingCtaLink>
    </div>
  )
}
