'use client'

import { useCallback, useEffect, useState } from 'react'
import type {
  DesktopPreferences,
  TerminalAppearanceTheme,
  TerminalThemeProfile,
} from '@sim/desktop-bridge'
import { Label, Switch, toast } from '@sim/emcn'
import { useParams, useRouter } from 'next/navigation'
import { getDesktopBridge, setDesktopPreferencesSnapshot } from '@/lib/desktop'
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

      {getDesktopBridge()?.settings?.setTerminalTheme && (
        <SettingsSection label='Appearance'>
          <div className='flex items-center justify-between gap-4'>
            <div className='flex flex-col gap-1'>
              <Label>Theme</Label>
              <p className='text-[var(--text-muted)] text-caption'>
                Choose Sim’s default palettes or a profile from Terminal or iTerm2.
              </p>
            </div>
            <TerminalThemePicker
              value={preferences.terminalTheme ?? 'app'}
              profiles={profiles}
              selectedProfile={preferences.terminalProfile}
              disabled={themePending}
              onBuiltInSelect={(theme) => void setTheme(theme)}
              onProfileSelect={(profile) => void selectProfile(profile)}
            />
          </div>
        </SettingsSection>
      )}
    </SettingsPanel>
  )
}
