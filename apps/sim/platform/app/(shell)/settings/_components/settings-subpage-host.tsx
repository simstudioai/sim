'use client'

import type { ReactNode } from 'react'
import { RedesignSurface } from '@/app/o/[organizationId]/_redesign/redesign-host'
import { resolveOrganizationSurfaceHeaderMeta } from '@/app/o/[organizationId]/settings/navigation'
import { SettingsScreen } from '@/platform/app/(shell)/settings/_components/settings-screen/settings-screen'

interface SettingsSubpageHostProps {
  /** The section this page belongs to, whose heading it keeps. */
  section: string
  children: ReactNode
}

/** A page under a section, such as one connection, in its own surface below the frame's breadcrumb. */
export function SettingsSubpageHost({ section, children }: SettingsSubpageHostProps) {
  const meta = resolveOrganizationSurfaceHeaderMeta(section)
  return (
    <div className='grid h-full min-h-0 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)]'>
      <RedesignSurface>
        <SettingsScreen title={meta?.title ?? 'Settings'} description={meta?.description}>
          {children}
        </SettingsScreen>
      </RedesignSurface>
    </div>
  )
}
