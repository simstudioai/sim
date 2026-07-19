import type { ReactNode } from 'react'
import { ChipLink, chipContentLabelClass, chipGeometryClass, cn } from '@sim/emcn'
import Link from 'next/link'
import {
  GitHubChip,
  LogoMark,
  MobileNav,
  NAV_MENUS,
  NavbarShell,
  NavMenuChip,
  SimWordmark,
} from '@/app/(landing)/components/navbar/components'
import { DEMO_HREF, SIGNUP_HREF } from '@/app/(landing)/constants'

/**
 * The single navbar for every public surface — the landing marketing bar and,
 * via {@link logoOnly}, the minimal header every non-marketing surface wears
 * (auth, 404, shared file / interface). One component so the brand mark, geometry,
 * and hover behaviour can never drift between surfaces; the only differences are
 * what is presented (mega-menus vs a static resource name) and whether CTAs show.
 *
 * Sticky `<header><nav>` landmark with `SiteNavigationElement` schema.org
 * markup. Server Component - the dropdown triggers, GitHub chip, and the
 * {@link NavbarShell} (which frosts the bar to glass on scroll) are isolated
 * client leaves, so the wordmark and links stay zero-hydration, crawlable HTML.
 *
 * Every item is a bare emcn chip. Both clusters use `gap-1`, which with
 * the chips' own `mx-0.5` margins yields 8px between pills; the nav's
 * `gap-3.5` (14px) plus the first chip's 2px margin puts exactly 16px -
 * twice the inter-chip gap - between the wordmark and the first menu chip. The
 * {@link logoOnly} resource {@link name} wears the same `mx-0.5` + chip geometry,
 * so it sits at that identical 16px offset from the wordmark, in nav-item type -
 * just not clickable. On the marketing bar and the bare logo-only shells the
 * content is capped and centered at the shared `max-w-[1460px]` with an `px-20`
 * (80px) gutter, so the wordmark aligns with the contained section content on
 * wide screens - the frosted `<header>` shell stays full-bleed. A named resource
 * navbar instead goes full-bleed at a `px-6` (24px) gutter, just inside the
 * module's 16px content edge below it (see `contentAligned`). It keeps the `pt-4`
 * (16px) top and drops the bottom padding (`pb-0`), so the module's own 16px
 * `p-4` is the only gap below - leaving 16px above the wordmark and 16px below
 * it, symmetric, without shifting the bar up. Text weight is the platform
 * default (400).
 *
 * Layout (left → right): Sim wordmark (18px glyph centered in a
 * chip-height slot, chip-text color) → the {@link NAV_MENUS} mega-menus
 * (pure-CSS hover/focus dropdowns) → Pricing → GitHub stars. Right side: Log in
 * (default chip), Contact sales (outline chip), Sign up (filled chip).
 * Enterprise lives inside the Resources mega-menu, not as a standalone chip.
 */

interface NavbarProps {
  /**
   * Formatted GitHub star count (e.g. "28.8k"), fetched server-side at
   * build/revalidate time. Omitted by non-marketing shells that reuse this
   * navbar without a stars fetch (the GitHub chip is hidden when absent).
   */
  stars?: string
  /**
   * Minimal mode: drop the marketing navigation (mega-menus, GitHub chip, auth
   * CTAs, mobile sheet) and render only the wordmark, optionally followed by a
   * static {@link name}. Every non-marketing surface (auth, 404, shared file /
   * interface) renders the navbar this way.
   */
  logoOnly?: boolean
  /**
   * A resource label (a shared file / interface name, a deployed chat title)
   * shown beside the wordmark in the exact nav-item style, but NOT clickable —
   * the div is kept for spacing, without the hover/link chrome. Only rendered in
   * {@link logoOnly} mode.
   */
  name?: string
  /**
   * A leading adornment rendered inside the {@link name} pill (e.g. a deployed
   * chat's custom logo image). Sits on the brand side, before the label, at the
   * canonical chip icon↔label gap. Only rendered in {@link logoOnly} mode.
   */
  nameIcon?: ReactNode
  /**
   * A secondary label after the {@link name} (e.g. "Shared by Ada") — a second
   * static nav-item, styled identically to the name, giving the resource's
   * provenance. Only rendered in {@link logoOnly} mode.
   */
  meta?: string
  /**
   * Whitelabel: hide the Sim wordmark when a custom brand logo is configured,
   * leaving just the {@link name}. Only meaningful in {@link logoOnly} mode; the
   * caller reads `brand.logoUrl`, so this stays a Server Component.
   */
  hideBrand?: boolean
  /**
   * Right-aligned actions for {@link logoOnly} mode (e.g. a file viewer's
   * Download chip) — the minimal surfaces' equivalent of the marketing CTAs.
   */
  actions?: ReactNode
}

