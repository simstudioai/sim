'use client'

import { useCallback, useEffect, useState } from 'react'
import type { DesktopPreferences } from '@sim/desktop-bridge'
import { Label, Switch, toast } from '@sim/emcn'
import { useParams, useRouter } from 'next/navigation'
import { getDesktopBridge, setDesktopPreferencesSnapshot } from '@/lib/desktop'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'

export function Terminal() {
  const params = useParams()
  const router = useRouter()
  const workspaceId = params.workspaceId as string
  const [preferences, setPreferences] = useState<DesktopPreferences | null>(null)
  const [togglePending, setTogglePending] = useState(false)

  useEffect(() => {
    const bridge = getDesktopBridge()
    if (!bridge?.terminal || !bridge.settings) {
      router.replace(`/workspace/${workspaceId}/settings/general`)
      return
    }
    void bridge.settings
      .getPreferences()
      .then(setPreferences)
      .catch(() => toast.error('Could not load terminal settings'))
  }, [router, workspaceId])

  const setEnabled = useCallback(async (enabled: boolean) => {
    const setTerminalEnabled = getDesktopBridge()?.settings?.setTerminalEnabled
    if (!setTerminalEnabled) return
    setTogglePending(true)
    try {
      const next = await setTerminalEnabled(enabled)
      setPreferences(next)
      setDesktopPreferencesSnapshot(next)
    } catch {
      toast.error('Could not update terminal settings')
    } finally {
      setTogglePending(false)
    }
  }, [])

  if (!preferences) {
    return null
  }

  return (
    <SettingsPanel>
      <SettingsSection label='Agent terminal'>
        <div className='flex items-center justify-between'>
          <div className='flex flex-col gap-1'>
            <Label htmlFor='terminal-enabled'>Let Chat run commands</Label>
            <p className='text-[var(--text-muted)] text-caption'>
              Commands run on this machine with your own permissions.
            </p>
          </div>
          <Switch
            id='terminal-enabled'
            checked={preferences.terminalEnabled ?? true}
            disabled={togglePending}
            onCheckedChange={(checked) => void setEnabled(checked)}
          />
        </div>
      </SettingsSection>
    </SettingsPanel>
  )
}
