'use client'

import { useEffect, useRef, useState } from 'react'
import type {
  BrowserChromeImportResult,
  BrowserImportError,
  BrowserImportProfile,
} from '@sim/desktop-bridge'
import { toast } from '@sim/emcn'
import { ImportModal } from '@/components/browser-import/import-modal'
import { getDesktopBridge } from '@/lib/desktop'

const IMPORT_ERROR_MESSAGES: Record<BrowserImportError, string> = {
  'unsupported-platform': 'Importing from another browser is only supported on macOS.',
  'chrome-not-found': 'Could not find that browser profile.',
  'keychain-unavailable':
    'Sim needs your permission to read that browser’s saved data. Allow the Keychain prompt and try again.',
  'profile-unreadable':
    'Could not read that browser’s data. Try quitting the other browser, then import again.',
  'unsupported-schema': 'That browser stores its data in a format Sim cannot read yet.',
  'nothing-imported': 'Nothing from that profile could be imported.',
  'vault-unavailable':
    'This device cannot store passwords securely, so saved passwords were not imported.',
  unknown: 'Could not import from that browser.',
}

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

interface BrowserImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImported: () => Promise<unknown>
}

/** Shares the same user-initiated import flow between Settings and the browser panel. */
export function BrowserImportDialog({ open, onOpenChange, onImported }: BrowserImportDialogProps) {
  const [profiles, setProfiles] = useState<BrowserImportProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [pending, setPending] = useState(false)
  const importInFlight = useRef(false)

  useEffect(() => {
    if (!open) return
    let active = true
    setLoading(true)
    setError(undefined)
    setProfiles([])
    const listProfiles = getDesktopBridge()?.browserImport?.listChromeProfiles
    if (!listProfiles) {
      setError('Browser import is not available on this device.')
      setLoading(false)
      return
    }
    void listProfiles()
      .then((next) => {
        if (active) setProfiles(next)
      })
      .catch(() => {
        if (active) setError('Could not load browser profiles. Close this dialog and try again.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [open])

  async function importFromBrowser(profile: BrowserImportProfile) {
    const runImport = getDesktopBridge()?.browserImport?.importFromChrome
    if (!runImport || importInFlight.current) return
    importInFlight.current = true
    setPending(true)
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
      } else {
        if (summary) toast.success(`${summary} from ${profile.label}`)
        else toast.info('No new data was imported. Existing saved passwords were kept.')
        onOpenChange(false)
      }
      await onImported().catch(() => {
        toast.error('Import finished, but the browser could not refresh. Try reopening it.')
      })
    } catch {
      toast.error('Could not import from that browser')
    } finally {
      importInFlight.current = false
      setPending(false)
    }
  }

  return (
    <ImportModal
      open={open}
      onOpenChange={onOpenChange}
      profiles={profiles}
      loading={loading}
      error={error}
      pending={pending}
      onImport={(profile) => void importFromBrowser(profile)}
    />
  )
}
