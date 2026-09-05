import { cn } from '@sim/emcn'
import { LandingCtaLink } from '@/app/(landing)/components/landing-cta-link'
import {
  HOME_INSET,
  HOME_TYPE,
  LANDING_CONTENT_WIDTH,
  LANDING_GUTTER,
} from '@/app/(landing)/components/landing-layout'
import { CertBlocs } from '@/app/(landing)/components/security/components/cert-blocs'

/**
 * The governance beat: the certification claim, the Trust Center link, and the
 * confirmed certifications as three Carbon blocs on the page ground. SOC 2
 * lives only in this certification row. The operational controls grid is its
 * own section under the feature rail — see `WorkspaceControls`.
 */

const TRUST_CENTER_HREF = 'https://trust.sim.ai/'

const OUTBOUND_LINK = {
  target: '_blank',
  rel: 'noopener noreferrer',
} as const

export function Security() {
  return (
    <section
      id='security'
      aria-labelledby='security-heading'
      className={cn('flex w-full flex-col', LANDING_CONTENT_WIDTH, LANDING_GUTTER)}
    >
      <div className={cn('flex flex-col gap-20 max-sm:gap-10 max-lg:gap-14', HOME_INSET)}>
        <div className='flex w-full items-start justify-between gap-10 max-sm:gap-5 max-xl:flex-col'>
          <h2
            id='security-heading'
            className={cn(
              'max-w-[16ch] text-balance text-[var(--text-primary)] md:w-1/2',
              HOME_TYPE.h2
            )}
          >
            Central governance for enterprise AI
          </h2>
          <div className='flex w-[min(28rem,40%)] flex-col items-start max-xl:w-full'>
            <p className={cn('max-w-[34ch] text-pretty text-[var(--text-body)]', HOME_TYPE.lead)}>
              Sim is one place to control who can build agents, what they can use, and how the
              workspace runs.
            </p>
            <LandingCtaLink
              href={TRUST_CENTER_HREF}
              {...OUTBOUND_LINK}
              variant='outline'
              className='mt-5'
            >
              Trust Center
            </LandingCtaLink>
          </div>
        </div>

        <CertBlocs href={TRUST_CENTER_HREF} />
      </div>
    </section>
  )
}
