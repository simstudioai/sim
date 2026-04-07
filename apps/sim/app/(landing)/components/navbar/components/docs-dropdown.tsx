import Image from 'next/image'
import { AgentIcon, GithubOutlineIcon, McpIcon } from '@/components/icons'

const PREVIEW_CARDS = [
  {
    title: 'Introduction',
    href: 'https://docs.sim.ai',
    image: '/landing/docs-getting-started.svg',
  },
  {
    title: 'Getting Started',
    href: 'https://docs.sim.ai/getting-started',
    image: '/landing/docs-intro.svg',
  },
] as const

const RESOURCE_CARDS = [
  {
    title: 'Agent',
    description: 'Build AI agents',
    href: 'https://docs.sim.ai/blocks/agent',
    icon: AgentIcon,
  },
  {
    title: 'MCP',
    description: 'Connect tools',
    href: 'https://docs.sim.ai/mcp',
    icon: McpIcon,
  },
  {
    title: 'Self-hosting',
    description: 'Host on your infra',
    href: 'https://docs.sim.ai/self-hosting',
    icon: GithubOutlineIcon,
  },
] as const

export function DocsDropdown() {
  return (
    <div className='w-[480px] rounded-[5px] border border-[var(--landing-bg-elevated)] bg-[var(--landing-bg)] p-2 shadow-overlay'>
      <div className='grid grid-cols-2 gap-2'>
        {PREVIEW_CARDS.map((card) => (
          <a
            key={card.title}
            href={card.href}
            target='_blank'
            rel='noopener noreferrer'
            className='group/card overflow-hidden rounded-[5px] border border-[var(--landing-bg-elevated)] bg-[var(--landing-bg)] transition-colors hover:border-[var(--landing-border-strong)] hover:bg-[var(--landing-bg-elevated)]'
          >
            <div className='relative h-[120px] w-full overflow-hidden bg-[#141414]'>
              <Image
                src={card.image}
                alt={card.title}
                fill
                sizes='220px'
                className='scale-[1.04] object-cover transition-transform duration-200 group-hover/card:scale-[1.06]'
                unoptimized
              />
            </div>
            <div className='px-2.5 py-2'>
              <span className='font-[430] font-season text-[var(--landing-text-body)] text-small'>
                {card.title}
              </span>
            </div>
          </a>
        ))}
      </div>

      <div className='mt-2 grid grid-cols-3 gap-2'>
        {RESOURCE_CARDS.map((card) => {
          const Icon = card.icon
          return (
            <a
              key={card.title}
              href={card.href}
              target='_blank'
              rel='noopener noreferrer'
              className='flex flex-col gap-1 rounded-[5px] border border-[var(--landing-bg-elevated)] px-2.5 py-2 transition-colors hover:border-[var(--landing-border-strong)] hover:bg-[var(--landing-bg-card)]'
            >
              <div className='flex items-center gap-1.5'>
                <Icon className='h-[13px] w-[13px] flex-shrink-0 text-[var(--landing-text-icon)]' />
                <span className='font-[430] font-season text-[var(--landing-text-body)] text-caption'>
                  {card.title}
                </span>
              </div>
              <span className='font-season text-[var(--landing-text-icon)] text-xs leading-[130%]'>
                {card.description}
              </span>
            </a>
          )
        })}
      </div>
    </div>
  )
}
