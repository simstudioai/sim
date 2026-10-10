'use client'

import { useEffect, useState } from 'react'
import type { DesktopPreferenceKey, DesktopPreferences } from '@sim/desktop-bridge'
import { Label, Switch, toast } from '@sim/emcn'
import { useParams, useRouter } from 'next/navigation'
import { getDesktopBridge, getDesktopShellVersion } from '@/lib/desktop'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import { useDesktopPreferenceMutation } from '@/hooks/use-desktop-preference-mutation'
import { useDesktopUpdateState } from '@/hooks/use-desktop-update-state'

interface PreferenceRowProps {
  id: string
  label: string
  checked: boolean
  disabled?: boolean
  onCheckedChange: (checked: boolean) => void
}

function PreferenceRow({ id, label, checked, disabled, onCheckedChange }: PreferenceRowProps) {
  return (
    <div className='flex items-center justify-between'>
      <Label htmlFor={id}>{label}</Label>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} />
    </div>
  )
}

export function Desktop() {
  const params = useParams()
  const router = useRouter()
  const workspaceId = params.workspaceId as string
  const [preferences, setPreferences] = useState<DesktopPreferences | null>(null)
  const [pendingPreference, setPendingPreference] = useState<DesktopPreferenceKey | null>(null)
  /** Whether Sim runs chats on this device in the background; only then can sleep matter. */
  const [runsInBackground, setRunsInBackground] = useState(false)
  const updateState = useDesktopUpdateState()
  const shellVersion = getDesktopShellVersion()

  useEffect(() => {
    const bridge = getDesktopBridge()
    if (!bridge) {
      router.replace(`/workspace/${workspaceId}/settings/general`)
      return
    }
    void bridge.settings
      .getPreferences()
      .then(setPreferences)
      .catch(() => toast.error('Could not load desktop settings'))
    void bridge.desktopExecutor
      ?.getDevice()
      .then((device) => setRunsInBackground(device !== null))
      .catch(() => setRunsInBackground(false))
    return bridge.settings.onFullFileAccessChanged?.(setPreferences)
  }, [router, workspaceId])

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

  if (!preferences) {
    return null
  }

  const notificationsDisabled =
    !preferences.notificationsEnabled || pendingPreference === 'notificationsEnabled'
  const supportsPreventSleep =
    runsInBackground && Boolean(getDesktopBridge()?.settings.setPreventSleepWhileRunning)

  return (
    <SettingsPanel>
      <SettingsSection label='General'>
        <div className='flex flex-col gap-3'>
          {shellVersion && (
            <div className='flex items-center justify-between'>
              <Label asChild>
                <span>Version</span>
              </Label>
              <span className='text-[var(--text-muted)] text-sm'>
                {updateState.status === 'ready' && updateState.version
                  ? `${shellVersion} → ${updateState.version} on restart`
                  : shellVersion}
              </span>
            </div>
          )}
          <PreferenceRow
            id='desktop-launch-at-login'
            label='Launch Sim at login'
            checked={preferences.launchAtLogin}
            disabled={pendingPreference !== null}
            onCheckedChange={(checked) => void updatePreference('launchAtLogin', checked)}
          />
          {supportsPreventSleep && (
            <PreferenceRow
              id='desktop-prevent-sleep'
              label='Prevent sleep while a chat is running'
              checked={preferences.preventSleepWhileRunning ?? true}
              disabled={preventSleepPending}
              onCheckedChange={(checked) => void setPreventSleep(checked)}
            />
          )}
          <PreferenceRow
            id='desktop-tray-enabled'
            label='Show Sim in Control Center'
            checked={preferences.trayEnabled}
            disabled={pendingPreference !== null}
            onCheckedChange={(checked) => void updatePreference('trayEnabled', checked)}
          />
          <PreferenceRow
            id='desktop-auto-download-updates'
            label='Automatically download updates'
            checked={preferences.autoDownloadUpdates}
            disabled={pendingPreference !== null}
            onCheckedChange={(checked) => void updatePreference('autoDownloadUpdates', checked)}
          />
        </div>
      </SettingsSection>

      {getDesktopBridge()?.settings.setFullFileAccess && (
        <SettingsSection label='Local files'>
          <PreferenceRow
            id='desktop-full-file-access'
            label='Full file access'
            checked={preferences.fullFileAccess ?? false}
            disabled={fullFileAccessPending}
            onCheckedChange={(checked) => void setFullFileAccess(checked)}
          />
        </SettingsSection>
      )}

      <SettingsSection label='Notifications'>
        <div className='flex flex-col gap-3'>
          <PreferenceRow
            id='desktop-notifications'
            label='Enable desktop notifications'
            checked={preferences.notificationsEnabled}
            disabled={pendingPreference !== null}
            onCheckedChange={(checked) => void updatePreference('notificationsEnabled', checked)}
          />
          <PreferenceRow
            id='desktop-notification-sounds'
            label='Play notification sounds'
            checked={preferences.notificationSounds}
            disabled={notificationsDisabled || pendingPreference !== null}
            onCheckedChange={(checked) => void updatePreference('notificationSounds', checked)}
          />
          <PreferenceRow
            id='desktop-notifications-unfocused'
            label="Notify only when Sim isn't focused"
            checked={preferences.notificationsOnlyWhenUnfocused}
            disabled={notificationsDisabled || pendingPreference !== null}
            onCheckedChange={(checked) =>
              void updatePreference('notificationsOnlyWhenUnfocused', checked)
            }
          />
        </div>
      </SettingsSection>
    </SettingsPanel>
  )
}
