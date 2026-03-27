import type { ComponentType, SVGProps } from 'react'
import Link from 'next/link'
import { Badge } from '@/components/emcn'
import type { Integration } from '@/app/(landing)/integrations/data/types'
import { IntegrationIcon } from './integration-icon'

interface IntegrationCardProps {
  integration: Integration
  IconComponent?: ComponentType<SVGProps<SVGSVGElement>>
}

export function IntegrationCard({ integration, IconComponent }: IntegrationCardProps) {
  const { slug, name, description, bgColor, operationCount, triggerCount } = integration

  return (
    <Link
      href={`/integrations/${slug}`}
      className='group flex flex-col rounded-lg border border-[var(--landing-border)] bg-[var(--landing-bg-card)] p-4 transition-colors hover:border-[var(--landing-border-strong)] hover:bg-[var(--landing-bg-elevated)]'
      aria-label={`${name} integration`}
    >
      <IntegrationIcon
        bgColor={bgColor}
        name={name}
        Icon={IconComponent}
        className='mb-3 h-10 w-10 rounded-lg'
        aria-hidden='true'
      />

      {/* Name */}
      <h3 className='mb-1 font-[500] text-[14px] text-[var(--landing-text)] leading-snug'>
        {name}
      </h3>

      {/* Description — clamped to 2 lines */}
      <p className='mb-3 line-clamp-2 flex-1 text-[12px] text-[var(--landing-text-muted)] leading-relaxed'>
        {description}
      </p>

      {/* Footer row */}
      <div className='flex flex-wrap items-center gap-1.5'>
        {operationCount > 0 && (
          <Badge className='border-0 bg-[#333] text-[11px] text-[var(--landing-text-muted)]'>
            {operationCount} {operationCount === 1 ? 'tool' : 'tools'}
          </Badge>
        )}
        {triggerCount > 0 && (
          <Badge className='border-0 bg-[#333] text-[11px] text-[var(--landing-text-muted)]'>
            {triggerCount} {triggerCount === 1 ? 'trigger' : 'triggers'}
          </Badge>
        )}
        <span className='ml-auto text-[#555] text-[12px] transition-colors group-hover:text-[var(--landing-text-muted)]'>
          Learn more →
        </span>
      </div>
    </Link>
  )
}
