'use client'

import { useEffect } from 'react'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import { FailureNotice } from '@sim/emcn/status'
import { SettingsPageHeader } from '@/app/(product)/_components/settings-parts/settings-page'
import { SwitchRow } from '@/app/(product)/_components/settings-parts/switch-row'
import type { SettingsSectionProps } from '@/app/(product)/o/[organizationId]/settings/_components/section-registry'
import {
  ComputerUseActivity,
  ComputerUseSettings,
} from '@/app/(product)/o/[organizationId]/settings/_components/sections/desktop/computer-use'
import {
  type DesktopPreferenceKey,
  type DesktopPreferences,
  getDesktopBridge,
  getDesktopShellVersion,
  useComputerUseStatus,
  useDesktopPreferenceMutation,
  useDesktopRead,
  useDesktopUpdateState,
} from '@/platform/lib/data/desktop'

interface DesktopData {
  preferences: DesktopPreferences
  /** Whether Sim runs chats on this device in the background; only then can sleep matter. */
  runsInBackground: boolean
}

/** Device-level settings the desktop shell owns. Outside the desktop app it opens Preferences. */
export default function DesktopSection({ organization }: SettingsSectionProps) {
  const { data, setData, failed, retry } = useDesktopRead(async (bridge): Promise<DesktopData> => {
    const [preferences, device] = await Promise.all([
      bridge.settings.getPreferences(),
      bridge.desktopExecutor?.getDevice().catch(() => null) ?? null,
    ])
    return { preferences, runsInBackground: device !== null }
  })
  const updateState = useDesktopUpdateState()
  const computerUse = useComputerUseStatus()
  const setPreferences = (preferences: DesktopPreferences) =>
    setData((current) => current && { ...current, preferences })

  useEffect(
    () =>
      getDesktopBridge()?.settings.onFullFileAccessChanged?.((preferences) =>
        setData((current) => current && { ...current, preferences })
      ),
    [setData]
  )

  const { pending: preferencePending, mutate: setPreference } = useDesktopPreferenceMutation(
    (bridge, key: DesktopPreferenceKey, value: boolean) =>
      bridge.settings.setPreference(key, value),
    'Could not update desktop settings',
    setPreferences
  )
  const { pending: preventSleepPending, mutate: setPreventSleep } = useDesktopPreferenceMutation(
    async (bridge, enabled: boolean) => bridge.settings.setPreventSleepWhileRunning?.(enabled),
    'Could not update desktop settings',
    setPreferences
  )
  const { pending: fullFileAccessPending, mutate: setFullFileAccess } =
    useDesktopPreferenceMutation(
      async (bridge, enabled: boolean) => bridge.settings.setFullFileAccess?.(enabled),
      'Could not save file access settings. Your previous setting may return after restarting Sim.',
      setPreferences
    )

  if (failed)
    return (
      <>
        <SettingsPageHeader />
        <FailureNotice message='Could not load desktop settings' onRetry={retry} />
      </>
    )
  if (!data) return <SettingsPageHeader />

  const { preferences } = data
  const settings = getDesktopBridge()?.settings
  const shellVersion = getDesktopShellVersion()
  const notificationsOff = !preferences.notificationsEnabled
  const supportsPreventSleep =
    data.runsInBackground && Boolean(settings?.setPreventSleepWhileRunning)

  return (
    <>
      <SettingsPageHeader />
      <ComputerUseActivity activeAction={computerUse.activeAction} />
      <SettingsSection title='General'>
        {shellVersion && (
          <SettingsRow label='Version' description='The desktop app version on this computer'>
            <span data-type='T067'>
              {updateState.status === 'ready' && updateState.version
                ? `${shellVersion} → ${updateState.version} on restart`
                : shellVersion}
            </span>
          </SettingsRow>
        )}
        <SwitchRow
          label='Launch Sim at login'
          description='Open Sim when you sign in to this computer'
          checked={preferences.launchAtLogin}
          disabled={preferencePending}
          onCheckedChange={(checked) => void setPreference('launchAtLogin', checked)}
        />
        {supportsPreventSleep && (
          <SwitchRow
            label='Prevent sleep while a chat is running'
            description='Keep this computer awake until a chat finishes'
            checked={preferences.preventSleepWhileRunning ?? true}
            disabled={preventSleepPending}
            onCheckedChange={(checked) => void setPreventSleep(checked)}
          />
        )}
        <SwitchRow
          label='Show Sim in the menu bar'
          description='Open recent chats from an icon in the menu bar'
          checked={preferences.trayEnabled}
          disabled={preferencePending}
          onCheckedChange={(checked) => void setPreference('trayEnabled', checked)}
        />
        <SwitchRow
          label='Automatically download updates'
          description='Download new versions in the background'
          checked={preferences.autoDownloadUpdates}
          disabled={preferencePending}
          onCheckedChange={(checked) => void setPreference('autoDownloadUpdates', checked)}
        />
      </SettingsSection>
      {settings?.setFullFileAccess && (
        <SettingsSection title='Local files'>
          <SwitchRow
            label='Full file access'
            description='Sim can read and import files from any folder on this computer'
            checked={preferences.fullFileAccess ?? false}
            disabled={fullFileAccessPending}
            onCheckedChange={(checked) => void setFullFileAccess(checked)}
          />
        </SettingsSection>
      )}
      <SettingsSection title='Notifications'>
        <SwitchRow
          label='Enable desktop notifications'
          description='When a run needs your attention'
          checked={preferences.notificationsEnabled}
          disabled={preferencePending}
          onCheckedChange={(checked) => void setPreference('notificationsEnabled', checked)}
        />
        <SwitchRow
          label='Play notification sounds'
          description='Play a sound when work finishes'
          checked={preferences.notificationSounds}
          disabled={notificationsOff || preferencePending}
          onCheckedChange={(checked) => void setPreference('notificationSounds', checked)}
        />
        <SwitchRow
          label="Notify only when Sim isn't focused"
          description='Stay quiet while you are using Sim'
          checked={preferences.notificationsOnlyWhenUnfocused}
          disabled={notificationsOff || preferencePending}
          onCheckedChange={(checked) =>
            void setPreference('notificationsOnlyWhenUnfocused', checked)
          }
        />
      </SettingsSection>
      <ComputerUseSettings
        enabled={organization.featureFlags['mothership-computer-use']}
        computerUse={computerUse}
      />
    </>
  )
}
