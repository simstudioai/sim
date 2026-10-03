import { cn } from '@sim/emcn'
import {
  AgentMomentum,
  FeaturedCustomer,
  Features,
  Hero,
  HomeStructuredData,
  PlatformSuite,
  ProductDemo,
  Proof,
  Security,
  WorkspaceControls,
} from '@/app/(landing)/components'
import { HOME_SECTION_RHYTHM } from '@/app/(landing)/components/landing-layout'
import { LandingAnalytics } from '@/app/(landing)/landing-analytics'

/**
 * Landing page root - owns the section order and the `<main>` content region.
 *
 * The shared chrome (`light` + brand token layer, scroll port, skip link, navbar
 * with build/revalidate-time GitHub stars, painted CTA, footer, and site-wide JSON-LD) is
 * owned by the route-group layout via `LandingShell`, so the landing family can
 * never drift and the navbar persists across navigation. This page emits only
 * its `<main>` and the home-specific structured data.
 *
 * Section order copies Harvey's homepage:
 *
 * 1. {@link Hero} - split masthead and full-width product stage.
 * 2. {@link Proof} - customer-logo row.
 * 3. {@link FeaturedCustomer} - featured customer film carousel.
 * 4. {@link AgentMomentum} - editorial proof points for the open-source agent ecosystem.
 * 5. {@link PlatformSuite} - creation and centralized-governance windows.
 * 6. {@link ProductDemo} - the demo player, grouped with the platform cards.
 * 7. {@link Features} - the horizontal product rail.
 * 8. {@link WorkspaceControls} - the rail's six governance controls, untitled.
 * 9. {@link Security} - governance intro, Trust Center link, certification blocs.
 *
 * `<main>` is a `flex flex-col` whose `gap` is the single source of truth for
 * major-section rhythm. Customer proof, platform media, and product controls
 * each form a group with their own smaller positive gap.
 */
export default function Landing() {
  return (
    <main id='main-content' className={cn('flex flex-col', HOME_SECTION_RHYTHM)}>
      <LandingAnalytics />
      <HomeStructuredData />
      <div className='flex flex-col gap-24 max-sm:gap-12 max-lg:gap-16'>
        <Hero />
        <div className='flex flex-col gap-16 max-sm:gap-10 max-lg:gap-12'>
          <Proof />
          <div className='flex flex-col gap-7 max-lg:gap-4'>
            <FeaturedCustomer />
            <AgentMomentum />
          </div>
        </div>
      </div>
      {/* The demo frame belongs to the platform section: it follows the two
        cards at the cards' own gap and shares their inset, so the three read
        as one grid. The `<main>` rhythm applies around the group, and nothing
        else may join it - the frame's inset assumes the cards directly above. */}
      <div className='flex flex-col gap-4'>
        <PlatformSuite />
        <ProductDemo />
      </div>
      <div className='flex flex-col gap-20 max-sm:gap-12 max-lg:gap-16'>
        <Features />
        <WorkspaceControls />
      </div>
      <Security />
    </main>
  )
}
