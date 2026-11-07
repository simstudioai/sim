import type { HTMLAttributes, ReactNode } from 'react'
import { Icon } from '@sim/emcn/icon'
import { cn } from '@sim/emcn/lib/cn'
import Link from 'next/link'

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
        'group/card flex min-w-0 items-center gap-4 px-4 py-4 text-[var(--docs-text)] text-docs-table transition-colors hover:bg-[var(--docs-hover)] ',
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
      <Icon name='arrow-right' className='size-4 shrink-0 text-[var(--docs-muted)]' />
    </Link>
  )
}
