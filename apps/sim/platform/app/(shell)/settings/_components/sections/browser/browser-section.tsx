'use client'

import { useState } from 'react'
import { Button } from '@sim/emcn/button'
import { ChoiceMenu } from '@sim/emcn/menu/choice-menu'
import { Modal } from '@sim/emcn/modal'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import { FailureNotice } from '@sim/emcn/status'
import { Switch } from '@sim/emcn/switch'
import { useQueryStates } from 'nuqs'
import { PasswordsView } from '@/platform/app/(shell)/settings/_components/sections/browser/passwords-view'
import {
  browserParsers,
  browserUrlKeys,
} from '@/platform/app/(shell)/settings/_components/sections/browser/search-params'
import {
  BROWSER_DATA_KINDS,
  type BrowserCredential,
  type BrowserDataKind,
  DESKTOP_ZOOM_PERCENTS,
  type DesktopAppearanceTheme,
  type DesktopPreferences,
  type DesktopZoomPercent,
  getDesktopBridge,
  isDesktopZoomPercent,
  readBrowserCredentials,
  useDesktopPreferenceMutation,
  useDesktopRead,
} from '@/platform/lib/data/desktop'
import { toast } from '@/platform/shared/toast'

interface DataRow {
  kind: BrowserDataKind
  label: string
  action: string
  /** What the user actually loses, spelled out in the confirmation. */
  consequence: string
}

