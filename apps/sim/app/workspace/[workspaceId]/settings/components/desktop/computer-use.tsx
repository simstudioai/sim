'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ComputerUseAppPermission } from '@sim/desktop-bridge'
import { Chip, ChipSwitch, Label, toast } from '@sim/emcn'
import { useParams } from 'next/navigation'
import { ComputerUseActivity } from '@/components/computer-use/activity'
import { getDesktopBridge } from '@/lib/desktop'
import { CAPABILITY_RULES } from '@/lib/permission-groups/capabilities'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import { useUserPermissionConfig } from '@/ee/access-control/hooks/permission-groups'
import { useComputerUseStatus } from '@/hooks/use-computer-use-status'

const ON_OFF_OPTIONS = [
  { value: 'off', label: 'Off' },
  { value: 'on', label: 'On' },
]

/** The activity stays visible so an in-flight action can be stopped; the device controls need the permission group's consent. */
export function ComputerUseSettings() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const permission = useUserPermissionConfig(workspaceId)
  const allowed =
    permission.isSuccess &&
    (permission.data.config === null ||
      !CAPABILITY_RULES['computer_use.use'].deniedBy(permission.data.config))
  return (
    <>
      <ComputerUseActivity />
      {allowed && <ComputerUseSettingsControls />}
    </>
  )
}

function ComputerUseSettingsControls() {
  const requestVersion = useRef(0)
  const bridge = getDesktopBridge()?.computerUse
  const { status, setStatus, refresh, error } = useComputerUseStatus()
  const [apps, setApps] = useState<ComputerUseAppPermission[]>([])
  const [pending, setPending] = useState(false)
  const refreshApps = useCallback(async () => {
    if (!bridge) return
    const version = ++requestVersion.current
    try {
      const approved = await bridge.listAppPermissions()
      if (version === requestVersion.current) setApps(approved)
    } catch {
      if (version === requestVersion.current) toast.error('Could not load approved apps')
    }
  }, [bridge])
  useEffect(() => {
    void refreshApps()
    return () => {
      requestVersion.current += 1
    }
  }, [refreshApps, status?.activeAction])
  if (!bridge || status?.supported === false) return null
  const update = async (action: () => Promise<void>) => {
    setPending(true)
    try {
      await action()
    } catch {
      toast.error('Could not update Computer Use settings')
    } finally {
      setPending(false)
    }
  }
  const askForApps = status?.askForApps
  const setAskForApps = bridge.setAskForApps
  return (
    <SettingsSection label='Computer Use'>
      <div className='flex flex-col gap-3'>
        <div className='flex items-center justify-between'>
          <Label asChild>
            <span>Use apps on this Mac</span>
          </Label>
          <ChipSwitch
            aria-label='Use apps on this Mac'
            options={ON_OFF_OPTIONS}
            value={status?.enabled ? 'on' : 'off'}
            disabled={pending || !status}
            onChange={(value) =>
              void update(async () => setStatus(await bridge.setEnabled(value === 'on')))
            }
          />
        </div>
        <p className='text-[var(--text-muted)] text-sm'>
          Sim can use any app except terminals, password managers, and System Settings.
        </p>
        {error && (
          <div className='flex items-center justify-between text-sm'>
            <span>Could not reach the Computer Use helper.</span>
            <Chip onClick={() => void refresh()}>Retry</Chip>
          </div>
        )}
        {status?.enabled && (
          <>
            {(['accessibility', 'screenCapture'] as const).map((permission) => {
              const label = permission === 'accessibility' ? 'Accessibility' : 'Screen Recording'
              return (
                <div className='flex items-center justify-between' key={permission}>
                  <Label>{label}</Label>
                  {status.permissions[permission] ? (
                    <span className='text-[var(--text-muted)] text-sm'>Allowed</span>
                  ) : (
                    <Chip
                      aria-label={`Allow ${label} in System Settings`}
                      disabled={pending}
                      onClick={() =>
                        void update(async () =>
                          setStatus(await bridge.requestPermission(permission))
                        )
                      }
                    >
                      Allow
                    </Chip>
                  )}
                </div>
              )
            })}
            {setAskForApps && askForApps !== undefined && (
              <div className='flex items-center justify-between'>
                <Label asChild>
                  <span>Ask before using a new app</span>
                </Label>
                <ChipSwitch
                  aria-label='Ask before using a new app'
                  options={ON_OFF_OPTIONS}
                  value={askForApps ? 'on' : 'off'}
                  disabled={pending}
                  onChange={(value) =>
                    void update(async () => setStatus(await setAskForApps(value === 'on')))
                  }
                />
              </div>
            )}
          </>
        )}
        {askForApps !== false && apps.length > 0 && (
          <div className='flex flex-col gap-2'>
            <Label>Approved apps</Label>
            {apps.map((app) => (
              <div className='flex items-center justify-between gap-3' key={app.bundleId}>
                <span className='truncate text-sm' title={app.bundleId}>
                  {app.displayName}
                </span>
                <Chip
                  disabled={pending}
                  onClick={() =>
                    void update(async () => {
                      requestVersion.current += 1
                      await bridge.revokeApp(app.bundleId)
                      await refreshApps()
                    })
                  }
                >
                  Revoke
                </Chip>
              </div>
            ))}
          </div>
        )}
      </div>
    </SettingsSection>
  )
}