export function Navbar({
  stars,
  logoOnly = false,
  name,
  nameIcon,
  meta,
  hideBrand = false,
  actions,
}: NavbarProps) {
  /**
   * A named resource navbar (shared file / interface / chat) drops the centered
   * landing gutter and goes full-bleed at the `px-6` (24px) content gutter — see
   * the class list below and the component TSDoc. Bare logo-only shells (auth,
   * 404) and the marketing bar keep the landing gutter.
   */
  const contentAligned = logoOnly && Boolean(name)

  return (
    <NavbarShell>
      <nav
        aria-label='Primary navigation'
        itemScope
        itemType='https://schema.org/SiteNavigationElement'
        className={cn(
          'relative flex w-full items-center gap-3.5',
          contentAligned
            ? 'px-6 pt-4 pb-0'
            : 'mx-auto max-w-[1460px] px-20 py-4 max-sm:px-5 max-lg:px-8'
        )}
      >
        {!hideBrand && (
          <Link
            href='/'
            aria-label='Sim home'
            itemProp='url'
            prefetch={false}
            className='flex h-[30px] items-center'
          >
            <span itemProp='name' className='sr-only'>
              Sim
            </span>
            <LogoMark>
              <SimWordmark />
            </LogoMark>
          </Link>
        )}

        {logoOnly ? (
          <>
            {name || nameIcon || meta ? (
              <div className='flex min-w-0 items-center gap-1'>
                {name || nameIcon ? (
                  <span className={cn(chipGeometryClass, 'mx-0.5 inline-flex min-w-0')}>
                    {nameIcon}
                    {name ? <span className={chipContentLabelClass}>{name}</span> : null}
                  </span>
                ) : null}
                {meta ? (
                  <span className={cn(chipGeometryClass, 'mx-0.5 inline-flex min-w-0')}>
                    <span className={chipContentLabelClass}>{meta}</span>
                  </span>
                ) : null}
              </div>
            ) : null}
            {actions ? (
              <div className='ml-auto flex shrink-0 items-center gap-1'>{actions}</div>
            ) : null}
          </>
        ) : (
          <>
            <div className='hidden items-center gap-1 lg:flex'>
              {NAV_MENUS.map((menu) => (
                <NavMenuChip key={menu.label} menu={menu} />
              ))}
              <ChipLink href='/pricing' itemProp='url'>
                Pricing
              </ChipLink>
              {stars !== undefined && <GitHubChip stars={stars} />}
            </div>

            <div className='ml-auto hidden items-center gap-1 lg:flex'>
              <ChipLink href='/login' prefetch={false}>
                Log in
              </ChipLink>
              <ChipLink variant='border' href={DEMO_HREF}>
                Contact sales
              </ChipLink>
              <ChipLink variant='primary' href={SIGNUP_HREF} prefetch={false}>
                Sign up
              </ChipLink>
            </div>

            <MobileNav stars={stars ?? '0'} />
          </>
        )}
      </nav>
    </NavbarShell>
  )
}
