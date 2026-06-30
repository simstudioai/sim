import Link from 'next/link'
import { cn } from '@/lib/core/utils/cn'
import type { CatalogModel, CatalogProvider } from '@/app/(landing)/models/utils'

export function ProviderIcon({
  provider,
  className = 'size-12 rounded-xl',
  iconClassName = 'h-6 w-6',
}: {
  provider: Pick<CatalogProvider, 'icon' | 'name'>
  className?: string
  iconClassName?: string
}) {
  const Icon = provider.icon

  return (
    <span
      className={cn(
        'flex items-center justify-center border border-[var(--border-1)] bg-[var(--bg)]',
        className
      )}
    >
      {Icon ? (
        <Icon className={iconClassName} />
      ) : (
        <span className='text-[14px] text-[var(--text-primary)]'>
          {provider.name.slice(0, 2).toUpperCase()}
        </span>
      )}
    </span>
  )
}

export function FeaturedProviderCard({ provider }: { provider: CatalogProvider }) {
  return (
    <Link
      href={provider.href}
      className='group flex flex-1 flex-col gap-4 border-[var(--border)] border-t p-6 transition-colors first:border-t-0 hover:bg-[var(--surface-hover)] sm:border-t-0 sm:border-l sm:first:border-l-0'
    >
      <ProviderIcon provider={provider} className='size-10 rounded-xl' iconClassName='h-5 w-5' />
      <div className='flex flex-col gap-2'>
        <h3 className='text-[var(--text-primary)] text-lg leading-tight tracking-[-0.01em]'>
          {provider.name}
        </h3>
        <p className='line-clamp-2 text-[var(--text-muted)] text-sm leading-[150%]'>
          {provider.description}
        </p>
      </div>
    </Link>
  )
}

export function FeaturedModelCard({
  provider,
  model,
}: {
  provider: CatalogProvider
  model: CatalogModel
}) {
  return (
    <Link
      href={model.href}
      className='group flex flex-1 flex-col gap-4 border-[var(--border)] border-t p-6 transition-colors first:border-t-0 hover:bg-[var(--surface-hover)] sm:border-t-0 sm:border-l sm:first:border-l-0'
    >
      <ProviderIcon provider={provider} className='size-10 rounded-xl' iconClassName='h-5 w-5' />
      <div className='flex flex-col gap-2'>
        <span className='text-[var(--text-muted)] text-xs uppercase tracking-[0.1em]'>
          {provider.name}
        </span>
        <h3 className='text-[var(--text-primary)] text-lg leading-tight tracking-[-0.01em]'>
          {model.displayName}
        </h3>
        <p className='line-clamp-2 text-[var(--text-muted)] text-sm leading-[150%]'>
          {model.summary}
        </p>
      </div>
    </Link>
  )
}
