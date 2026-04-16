import Image from 'next/image'
import Link from 'next/link'
import { cn } from '@/lib/core/utils/cn'
import { FooterCTA } from '@/app/(landing)/components/footer/footer-cta'

const LINK_CLASS =
  'text-sm text-[var(--landing-text-muted)] transition-colors hover:text-[var(--landing-text)]'

interface FooterItem {
  label: string
  href: string
  external?: boolean
  externalArrow?: boolean
}

const PRODUCT_LINKS: FooterItem[] = [
  { label: 'Mothership', href: 'https://docs.sim.ai', external: true },
  { label: 'Workflows', href: 'https://docs.sim.ai', external: true },
  { label: 'Knowledge Base', href: 'https://docs.sim.ai/knowledgebase', external: true },
  { label: 'Tables', href: 'https://docs.sim.ai/tables', external: true },
  { label: 'MCP', href: 'https://docs.sim.ai/mcp', external: true },
  { label: 'API', href: 'https://docs.sim.ai/api-reference/getting-started', external: true },
  { label: 'Self Hosting', href: 'https://docs.sim.ai/self-hosting', external: true },
  { label: 'Status', href: 'https://status.sim.ai', external: true, externalArrow: true },
]

const RESOURCES_LINKS: FooterItem[] = [
  { label: 'Blog', href: '/blog' },
  { label: 'Docs', href: 'https://docs.sim.ai', external: true },
  { label: 'Models', href: '/models' },
  { label: 'Partners', href: '/partners' },
  { label: 'Careers', href: 'https://jobs.ashbyhq.com/sim', external: true, externalArrow: true },
  { label: 'Changelog', href: '/changelog' },
]

const BLOCK_LINKS: FooterItem[] = [
  { label: 'Agent', href: 'https://docs.sim.ai/blocks/agent', external: true },
  { label: 'Router', href: 'https://docs.sim.ai/blocks/router', external: true },
  { label: 'Function', href: 'https://docs.sim.ai/blocks/function', external: true },
  { label: 'Condition', href: 'https://docs.sim.ai/blocks/condition', external: true },
  { label: 'API', href: 'https://docs.sim.ai/blocks/api', external: true },
  { label: 'Workflow', href: 'https://docs.sim.ai/blocks/workflow', external: true },
  { label: 'Parallel', href: 'https://docs.sim.ai/blocks/parallel', external: true },
  { label: 'Guardrails', href: 'https://docs.sim.ai/blocks/guardrails', external: true },
  { label: 'Evaluator', href: 'https://docs.sim.ai/blocks/evaluator', external: true },
  { label: 'Loop', href: 'https://docs.sim.ai/blocks/loop', external: true },
]

