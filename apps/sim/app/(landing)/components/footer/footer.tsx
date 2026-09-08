import { cn } from '@sim/emcn'
import Link from 'next/link'
import { ConsentPreferencesTrigger } from '@/app/_shell/consent/consent-preferences-trigger'
import { ALL_COMPETITORS } from '@/app/(landing)/comparisons/utils'
import { FooterWordmarkLoop } from '@/app/(landing)/components/footer/components/footer-wordmark-loop'
import { ThemeToggle } from '@/app/(landing)/components/footer/components/theme-toggle'
import { LANDING_CONTENT_WIDTH, LANDING_GUTTER } from '@/app/(landing)/components/landing-layout'
import { SimWordmark } from '@/app/(landing)/components/navbar/components/sim-wordmark'
import { MODEL_PROVIDERS_WITH_CATALOGS } from '@/app/(landing)/models/utils'

/**
 * Landing footer - the site link directory. Re-authored from the prior landing
 * footer's structure and link content, but on the platform's light tokens and
 * with no cross-import from `(home)`. Fully responsive like the rest of the page
 * - desktop is the baseline, scaled down via `max-*` overrides (7→3→2 columns).
 * The closing CTA lives in its own {@link Cta} section above; this is purely the
 * `<footer>` landmark.
 *
 * The wordmark cell also carries the {@link ThemeToggle} - the site's light/dark
 * switch - tucked under the mark, where a visitor looking for the dark version
 * of the site finds it without it competing with the link directory.
 *
 * Below the link directory, the site signs off on a large centered
 * {@link FooterWordmarkLoop} - the wordmark melting into the thinking loader
 * and back - sitting between the columns and the copyright line the way
 * Legora closes its footer on a giant wordmark. Responsive top spacing gives
 * the mark its own beat after the columns, followed by the copyright line.
 *
 * Carries `SiteNavigationElement` schema for crawlable footer nav. A top
 * hairline separates it from the page and spans the full viewport width
 * (edge-to-edge): the border lives on the full-width `<footer>` landmark while
 * an inner container caps and centers the content at
 * {@link LANDING_CONTENT_WIDTH} with {@link LANDING_GUTTER}, matching every
 * section above.
 */

const LINK_CLASS =
  'text-left text-sm text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]'

interface FooterLinkItem {
  label: string
  href: string
  external?: boolean
}

interface FooterConsentItem {
  label: string
  consentPreferences: true
}

type FooterItem = FooterLinkItem | FooterConsentItem

interface FooterProps {
  showConsentPreferences?: boolean
}

/**
 * Platform modules link to their local landing pages (internal link equity
 * stays on the ranking pages); docs-only surfaces remain external.
 */
const PRODUCT_LINKS: FooterItem[] = [
  { label: 'Overview', href: '/platform' },
  { label: 'Enterprise', href: '/enterprise' },
  { label: 'Chat', href: 'https://docs.sim.ai/mothership', external: true },
  { label: 'Workflows', href: '/workflows' },
  { label: 'Knowledge Base', href: '/knowledge' },
  { label: 'Tables', href: '/tables' },
  { label: 'Files', href: '/files' },
  { label: 'Logs', href: '/logs' },
  { label: 'MCP', href: 'https://docs.sim.ai/agents/mcp', external: true },
  { label: 'API', href: 'https://docs.sim.ai/api-reference/getting-started', external: true },
  { label: 'CLI', href: 'https://docs.sim.ai/cli', external: true },
  { label: 'Self Hosting', href: 'https://docs.sim.ai/platform/self-hosting', external: true },
]

const RESOURCES_LINKS: FooterItem[] = [
  { label: 'Customers', href: '/customers' },
  { label: 'Blog', href: '/blog' },
  { label: 'Docs', href: 'https://docs.sim.ai', external: true },
  { label: 'Library', href: '/library' },
  { label: 'Careers', href: '/careers' },
  { label: 'Changelog', href: '/changelog' },
  { label: 'Contact', href: '/contact' },
  { label: 'Status', href: 'https://status.sim.ai', external: true },
  { label: 'Security', href: 'https://trust.sim.ai', external: true },
]

/** Top model providers, sourced from the catalog so labels/hrefs never drift. */
const MODEL_LINKS: FooterItem[] = [
  { label: 'All Models', href: '/models' },
  ...MODEL_PROVIDERS_WITH_CATALOGS.slice(0, 8).map((provider) => ({
    label: provider.name,
    href: provider.href,
  })),
]

/** Top comparison pages, sourced from the competitor catalog so labels/hrefs never drift. */
const COMPARE_LINKS: FooterItem[] = [
  { label: 'All Comparisons', href: '/comparisons' },
  ...ALL_COMPETITORS.slice(0, 9).map((competitor) => ({
    label: competitor.name,
    href: `/comparisons/${competitor.id}`,
  })),
]

