'use client'

import { useCallback, useEffect, useState } from 'react'
import { BROWSER_DATA_KINDS, type BrowserDataKind } from '@sim/browser-protocol'
import {
  type BrowserCredentialMetadata,
  type DesktopAppearanceTheme,
  type DesktopPreferences,
  type DesktopZoomPercent,
  isDesktopAppearanceTheme,
} from '@sim/desktop-bridge'
import { Chip, ChipConfirmModal, Label, Switch, toast } from '@sim/emcn'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { getDesktopBridge, setDesktopPreferencesSnapshot } from '@/lib/desktop'
import { AppearanceThemeSelect } from '@/app/workspace/[workspaceId]/settings/components/appearance-theme-select'
import { PasswordsView } from '@/app/workspace/[workspaceId]/settings/components/browser/components/passwords-view/passwords-view'
import { DefaultZoomSelect } from '@/app/workspace/[workspaceId]/settings/components/default-zoom-select'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'

interface DataRow {
  kind: BrowserDataKind
  label: string
  action: string
  /**
   * What the user actually loses. Not shown in the row — the action names
   * itself — but spelled out in the confirmation, where it matters.
   */
  consequence: string
}

/**
 * Download history is deliberately absent: files are saved directly to the
 * configured folder without retaining a separate browsing-history record.
 */
const DATA_ROWS: DataRow[] = [
  {
    kind: 'cookies',
    label: 'Cookies',
    action: 'Delete cookies',
    consequence: 'sign the browser out of every site it is currently signed into',
  },
  {
    kind: 'site-data',
    label: 'Site data',
    action: 'Delete site data',
    consequence: 'erase the data sites have stored locally, such as drafts and preferences',
  },
  {
    kind: 'cache',
    label: 'Cached images and files',
    action: 'Delete cached images and files',
    consequence: 'free up space and make sites load more slowly the first time',
  },
]

