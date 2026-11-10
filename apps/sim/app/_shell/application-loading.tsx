import { SimWordmark } from '@sim/emcn-legacy'
import { defaultBrandConfig } from '@/lib/branding'
import { DesktopTitleBarLane } from '@/app/_shell/desktop-title-bar'
import { getBrandConfig } from '@/ee/whitelabeling'

/** Shared full-screen loading surface for the standalone site routes. */
export function ApplicationLoading() {
  const brand = getBrandConfig()
  return (
    <div
      role='status'
      aria-label={`Loading ${brand.name}`}
      className='desktop-title-bar-page flex w-full items-center justify-center bg-[var(--bg)]'
    >
      <DesktopTitleBarLane />
      {brand.wordmarkUrl ? (
        <img src={brand.wordmarkUrl} alt='' className='h-8 max-w-[240px] object-contain' />
      ) : brand.name !== defaultBrandConfig.name ? (
        <span className='text-[var(--text-tertiary)] text-lg'>{brand.name}</span>
      ) : (
        <SimWordmark size='loading' tone='brand-muted' />
      )}
    </div>
  )
}
