'use client'

import type { ReactNode } from 'react'
import { Surface } from '@/platform/design-system/components/surface/surface'
import hostStyles from '@/platform/embedded/app/(shell)/settings/_components/settings-host.module.css'
import { SettingsScreen } from '@/platform/embedded/app/(shell)/settings/_components/settings-screen/settings-screen'
import { resolveOrganizationSurfaceHeaderMeta } from '@/platform/embedded/lib/data/settings-sections'

interface SettingsSubpageHostProps {
  /** The section this page belongs to, whose heading it keeps. */
  section: string
  children: ReactNode
}

/** A page under a section, such as one connection, in its own surface below the frame's breadcrumb. */
export function SettingsSubpageHost({ section, children }: SettingsSubpageHostProps) {
  const meta = resolveOrganizationSurfaceHeaderMeta(section)
  return (
    <div className={hostStyles.host}>
      <Surface canvas>
        <SettingsScreen title={meta?.title ?? 'Settings'} description={meta?.description}>
          {children}
        </SettingsScreen>
      </Surface>
    </div>
  )
}
