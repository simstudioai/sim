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
    <div className='w-[480px] rounded-[5px] border border-[#2A2A2A] bg-[#1C1C1C] p-[16px] shadow-[0_16px_48px_rgba(0,0,0,0.4)]'>
      <div className='grid grid-cols-2 gap-[10px]'>
        {PREVIEW_CARDS.map((card) => (
          <a
            key={card.title}
            href={card.href}
            target='_blank'
            rel='noopener noreferrer'
            className='group/card overflow-hidden rounded-[5px] border border-[#2A2A2A] bg-[#1C1C1C] transition-colors hover:border-[#3D3D3D] hover:bg-[#2A2A2A]'
          >
            <div className='h-[120px] w-full overflow-hidden bg-[#141414]'>
              <img
                src={card.image}
                alt={card.title}
                decoding='async'
                className='h-full w-full scale-[1.04] object-cover transition-transform duration-200 group-hover/card:scale-[1.06]'
              />
            </div>
            <div className='px-[10px] py-[8px]'>
              <span className='font-[430] font-season text-[#cdcdcd] text-[13px]'>
                {card.title}
              </span>
            </div>
          </a>
        ))}
      </div>

      <div className='mt-[8px] grid grid-cols-3 gap-[8px]'>
        {RESOURCE_CARDS.map((card) => {
          const Icon = card.icon
          return (
            <a
              key={card.title}
              href={card.href}
              target='_blank'
              rel='noopener noreferrer'
              className='flex flex-col gap-[4px] rounded-[5px] border border-[#2A2A2A] px-[10px] py-[8px] transition-colors hover:border-[#3D3D3D] hover:bg-[#232323]'
            >
              <div className='flex items-center gap-[6px]'>
                <Icon className='h-[13px] w-[13px] flex-shrink-0 text-[#939393]' />
                <span className='font-[430] font-season text-[#cdcdcd] text-[12px]'>
                  {card.title}
                </span>
              </div>
              <span className='font-season text-[#939393] text-[11px] leading-[130%]'>
                {card.description}
              </span>
            </a>
          )
        })}
      </div>
    </div>
  )
}
