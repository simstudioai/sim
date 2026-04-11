import type { ComponentType, SVGProps } from 'react'
import Link from 'next/link'
import {
  AgentIcon,
  ApiIcon,
  McpIcon,
  PackageSearchIcon,
  TableIcon,
  WorkflowIcon,
} from '@/components/icons'

interface ProductLink {
  label: string
  description: string
  href: string
  external?: boolean
  icon: ComponentType<SVGProps<SVGSVGElement>>
}

interface SidebarLink {
  label: string
  href: string
  external?: boolean
}

const PLATFORM: ProductLink[] = [
  {
    label: 'Workflows',
    description: 'Visual AI automation builder',
    href: 'https://docs.sim.ai/getting-started',
    external: true,
    icon: WorkflowIcon,
  },
  {
    label: 'Agent',
    description: 'Build autonomous AI agents',
    href: 'https://docs.sim.ai/blocks/agent',
    external: true,
    icon: AgentIcon,
  },
  {
    label: 'MCP',
    description: 'Connect external tools',
    href: 'https://docs.sim.ai/mcp',
    external: true,
    icon: McpIcon,
  },
  {
    label: 'Knowledge Base',
    description: 'Retrieval-augmented context',
    href: 'https://docs.sim.ai/knowledgebase',
    external: true,
    icon: PackageSearchIcon,
  },
  {
    label: 'Tables',
    description: 'Structured data storage',
    href: 'https://docs.sim.ai/tables',
    external: true,
    icon: TableIcon,
  },
  {
    label: 'API',
    description: 'Deploy workflows as endpoints',
    href: 'https://docs.sim.ai/api-reference/getting-started',
    external: true,
    icon: ApiIcon,
  },
]

const EXPLORE: SidebarLink[] = [
  { label: 'Models', href: '/models' },
  { label: 'Integrations', href: '/integrations' },
  { label: 'Changelog', href: '/changelog' },
  { label: 'Self-hosting', href: 'https://docs.sim.ai/self-hosting', external: true },
]

function DropdownLink({ link }: { link: ProductLink }) {
  const Icon = link.icon
  const Tag = link.external ? 'a' : Link
  const props = link.external
    ? { href: link.href, target: '_blank' as const, rel: 'noopener noreferrer' }
    : { href: link.href }

  return (
    <Tag
      {...props}
      className='group/item flex items-start gap-2.5 rounded-[5px] px-2.5 py-2 transition-colors hover:bg-[var(--landing-bg-elevated)]'
    >
      <Icon className='mt-0.5 h-[15px] w-[15px] shrink-0 text-[var(--landing-text-icon)]' />
      <div className='flex flex-col'>
        <span className='font-[430] font-season text-[13px] text-white leading-tight'>
          {link.label}
        </span>
        <span className='font-season text-[12px] text-[var(--landing-text-subtle)] leading-[150%]'>
          {link.description}
        </span>
      </div>
    </Tag>
  )
}

export function ProductDropdown() {
  return (
    <div className='flex w-[560px] rounded-[5px] border border-[var(--landing-bg-elevated)] bg-[var(--landing-bg)] shadow-overlay'>
      <div className='flex-1 p-2'>
        <div className='mb-1 px-2.5 pt-1'>
          <span className='font-[430] font-season text-[11px] text-[var(--landing-text-subtle)] uppercase tracking-[0.08em]'>
            Platform
          </span>
          <div className='mt-1.5 h-px bg-[var(--landing-bg-elevated)]' />
        </div>

        <div className='grid grid-cols-2'>
          {PLATFORM.map((link) => (
            <DropdownLink key={link.label} link={link} />
          ))}
        </div>
      </div>

      <div className='w-px self-stretch bg-[var(--landing-bg-elevated)]' />

      <div className='w-[160px] p-2'>
        <div className='mb-1 px-2.5 pt-1'>
          <span className='font-[430] font-season text-[11px] text-[var(--landing-text-subtle)] uppercase tracking-[0.08em]'>
            Explore
          </span>
          <div className='mt-1.5 h-px bg-[var(--landing-bg-elevated)]' />
        </div>

        {EXPLORE.map((link) => {
          const Tag = link.external ? 'a' : Link
          const props = link.external
            ? { href: link.href, target: '_blank' as const, rel: 'noopener noreferrer' }
            : { href: link.href }
          return (
            <Tag
              key={link.label}
              {...props}
              className='block rounded-[5px] px-2.5 py-1.5 font-[430] font-season text-[13px] text-white transition-colors hover:bg-[var(--landing-bg-elevated)]'
            >
              {link.label}
            </Tag>
          )
        })}
      </div>
    </div>
  )
}
