'use client'

import { ArrowLeft, Label, Switch } from '@sim/emcn'
import { requestJson } from '@/lib/api/client/request'
import { telemetryContract } from '@/lib/api/contracts/telemetry'
import { isHosted } from '@/lib/core/config/env-flags'
import { CookiePreferences } from '@/app/workspace/[workspaceId]/settings/components/general/components/cookie-preferences'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import { useGeneralSettings, useUpdateGeneralSetting } from '@/hooks/queries/general-settings'

interface PrivacyViewProps {
  onBack: () => void
}

/**
 * Privacy sub-view of General — the one place a signed-in user changes what Sim
 * may collect.
 *
 * A detail sub-view rather than its own settings tab: the nav is already long,
 * and a tab a user opens once and never returns to is the wrong weight for it.
 * Telemetry shows everywhere; cookies only on the hosted service, which is the
 * only deployment that sets them.
 */
export function PrivacyView({ onBack }: PrivacyViewProps) {
  const { data: settings } = useGeneralSettings()
  const updateSetting = useUpdateGeneralSetting()

  const handleTelemetryToggle = async (checked: boolean) => {
    if (checked === settings?.telemetryEnabled || updateSetting.isPending) return

    await updateSetting.mutateAsync({ key: 'telemetryEnabled', value: checked })

    if (checked && typeof window !== 'undefined') {
      requestJson(telemetryContract, {
        body: {
          category: 'consent',
          action: 'enable_from_settings',
          timestamp: new Date().toISOString(),
        },
      }).catch(() => {})
    }
  }

  return (
    <SettingsPanel
      back={{ text: 'General', icon: ArrowLeft, onSelect: onBack }}
      title='Privacy'
      description='Control what Sim collects about how you use it.'
    >
      <SettingsSection label='Telemetry'>
        <div className='flex flex-col gap-3'>
          <div className='flex items-center justify-between'>
            <Label htmlFor='telemetry'>Allow anonymous telemetry</Label>
            <Switch
              id='telemetry'
              checked={settings?.telemetryEnabled ?? true}
              onCheckedChange={handleTelemetryToggle}
            />
          </div>
          <p className='text-[var(--text-muted)] text-small'>
            We use OpenTelemetry to collect anonymous usage data to improve Sim. You can opt-out at
            any time.
          </p>
        </div>
      </SettingsSection>

      {isHosted && <CookiePreferences />}
    </SettingsPanel>
  )
}
