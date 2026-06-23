import Link from 'next/link'
import { cn } from '@/lib/core/utils/cn'
import { SimWordmark } from '@/app/(landing)/components/navbar/components/sim-wordmark'

/**
 * Landing footer — the site link directory. Re-authored from the prior landing
 * footer's structure and link content, but on the platform's light tokens with
 * no responsive variants (desktop-only, per this directory's rules) and no
 * cross-import from `(home)`. The closing CTA lives in its own {@link Cta}
 * section above; this is purely the `<footer>` landmark.
 *
 * Carries `SiteNavigationElement` schema for crawlable footer nav. A top
 * hairline separates it from the page and spans the full viewport width
 * (edge-to-edge): the border lives on the full-width `<footer>` landmark while
 * an inner container caps and centers the content at the shared
 * `max-w-[1446px]` with the same `px-12` gutter as every section above.
 */

const LINK_CLASS =
  'text-[14px] text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]'

interface FooterItem {
  label: string
  href: string
  external?: boolean
  externalArrow?: boolean
}

const PRODUCT_LINKS: FooterItem[] = [
  { label: 'Mothership', href: 'https://docs.sim.ai/mothership', external: true },
  { label: 'Workflows', href: 'https://docs.sim.ai', external: true },
  { label: 'Knowledge Base', href: 'https://docs.sim.ai/knowledgebase', external: true },
  { label: 'Tables', href: 'https://docs.sim.ai/tables', external: true },
  { label: 'MCP', href: 'https://docs.sim.ai/agents/mcp', external: true },
  { label: 'API', href: 'https://docs.sim.ai/api-reference/getting-started', external: true },
  { label: 'Self Hosting', href: 'https://docs.sim.ai/platform/self-hosting', external: true },
  { label: 'Status', href: 'https://status.sim.ai', external: true, externalArrow: true },
]

const RESOURCES_LINKS: FooterItem[] = [
  { label: 'Blog', href: '/blog' },
  { label: 'Docs', href: 'https://docs.sim.ai', external: true },
  { label: 'Models', href: '/models' },
  { label: 'Partners', href: '/partners' },
  { label: 'Careers', href: 'https://jobs.ashbyhq.com/sim', external: true, externalArrow: true },
  { label: 'Changelog', href: '/changelog' },
  { label: 'Contact', href: '/contact' },
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
  { label: 'Jira', href: 'https://docs.sim.ai/integrations/jira', external: true },
  { label: 'Linear', href: 'https://docs.sim.ai/integrations/linear', external: true },
  { label: 'Supabase', href: 'https://docs.sim.ai/integrations/supabase', external: true },
  { label: 'Stripe', href: 'https://docs.sim.ai/integrations/stripe', external: true },
]

const SOCIAL_LINKS: FooterItem[] = [
  { label: 'X (Twitter)', href: 'https://x.com/simdotai', external: true, externalArrow: true },
  {
    label: 'LinkedIn',
    href: 'https://www.linkedin.com/company/simstudioai/',
    external: true,
    externalArrow: true,
  },
  { label: 'Discord', href: 'https://discord.gg/Hr4UWYEcTT', external: true, externalArrow: true },
  {
    label: 'GitHub',
    href: 'https://github.com/simstudioai/sim',
    external: true,
    externalArrow: true,
  },
]

const LEGAL_LINKS: FooterItem[] = [
  { label: 'Terms of Service', href: '/terms' },
  { label: 'Privacy Policy', href: '/privacy' },
]

function ExternalArrow() {
  return (
    <svg
      aria-hidden='true'
      className='-rotate-45 size-3 shrink-0'
      viewBox='0 0 10 10'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
    >
      <path
        d='M3.5 2L6.5 5L3.5 8'
        stroke='currentColor'
        strokeWidth='1.33'
        strokeLinecap='square'
        strokeLinejoin='miter'
      />
    </svg>
  )
}

function FooterColumn({ title, items }: { title: string; items: FooterItem[] }) {
  return (
    <div>
      <h3 className='mb-4 text-[14px] text-[var(--text-primary)]'>{title}</h3>
      <div className='flex flex-col gap-2.5'>
        {items.map(({ label, href, external, externalArrow }) =>
          external ? (
            <a
              key={label}
              href={href}
              target='_blank'
              rel='noopener noreferrer'
              className={cn(LINK_CLASS, externalArrow && 'inline-flex items-center gap-1')}
            >
              {label}
              {externalArrow && <ExternalArrow />}
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
    <footer
      role='contentinfo'
      className='mt-[120px] w-full border-[var(--border)] border-t max-sm:mt-16 max-lg:mt-20'
    >
      <div className='mx-auto w-full max-w-[1446px] px-12 pt-20 pb-12 max-sm:px-5 max-sm:pt-12 max-lg:px-8 max-lg:pt-16'>
        <nav
          aria-label='Footer navigation'
          itemScope
          itemType='https://schema.org/SiteNavigationElement'
          className='grid grid-cols-7 gap-x-8 gap-y-10 max-sm:grid-cols-2 max-sm:gap-y-8 max-lg:grid-cols-3'
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
          <FooterColumn title='Socials' items={SOCIAL_LINKS} />
          <FooterColumn title='Legal' items={LEGAL_LINKS} />
        </nav>

        <p className='mt-16 text-[13px] text-[var(--text-muted)]'>
          © 2026 Sim. All rights reserved.
        </p>
      </div>
    </footer>
  )
}
