'use client'

import type * as React from 'react'
import { blockTypeToIconMap } from '@/components/ui/icon-mapping'

interface BlockInfoCardProps {
  type: string
  color: string
  icon?: React.ComponentType<{ className?: string }>
  /** Display name of the external service, used as the outbound link label. */
  name?: string
  /** Canonical homepage of the external service; rendered as an outbound link. */
  href?: string
}

/** Strips the protocol and `www.` so the link reads as a bare domain. */
function formatHostname(href: string): string {
  try {
    return new URL(href).hostname.replace(/^www\./, '')
  } catch {
    return href
  }
}

export function BlockInfoCard({
  type,
  color,
  icon: IconComponent,
  name,
  href,
}: BlockInfoCardProps): React.ReactNode {
  const ResolvedIcon = IconComponent || blockTypeToIconMap[type] || null

  return (
    <div className='not-prose mb-6'>
      <div
        className='flex items-center justify-center overflow-hidden rounded-lg p-8'
        style={{ background: color }}
      >
        {ResolvedIcon ? (
          <ResolvedIcon className='size-10 text-white' />
        ) : (
          <div className='font-mono text-white text-xl opacity-70'>{type.substring(0, 2)}</div>
        )}
      </div>
      {href && (
        <a
          href={href}
          target='_blank'
          rel='noopener noreferrer'
          className='mt-3 inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 font-normal text-[var(--text-muted)] text-sm no-underline transition-colors hover:bg-[var(--surface-4)] hover:text-[var(--text-body)]'
        >
          {name ? `Visit ${name}` : formatHostname(href)}
          <svg
            aria-hidden='true'
            className='size-3 shrink-0 opacity-70'
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            strokeWidth={2}
            strokeLinecap='round'
            strokeLinejoin='round'
          >
            <path d='M7 17 17 7' />
            <path d='M7 7h10v10' />
          </svg>
        </a>
      )}
    </div>
  )
}
