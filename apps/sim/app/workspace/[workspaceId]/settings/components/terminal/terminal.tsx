'use client'

import { useCallback, useEffect, useState } from 'react'
import type {
  DesktopPreferences,
  DesktopZoomPercent,
  TerminalAppearanceTheme,
  TerminalThemeProfile,
} from '@sim/desktop-bridge'
import { Label, Switch, toast } from '@sim/emcn'
import { useParams, useRouter } from 'next/navigation'
import { getDesktopBridge, setDesktopPreferencesSnapshot } from '@/lib/desktop'
import { DefaultZoomSelect } from '@/app/workspace/[workspaceId]/settings/components/default-zoom-select'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import { TerminalThemePicker } from '@/app/workspace/[workspaceId]/settings/components/terminal/terminal-theme-picker'

export function Terminal() {
  const params = useParams()
  const router = useRouter()
  const workspaceId = params.workspaceId as string
  const [preferences, setPreferences] = useState<DesktopPreferences | null>(null)
  const [profiles, setProfiles] = useState<TerminalThemeProfile[]>([])
  const [togglePending, setTogglePending] = useState(false)
  const [themePending, setThemePending] = useState(false)
  const [zoomPending, setZoomPending] = useState(false)

  useEffect(() => {
    const bridge = getDesktopBridge()
    if (!bridge?.terminal || !bridge.settings) {
      router.replace(`/workspace/${workspaceId}/settings/general`)
      return
    }
    void Promise.all([
      bridge.settings.getPreferences(),
      bridge.terminalThemes?.listProfiles().catch(() => []) ?? [],
    ])
      .then(([nextPreferences, nextProfiles]) => {
        setPreferences(nextPreferences)
        setProfiles(nextProfiles)
      })
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

  const selectProfile = useCallback(async (profile: TerminalThemeProfile) => {
    const select = getDesktopBridge()?.terminalThemes?.selectProfile
    if (!select) return
    setThemePending(true)
    try {
      const next = await select(profile.id)
      if (!next) {
        toast.error('Could not select that terminal theme')
        return
      }
      setPreferences(next)
      setDesktopPreferencesSnapshot(next)
    } catch {
      toast.error('Could not select that terminal theme')
    } finally {
      setThemePending(false)
    }
  }, [])

  const setTheme = useCallback(async (theme: TerminalAppearanceTheme) => {
    const setTerminalTheme = getDesktopBridge()?.settings?.setTerminalTheme
    if (!setTerminalTheme) return
    setThemePending(true)
    try {
      const next = await setTerminalTheme(theme)
      setPreferences(next)
      setDesktopPreferencesSnapshot(next)
    } catch {
      toast.error('Could not update terminal appearance')
    } finally {
      setThemePending(false)
    }
  }, [])

  const setDefaultZoom = useCallback(async (zoom: DesktopZoomPercent) => {
    const setTerminalDefaultZoom = getDesktopBridge()?.settings?.setTerminalDefaultZoom
    if (!setTerminalDefaultZoom) return
    setZoomPending(true)
    try {
      const next = await setTerminalDefaultZoom(zoom)
      setPreferences(next)
      setDesktopPreferencesSnapshot(next)
    } catch {
      toast.error('Could not update the default terminal zoom')
    } finally {
      setZoomPending(false)
    }
  }, [])

  if (!preferences) {
    return null
  }

  const canSetTheme = typeof getDesktopBridge()?.settings?.setTerminalTheme === 'function'
  const canSetDefaultZoom =
    typeof getDesktopBridge()?.settings?.setTerminalDefaultZoom === 'function'

  return (
    <SettingsPanel>
      <SettingsSection label='General'>
        <div className='flex flex-col gap-3'>
          <div className='flex items-center justify-between'>
            <Label htmlFor='terminal-enabled'>Let Chat run commands</Label>
            <Switch
              id='terminal-enabled'
              checked={preferences.terminalEnabled ?? true}
              disabled={togglePending}
              onCheckedChange={(checked) => void setEnabled(checked)}
            />
          </div>

          {canSetTheme && (
            <div className='flex items-center justify-between gap-4'>
              <Label>Theme</Label>
              <TerminalThemePicker
                value={preferences.terminalTheme ?? 'app'}
                profiles={profiles}
                selectedProfile={preferences.terminalProfile}
                disabled={themePending}
                onBuiltInSelect={(theme) => void setTheme(theme)}
                onProfileSelect={(profile) => void selectProfile(profile)}
              />
            </div>
          )}

          {canSetDefaultZoom && (
            <div className='flex items-center justify-between gap-4'>
              <Label>Default zoom</Label>
              <DefaultZoomSelect
                ariaLabel='Terminal default zoom'
                value={preferences.terminalDefaultZoom ?? 100}
                onChange={(zoom) => void setDefaultZoom(zoom)}
                disabled={zoomPending}
              />
            </div>
          )}
        </div>
      </SettingsSection>
    </SettingsPanel>
  )
}
