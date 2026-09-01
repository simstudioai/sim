'use client'

import { useCallback, useEffect, useState } from 'react'
import { BROWSER_DATA_KINDS, type BrowserDataKind } from '@sim/browser-protocol'
import type {
  BrowserCredentialMetadata,
  DesktopAppearanceTheme,
  DesktopPreferences,
  DesktopZoomPercent,
} from '@sim/desktop-bridge'
import { Chip, ChipConfirmModal, Label, Switch, toast } from '@sim/emcn'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { getDesktopBridge } from '@/lib/desktop'
import { AppearanceThemeSelect } from '@/app/workspace/[workspaceId]/settings/components/appearance-theme-select'
import { PasswordsView } from '@/app/workspace/[workspaceId]/settings/components/browser/components/passwords-view/passwords-view'
import { DefaultZoomSelect } from '@/app/workspace/[workspaceId]/settings/components/default-zoom-select'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import { useDesktopPreferenceMutation } from '@/hooks/use-desktop-preference-mutation'

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
  const [credentials, setCredentials] = useState<BrowserCredentialMetadata[]>([])
  const openImport = searchParams.get('browserImport') === '1'
  const [showPasswords, setShowPasswords] = useState(
    searchParams.get('browserView') === 'passwords' || openImport
  )
  const [confirming, setConfirming] = useState<DataRow | 'all' | null>(
    searchParams.get('browserClear') === '1' ? 'all' : null
  )
  const [clearPending, setClearPending] = useState(false)

  const { pending: themePending, mutate: setTheme } = useDesktopPreferenceMutation(
    (bridge, theme: DesktopAppearanceTheme) => bridge.settings.setBrowserTheme(theme),
    'Could not update browser appearance',
    setPreferences
  )

  const { pending: zoomPending, mutate: setDefaultZoom } = useDesktopPreferenceMutation(
    (bridge, zoom: DesktopZoomPercent) => bridge.settings.setBrowserDefaultZoom(zoom),
    'Could not update the default browser zoom',
    setPreferences
  )

  // A cancelled chooser resolves without preferences, which the hook skips.
  const { pending: downloadDirectoryPending, mutate: chooseDownloadDirectory } =
    useDesktopPreferenceMutation(
      (bridge) => bridge.settings.chooseBrowserDownloadDirectory(),
      'Could not update the browser download location',
      setPreferences
    )

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

  const { pending: togglePending, mutate: setEnabled } = useDesktopPreferenceMutation(
    (bridge, enabled: boolean) => bridge.settings.setPreference('browserEnabled', enabled),
    'Could not update browser settings',
    setPreferences
  )

  const { pending: searchSuggestionsPending, mutate: setSearchSuggestionsEnabled } =
    useDesktopPreferenceMutation(
      async (bridge, enabled: boolean) =>
        bridge.settings.setBrowserSearchSuggestionsEnabled?.(enabled),
      'Could not update browser search suggestions',
      setPreferences
    )

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

  const actions = [
    {
      id: 'passwords',
      text: 'Passwords',
      onSelect: () => setShowPasswords(true),
      disabled: !preferences,
    },
    {
      id: 'clear-all',
      text: 'Clear all',
      variant: 'destructive' as const,
      onSelect: () => setConfirming('all'),
      disabled: !preferences || clearPending,
    },
  ]

  if (!preferences) {
    return <SettingsPanel actions={actions} />
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
  const supportsSearchSuggestions = Boolean(
    getDesktopBridge()?.settings.setBrowserSearchSuggestionsEnabled
  )
  const target = confirming === 'all' ? null : confirming

  return (
    <>
      <SettingsPanel actions={actions}>
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

            {supportsSearchSuggestions && (
              <div className='flex items-center justify-between gap-4'>
                <div className='flex min-w-0 flex-col gap-1'>
                  <Label htmlFor='browser-search-suggestions'>Search suggestions</Label>
                  <p className='text-[var(--text-muted)] text-caption'>
                    Send address-bar typing to Google for live completions
                  </p>
                </div>
                <Switch
                  id='browser-search-suggestions'
                  checked={preferences.browserSearchSuggestionsEnabled ?? true}
                  disabled={searchSuggestionsPending}
                  onCheckedChange={(checked) => void setSearchSuggestionsEnabled(checked)}
                />
              </div>
            )}

            <div className='flex items-center justify-between gap-4'>
              <Label>Theme</Label>
              <AppearanceThemeSelect
                ariaLabel='Browser theme'
                value={preferences.browserTheme}
                disabled={themePending}
                onChange={(theme) => void setTheme(theme)}
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
        defaultAction={target?.kind === 'cache' ? 'confirm' : 'dismiss'}
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
