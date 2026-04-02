import Link from 'next/link'
import { Badge } from '@/components/emcn'
import {
  type CatalogModel,
  type CatalogProvider,
  formatPrice,
  formatTokenCount,
  formatUpdatedAt,
} from '@/app/(landing)/models/utils'

export function Breadcrumbs({ items }: { items: Array<{ label: string; href?: string }> }) {
  return (
    <nav
      aria-label='Breadcrumb'
      className='mb-10 flex flex-wrap items-center gap-2 text-[#555] text-[13px]'
    >
      {items.map((item, index) => (
        <span key={`${item.label}-${index}`} className='inline-flex items-center gap-2'>
          {item.href ? (
            <Link
              href={item.href}
              className='transition-colors hover:text-[var(--landing-text-muted)]'
            >
              {item.label}
            </Link>
          ) : (
            <span className='text-[var(--landing-text-muted)]'>{item.label}</span>
          )}
          {index < items.length - 1 ? <span aria-hidden='true'>/</span> : null}
        </span>
      ))}
    </nav>
  )
}

export function ProviderIcon({
  provider,
  className = 'h-12 w-12 rounded-2xl',
  iconClassName = 'h-6 w-6',
}: {
  provider: Pick<CatalogProvider, 'icon' | 'name'>
  className?: string
  iconClassName?: string
}) {
  const Icon = provider.icon

  return (
    <span
      className={`flex items-center justify-center border border-[var(--landing-border)] bg-[var(--landing-bg)] ${className}`}
    >
      {Icon ? (
        <Icon className={iconClassName} />
      ) : (
        <span className='font-[500] text-[14px] text-[var(--landing-text)]'>
          {provider.name.slice(0, 2).toUpperCase()}
        </span>
      )}
    </span>
  )
}

export function StatCard({
  label,
  value,
  compact = false,
}: {
  label: string
  value: string
  compact?: boolean
}) {
  return (
    <div className='rounded-2xl border border-[var(--landing-border)] bg-[var(--landing-bg-elevated)] px-4 py-3'>
      <p className='text-[11px] text-[var(--landing-text-muted)] uppercase tracking-[0.08em]'>
        {label}
      </p>
      <p
        className={`mt-1 font-[500] text-[var(--landing-text)] ${
          compact ? 'break-all text-[12px] leading-snug' : 'text-[18px]'
        }`}
      >
        {value}
      </p>
    </div>
  )
}

export function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className='rounded-xl border border-[var(--landing-border)] bg-[var(--landing-bg-card)] px-3 py-2'>
      <p className='text-[11px] text-[var(--landing-text-muted)] uppercase tracking-[0.08em]'>
        {label}
      </p>
      <p className='mt-1 break-words font-[500] text-[12px] text-[var(--landing-text)] leading-snug'>
        {value}
      </p>
    </div>
  )
}

export function CapabilityTags({ tags }: { tags: string[] }) {
  if (tags.length === 0) {
    return null
  }

  return (
    <div className='flex flex-wrap gap-2'>
      {tags.map((tag) => (
        <Badge
          key={tag}
          className='border-[var(--landing-border)] bg-transparent px-2 py-1 text-[11px] text-[var(--landing-text-muted)]'
        >
          {tag}
        </Badge>
      ))}
    </div>
  )
}

export function ProviderCard({ provider }: { provider: CatalogProvider }) {
  return (
    <Link
      href={provider.href}
      className='group flex h-full flex-col rounded-lg border border-[var(--landing-border)] bg-[var(--landing-bg-card)] p-4 transition-colors hover:border-[var(--landing-border-strong)] hover:bg-[var(--landing-bg-elevated)]'
    >
      <div className='mb-4 flex items-center gap-3'>
        <ProviderIcon provider={provider} />
        <div className='min-w-0'>
          <h3 className='font-[500] text-[18px] text-[var(--landing-text)]'>{provider.name}</h3>
          <p className='text-[12px] text-[var(--landing-text-muted)]'>
            {provider.modelCount} models tracked
          </p>
        </div>
      </div>

      <p className='mb-4 flex-1 text-[14px] text-[var(--landing-text-muted)] leading-relaxed'>
        {provider.description}
      </p>

      <div className='mb-4 grid grid-cols-2 gap-3'>
        <DetailItem label='Default' value={provider.defaultModelDisplayName || 'Dynamic'} />
        <DetailItem
          label='Catalog'
          value={provider.contextInformationAvailable ? 'Tracked metadata' : 'Partial metadata'}
        />
      </div>

      <CapabilityTags tags={provider.providerCapabilityTags.slice(0, 4)} />

      <p className='mt-4 text-[#555] text-[13px] transition-colors group-hover:text-[var(--landing-text-muted)]'>
        Explore provider →
      </p>
    </Link>
  )
}

export function ModelCard({
  provider,
  model,
  showProvider = false,
}: {
  provider: CatalogProvider
  model: CatalogModel
  showProvider?: boolean
}) {
  return (
    <Link
      href={model.href}
      className='group flex h-full flex-col rounded-lg border border-[var(--landing-border)] bg-[var(--landing-bg-card)] p-4 transition-colors hover:border-[var(--landing-border-strong)] hover:bg-[var(--landing-bg-elevated)]'
    >
      <div className='mb-4 flex items-start gap-3'>
        <ProviderIcon
          provider={provider}
          className='h-10 w-10 rounded-xl'
          iconClassName='h-5 w-5'
        />
        <div className='min-w-0 flex-1'>
          {showProvider ? (
            <p className='mb-1 text-[12px] text-[var(--landing-text-muted)]'>{provider.name}</p>
          ) : null}
          <h3 className='break-all font-[500] text-[16px] text-[var(--landing-text)] leading-snug'>
            {model.displayName}
          </h3>
          <p className='mt-1 break-all text-[12px] text-[var(--landing-text-muted)]'>{model.id}</p>
        </div>
      </div>

      <p className='mb-3 line-clamp-3 flex-1 text-[12px] text-[var(--landing-text-muted)] leading-relaxed'>
        {model.summary}
      </p>

      <div className='flex flex-wrap items-center gap-1.5'>
        <Badge className='border-0 bg-[#333] text-[11px] text-[var(--landing-text-muted)]'>
          {`Input ${formatPrice(model.pricing.input)}/1M`}
        </Badge>
        <Badge className='border-0 bg-[#333] text-[11px] text-[var(--landing-text-muted)]'>
          {`Output ${formatPrice(model.pricing.output)}/1M`}
        </Badge>
        <Badge className='border-0 bg-[#333] text-[11px] text-[var(--landing-text-muted)]'>
          {model.contextWindow
            ? `${formatTokenCount(model.contextWindow)} context`
            : 'Unknown context'}
        </Badge>
        {model.capabilityTags[0] ? (
          <Badge className='border-0 bg-[#333] text-[11px] text-[var(--landing-text-muted)]'>
            {model.capabilityTags[0]}
          </Badge>
        ) : null}
        <span className='ml-auto text-[#555] text-[12px] transition-colors group-hover:text-[var(--landing-text-muted)]'>
          {`Updated ${formatUpdatedAt(model.pricing.updatedAt)} →`}
        </span>
      </div>
    </Link>
  )
}
