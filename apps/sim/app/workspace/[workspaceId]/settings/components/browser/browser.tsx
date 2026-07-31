'use client'

import { useCallback, useEffect, useState } from 'react'
import { BROWSER_DATA_KINDS, type BrowserDataKind } from '@sim/browser-protocol'
import {
  BROWSER_ZOOM_PERCENTS,
  type BrowserCredentialMetadata,
  type BrowserZoomPercent,
  type DesktopAppearanceTheme,
  type DesktopPreferences,
  isBrowserZoomPercent,
  isDesktopAppearanceTheme,
} from '@sim/desktop-bridge'
import { Chip, ChipConfirmModal, ChipSelect, Label, Switch, toast } from '@sim/emcn'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { getDesktopBridge, setDesktopPreferencesSnapshot } from '@/lib/desktop'
import { AppearanceThemeSelect } from '@/app/workspace/[workspaceId]/settings/components/appearance-theme-select'
import { PasswordsView } from '@/app/workspace/[workspaceId]/settings/components/browser/components/passwords-view/passwords-view'
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

const BROWSER_ZOOM_OPTIONS = BROWSER_ZOOM_PERCENTS.map((zoom) => ({
  label: `${zoom}%`,
  value: String(zoom),
}))

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
    const setBrowserTheme = getDesktopBridge()?.settings?.setBrowserTheme
    if (!setBrowserTheme) return
    setThemePending(true)
    try {
      const next = await setBrowserTheme(theme)
      setPreferences(next)
      setDesktopPreferencesSnapshot(next)
    } catch {
      toast.error('Could not update browser appearance')
    } finally {
      setThemePending(false)
    }
  }, [])

  const setDefaultZoom = useCallback(async (zoom: BrowserZoomPercent) => {
    const setBrowserDefaultZoom = getDesktopBridge()?.settings?.setBrowserDefaultZoom
    if (!setBrowserDefaultZoom) return
    setZoomPending(true)
    try {
      const next = await setBrowserDefaultZoom(zoom)
      setPreferences(next)
      setDesktopPreferencesSnapshot(next)
    } catch {
      toast.error('Could not update the default browser zoom')
    } finally {
      setZoomPending(false)
    }
  }, [])

  const chooseDownloadDirectory = useCallback(async () => {
    const choose = getDesktopBridge()?.settings?.chooseBrowserDownloadDirectory
    if (!choose) return
    setDownloadDirectoryPending(true)
    try {
      const next = await choose()
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
    if (!bridge?.browserAgent || !bridge.settings) {
      router.replace(`/workspace/${workspaceId}/settings/general`)
      return
    }
    void Promise.all([bridge.settings.getPreferences(), refreshCredentials()])
      .then(([next]) => setPreferences(next))
      .catch(() => toast.error('Could not load browser settings'))
  }, [refreshCredentials, router, workspaceId])

  const setEnabled = useCallback(async (enabled: boolean) => {
    const setBrowserEnabled = getDesktopBridge()?.settings?.setBrowserEnabled
    if (!setBrowserEnabled) return
    setTogglePending(true)
    try {
      const next = await setBrowserEnabled(enabled)
      setPreferences(next)
      setDesktopPreferencesSnapshot(next)
    } catch {
      toast.error('Could not update browser settings')
    } finally {
      setTogglePending(false)
    }
  }, [])

  const clear = useCallback(async (kinds: readonly BrowserDataKind[]) => {
    const clearBrowsingData = getDesktopBridge()?.browserAgent?.clearBrowsingData
    if (!clearBrowsingData) return
    setClearPending(true)
    try {
      await clearBrowsingData(kinds)
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

  const enabled = preferences.browserEnabled ?? true
  const canClearData = typeof getDesktopBridge()?.browserAgent?.clearBrowsingData === 'function'
  const canManagePasswords = Boolean(getDesktopBridge()?.browserCredentials)
  const canSetTheme = typeof getDesktopBridge()?.settings?.setBrowserTheme === 'function'
  const canSetDefaultZoom =
    typeof getDesktopBridge()?.settings?.setBrowserDefaultZoom === 'function'
  const canChooseDownloadDirectory =
    typeof getDesktopBridge()?.settings?.chooseBrowserDownloadDirectory === 'function'
  const target = confirming === 'all' ? null : confirming

  return (
    <>
      <SettingsPanel
        actions={[
          ...(canManagePasswords
            ? [{ text: 'Passwords', onSelect: () => setShowPasswords(true) }]
            : []),
          ...(canClearData
            ? [
                {
                  text: 'Clear all',
                  variant: 'destructive' as const,
                  onSelect: () => setConfirming('all'),
                  disabled: clearPending,
                },
              ]
            : []),
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

            {canSetTheme && (
              <div className='flex items-center justify-between gap-4'>
                <Label>Theme</Label>
                <AppearanceThemeSelect
                  ariaLabel='Browser theme'
                  value={preferences.browserTheme ?? 'app'}
                  disabled={themePending}
                  onChange={(theme) => {
                    if (isDesktopAppearanceTheme(theme)) void setTheme(theme)
                  }}
                />
              </div>
            )}

            {canSetDefaultZoom && (
              <div className='flex items-center justify-between gap-4'>
                <Label>Default zoom</Label>
                <div className='w-[240px] flex-shrink-0'>
                  <ChipSelect
                    aria-label='Default zoom'
                    align='start'
                    fullWidth
                    dropdownWidth='trigger'
                    value={String(preferences.browserDefaultZoom ?? 100)}
                    onChange={(value) => {
                      const zoom = Number.parseInt(value, 10)
                      if (isBrowserZoomPercent(zoom)) void setDefaultZoom(zoom)
                    }}
                    disabled={zoomPending}
                    options={BROWSER_ZOOM_OPTIONS}
                  />
                </div>
              </div>
            )}

            {canChooseDownloadDirectory && (
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
            )}
          </div>
        </SettingsSection>

        {canClearData && (
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
        )}
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
