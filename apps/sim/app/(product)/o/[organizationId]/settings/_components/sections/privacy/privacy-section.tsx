'use client'

import type { ReactNode } from 'react'
import { SettingsSection } from '@sim/emcn/settings-section'
import dynamic from 'next/dynamic'
import { SavedSettingsSection } from '@/app/(product)/_components/settings-parts/saved-settings'
import { SwitchRow } from '@/app/(product)/_components/settings-parts/switch-row'
import { useTelemetrySetting } from '@/platform/lib/data/preferences'

const cookiesPending = () => <SettingsSection title='Cookies' />

/** Only the hosted service sets cookies, so only it loads the consent runtime. */
export const LiveCookies = dynamic(
  () =>
    import(
      '@/app/(product)/o/[organizationId]/settings/_components/sections/privacy/cookie-preferences'
    ).then((module) => module.CookieCategories),
  { ssr: false, loading: cookiesPending }
)

export const SessionCookies = dynamic(
  () =>
    import(
      '@/app/(product)/o/[organizationId]/settings/_components/sections/privacy/cookie-preferences'
    ).then((module) => module.SessionCookieCategories),
  { ssr: false, loading: cookiesPending }
)

interface PrivacySectionProps {
  /** The cookie choices, filled by the route on the hosted service; nothing elsewhere. */
  cookies: ReactNode
  /** Leaves the browser's own telemetry preference alone on a fixture preview. */
  preview?: boolean
}

export default function PrivacySection({ cookies, preview }: PrivacySectionProps) {
  const telemetry = useTelemetrySetting(preview)
  return (
    <>
      <SavedSettingsSection title='Telemetry'>
        <SwitchRow
          label='Allow browser telemetry'
          description='Share browser performance and error diagnostics to help improve Sim'
          checked={telemetry.checked}
          disabled={telemetry.disabled}
          onCheckedChange={(checked) => void telemetry.set(checked)}
        />
      </SavedSettingsSection>
      {cookies}
    </>
  )
}
