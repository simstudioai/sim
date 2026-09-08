import { ChipLink, cn } from '@sim/emcn'
import Link from 'next/link'
import { LandingCtaLink } from '@/app/(landing)/components/landing-cta-link'
import { LANDING_CONTENT_WIDTH, LANDING_GUTTER } from '@/app/(landing)/components/landing-layout'
import {
  AnnouncementBanner,
  GitHubChip,
  LogoMark,
  MobileNav,
  NAV_MENUS,
  NavbarAuthPill,
  NavbarShell,
  NavMenuCluster,
  SimWordmark,
} from '@/app/(landing)/components/navbar/components'
import { DEMO_HREF } from '@/app/(landing)/constants'

/**
 * Shared landing navigation with centered product links, a divided account pill
 * for Log in and Start building, and the filled demo CTA.
 * Below `xl`, the mobile sheet keeps the wider auth cluster clear of navigation
 * links. The shell owns sticky positioning, menu state, and the frosted surface.
 */

interface NavbarProps {
  /**
   * Formatted GitHub star count (e.g. "28.8k"), fetched server-side at
   * build/revalidate time. Omitted by non-marketing shells that reuse this
   * navbar without a stars fetch (the GitHub chip is hidden when absent).
   */
  stars?: string
}

export function Navbar({ stars }: NavbarProps) {
  return (
    <NavbarShell>
      <AnnouncementBanner />
      <nav
        aria-label='Primary navigation'
        itemScope
        itemType='https://schema.org/SiteNavigationElement'
        className={cn(
          'relative flex items-center justify-between py-4',
          LANDING_CONTENT_WIDTH,
          LANDING_GUTTER
        )}
      >
        <Link
          href='/'
          aria-label='Sim home'
          itemProp='url'
          className='relative z-10 flex h-[30px] shrink-0 items-center'
        >
          <span itemProp='name' className='sr-only'>
            Sim
          </span>
          <LogoMark>
            <SimWordmark />
          </LogoMark>
        </Link>

        <div className='absolute inset-x-0 hidden items-center justify-center gap-1 xl:flex'>
          <NavMenuCluster menus={NAV_MENUS} />
          <div className='relative z-10 flex items-center gap-1'>
            <ChipLink href='/pricing' itemProp='url' shape='round' className='px-3'>
              Pricing
            </ChipLink>
            {stars !== undefined && <GitHubChip stars={stars} />}
          </div>
        </div>

        <div className='relative z-10 hidden shrink-0 items-center gap-2 xl:flex'>
          <NavbarAuthPill />
          <LandingCtaLink href={DEMO_HREF} size='compact' withArrow>
            Request a demo
          </LandingCtaLink>
        </div>

        <MobileNav stars={stars ?? '0'} />
      </nav>
    </NavbarShell>
  )
}
