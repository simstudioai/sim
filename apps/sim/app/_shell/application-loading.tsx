import { cn, SimWordmark } from '@sim/emcn'
import { DesktopTitleBarLane } from '@/app/_shell/desktop-title-bar'
import { type BrandConfig, getBrandConfig } from '@/ee/whitelabeling'

interface ApplicationLoadingProps {
  brand?: BrandConfig
  fullScreen?: boolean
}

/** Shared loading surface for app entry, shell prefetch, and workflow navigation. */
export function ApplicationLoading({
  brand = getBrandConfig(),
  fullScreen = true,
}: ApplicationLoadingProps) {
  const wordmarkUrl = brand.wordmarkUrl || brand.logoUrl

  return (
    <div
      role='status'
      aria-label={`Loading ${brand.name}`}
      className={cn(
        'flex w-full items-center justify-center bg-[var(--bg)]',
        fullScreen ? 'desktop-title-bar-page' : 'h-full'
      )}
    >
      {fullScreen && <DesktopTitleBarLane />}
      {wordmarkUrl ? (
        <img src={wordmarkUrl} alt='' className='h-8 max-w-[240px] object-contain' />
      ) : brand.isWhitelabeled ? (
        <span className='text-[var(--text-tertiary)] text-lg'>{brand.name}</span>
      ) : (
        <SimWordmark size='loading' tone='brand-muted' />
      )}
    </div>
  )
}
