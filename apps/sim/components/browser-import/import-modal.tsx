'use client'

import { useState } from 'react'
import type { BrowserImportProfile } from '@sim/desktop-bridge'
import {
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
} from '@sim/emcn'

interface ImportModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Every importable profile across every detected browser. */
  profiles: BrowserImportProfile[]
  loading?: boolean
  error?: string
  pending: boolean
  onImport: (profile: BrowserImportProfile) => void
}

/** One entry per browser, in the order profiles were discovered. */
function browserOptions(profiles: BrowserImportProfile[]) {
  const seen = new Map<string, string>()
  for (const { browserId, browserLabel } of profiles) {
    if (!seen.has(browserId)) seen.set(browserId, browserLabel)
  }
  return [...seen].map(([value, label]) => ({ value, label }))
}

/**
 * Chooses what to bring into the built-in browser.
 *
 * Browser and profile are separate fields because they are separate
 * decisions: which application, then which identity inside it. Both are
 * required — Sim's browser has one profile, so importing is choosing which
 * single identity it takes on, and there is no coherent "all of them" (two
 * profiles' cookies for the same site would just overwrite each other).
 */
export function ImportModal({
  open,
  onOpenChange,
  profiles,
  loading = false,
  error,
  pending,
  onImport,
}: ImportModalProps) {
  const browsers = browserOptions(profiles)
  const [pickedBrowserId, setPickedBrowserId] = useState(browsers[0]?.value ?? '')

  /**
   * A reload can drop the browser or profile that was picked. Falling back here
   * rather than correcting in an effect matters: the effect form commits and
   * paints one frame in which the profile still belongs to the previously
   * selected browser, and Import is enabled during it.
   */
  const browserId = browsers.some((browser) => browser.value === pickedBrowserId)
    ? pickedBrowserId
    : (browsers[0]?.value ?? '')

  const profilesForBrowser = profiles.filter((profile) => profile.browserId === browserId)
  const [pickedProfileId, setPickedProfileId] = useState(profilesForBrowser[0]?.id ?? '')

  const profileId = profilesForBrowser.some((profile) => profile.id === pickedProfileId)
    ? pickedProfileId
    : (profilesForBrowser[0]?.id ?? '')

  const selected = profilesForBrowser.find((profile) => profile.id === profileId) ?? null

  return (
    <ChipModal
      open={open}
      onOpenChange={onOpenChange}
      srTitle='Import from your browser'
      dismissDisabled={pending}
    >
      <ChipModalHeader onClose={() => onOpenChange(false)}>
        Import from your browser
      </ChipModalHeader>
      <ChipModalBody>
        <p className='text-pretty px-2 text-[var(--text-body)] text-sm'>
          Copy cookies, saved passwords, and address-bar suggestions into Sim. Your other browser
          stays unchanged and nothing is uploaded. Future changes are not synced.
        </p>
        <p className='text-pretty px-2 text-[var(--text-muted)] text-caption'>
          Passwords stay encrypted on this device until you delete them or sign out of Sim. Website
          sessions may still expire.
        </p>
        {(loading || (!error && profiles.length === 0)) && (
          <p className='px-2 text-[var(--text-muted)] text-small' role='status'>
            {loading
              ? 'Looking for browser profiles…'
              : 'No supported browser profiles were found on this device.'}
          </p>
        )}
        <ChipModalField
          type='dropdown'
          title='Browser'
          options={browsers}
          value={browserId}
          onChange={setPickedBrowserId}
          placeholder='Select a browser'
          align='start'
          disabled={loading || pending || browsers.length === 0}
        />
        <ChipModalField
          type='dropdown'
          title='Profile'
          options={profilesForBrowser.map((profile) => ({
            value: profile.id,
            label: profile.profileLabel,
          }))}
          value={profileId}
          onChange={setPickedProfileId}
          placeholder='Select a profile'
          align='start'
          disabled={loading || pending || profilesForBrowser.length === 0}
        />
        <ChipModalError>{!loading && error}</ChipModalError>
      </ChipModalBody>
      <ChipModalFooter
        onCancel={() => onOpenChange(false)}
        cancelDisabled={pending}
        primaryAction={{
          label: pending ? 'Importing...' : 'Import',
          disabled: loading || pending || selected === null,
          onClick: () => {
            if (selected) onImport(selected)
          },
        }}
      />
    </ChipModal>
  )
}