/** Download history is absent: files save straight to the folder without a history record. */
const DATA_ROWS: readonly DataRow[] = [
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

const THEMES = [
  { label: 'Sim', value: 'app' },
  { label: 'Light', value: 'light' },
  { label: 'Dark', value: 'dark' },
] as const satisfies readonly { label: string; value: DesktopAppearanceTheme }[]

const ZOOM_OPTIONS = DESKTOP_ZOOM_PERCENTS.map((zoom) => ({
  label: `${zoom}%`,
  value: String(zoom),
}))

const ENABLED_LABEL = 'Let Chat browse the web'
const SUGGESTIONS_LABEL = 'Search suggestions'

interface BrowserData {
  preferences: DesktopPreferences
  credentials: BrowserCredential[]
}

interface BrowserSettingsProps {
  preferences: DesktopPreferences
  setPreferences: (next: DesktopPreferences) => void
  initialClearAll: boolean
  onOpenPasswords: () => void
  onClearAllClosed: () => void
}

function BrowserSettings({
  preferences,
  setPreferences,
  initialClearAll,
  onOpenPasswords,
  onClearAllClosed,
}: BrowserSettingsProps) {
  const [confirming, setConfirming] = useState<DataRow | 'all' | null>(
    initialClearAll ? 'all' : null
  )

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

  const clear = async (kinds: readonly BrowserDataKind[]) => {
    const desktop = getDesktopBridge()
    if (!desktop) return
    try {
      await desktop.browserAgent.clearBrowsingData(kinds)
    } catch {
      toast.error('Could not delete browsing data')
      return false
    }
  }

  const supportsSearchSuggestions = Boolean(
    getDesktopBridge()?.settings.setBrowserSearchSuggestionsEnabled
  )
  const target = confirming === 'all' ? null : confirming

  return (
    <>
      <SettingsSection title='General'>
        <SettingsRow label={ENABLED_LABEL}>
          <Switch
            label={ENABLED_LABEL}
            checked={preferences.browserEnabled}
            disabled={togglePending}
            onCheckedChange={(checked) => void setEnabled(checked)}
          />
        </SettingsRow>
        {supportsSearchSuggestions && (
          <SettingsRow
            label={SUGGESTIONS_LABEL}
            description='Send address-bar typing to Google for live completions'
          >
            <Switch
              label={SUGGESTIONS_LABEL}
              checked={preferences.browserSearchSuggestionsEnabled ?? true}
              disabled={searchSuggestionsPending}
              onCheckedChange={(checked) => void setSearchSuggestionsEnabled(checked)}
            />
          </SettingsRow>
        )}
        <SettingsRow label='Theme'>
          <ChoiceMenu
            label='Browser theme'
            options={THEMES}
            value={preferences.browserTheme}
            disabled={themePending}
            onValueChange={(value) => {
              const theme = THEMES.find((option) => option.value === value)
              if (theme) void setTheme(theme.value)
            }}
          />
        </SettingsRow>
        <SettingsRow label='Default zoom'>
          <ChoiceMenu
            label='Default zoom'
            options={ZOOM_OPTIONS}
            value={String(preferences.browserDefaultZoom)}
            disabled={zoomPending}
            onValueChange={(value) => {
              const zoom = Number.parseInt(value, 10)
              if (isDesktopZoomPercent(zoom)) void setDefaultZoom(zoom)
            }}
          />
        </SettingsRow>
        <SettingsRow label='Download location' description={preferences.browserDownloadDirectory}>
          <Button
            size='compact'
            disabled={downloadDirectoryPending}
            onClick={() => void chooseDownloadDirectory()}
          >
            {downloadDirectoryPending ? 'Choosing…' : 'Change'}
          </Button>
        </SettingsRow>
        <SettingsRow
          label='Passwords'
          description='Saved logins for the built-in browser, encrypted on this device.'
        >
          <Button size='compact' onClick={onOpenPasswords}>
            Manage
          </Button>
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title='Browsing data'>
        {DATA_ROWS.map((row) => (
          <SettingsRow key={row.kind} label={row.label}>
            <Button variant='quiet' destructive size='compact' onClick={() => setConfirming(row)}>
              {row.action}
            </Button>
          </SettingsRow>
        ))}
        <SettingsRow
          label='Clear all browsing data'
          description='Cookies, site data, and cache. Your Sim account and saved passwords are not affected.'
        >
          <Button variant='quiet' destructive size='compact' onClick={() => setConfirming('all')}>
            Clear all
          </Button>
        </SettingsRow>
      </SettingsSection>
      <Modal
        variant='confirm'
        destructive
        open={confirming !== null}
        onOpenChange={(open) => {
          if (open) return
          setConfirming(null)
          onClearAllClosed()
        }}
        title={target ? target.action : 'Clear all browsing data'}
        description={`This will ${
          target
            ? target.consequence
            : 'sign the browser out of every site and erase its cookies, site data, and cache'
        }. Your Sim account and saved passwords are not affected.`}
        confirmLabel={target ? target.action : 'Clear all'}
        onConfirm={() => clear(target ? [target.kind] : BROWSER_DATA_KINDS)}
      />
    </>
  )
}

/** The built-in browser on this device. Outside the desktop app it opens General. */
export default function BrowserSection() {
  const [params, setParams] = useQueryStates(browserParsers, browserUrlKeys)
  const { data, setData, failed, retry } = useDesktopRead(async (bridge): Promise<BrowserData> => {
    const [preferences, credentials] = await Promise.all([
      bridge.settings.getPreferences(),
      readBrowserCredentials(),
    ])
    return { preferences, credentials }
  })
  /** Opening the import dialog opens the passwords it adds to. */
  const openImport = params.browserImport === '1'
  const showPasswords = params.browserView === 'passwords' || openImport

  if (failed) return <FailureNotice message='Could not load browser settings' onRetry={retry} />
  if (!data) return null

  const setPreferences = (preferences: DesktopPreferences) =>
    setData((current) => current && { ...current, preferences })
  const setCredentials = (credentials: BrowserCredential[]) =>
    setData((current) => current && { ...current, credentials })

  if (showPasswords) {
    return (
      <PasswordsView
        credentials={data.credentials}
        initialImportOpen={openImport}
        onChange={setCredentials}
        onBack={() => void setParams({ browserView: null, browserImport: null })}
        onImported={async () => setCredentials(await readBrowserCredentials())}
      />
    )
  }
  return (
    <BrowserSettings
      preferences={data.preferences}
      setPreferences={setPreferences}
      initialClearAll={params.browserClear === '1'}
      onOpenPasswords={() => void setParams({ browserView: 'passwords' }, { history: 'push' })}
      onClearAllClosed={() => void setParams({ browserClear: null })}
    />
  )
}
