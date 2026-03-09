'use client'

import type * as React from 'react'
import { ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { cn } from '@/lib/core/utils/cn'

export interface BreadcrumbItem {
  label: string
  href?: string
}

export interface BreadcrumbProps extends React.HTMLAttributes<HTMLElement> {
  items: BreadcrumbItem[]
}

/**
 * Breadcrumb navigation component following emcn design patterns
 */
function Breadcrumb({ items, className, ...props }: BreadcrumbProps) {
  return (
    <nav
      aria-label='Breadcrumb'
      className={cn('flex items-center gap-[6px]', className)}
      {...props}
    >
      {items.map((item, index) => {
        const isLast = index === items.length - 1

        return (
          <div key={`${item.label}-${index}`} className='flex items-center gap-[6px]'>
            {item.href && !isLast ? (
              <Link
                href={item.href}
                className='block max-w-[200px] truncate font-medium text-[14px] text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-primary)]'
              >
                {item.label}
              </Link>
            ) : (
              <span
                className={cn(
                  'block max-w-[200px] truncate font-medium text-[14px]',
                  isLast ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]'
                )}
              >
                {item.label}
              </span>
            )}

            {!isLast && <ChevronRight className='h-[14px] w-[14px] text-[var(--text-muted)]' />}
          </div>
        )
      })}
    </nav>
  )
}

export { Breadcrumb }
