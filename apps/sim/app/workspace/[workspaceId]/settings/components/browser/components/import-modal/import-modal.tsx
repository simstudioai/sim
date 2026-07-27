'use client'

import { useEffect, useMemo, useState } from 'react'
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
    const id = browserId ?? 'chrome'
    if (!seen.has(id)) seen.set(id, browserLabel ?? 'Chrome')
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
  const [browserId, setBrowserId] = useState(browsers[0]?.value ?? '')

  const profilesForBrowser = useMemo(
    () => profiles.filter((profile) => (profile.browserId ?? 'chrome') === browserId),
    [browserId, profiles]
  )
  const [profileId, setProfileId] = useState(profilesForBrowser[0]?.id ?? '')

  // Keep the selection valid as the browser changes or the list reloads,
  // rather than leaving a profile selected that belongs to another browser.
  useEffect(() => {
    if (!profilesForBrowser.some((profile) => profile.id === profileId)) {
      setProfileId(profilesForBrowser[0]?.id ?? '')
    }
  }, [profileId, profilesForBrowser])

  useEffect(() => {
    if (!browsers.some((browser) => browser.value === browserId)) {
      setBrowserId(browsers[0]?.value ?? '')
    }
  }, [browserId, browsers])

  const selected = profiles.find((profile) => profile.id === profileId) ?? null

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
          onChange={setBrowserId}
          placeholder='Select a browser'
          align='start'
          disabled={pending || browsers.length === 0}
        />
        <ChipModalField
          type='dropdown'
          title='Profile'
          options={profilesForBrowser.map((profile) => ({
            value: profile.id,
            label: profile.profileLabel ?? profile.label,
          }))}
          value={profileId}
          onChange={setProfileId}
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
