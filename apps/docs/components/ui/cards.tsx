import type { HTMLAttributes, ReactNode } from 'react'
import { ArrowRight } from '@sim/emcn/icons'
import Link from 'next/link'
import { cn } from '@/components/docs/classnames'

interface CardsProps extends HTMLAttributes<HTMLDivElement> {}
interface CardProps {
  href: string
  title: string
  children?: ReactNode
  icon?: ReactNode
  className?: string
}

export function Cards({ className, ...props }: CardsProps) {
  return (
    <div
      {...props}
      className={cn('my-5 flex min-w-0 flex-col divide-y divide-[var(--docs-border)]', className)}
    />
  )
}

/** An open route row with separators owned by its parent collection. */
export function Card({ href, title, children, icon, className }: CardProps) {
  return (
    <Link
      href={href}
      className={cn(
        'group/card flex min-w-0 items-center gap-4 px-4 py-4 text-[var(--docs-text)] text-docs-table transition-colors hover:bg-[var(--docs-hover)] focus-visible:outline-2 focus-visible:outline-[var(--docs-link)] focus-visible:outline-offset-2',
        className
      )}
    >
      {icon && (
        <span className='flex size-6 shrink-0 items-center justify-center text-[var(--docs-muted)] [&>svg]:size-4'>
          {icon}
        </span>
      )}
      <div className='min-w-0 flex-1'>
        <span className='block font-medium'>{title}</span>
        {children && <div className='mt-0.5 [&>p]:m-0 [&>p]:text-docs-table'>{children}</div>}
      </div>
      <ArrowRight className='size-4 shrink-0 text-[var(--docs-muted)]' />
    </Link>
  )
}