const INTEGRATION_LINKS: FooterItem[] = [
  { label: 'All Integrations', href: '/integrations' },
  { label: 'Confluence', href: 'https://docs.sim.ai/tools/confluence', external: true },
  { label: 'Slack', href: 'https://docs.sim.ai/tools/slack', external: true },
  { label: 'GitHub', href: 'https://docs.sim.ai/tools/github', external: true },
  { label: 'Gmail', href: 'https://docs.sim.ai/tools/gmail', external: true },
  { label: 'HubSpot', href: 'https://docs.sim.ai/tools/hubspot', external: true },
  { label: 'Salesforce', href: 'https://docs.sim.ai/tools/salesforce', external: true },
  { label: 'Notion', href: 'https://docs.sim.ai/tools/notion', external: true },
  { label: 'Google Drive', href: 'https://docs.sim.ai/tools/google_drive', external: true },
  { label: 'Google Sheets', href: 'https://docs.sim.ai/tools/google_sheets', external: true },
  { label: 'Supabase', href: 'https://docs.sim.ai/tools/supabase', external: true },
  { label: 'Stripe', href: 'https://docs.sim.ai/tools/stripe', external: true },
  { label: 'Jira', href: 'https://docs.sim.ai/tools/jira', external: true },
  { label: 'Linear', href: 'https://docs.sim.ai/tools/linear', external: true },
  { label: 'Airtable', href: 'https://docs.sim.ai/tools/airtable', external: true },
  { label: 'Firecrawl', href: 'https://docs.sim.ai/tools/firecrawl', external: true },
  { label: 'Discord', href: 'https://docs.sim.ai/tools/discord', external: true },
  { label: 'Microsoft Teams', href: 'https://docs.sim.ai/tools/microsoft_teams', external: true },
  { label: 'Telegram', href: 'https://docs.sim.ai/tools/telegram', external: true },
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

function ChevronArrow({ external }: { external?: boolean }) {
  return (
    <svg
      className={cn('h-3 w-3 shrink-0', external && '-rotate-45')}
      viewBox='0 0 10 10'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
    >
      <line
        x1='0'
        y1='5'
        x2='9'
        y2='5'
        stroke='currentColor'
        strokeWidth='1.33'
        strokeLinecap='square'
        className='origin-left scale-x-0 transition-transform duration-200 ease-out [transform-box:fill-box] group-hover/link:scale-x-100'
      />
      <path
        d='M3.5 2L6.5 5L3.5 8'
        stroke='currentColor'
        strokeWidth='1.33'
        strokeLinecap='square'
        strokeLinejoin='miter'
        fill='none'
        className='transition-transform duration-200 ease-out group-hover/link:translate-x-[30%]'
      />
    </svg>
  )
}

function FooterColumn({ title, items }: { title: string; items: FooterItem[] }) {
  return (
    <div>
      <h3 className='mb-4 font-medium text-[var(--landing-text)] text-sm'>{title}</h3>
      <div className='flex flex-col gap-2.5'>
        {items.map(({ label, href, external, externalArrow }) =>
          external ? (
            <a
              key={label}
              href={href}
              target='_blank'
              rel='noopener noreferrer'
              className={cn(
                LINK_CLASS,
                externalArrow && 'group/link inline-flex items-center gap-1'
              )}
            >
              {label}
              {externalArrow && <ChevronArrow external />}
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

interface FooterProps {
  hideCTA?: boolean
}

export default function Footer({ hideCTA }: FooterProps) {
  return (
    <footer
      role='contentinfo'
      className={cn(
        'bg-[var(--landing-bg)] pb-10 font-[430] font-season text-sm',
        hideCTA && 'pt-10'
      )}
    >
      {!hideCTA && <FooterCTA />}
      <div className='relative px-[1.6vw] sm:px-8 lg:px-16'>
        <div
          aria-hidden='true'
          className='absolute top-0 left-0 z-20 hidden h-px w-[calc(4rem+4px)] bg-[var(--landing-bg-elevated)] lg:block'
        />
        <div
          aria-hidden='true'
          className='absolute top-0 right-0 z-20 hidden h-px w-[calc(4rem+4px)] bg-[var(--landing-bg-elevated)] lg:block'
        />
        <div
          aria-hidden='true'
          className='absolute bottom-0 left-0 z-20 hidden h-px w-[calc(4rem+4px)] bg-[var(--landing-bg-elevated)] lg:block'
        />
        <div
          aria-hidden='true'
          className='absolute right-0 bottom-0 z-20 hidden h-px w-[calc(4rem+4px)] bg-[var(--landing-bg-elevated)] lg:block'
        />
        <div className='relative z-10 border border-[var(--landing-bg-elevated)] px-6 pt-10 pb-8 sm:px-10 sm:pt-12 sm:pb-10'>
          <nav
            aria-label='Footer navigation'
            itemScope
            itemType='https://schema.org/SiteNavigationElement'
            className='relative z-[1] grid grid-cols-2 gap-x-8 gap-y-10 sm:grid-cols-3 lg:grid-cols-7'
          >
            <div className='col-span-2 flex flex-col gap-6 sm:col-span-1'>
              <Link href='/' aria-label='Sim home'>
                <Image
                  src='/logo/sim-landing.svg'
                  alt='Sim'
                  width={85}
                  height={26}
                  className='h-[26.4px] w-auto'
                />
              </Link>
            </div>

            <FooterColumn title='Product' items={PRODUCT_LINKS} />
            <FooterColumn title='Resources' items={RESOURCES_LINKS} />
            <FooterColumn title='Blocks' items={BLOCK_LINKS} />
            <FooterColumn title='Integrations' items={INTEGRATION_LINKS} />
            <FooterColumn title='Socials' items={SOCIAL_LINKS} />
            <FooterColumn title='Legal' items={LEGAL_LINKS} />
          </nav>
        </div>
      </div>
    </footer>
  )
}