const INTEGRATION_LINKS: FooterItem[] = [
  { label: 'All Integrations', href: '/integrations' },
  { label: 'Slack', href: 'https://docs.sim.ai/integrations/slack', external: true },
  { label: 'GitHub', href: 'https://docs.sim.ai/integrations/github', external: true },
  { label: 'Gmail', href: 'https://docs.sim.ai/integrations/gmail', external: true },
  { label: 'Notion', href: 'https://docs.sim.ai/integrations/notion', external: true },
  { label: 'Salesforce', href: 'https://docs.sim.ai/integrations/salesforce', external: true },
  { label: 'Jira', href: '/integrations/jira' },
  { label: 'Linear', href: 'https://docs.sim.ai/integrations/linear', external: true },
  { label: 'Supabase', href: 'https://docs.sim.ai/integrations/supabase', external: true },
  { label: 'Stripe', href: 'https://docs.sim.ai/integrations/stripe', external: true },
]

const SOCIAL_LINKS: FooterItem[] = [
  { label: 'X (Twitter)', href: 'https://x.com/simdotai', external: true },
  {
    label: 'LinkedIn',
    href: 'https://www.linkedin.com/company/simstudioai/',
    external: true,
  },
  {
    label: 'Slack',
    href: 'https://join.slack.com/t/sim-ott9864/shared_invite/zt-43lp8tc5v-0qrrqHGBKUsvQlpoouH~TA',
    external: true,
  },
  {
    label: 'GitHub',
    href: 'https://github.com/simstudioai/sim',
    external: true,
  },
]

const LEGAL_LINKS: FooterItem[] = [
  { label: 'Terms of Service', href: '/terms' },
  { label: 'Privacy Policy', href: '/privacy' },
  { label: 'Cookie Policy', href: '/cookie-policy' },
]

const CONSENT_PREFERENCES_LINK: FooterConsentItem = {
  label: 'Cookie preferences',
  consentPreferences: true,
}

function FooterColumn({ title, items }: { title: string; items: FooterItem[] }) {
  return (
    <div>
      <h3 className='mb-4 text-[var(--text-primary)] text-sm'>{title}</h3>
      <div className='flex flex-col gap-2.5'>
        {items.map((item) =>
          'consentPreferences' in item ? (
            <ConsentPreferencesTrigger key={item.label} className={LINK_CLASS}>
              {item.label}
            </ConsentPreferencesTrigger>
          ) : item.external ? (
            <a
              key={item.label}
              href={item.href}
              target='_blank'
              rel='noopener noreferrer'
              className={LINK_CLASS}
            >
              {item.label}
            </a>
          ) : (
            <Link key={item.label} href={item.href} className={LINK_CLASS}>
              {item.label}
            </Link>
          )
        )}
      </div>
    </div>
  )
}

export function Footer({ showConsentPreferences = false }: FooterProps) {
  return (
    <footer className='w-full border-[var(--border)] border-t'>
      <div
        className={cn('pt-16 pb-6 max-sm:pb-5 max-lg:pt-12', LANDING_CONTENT_WIDTH, LANDING_GUTTER)}
      >
        <nav
          aria-label='Footer navigation'
          itemScope
          itemType='https://schema.org/SiteNavigationElement'
          className='grid grid-cols-8 gap-x-8 gap-y-10 max-sm:grid-cols-2 max-sm:gap-y-8 max-lg:grid-cols-3'
        >
          <div className='flex flex-col items-start gap-5 max-lg:col-span-full max-lg:mb-2'>
            <Link href='/' aria-label='Sim home' className='flex h-[18px] items-center'>
              <SimWordmark />
            </Link>
            <ThemeToggle />
          </div>

          <FooterColumn title='Product' items={PRODUCT_LINKS} />
          <FooterColumn title='Resources' items={RESOURCES_LINKS} />
          <FooterColumn title='Compare' items={COMPARE_LINKS} />
          <FooterColumn title='Integrations' items={INTEGRATION_LINKS} />
          <FooterColumn title='Models' items={MODEL_LINKS} />
          <FooterColumn title='Socials' items={SOCIAL_LINKS} />
          <FooterColumn
            title='Legal'
            items={
              showConsentPreferences ? [...LEGAL_LINKS, CONSENT_PREFERENCES_LINK] : LEGAL_LINKS
            }
          />
        </nav>

        <FooterWordmarkLoop className='mt-[120px] max-sm:mt-16 max-lg:mt-[88px]' />

        <p className='mt-16 text-[var(--text-secondary)] text-sm'>
          © 2026 Sim. All rights reserved.
        </p>
      </div>
    </footer>
  )
}
