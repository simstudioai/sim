'use client'

import { useMemo, useState } from 'react'
import type { BrowserImportProfile } from '@sim/desktop-bridge'
import {
  ChipModal,
  ChipModalBody,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
} from '@sim/emcn'

interface ImportModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Every importable profile across every detected browser. */
  profiles: BrowserImportProfile[]
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
export function ImportModal({ open, onOpenChange, profiles, pending, onImport }: ImportModalProps) {
  const browsers = useMemo(() => browserOptions(profiles), [profiles])
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

  const profilesForBrowser = useMemo(
    () => profiles.filter((profile) => profile.browserId === browserId),
    [browserId, profiles]
  )
  const [pickedProfileId, setPickedProfileId] = useState(profilesForBrowser[0]?.id ?? '')

  const profileId = profilesForBrowser.some((profile) => profile.id === pickedProfileId)
    ? pickedProfileId
    : (profilesForBrowser[0]?.id ?? '')

  const selected = profilesForBrowser.find((profile) => profile.id === profileId) ?? null

  return (
    <ChipModal open={open} onOpenChange={onOpenChange} srTitle='Import from your browser'>
      <ChipModalHeader onClose={() => onOpenChange(false)}>
        Import from your browser
      </ChipModalHeader>
      <ChipModalBody>
        <p className='px-2 text-[var(--text-secondary)] text-sm'>
          Copies cookies and saved passwords into Sim’s browser, and reads which sites you use there
          so the address bar can suggest them. The other browser is only read, never changed, and
          nothing is uploaded.
        </p>
        <ChipModalField
          type='dropdown'
          title='Browser'
          options={browsers}
          value={browserId}
          onChange={setPickedBrowserId}
          placeholder='Select a browser'
          align='start'
          disabled={pending || browsers.length === 0}
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
          disabled={pending || profilesForBrowser.length === 0}
        />
      </ChipModalBody>
      <ChipModalFooter
        onCancel={() => onOpenChange(false)}
        cancelDisabled={pending}
        primaryAction={{
          label: pending ? 'Importing...' : 'Import',
          disabled: pending || selected === null,
          onClick: () => {
            if (selected) onImport(selected)
          },
        }}
      />
    </ChipModal>
  )
}
