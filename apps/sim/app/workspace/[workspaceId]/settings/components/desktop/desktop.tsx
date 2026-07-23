'use client'

import { useCallback, useEffect, useState } from 'react'
import type {
  DesktopPreferenceKey,
  DesktopPreferences,
  DesktopUpdateState,
  LocalFilesystemMount,
  LocalFilesystemResponse,
} from '@sim/desktop-bridge'
import { Chip, ChipConfirmModal, Label, Switch, toast } from '@sim/emcn'
import { Folder } from '@sim/emcn/icons'
import { useParams, useRouter } from 'next/navigation'
import { getDesktopBridge, getDesktopShellVersion, getDesktopUpdates } from '@/lib/desktop'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import { SettingsResourceRow } from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'

function getMounts(response: LocalFilesystemResponse): LocalFilesystemMount[] | null {
  return response.ok && 'mounts' in response.data ? response.data.mounts : null
}

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

interface UpdateChip {
  label: string
  disabled?: boolean
  onClick: () => void
}

/** The Updates section's single action, driven by the shell update pipeline. */
function updateChipFor(state: DesktopUpdateState): UpdateChip {
  const updates = getDesktopUpdates()
  const check = () => updates?.check()
  switch (state.status) {
    case 'checking':
      return { label: 'Checking...', disabled: true, onClick: () => {} }
    case 'available':
      return { label: 'Download update', onClick: check }
    case 'downloading':
      return {
        label: state.percent !== undefined ? `Downloading ${state.percent}%` : 'Downloading...',
        disabled: true,
        onClick: () => {},
      }
    case 'ready':
      return { label: 'Restart to update', onClick: () => updates?.install() }
    case 'error':
      return { label: 'Try again', onClick: check }
    default:
      return { label: 'Check for updates', onClick: check }
  }
}

