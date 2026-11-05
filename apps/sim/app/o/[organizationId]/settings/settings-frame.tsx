'use client'

import type { ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { useSettingsNavigationState } from '@/components/settings/settings-navigation-provider'
import { RedesignSurface } from '@/app/o/[organizationId]/_redesign/redesign-host'
import { resolveOrganizationSurfaceHeaderMeta } from '@/app/o/[organizationId]/settings/navigation'
import {
  SettingsBreadcrumb,
  SettingsScreen,
} from '@/platform/app/(shell)/settings/_components/settings-screen/settings-screen'

interface SettingsFrameProps {
  children: ReactNode
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
      <RedesignSurface>
        <SettingsBreadcrumb title={title} />
      </RedesignSurface>
      <div className='relative min-h-0 flex-1'>
        {pending && (
          <div className='absolute inset-0 z-10 grid grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)]'>
            <RedesignSurface>
              <SettingsScreen title={pending.title} description={pending.description} />
            </RedesignSurface>
          </div>
        )}
        <div className={pending ? 'invisible h-full' : 'h-full'} inert={pending ? true : undefined}>
          {children}
        </div>
      </div>
    </div>
  )
}