export function Browser() {
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const workspaceId = params.workspaceId as string
  const [preferences, setPreferences] = useState<DesktopPreferences | null>(null)
  const [togglePending, setTogglePending] = useState(false)
  const [themePending, setThemePending] = useState(false)
  const [zoomPending, setZoomPending] = useState(false)
  const [downloadDirectoryPending, setDownloadDirectoryPending] = useState(false)
  const [credentials, setCredentials] = useState<BrowserCredentialMetadata[]>([])
  const openImport = searchParams.get('browserImport') === '1'
  const [showPasswords, setShowPasswords] = useState(
    searchParams.get('browserView') === 'passwords' || openImport
  )
  const [confirming, setConfirming] = useState<DataRow | 'all' | null>(
    searchParams.get('browserClear') === '1' ? 'all' : null
  )
  const [clearPending, setClearPending] = useState(false)

  const setTheme = useCallback(async (theme: DesktopAppearanceTheme) => {
    const desktop = getDesktopBridge()
    if (!desktop) return
    setThemePending(true)
    try {
      const next = await desktop.settings.setBrowserTheme(theme)
      setPreferences(next)
      setDesktopPreferencesSnapshot(next)
    } catch {
      toast.error('Could not update browser appearance')
    } finally {
      setThemePending(false)
    }
  }, [])

  const setDefaultZoom = useCallback(async (zoom: DesktopZoomPercent) => {
    const desktop = getDesktopBridge()
    if (!desktop) return
    setZoomPending(true)
    try {
      const next = await desktop.settings.setBrowserDefaultZoom(zoom)
      setPreferences(next)
      setDesktopPreferencesSnapshot(next)
    } catch {
      toast.error('Could not update the default browser zoom')
    } finally {
      setZoomPending(false)
    }
  }, [])

  const chooseDownloadDirectory = useCallback(async () => {
    const desktop = getDesktopBridge()
    if (!desktop) return
    setDownloadDirectoryPending(true)
    try {
      const next = await desktop.settings.chooseBrowserDownloadDirectory()
      if (!next) return
      setPreferences(next)
      setDesktopPreferencesSnapshot(next)
    } catch {
      toast.error('Could not update the browser download location')
    } finally {
      setDownloadDirectoryPending(false)
    }
  }, [])

  const refreshCredentials = useCallback(async () => {
    const bridge = getDesktopBridge()?.browserCredentials
    if (!bridge) return
    const available = await bridge.isAvailable().catch(() => false)
    setCredentials(available ? await bridge.list().catch(() => []) : [])
  }, [])

  useEffect(() => {
    const bridge = getDesktopBridge()
    if (!bridge) {
      router.replace(`/workspace/${workspaceId}/settings/general`)
      return
    }
    void Promise.all([bridge.settings.getPreferences(), refreshCredentials()])
      .then(([next]) => setPreferences(next))
      .catch(() => toast.error('Could not load browser settings'))
  }, [refreshCredentials, router, workspaceId])

  const setEnabled = useCallback(async (enabled: boolean) => {
    const desktop = getDesktopBridge()
    if (!desktop) return
    setTogglePending(true)
    try {
      const next = await desktop.settings.setPreference('browserEnabled', enabled)
      setPreferences(next)
      setDesktopPreferencesSnapshot(next)
    } catch {
      toast.error('Could not update browser settings')
    } finally {
      setTogglePending(false)
    }
  }, [])

  const clear = useCallback(async (kinds: readonly BrowserDataKind[]) => {
    const desktop = getDesktopBridge()
    if (!desktop) return
    setClearPending(true)
    try {
      await desktop.browserAgent.clearBrowsingData(kinds)
      setConfirming(null)
    } catch {
      toast.error('Could not delete browsing data')
    } finally {
      setClearPending(false)
    }
  }, [])

  if (!preferences) {
    return null
  }

  if (showPasswords) {
    return (
      <PasswordsView
        credentials={credentials}
        initialImportOpen={openImport}
        onChange={setCredentials}
        onBack={() => setShowPasswords(false)}
        onImported={refreshCredentials}
      />
    )
  }

  const enabled = preferences.browserEnabled
  const target = confirming === 'all' ? null : confirming

  return (
    <>
      <SettingsPanel
        actions={[
          { text: 'Passwords', onSelect: () => setShowPasswords(true) },
          {
            text: 'Clear all',
            variant: 'destructive' as const,
            onSelect: () => setConfirming('all'),
            disabled: clearPending,
          },
        ]}
      >
        <SettingsSection label='General'>
          <div className='flex flex-col gap-3'>
            <div className='flex items-center justify-between'>
              <Label htmlFor='browser-enabled'>Let Chat browse the web</Label>
              <Switch
                id='browser-enabled'
                checked={enabled}
                disabled={togglePending}
                onCheckedChange={(checked) => void setEnabled(checked)}
              />
            </div>

            <div className='flex items-center justify-between gap-4'>
              <Label>Theme</Label>
              <AppearanceThemeSelect
                ariaLabel='Browser theme'
                value={preferences.browserTheme}
                disabled={themePending}
                onChange={(theme) => {
                  if (isDesktopAppearanceTheme(theme)) void setTheme(theme)
                }}
              />
            </div>

            <div className='flex items-center justify-between gap-4'>
              <Label>Default zoom</Label>
              <DefaultZoomSelect
                value={preferences.browserDefaultZoom}
                onChange={(zoom) => void setDefaultZoom(zoom)}
                disabled={zoomPending}
              />
            </div>

            <div className='flex items-center justify-between gap-4'>
              <div className='flex min-w-0 flex-col gap-1'>
                <Label>Download location</Label>
                <p
                  className='max-w-[520px] truncate text-[var(--text-muted)] text-caption'
                  title={preferences.browserDownloadDirectory}
                >
                  {preferences.browserDownloadDirectory}
                </p>
              </div>
              <Chip
                disabled={downloadDirectoryPending}
                onClick={() => void chooseDownloadDirectory()}
              >
                {downloadDirectoryPending ? 'Choosing...' : 'Change'}
              </Chip>
            </div>
          </div>
        </SettingsSection>

        <SettingsSection label='Browsing data'>
          <div className='flex flex-col gap-3'>
            {DATA_ROWS.map((row) => (
              <div key={row.kind} className='flex items-center justify-between'>
                <Label>{row.label}</Label>
                <Chip disabled={clearPending} onClick={() => setConfirming(row)}>
                  {row.action}
                </Chip>
              </div>
            ))}
          </div>
        </SettingsSection>
      </SettingsPanel>

      <ChipConfirmModal
        open={confirming !== null}
        onOpenChange={(open) => !open && setConfirming(null)}
        title={target ? target.action : 'Clear all browsing data'}
        text={[
          'This will ',
          {
            text: target
              ? target.consequence
              : 'sign the browser out of every site and erase its cookies, site data, and cache',
            bold: true,
          },
          '. Your Sim account and saved passwords are not affected.',
        ]}
        confirm={{
          label: target ? target.action : 'Clear all',
          pending: clearPending,
          pendingLabel: 'Deleting...',
          onClick: () => void clear(target ? [target.kind] : BROWSER_DATA_KINDS),
        }}
      />
    </>
  )
}
