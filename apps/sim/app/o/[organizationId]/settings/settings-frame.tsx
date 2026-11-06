'use client'

import { type ReactNode, useContext } from 'react'
import { usePathname } from 'next/navigation'
import { createPortal } from 'react-dom'
import { useSettingsNavigationState } from '@/components/settings/settings-navigation-provider'
import { resolveOrganizationSurfaceHeaderMeta } from '@/app/o/[organizationId]/settings/navigation'
import { MobileTitleSlot } from '@/app/workspace/[workspaceId]/components/workspace-chrome/mobile-title-slot'
import {
  SettingsBreadcrumb,
  SettingsMobileTitle,
  SettingsScreen,
} from '@/platform/app/(shell)/settings/_components/settings-screen/settings-screen'
import { Surface } from '@/platform/design-system/components/surface/surface'

interface SettingsFrameProps {
  children: ReactNode
}

/** On a phone the title joins the navigation toggle, so one bar sits above the page's heading. */
function PhoneTitle({ title }: { title: string }) {
  const slot = useContext(MobileTitleSlot)
  if (!slot) return null
  return createPortal(
    <Surface canvas>
      <SettingsMobileTitle title={title} />
    </Surface>,
    slot
  )
}

/**
 * The breadcrumb over every section. Each section mounts its own surface below it.
 *
 * A clicked section paints its heading over an empty body while its route resolves. The current
 * section stays mounted underneath, invisible and inert, so its state survives if the navigation
 * settles back on it.
 */
export function SettingsFrame({ children }: SettingsFrameProps) {
  const pathname = usePathname()
  const { pendingSection } = useSettingsNavigationState()
  const pending = pendingSection ? resolveOrganizationSurfaceHeaderMeta(pendingSection) : null
  const current = resolveOrganizationSurfaceHeaderMeta(pathname ?? '')
  const title = pending?.title ?? current?.title ?? 'Settings'

  return (
    <div className='flex h-full min-h-0 flex-col bg-[var(--bg)]'>
      <Surface canvas>
        <SettingsBreadcrumb title={title} />
      </Surface>
      <PhoneTitle title={title} />
      <div className='relative min-h-0 flex-1'>
        {pending && (
          <div className='absolute inset-0 z-10 grid grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)]'>
            <Surface canvas>
              <SettingsScreen title={pending.title} description={pending.description} />
            </Surface>
          </div>
        )}
        <div className={pending ? 'invisible h-full' : 'h-full'} inert={pending ? true : undefined}>
          {children}
        </div>
      </div>
    </div>
  )
}
