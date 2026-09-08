import { cn } from '@sim/emcn'
import { HeroAnnouncementChip } from '@/app/(landing)/components/hero/components/hero-announcement-chip'
import { LandingHeroHeader } from '@/app/(landing)/components/hero/components/hero-header'
import { HeroPlatformStage } from '@/app/(landing)/components/hero/components/hero-platform-stage'
import {
  HOME_INSET,
  LANDING_CONTENT_WIDTH,
  LANDING_GUTTER,
} from '@/app/(landing)/components/landing-layout'

/**
 * Landing hero - the only `<h1>` on the page.
 *
 * A wide split masthead places the headline at the leading edge and pairs it
 * with supporting copy and the primary action on the trailing side, above a
 * product UI aligned to the same inset container.
 *
 * The live preview keeps its native 1280×735 aspect ratio inside a wider
 * painted frame that shares the customer carousel's content width.
 */
export function Hero() {
  return (
    <section
      id='hero'
      aria-labelledby='hero-heading'
      className={cn(
        'flex flex-col items-start pt-24 text-left max-sm:pt-14 max-xl:pt-20',
        LANDING_CONTENT_WIDTH,
        LANDING_GUTTER
      )}
    >
      <p className='sr-only'>
        Sim is the open-source AI workspace where teams build, deploy, and manage AI agents for
        their organization. Connect hundreds of integrations and every major LLM, then govern
        access, spend, data, and deployment from one place. Build visually, conversationally, or
        with code, and run Sim in your own cloud.
      </p>

      <div className={HOME_INSET}>
        <LandingHeroHeader
          scale='home'
          headingId='hero-heading'
          eyebrow={<HeroAnnouncementChip />}
          heading={
            <>
              Build and govern
              <br />
              every AI agent in one place
            </>
          }
          description='Build, deploy, and manage AI agents with central control over access, spend, and data.'
        />
      </div>

      <HeroPlatformStage />
    </section>
  )
}
