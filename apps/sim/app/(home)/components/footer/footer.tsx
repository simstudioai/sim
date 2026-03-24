import Image from 'next/image'
import Link from 'next/link'
import { FooterCTA } from '@/app/(home)/components/footer/footer-cta'

const LINK_CLASS = 'text-[14px] text-[#999] transition-colors hover:text-[#ECECEC]'

interface FooterItem {
  label: string
  href: string
  external?: boolean
}

const PRODUCT_LINKS: FooterItem[] = [
  { label: 'Pricing', href: '/#pricing' },
  { label: 'Enterprise', href: 'https://form.typeform.com/to/jqCO12pF', external: true },
  { label: 'Self Hosting', href: 'https://docs.sim.ai/self-hosting', external: true },
  { label: 'MCP', href: 'https://docs.sim.ai/mcp', external: true },
  { label: 'Knowledge Base', href: 'https://docs.sim.ai/knowledgebase', external: true },
  { label: 'Tables', href: 'https://docs.sim.ai/tables', external: true },
  { label: 'API', href: 'https://docs.sim.ai/api-reference/getting-started', external: true },
  { label: 'Status', href: 'https://status.sim.ai', external: true },
]

const RESOURCES_LINKS: FooterItem[] = [
  { label: 'Blog', href: '/blog' },
  // { label: 'Templates', href: '/templates' },
  { label: 'Docs', href: 'https://docs.sim.ai', external: true },
  { label: 'Careers', href: 'https://jobs.ashbyhq.com/sim', external: true },
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
  { label: 'All Integrations →', href: '/integrations' },
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
  { label: 'Pinecone', href: 'https://docs.sim.ai/tools/pinecone', external: true },
  { label: 'Discord', href: 'https://docs.sim.ai/tools/discord', external: true },
  { label: 'Microsoft Teams', href: 'https://docs.sim.ai/tools/microsoft_teams', external: true },
  { label: 'Outlook', href: 'https://docs.sim.ai/tools/outlook', external: true },
  { label: 'Telegram', href: 'https://docs.sim.ai/tools/telegram', external: true },
]

const SOCIAL_LINKS: FooterItem[] = [
  { label: 'X (Twitter)', href: 'https://x.com/simdotai', external: true },
  { label: 'LinkedIn', href: 'https://www.linkedin.com/company/simstudioai/', external: true },
  { label: 'Discord', href: 'https://discord.gg/Hr4UWYEcTT', external: true },
  { label: 'GitHub', href: 'https://github.com/simstudioai/sim', external: true },
]

const LEGAL_LINKS: FooterItem[] = [
  { label: 'Terms of Service', href: '/terms' },
  { label: 'Privacy Policy', href: '/privacy' },
]

function FooterColumn({ title, items }: { title: string; items: FooterItem[] }) {
  return (
    <div>
      <h3 className='mb-[16px] font-medium text-[#ECECEC] text-[14px]'>{title}</h3>
      <div className='flex flex-col gap-[10px]'>
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

interface FooterProps {
  hideCTA?: boolean
}

export default function Footer({ hideCTA }: FooterProps) {
  return (
    <footer
      role='contentinfo'
      className={`bg-[#F6F6F6] pb-[40px] font-[430] font-season text-[14px]${hideCTA ? ' pt-[40px]' : ''}`}
    >
      {!hideCTA && <FooterCTA />}
      <div className='px-4 sm:px-8 md:px-[80px]'>
        <div className='relative overflow-hidden rounded-lg bg-[#1C1C1C] px-6 pt-[40px] pb-[32px] sm:px-10 sm:pt-[48px] sm:pb-[40px]'>
          <nav
            aria-label='Footer navigation'
            className='relative z-[1] grid grid-cols-2 gap-x-8 gap-y-10 sm:grid-cols-3 lg:grid-cols-7'
          >
            <div className='col-span-2 flex flex-col gap-[24px] sm:col-span-1'>
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

          {/* <svg
            aria-hidden='true'
            className='pointer-events-none absolute bottom-0 left-[-60px] hidden w-[85%] sm:block'
            viewBox='0 0 1800 316'
            fill='none'
            xmlns='http://www.w3.org/2000/svg'
          >
            <path
              d='M18.3562 305V48.95A30.594 30.594 0 0 1 48.95 18.356H917.05A30.594 30.594 0 0 1 947.644 48.95V273H1768C1777.11 273 1784.5 280.387 1784.5 289.5C1784.5 298.613 1777.11 306 1768 306H96.8603C78.635 306 63.8604 310 63.8604 305H18.3562'
              stroke='#2A2A2A'
              strokeWidth='2'
            />
            <rect
              x='58'
              y='58'
              width='849.288'
              height='199.288'
              rx='14'
              stroke='#2A2A2A'
              strokeWidth='2'
            />
          </svg> */}
        </div>
      </div>
    </footer>
  )
}
