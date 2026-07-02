import { cn } from '@sim/emcn'
import type { CatalogProvider } from '@/app/(landing)/models/utils'

export function ProviderIcon({
  provider,
  className = 'size-12 rounded-xl',
  iconClassName = 'size-6',
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
