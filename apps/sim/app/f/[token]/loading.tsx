import { SimWordmark } from '@sim/emcn'
import { DesktopTitleBarLane } from '@/app/_shell/desktop-title-bar'
import { getBrandConfig } from '@/ee/whitelabeling'

export default function SharedResourceLoading() {
  const brand = getBrandConfig()
  return (
    <div className='light desktop-title-bar-page flex h-screen flex-col bg-[var(--bg)]'>
      <DesktopTitleBarLane />
      <header className='flex shrink-0 items-center gap-3 border-[var(--border)] border-b px-4 py-3'>
        {!brand.logoUrl && <SimWordmark />}
        <span className='text-[var(--text-muted)] text-sm'>Shared files</span>
      </header>
      <div
        role='status'
        className='flex flex-1 items-center justify-center text-[var(--text-muted)] text-sm'
      >
        Loading…
      </div>
    </div>
  )
}