export function Desktop() {
  const params = useParams()
  const router = useRouter()
  const workspaceId = params.workspaceId as string
  const [preferences, setPreferences] = useState<DesktopPreferences | null>(null)
  const [mounts, setMounts] = useState<LocalFilesystemMount[]>([])
  const [pendingPreference, setPendingPreference] = useState<DesktopPreferenceKey | null>(null)
  const [mountToForget, setMountToForget] = useState<LocalFilesystemMount | null>(null)
  const [mountMutationPending, setMountMutationPending] = useState(false)
  const [updateState, setUpdateState] = useState<DesktopUpdateState>({ status: 'idle' })
  const [hasUpdatesSurface, setHasUpdatesSurface] = useState(false)
  const [shellVersion, setShellVersion] = useState<string | undefined>(undefined)

  const refreshMounts = useCallback(async () => {
    const bridge = getDesktopBridge()
    if (!bridge) return
    const response = await bridge.localFilesystem({ operation: 'list_mounts' })
    const nextMounts = getMounts(response)
    if (nextMounts) {
      setMounts(nextMounts)
      return
    }
    toast.error('Could not load folder access')
  }, [])

  useEffect(() => {
    const bridge = getDesktopBridge()
    if (!bridge?.settings) {
      router.replace(`/workspace/${workspaceId}/settings/general`)
      return
    }
    void Promise.all([bridge.settings.getPreferences(), refreshMounts()])
      .then(([nextPreferences]) => setPreferences(nextPreferences))
      .catch(() => toast.error('Could not load desktop settings'))
  }, [refreshMounts, router, workspaceId])

  useEffect(() => {
    setShellVersion(getDesktopShellVersion())
    const updates = getDesktopUpdates()
    if (!updates) return
    setHasUpdatesSurface(true)
    const unsubscribe = updates.onState(setUpdateState)
    void updates
      .getState()
      .then(setUpdateState)
      .catch(() => {})
    return unsubscribe
  }, [])

  const updatePreference = useCallback(async (key: DesktopPreferenceKey, value: boolean) => {
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
  }, [])

  const addFolder = useCallback(async () => {
    const bridge = getDesktopBridge()
    if (!bridge) return
    setMountMutationPending(true)
    try {
      const response = await bridge.localFilesystem({ operation: 'mount_directory' })
      if (!response.ok) {
        toast.error('Could not add folder access')
        return
      }
      await refreshMounts()
    } finally {
      setMountMutationPending(false)
    }
  }, [refreshMounts])

  const forgetFolder = useCallback(async () => {
    const bridge = getDesktopBridge()
    if (!bridge || !mountToForget) return
    setMountMutationPending(true)
    try {
      const response = await bridge.localFilesystem({
        operation: 'forget_mount',
        uri: mountToForget.uri,
      })
      if (!response.ok) {
        toast.error('Could not revoke folder access')
        return
      }
      setMountToForget(null)
      await refreshMounts()
    } finally {
      setMountMutationPending(false)
    }
  }, [mountToForget, refreshMounts])

  if (!preferences) {
    return null
  }

  const notificationsDisabled =
    !preferences.notificationsEnabled || pendingPreference === 'notificationsEnabled'

  return (
    <>
      <SettingsPanel>
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

        <SettingsSection label='App behavior'>
          <div className='flex flex-col gap-3'>
            <PreferenceRow
              id='desktop-launch-at-login'
              label='Launch Sim at login'
              checked={preferences.launchAtLogin}
              disabled={pendingPreference !== null}
              onCheckedChange={(checked) => void updatePreference('launchAtLogin', checked)}
            />
          </div>
        </SettingsSection>

        <SettingsSection
          label='Updates'
          action={
            hasUpdatesSurface
              ? (() => {
                  const chip = updateChipFor(updateState)
                  return (
                    <Chip onClick={chip.onClick} disabled={chip.disabled}>
                      {chip.label}
                    </Chip>
                  )
                })()
              : undefined
          }
        >
          <div className='flex flex-col gap-3'>
            <PreferenceRow
              id='desktop-auto-download-updates'
              label='Automatically download updates'
              checked={preferences.autoDownloadUpdates}
              disabled={pendingPreference !== null}
              onCheckedChange={(checked) => void updatePreference('autoDownloadUpdates', checked)}
            />
            {shellVersion && (
              <div className='flex items-center justify-between'>
                <Label>Version</Label>
                <span className='text-[var(--text-muted)] text-caption'>
                  {updateState.status === 'ready' && updateState.version
                    ? `${shellVersion} → ${updateState.version} on restart`
                    : shellVersion}
                </span>
              </div>
            )}
          </div>
        </SettingsSection>

        <SettingsSection
          label='Local folders'
          action={
            <Chip onClick={() => void addFolder()} disabled={mountMutationPending}>
              Add folder
            </Chip>
          }
        >
          {mounts.length === 0 ? (
            <SettingsEmptyState variant='inline'>
              No folder access granted. Chat can only read folders you add here.
            </SettingsEmptyState>
          ) : (
            <div className='flex flex-col gap-2'>
              {mounts.map((mount) => (
                <SettingsResourceRow
                  key={mount.id}
                  icon={<Folder />}
                  title={mount.name}
                  description='Read-only access for Mothership'
                  trailing={
                    <div className='flex flex-shrink-0 items-center gap-2'>
                      {!mount.remembered && (
                        <span className='text-[var(--text-muted)] text-caption'>
                          Until app restarts
                        </span>
                      )}
                      <Chip onClick={() => setMountToForget(mount)}>Revoke</Chip>
                    </div>
                  }
                />
              ))}
            </div>
          )}
        </SettingsSection>
      </SettingsPanel>

      <ChipConfirmModal
        open={mountToForget !== null}
        onOpenChange={(open) => !open && setMountToForget(null)}
        title='Revoke folder access'
        text={[
          'Sim will no longer be able to read ',
          { text: mountToForget?.name ?? 'this folder', bold: true },
          '. You can grant access again at any time.',
        ]}
        confirm={{
          label: 'Revoke access',
          pending: mountMutationPending,
          pendingLabel: 'Revoking...',
          onClick: () => void forgetFolder(),
        }}
      />
    </>
  )
}
