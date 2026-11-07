'use client'

import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import { Switch } from '@sim/emcn/switch'
import dynamic from 'next/dynamic'
import { SavedSettingsSection } from '@/platform/app/(shell)/settings/_components/section-parts/saved-settings'
import type { SettingsSectionProps } from '@/platform/app/(shell)/settings/_components/section-registry'
import { useTelemetrySetting } from '@/platform/lib/data/preferences'

/** Only the hosted service sets cookies, so only it loads the consent runtime. */
const CookiePreferences = dynamic(
  () => import('@/platform/app/(shell)/settings/_components/sections/privacy/cookie-preferences'),
  { ssr: false, loading: () => <SettingsSection title='Cookies' /> }
)

const TELEMETRY_LABEL = 'Allow browser telemetry'

export default function PrivacySection({ organization, fixture }: SettingsSectionProps) {
  const telemetry = useTelemetrySetting(fixture)
  return (
    <>
      <SavedSettingsSection title='Telemetry'>
        <SettingsRow
          label={TELEMETRY_LABEL}
          description='Share browser performance and error diagnostics to improve Sim. You can opt out at any time. This does not control server operational logs.'
        >
          <Switch
            label={TELEMETRY_LABEL}
            checked={telemetry.checked}
            disabled={telemetry.disabled}
            onCheckedChange={(checked) => void telemetry.set(checked)}
          />
        </SettingsRow>
      </SavedSettingsSection>
      {organization.deployment.hosted && (
        <CookiePreferences
          fixture={fixture}
          policyHref={`${organization.legacyOrigin}/cookie-policy`}
        />
      )}
    </>
  )
}
