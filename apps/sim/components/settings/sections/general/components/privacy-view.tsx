'use client'

import { ArrowLeft, Label, Switch, toast } from '@sim/emcn-legacy'
import { getErrorMessage } from '@sim/utils/errors'
import { SettingsPanel } from '@/components/settings/primitives/settings-panel'
import { SettingsSection } from '@/components/settings/primitives/settings-section/settings-section'
import { CookiePreferences } from '@/components/settings/sections/general/components/cookie-preferences'
import { useDeploymentShape } from '@/lib/core/config/deployment-shape'
import {
  getBrowserTelemetryPreference,
  setBrowserTelemetryPreference,
} from '@/lib/telemetry/browser-preference'
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
  const { hosted } = useDeploymentShape()

  const handleTelemetryToggle = async (checked: boolean) => {
    if (checked === settings?.telemetryEnabled || updateSetting.isPending) return

    const previous = getBrowserTelemetryPreference()
    setBrowserTelemetryPreference(false)
    try {
      await updateSetting.mutateAsync({ key: 'telemetryEnabled', value: checked })
      setBrowserTelemetryPreference(checked)
    } catch (error) {
      setBrowserTelemetryPreference(previous)
      toast.error(getErrorMessage(error, 'Could not save your telemetry preference'))
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
            <Label htmlFor='telemetry'>Allow browser telemetry</Label>
            <Switch
              id='telemetry'
              checked={settings?.telemetryEnabled ?? true}
              disabled={!settings || updateSetting.isPending}
              onCheckedChange={handleTelemetryToggle}
            />
          </div>
          <p className='text-[var(--text-muted)] text-small'>
            Share browser performance and error diagnostics to improve Sim. You can opt out at any
            time. This does not control server operational logs.
          </p>
        </div>
      </SettingsSection>

      {hosted && <CookiePreferences />}
    </SettingsPanel>
  )
}
