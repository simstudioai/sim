'use client'

import { useEffect, useState } from 'react'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import { FailureNotice } from '@sim/emcn/status'
import { Switch } from '@sim/emcn/switch'
import { toast } from '@/lib/toast/sink'
import type { SettingsSectionProps } from '@/platform/app/(shell)/settings/_components/section-registry'
import { ComputerUse } from '@/platform/app/(shell)/settings/_components/sections/desktop/computer-use'
import {
  type DesktopPreferenceKey,
  getDesktopBridge,
  getDesktopShellVersion,
  useDesktopPreferenceMutation,
  useDesktopRead,
  useDesktopUpdateState,
} from '@/platform/lib/data/desktop'

interface PreferenceRowProps {
  label: string
  checked: boolean
  disabled: boolean
  onCheckedChange: (checked: boolean) => void
}

function PreferenceRow({ label, checked, disabled, onCheckedChange }: PreferenceRowProps) {
  return (
    <SettingsRow label={label}>
      <Switch
        label={label}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
      />
    </SettingsRow>
  )
}

/** Device-level settings the desktop shell owns. Outside the desktop app it opens General. */
export default function DesktopSection({ organization }: SettingsSectionProps) {
  const {
    data: preferences,
    setData: setPreferences,
    failed,
    retry,
  } = useDesktopRead((bridge) => bridge.settings.getPreferences())
  const [pendingPreference, setPendingPreference] = useState<DesktopPreferenceKey | null>(null)
  /** Whether Sim runs chats on this device in the background; only then can sleep matter. */
  const [runsInBackground, setRunsInBackground] = useState(false)
  const updateState = useDesktopUpdateState()

  useEffect(() => {
    const bridge = getDesktopBridge()
    if (!bridge) return
    void bridge.desktopExecutor
      ?.getDevice()
      .then((device) => setRunsInBackground(device !== null))
      .catch(() => setRunsInBackground(false))
    return bridge.settings.onFullFileAccessChanged?.(setPreferences)
  }, [setPreferences])

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

  if (failed) return <FailureNotice message='Could not load desktop settings' onRetry={retry} />
  if (!preferences) return null

  const updatePreference = async (key: DesktopPreferenceKey, value: boolean) => {
    const settings = getDesktopBridge()?.settings
    if (!settings) return
    setPendingPreference(key)
    try {
      setPreferences(await settings.setPreference(key, value))
    } catch {
      toast.error('Could not update desktop settings')
    } finally {
      setPendingPreference(null)
    }
  }

  const settings = getDesktopBridge()?.settings
  const shellVersion = getDesktopShellVersion()
  const generalPending = pendingPreference !== null
  const notificationsDisabled =
    !preferences.notificationsEnabled || pendingPreference === 'notificationsEnabled'
  const supportsPreventSleep = runsInBackground && Boolean(settings?.setPreventSleepWhileRunning)

  return (
    <>
      <ComputerUse enabled={organization.featureFlags['mothership-computer-use']} />
      <SettingsSection title='General'>
        {shellVersion && (
          <SettingsRow label='Version'>
            <span data-type='T067'>
              {updateState.status === 'ready' && updateState.version
                ? `${shellVersion} → ${updateState.version} on restart`
                : shellVersion}
            </span>
          </SettingsRow>
        )}
        <PreferenceRow
          label='Launch Sim at login'
          checked={preferences.launchAtLogin}
          disabled={generalPending}
          onCheckedChange={(checked) => void updatePreference('launchAtLogin', checked)}
        />
        {supportsPreventSleep && (
          <PreferenceRow
            label='Prevent sleep while a chat is running'
            checked={preferences.preventSleepWhileRunning ?? true}
            disabled={preventSleepPending}
            onCheckedChange={(checked) => void setPreventSleep(checked)}
          />
        )}
        <PreferenceRow
          label='Show Sim in Control Center'
          checked={preferences.trayEnabled}
          disabled={generalPending}
          onCheckedChange={(checked) => void updatePreference('trayEnabled', checked)}
        />
        <PreferenceRow
          label='Automatically download updates'
          checked={preferences.autoDownloadUpdates}
          disabled={generalPending}
          onCheckedChange={(checked) => void updatePreference('autoDownloadUpdates', checked)}
        />
      </SettingsSection>
      {settings?.setFullFileAccess && (
        <SettingsSection title='Local files'>
          <PreferenceRow
            label='Full file access'
            checked={preferences.fullFileAccess ?? false}
            disabled={fullFileAccessPending}
            onCheckedChange={(checked) => void setFullFileAccess(checked)}
          />
        </SettingsSection>
      )}
      <SettingsSection title='Notifications'>
        <PreferenceRow
          label='Enable desktop notifications'
          checked={preferences.notificationsEnabled}
          disabled={generalPending}
          onCheckedChange={(checked) => void updatePreference('notificationsEnabled', checked)}
        />
        <PreferenceRow
          label='Play notification sounds'
          checked={preferences.notificationSounds}
          disabled={notificationsDisabled || generalPending}
          onCheckedChange={(checked) => void updatePreference('notificationSounds', checked)}
        />
        <PreferenceRow
          label="Notify only when Sim isn't focused"
          checked={preferences.notificationsOnlyWhenUnfocused}
          disabled={notificationsDisabled || generalPending}
          onCheckedChange={(checked) =>
            void updatePreference('notificationsOnlyWhenUnfocused', checked)
          }
        />
      </SettingsSection>
    </>
  )
}
