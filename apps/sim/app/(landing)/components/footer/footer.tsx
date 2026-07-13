import Link from 'next/link'
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
 * Carries `SiteNavigationElement` schema for crawlable footer nav. A top
 * hairline separates it from the page and spans the full viewport width
 * (edge-to-edge): the border lives on the full-width `<footer>` landmark while
 * an inner container caps and centers the content at the shared
 * `max-w-[1460px]` with the same `px-20` gutter as every section above.
 */

const LINK_CLASS =
  'text-sm text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]'

interface FooterItem {
  label: string
  href: string
  external?: boolean
}

const PRODUCT_LINKS: FooterItem[] = [
  { label: 'Enterprise', href: '/enterprise' },
  { label: 'Mothership', href: 'https://docs.sim.ai/mothership', external: true },
  { label: 'Workflows', href: 'https://docs.sim.ai', external: true },
  { label: 'Knowledge Base', href: 'https://docs.sim.ai/knowledgebase', external: true },
  { label: 'Tables', href: 'https://docs.sim.ai/tables', external: true },
  { label: 'MCP', href: 'https://docs.sim.ai/agents/mcp', external: true },
  { label: 'API', href: 'https://docs.sim.ai/api-reference/getting-started', external: true },
  { label: 'Self Hosting', href: 'https://docs.sim.ai/platform/self-hosting', external: true },
  { label: 'Status', href: 'https://status.sim.ai', external: true },
]

const RESOURCES_LINKS: FooterItem[] = [
  { label: 'Blog', href: '/blog' },
  { label: 'Docs', href: 'https://docs.sim.ai', external: true },
  { label: 'Compare', href: '/comparisons' },
  { label: 'Careers', href: '/careers' },
  { label: 'Changelog', href: '/changelog' },
  { label: 'Contact', href: '/contact' },
]

/** Top model providers, sourced from the catalog so labels/hrefs never drift. */
const MODEL_LINKS: FooterItem[] = [
  { label: 'All Models', href: '/models' },
  ...MODEL_PROVIDERS_WITH_CATALOGS.slice(0, 8).map((provider) => ({
    label: provider.name,
    href: provider.href,
  })),
]

const BLOCK_LINKS: FooterItem[] = [
  { label: 'Agent', href: 'https://docs.sim.ai/workflows/blocks/agent', external: true },
  { label: 'Router', href: 'https://docs.sim.ai/workflows/blocks/router', external: true },
  { label: 'Function', href: 'https://docs.sim.ai/workflows/blocks/function', external: true },
  { label: 'Condition', href: 'https://docs.sim.ai/workflows/blocks/condition', external: true },
  { label: 'API Block', href: 'https://docs.sim.ai/workflows/blocks/api', external: true },
  { label: 'Workflow', href: 'https://docs.sim.ai/workflows/blocks/workflow', external: true },
  { label: 'Parallel', href: 'https://docs.sim.ai/workflows/blocks/parallel', external: true },
  { label: 'Guardrails', href: 'https://docs.sim.ai/workflows/blocks/guardrails', external: true },
  { label: 'Evaluator', href: 'https://docs.sim.ai/workflows/blocks/evaluator', external: true },
  { label: 'Loop', href: 'https://docs.sim.ai/workflows/blocks/loop', external: true },
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
  { label: 'Discord', href: 'https://discord.gg/Hr4UWYEcTT', external: true },
  {
    label: 'GitHub',
    href: 'https://github.com/simstudioai/sim',
    external: true,
  },
]

const LEGAL_LINKS: FooterItem[] = [
  { label: 'Terms of Service', href: '/terms' },
  { label: 'Privacy Policy', href: '/privacy' },
]

function FooterColumn({ title, items }: { title: string; items: FooterItem[] }) {
  return (
    <div>
      <h3 className='mb-4 text-[var(--text-primary)] text-sm'>{title}</h3>
      <div className='flex flex-col gap-2.5'>
        {items.map(({ label, href, external }) =>
          external ? (
            <a
              key={label}
              href={href}
              target='_blank'
              rel='noopener noreferrer'
              className={LINK_CLASS}
            >
              {label}
            </a>
          ) : (
            <Link key={label} href={href} className={LINK_CLASS}>
              {label}
            </Link>
          )
        )}
      </div>
    </div>
  )
}

export function Footer() {
  return (
    <footer className='mt-[120px] w-full border-[var(--border)] border-t max-sm:mt-16 max-lg:mt-[88px]'>
      <div className='mx-auto w-full max-w-[1460px] px-20 pt-16 pb-16 max-sm:px-5 max-lg:px-8 max-lg:pt-12 max-lg:pb-12'>
        <nav
          aria-label='Footer navigation'
          itemScope
          itemType='https://schema.org/SiteNavigationElement'
          className='grid grid-cols-8 gap-x-8 gap-y-10 max-sm:grid-cols-2 max-sm:gap-y-8 max-lg:grid-cols-3'
        >
          <Link
            href='/'
            aria-label='Sim home'
            className='flex h-[18px] items-center max-lg:col-span-full max-lg:mb-2'
          >
            <SimWordmark />
          </Link>

          <FooterColumn title='Product' items={PRODUCT_LINKS} />
          <FooterColumn title='Resources' items={RESOURCES_LINKS} />
          <FooterColumn title='Blocks' items={BLOCK_LINKS} />
          <FooterColumn title='Integrations' items={INTEGRATION_LINKS} />
          <FooterColumn title='Models' items={MODEL_LINKS} />
          <FooterColumn title='Socials' items={SOCIAL_LINKS} />
          <FooterColumn title='Legal' items={LEGAL_LINKS} />
        </nav>

        <p className='mt-16 text-[var(--text-muted)] text-sm'>© 2026 Sim. All rights reserved.</p>
      </div>
    </footer>
  )
}
