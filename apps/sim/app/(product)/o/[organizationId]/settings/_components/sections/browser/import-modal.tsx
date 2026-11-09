'use client'

import { useState } from 'react'
import { SelectField } from '@sim/emcn/field'
import { Modal } from '@sim/emcn/modal'
import { InlineNotice } from '@sim/emcn/status'
import { toast } from '@/lib/toast/sink'
import { Muted } from '@/app/(product)/_components/settings-parts/settings-parts'
import { IMPORT_ERROR_MESSAGES } from '@/platform/lib/data/browser-sign-in'
import {
  type BrowserChromeImportResult,
  type BrowserImportProfile,
  getDesktopBridge,
  useBrowserImportProfiles,
} from '@/platform/lib/data/desktop'

/** Counts only what landed; importing a cookie does not guarantee a signed-in session. */
function importSummary({ cookies, passwords }: BrowserChromeImportResult): string | null {
  const parts: string[] = []
  const saved = passwords.passwordsAdded + passwords.passwordsUpdated
  if (cookies.cookiesImported > 0) {
    parts.push(`${cookies.cookiesImported} ${cookies.cookiesImported === 1 ? 'cookie' : 'cookies'}`)
  }
  if (saved > 0) parts.push(`${saved} ${saved === 1 ? 'password' : 'passwords'}`)
  return parts.length > 0 ? `Imported ${parts.join(' and ')}` : null
}

/** One entry per browser, in the order profiles were discovered. */
function browserOptions(profiles: readonly BrowserImportProfile[]) {
  const seen = new Map<string, string>()
  for (const { browserId, browserLabel } of profiles) {
    if (!seen.has(browserId)) seen.set(browserId, browserLabel)
  }
  return [...seen].map(([value, label]) => ({ value, label }))
}

interface ImportModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImported: () => Promise<unknown>
}

/**
 * Chooses which browser identity the built-in browser takes on: the browser, then the profile inside
 * it. Sim's browser has one profile, so there is no "all of them".
 */
export function ImportModal({ open, onOpenChange, onImported }: ImportModalProps) {
  const available = Boolean(getDesktopBridge()?.browserImport?.listChromeProfiles)
  const profilesQuery = useBrowserImportProfiles(open && available)
  const profiles = profilesQuery.data ?? []
  const loading = available && profilesQuery.isPending
  const error = !available
    ? 'Browser import is not available on this device.'
    : profilesQuery.isError
      ? 'Could not load browser profiles. Close this dialog and try again.'
      : undefined

  const browsers = browserOptions(profiles)
  const [pickedBrowserId, setPickedBrowserId] = useState('')
  /** A reload can drop the picked browser or profile, so both fall back during render. */
  const browserId = browsers.some((browser) => browser.value === pickedBrowserId)
    ? pickedBrowserId
    : (browsers[0]?.value ?? '')
  const profilesForBrowser = profiles.filter((profile) => profile.browserId === browserId)
  const [pickedProfileId, setPickedProfileId] = useState('')
  const profileId = profilesForBrowser.some((profile) => profile.id === pickedProfileId)
    ? pickedProfileId
    : (profilesForBrowser[0]?.id ?? '')
  const selected = profilesForBrowser.find((profile) => profile.id === profileId) ?? null

  /** Resolves false to keep the dialog open when part of the import failed. */
  async function importFromBrowser(profile: BrowserImportProfile): Promise<boolean> {
    const runImport = getDesktopBridge()?.browserImport?.importFromChrome
    if (!runImport) return false
    try {
      /** The IPC call must precede any await to preserve the click's user activation. */
      const result = await runImport(profile.id, 'replace')
      const summary = importSummary(result)
      const failures: string[] = []
      if (result.cookies.error) {
        failures.push(`Cookies: ${IMPORT_ERROR_MESSAGES[result.cookies.error]}`)
      }
      if (result.passwords.error) {
        failures.push(`Passwords: ${IMPORT_ERROR_MESSAGES[result.passwords.error]}`)
      }
      if (failures.length > 0) {
        const message = [summary && `${summary} from ${profile.label}.`, ...failures]
          .filter(Boolean)
          .join(' ')
        if (summary) toast.warning(message)
        else toast.error(message)
      } else if (summary) {
        toast.success(`${summary} from ${profile.label}`)
      } else {
        toast.info('No new data was imported. Existing saved passwords were kept.')
      }
      await onImported().catch(() => {
        toast.error('Import finished, but the browser could not refresh. Try reopening it.')
      })
      return failures.length === 0
    } catch {
      toast.error('Could not import from that browser')
      return false
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title='Import from your browser'
      description='Copy cookies, saved passwords, and address-bar suggestions into Sim. Your other browser stays unchanged and nothing is uploaded. Future changes are not synced.'
      confirmLabel='Import'
      confirmDisabled={loading || selected === null}
      onConfirm={() => (selected ? importFromBrowser(selected) : false)}
    >
      <Muted>
        Passwords stay encrypted on this device until you delete them or sign out of Sim. Website
        sessions may still expire.
      </Muted>
      {!loading && !error && profiles.length === 0 && (
        <Muted>No supported browser profiles were found on this device.</Muted>
      )}
      <SelectField
        label='Browser'
        options={browsers}
        value={browserId || undefined}
        onValueChange={setPickedBrowserId}
        placeholder='Select a browser'
        disabled={loading || browsers.length === 0}
      />
      <SelectField
        label='Profile'
        options={profilesForBrowser.map((profile) => ({
          value: profile.id,
          label: profile.profileLabel,
        }))}
        value={profileId || undefined}
        onValueChange={setPickedProfileId}
        placeholder='Select a profile'
        disabled={loading || profilesForBrowser.length === 0}
      />
      {!loading && error && <InlineNotice intent='danger' message={error} />}
    </Modal>
  )
}
