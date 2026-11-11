'use client'

import { useState } from 'react'
import { Button } from '@sim/emcn/button'
import { ConfirmDialog } from '@sim/emcn/modal/confirm-dialog'
import { Select } from '@sim/emcn/picker/select'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import { FailureNotice } from '@sim/emcn/status'
import { useQueryStates } from 'nuqs'
import { SettingsPageHeader } from '@/app/(product)/_components/settings-parts/settings-page'
import { SwitchRow } from '@/app/(product)/_components/settings-parts/switch-row'
import { PasswordsView } from '@/app/(product)/o/[organizationId]/settings/_components/sections/browser/passwords-view'
import {
  browserParsers,
  browserUrlKeys,
} from '@/app/(product)/o/[organizationId]/settings/_components/sections/browser/search-params'
import {
  BROWSER_DATA_KINDS,
  DESKTOP_THEME_OPTIONS,
  DESKTOP_ZOOM_PERCENTS,
  type DesktopAppearanceTheme,
  type DesktopPreferences,
  type DesktopZoomPercent,
  getDesktopBridge,
  isDesktopZoomPercent,
  useDesktopPreferenceMutation,
  useDesktopRead,
} from '@/platform/lib/data/desktop'

const ZOOM_OPTIONS = DESKTOP_ZOOM_PERCENTS.map((zoom) => ({
  label: `${zoom}%`,
  value: String(zoom),
}))

/** Clears every kind the browser holds: cookies, site data and cache. */
async function clearBrowsingData() {
  const browserAgent = getDesktopBridge()?.browserAgent
  if (!browserAgent) throw new Error('The built-in browser is not available on this device')
  try {
    await browserAgent.clearBrowsingData(BROWSER_DATA_KINDS)
  } catch {
    throw new Error('Could not clear browsing data')
  }
}

interface BrowserSettingsProps {
  preferences: DesktopPreferences
  setPreferences: (next: DesktopPreferences) => void
  initialClearing: boolean
  onOpenPasswords: () => void
  onClearClosed: () => void
}

function BrowserSettings({
  preferences,
  setPreferences,
  initialClearing,
  onOpenPasswords,
  onClearClosed,
}: BrowserSettingsProps) {
  const [clearing, setClearing] = useState(initialClearing)

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

  const supportsSearchSuggestions = Boolean(
    getDesktopBridge()?.settings.setBrowserSearchSuggestionsEnabled
  )

  return (
    <>
      <SettingsPageHeader />
      <SettingsSection title='General'>
        <SwitchRow
          label='Let Chat browse the web'
          description='Chat can open and use sites in the built-in browser'
          checked={preferences.browserEnabled}
          disabled={togglePending}
          onCheckedChange={(checked) => void setEnabled(checked)}
        />
        {supportsSearchSuggestions && (
          <SwitchRow
            label='Search suggestions'
            description='Send address-bar typing to Google for live completions'
            checked={preferences.browserSearchSuggestionsEnabled ?? true}
            disabled={searchSuggestionsPending}
            onCheckedChange={(checked) => void setSearchSuggestionsEnabled(checked)}
          />
        )}
        <SettingsRow label='Theme' description='Select the color theme sites see' field>
          <Select
            label='Browser theme'
            options={DESKTOP_THEME_OPTIONS}
            value={preferences.browserTheme}
            disabled={themePending}
            onValueChange={(value) => {
              const theme = DESKTOP_THEME_OPTIONS.find((option) => option.value === value)
              if (theme) void setTheme(theme.value)
            }}
          />
        </SettingsRow>
        <SettingsRow label='Default zoom' description='Zoom level for new pages' field>
          <Select
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
      </SettingsSection>
      <SettingsSection title='Browsing data'>
        <SettingsRow
          label='Passwords'
          description='Saved logins for the built-in browser, encrypted on this device'
        >
          <Button size='compact' onClick={onOpenPasswords}>
            Manage
          </Button>
        </SettingsRow>
        <SettingsRow
          label='Clear browsing data'
          description='Cookies, site data and cache; your Sim account and saved passwords stay'
        >
          <Button variant='quiet' destructive size='compact' onClick={() => setClearing(true)}>
            Clear
          </Button>
        </SettingsRow>
      </SettingsSection>
      <ConfirmDialog
        target={clearing}
        onClose={() => {
          setClearing(false)
          onClearClosed()
        }}
        title='Clear browsing data'
        description='This signs the browser out of every site and erases its cookies, the drafts and preferences sites store on this device, and cached images and files. Your Sim account and saved passwords are not affected.'
        confirmLabel='Clear'
        pendingLabel='Clearing…'
        onConfirm={clearBrowsingData}
      />
    </>
  )
}

/** The built-in browser on this device. Outside the desktop app it opens Preferences. */
export default function BrowserSection() {
  const [params, setParams] = useQueryStates(browserParsers, browserUrlKeys)
  const { data, setData, failed, retry } = useDesktopRead((bridge) =>
    bridge.settings.getPreferences()
  )
  /** Opening the import dialog opens the passwords it adds to. */
  const openImport = params.browserImport === '1'
  const showPasswords = params.browserView === 'passwords' || openImport

  if (failed)
    return (
      <>
        <SettingsPageHeader />
        <FailureNotice message='Could not load browser settings' onRetry={retry} />
      </>
    )
  if (!data) return showPasswords ? null : <SettingsPageHeader />

  if (showPasswords) {
    return (
      <PasswordsView
        initialImportOpen={openImport}
        onBack={() => void setParams({ browserView: null, browserImport: null })}
      />
    )
  }
  return (
    <BrowserSettings
      preferences={data}
      setPreferences={setData}
      initialClearing={params.browserClear === '1'}
      onOpenPasswords={() => void setParams({ browserView: 'passwords' }, { history: 'push' })}
      onClearClosed={() => void setParams({ browserClear: null })}
    />
  )
}
