'use client'

import { useCallback, useEffect, useState } from 'react'
import type {
  DesktopPreferenceKey,
  DesktopPreferences,
  LocalFilesystemMount,
  LocalFilesystemResponse,
} from '@sim/desktop-bridge'
import {
  Chip,
  ChipConfirmModal,
  Label,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableRow,
  toast,
} from '@sim/emcn'
import { useParams, useRouter } from 'next/navigation'
import { getDesktopBridge } from '@/lib/desktop'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
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
    <TableRow>
      <TableCell>
        <Label htmlFor={id}>{label}</Label>
      </TableCell>
      <TableCell>
        <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} />
      </TableCell>
    </TableRow>
  )
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
          <Table>
            <TableBody>
              <PreferenceRow
                id='desktop-notifications'
                label='Enable desktop notifications'
                checked={preferences.notificationsEnabled}
                disabled={pendingPreference !== null}
                onCheckedChange={(checked) =>
                  void updatePreference('notificationsEnabled', checked)
                }
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
            </TableBody>
          </Table>
        </SettingsSection>

        <SettingsSection label='App behavior'>
          <Table>
            <TableBody>
              <PreferenceRow
                id='desktop-launch-at-login'
                label='Launch Sim at login'
                checked={preferences.launchAtLogin}
                disabled={pendingPreference !== null}
                onCheckedChange={(checked) => void updatePreference('launchAtLogin', checked)}
              />
            </TableBody>
          </Table>
        </SettingsSection>

        <SettingsSection
          label='Files'
          action={
            <Chip onClick={() => void addFolder()} disabled={mountMutationPending}>
              Add folder
            </Chip>
          }
        >
          {mounts.length === 0 ? (
            <SettingsEmptyState variant='inline'>No folders added.</SettingsEmptyState>
          ) : (
            <Table>
              <TableBody>
                {mounts.map((mount) => (
                  <TableRow key={mount.id}>
                    <TableCell>{mount.name}</TableCell>
                    <TableCell>{mount.uri}</TableCell>
                    <TableCell>
                      <Chip onClick={() => setMountToForget(mount)}>Revoke</Chip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </SettingsSection>

        <SettingsSection label='Updates'>
          <Table>
            <TableBody>
              <PreferenceRow
                id='desktop-auto-download-updates'
                label='Automatically download updates'
                checked={preferences.autoDownloadUpdates}
                disabled={pendingPreference !== null}
                onCheckedChange={(checked) => void updatePreference('autoDownloadUpdates', checked)}
              />
            </TableBody>
          </Table>
        </SettingsSection>
      </SettingsPanel>

      <ChipConfirmModal
        open={mountToForget !== null}
        onOpenChange={(open) => !open && setMountToForget(null)}
        title='Revoke folder access'
        text={`Sim will no longer be able to access ${mountToForget?.name ?? 'this folder'}.`}
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
