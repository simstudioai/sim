import Link from 'next/link'
import { FooterPeel } from '@/components/footer/footer-peel'
import { SimWordmark } from '@/components/ui/sim-logo'
import { SIM_SITE_URL } from '@/lib/urls'

/**
 * Docs footer — the same site link directory as the main app's landing
 * footer (`apps/sim/app/(landing)/components/footer`), ported here so both
 * apps share one consistent footer (including the scroll "peel" reveal).
 * Links that live on sim.ai are absolute (docs.sim.ai is a different origin);
 * links that live on docs.sim.ai itself (Academy, API Reference, blocks,
 * integrations guides, …) stay relative.
 */

const LINK_CLASS =
  'text-sm text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]'

interface FooterItem {
  label: string
  href: string
  external?: boolean
}

const PRODUCT_LINKS: FooterItem[] = [
  { label: 'Enterprise', href: `${SIM_SITE_URL}/enterprise`, external: true },
  { label: 'Mothership', href: '/mothership' },
  { label: 'Workflows', href: '/introduction' },
  { label: 'Knowledge Base', href: '/knowledgebase' },
  { label: 'Tables', href: '/tables' },
  { label: 'MCP', href: '/agents/mcp' },
  { label: 'API', href: '/api-reference/getting-started' },
  { label: 'Self Hosting', href: '/platform/self-hosting' },
  { label: 'Status', href: 'https://status.sim.ai', external: true },
]

const RESOURCES_LINKS: FooterItem[] = [
  { label: 'Blog', href: `${SIM_SITE_URL}/blog`, external: true },
  { label: 'Academy', href: '/academy' },
  { label: 'Compare', href: `${SIM_SITE_URL}/comparison`, external: true },
  { label: 'Careers', href: `${SIM_SITE_URL}/careers`, external: true },
  { label: 'Changelog', href: `${SIM_SITE_URL}/changelog`, external: true },
  { label: 'Contact', href: `${SIM_SITE_URL}/contact`, external: true },
]

/** Top model providers — mirrors the landing footer's top 8 catalog providers. */
const MODEL_LINKS: FooterItem[] = [
  { label: 'All Models', href: `${SIM_SITE_URL}/models`, external: true },
  { label: 'OpenAI', href: `${SIM_SITE_URL}/models/openai`, external: true },
  { label: 'Anthropic', href: `${SIM_SITE_URL}/models/anthropic`, external: true },
  { label: 'Google', href: `${SIM_SITE_URL}/models/google`, external: true },
  { label: 'DeepSeek', href: `${SIM_SITE_URL}/models/deepseek`, external: true },
  { label: 'xAI', href: `${SIM_SITE_URL}/models/xai`, external: true },
  { label: 'Cerebras', href: `${SIM_SITE_URL}/models/cerebras`, external: true },
  { label: 'Groq', href: `${SIM_SITE_URL}/models/groq`, external: true },
  { label: 'Sakana AI', href: `${SIM_SITE_URL}/models/sakana`, external: true },
]

const BLOCK_LINKS: FooterItem[] = [
  { label: 'Agent', href: '/workflows/blocks/agent' },
  { label: 'Router', href: '/workflows/blocks/router' },
  { label: 'Function', href: '/workflows/blocks/function' },
  { label: 'Condition', href: '/workflows/blocks/condition' },
  { label: 'API Block', href: '/workflows/blocks/api' },
  { label: 'Workflow', href: '/workflows/blocks/workflow' },
  { label: 'Parallel', href: '/workflows/blocks/parallel' },
  { label: 'Guardrails', href: '/workflows/blocks/guardrails' },
  { label: 'Evaluator', href: '/workflows/blocks/evaluator' },
  { label: 'Loop', href: '/workflows/blocks/loop' },
]

const INTEGRATION_LINKS: FooterItem[] = [
  { label: 'All Integrations', href: `${SIM_SITE_URL}/integrations`, external: true },
  { label: 'Slack', href: '/integrations/slack' },
  { label: 'GitHub', href: '/integrations/github' },
  { label: 'Gmail', href: '/integrations/gmail' },
  { label: 'Notion', href: '/integrations/notion' },
  { label: 'Salesforce', href: '/integrations/salesforce' },
  { label: 'Jira', href: `${SIM_SITE_URL}/integrations/jira`, external: true },
  { label: 'Linear', href: '/integrations/linear' },
  { label: 'Supabase', href: '/integrations/supabase' },
  { label: 'Stripe', href: '/integrations/stripe' },
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
  { label: 'Terms of Service', href: `${SIM_SITE_URL}/terms`, external: true },
  { label: 'Privacy Policy', href: `${SIM_SITE_URL}/privacy`, external: true },
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
    <div className='relative mt-[120px] pb-[320px] max-sm:mt-16 max-sm:pb-[200px] max-lg:mt-[88px]'>
      <FooterPeel />
      <footer className='-mt-[320px] max-sm:-mt-[200px] relative z-10 w-full border-[var(--border)] border-t bg-[var(--bg)]'>
        <div className='mx-auto w-full max-w-[1460px] px-20 pt-16 pb-16 max-sm:px-5 max-lg:px-8 max-lg:pt-12 max-lg:pb-12'>
          <nav
            aria-label='Footer navigation'
            itemScope
            itemType='https://schema.org/SiteNavigationElement'
            className='grid grid-cols-8 gap-x-8 gap-y-10 max-sm:grid-cols-2 max-sm:gap-y-8 max-lg:grid-cols-3'
          >
            <a
              href={SIM_SITE_URL}
              aria-label='Sim home'
              className='flex h-[18px] items-center max-lg:col-span-full max-lg:mb-2'
            >
              <SimWordmark />
            </a>

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
    </div>
  )
}
