'use client'

import { useEffect, useState } from 'react'
import type { ComputerUseAppPermission } from '@sim/desktop-bridge'
import { Chip, ChipSwitch, Label, toast } from '@sim/emcn'
import { ComputerUseActivity } from '@/components/computer-use/activity'
import { getDesktopBridge } from '@/lib/desktop'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import { useComputerUseAvailability } from '@/hooks/queries/computer-use'
import { useComputerUseStatus } from '@/hooks/use-computer-use-status'

export function ComputerUseSettings() {
  const bridge = getDesktopBridge()?.computerUse
  const availability = useComputerUseAvailability(Boolean(bridge))
  const { status, setStatus, refresh, error } = useComputerUseStatus()
  const [apps, setApps] = useState<ComputerUseAppPermission[]>([])
  const [pending, setPending] = useState(false)
  useEffect(() => {
    if (!bridge || !availability.data?.enabled) return
    void bridge
      .listAppPermissions()
      .then(setApps)
      .catch(() => toast.error('Could not load approved apps'))
  }, [bridge, availability.data?.enabled, status?.activeAction])
  if (!bridge || !availability.data?.enabled || status?.supported === false) return null
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
  return (
    <SettingsSection label='Computer Use'>
      <div className='flex flex-col gap-3'>
        <ComputerUseActivity />
        <div className='flex items-center justify-between'>
          <Label asChild>
            <span>Allow Mothership to use Mac apps</span>
          </Label>
          <ChipSwitch
            aria-label='Allow Mothership to use Mac apps'
            options={[
              { value: 'off', label: 'Off' },
              { value: 'on', label: 'On' },
            ]}
            value={status?.enabled ? 'on' : 'off'}
            disabled={pending || !status}
            onChange={(value) =>
              void update(async () => setStatus(await bridge.setEnabled(value === 'on')))
            }
          />
        </div>
        <p className='text-[var(--text-muted)] text-sm'>
          Off by default. Each app requires your approval. You can stop an action from the
          conversation or revoke an app below.
        </p>
        {error && (
          <div className='flex items-center justify-between text-sm'>
            <span>Could not connect to the computer helper.</span>
            <Chip onClick={() => void refresh()}>Retry</Chip>
          </div>
        )}
        {(['accessibility', 'screenCapture'] as const).map((permission) => (
          <div className='flex items-center justify-between' key={permission}>
            <Label>{permission === 'accessibility' ? 'Accessibility' : 'Screen Recording'}</Label>
            {status?.permissions[permission] ? (
              <span className='text-[var(--text-muted)] text-sm'>Allowed</span>
            ) : (
              <Chip
                disabled={pending || !status}
                onClick={() =>
                  void update(async () => setStatus(await bridge.requestPermission(permission)))
                }
              >
                Open System Settings
              </Chip>
            )}
          </div>
        ))}
        <p className='text-[var(--text-muted)] text-sm'>
          Accessibility allows interaction with approved apps. Screen Recording allows screenshots.
          Return here after granting access to refresh the status.
        </p>
        {apps.length > 0 && (
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
                      await bridge.revokeApp(app.bundleId)
                      setApps(await bridge.listAppPermissions())
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
