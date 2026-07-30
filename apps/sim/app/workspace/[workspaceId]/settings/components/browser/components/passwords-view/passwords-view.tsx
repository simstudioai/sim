'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  BrowserChromeImportResult,
  BrowserCredentialMetadata,
  BrowserImportError,
  BrowserImportProfile,
} from '@sim/desktop-bridge'
import { ArrowLeft, ArrowRight, ChipConfirmModal, Key, Plus, toast } from '@sim/emcn'
import { getDesktopBridge } from '@/lib/desktop'
import { ImportModal } from '@/app/workspace/[workspaceId]/settings/components/browser/components/import-modal/import-modal'
import { PasswordDetail } from '@/app/workspace/[workspaceId]/settings/components/browser/components/password-detail/password-detail'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import { SettingsResourceRow } from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import { useSettingsSearch } from '@/app/workspace/[workspaceId]/settings/components/use-settings-search'

/** The integrations page's responsive card grid (see `integration-section.tsx`, `skills.tsx`). */
const CARD_GRID = '-mx-2 grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-x-2 gap-y-0.5'
/** Card hit area; the row chrome inside it comes from {@link SettingsResourceRow}. */
const CARD_CLASSES =
  'w-full rounded-lg p-2 text-left transition-colors hover-hover:bg-[var(--surface-active)]'

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

function siteLabel(origin: string): string {
  return origin.replace(/^https?:\/\//, '')
}

function pluralize(count: number, noun: string): string {
  return `${count} ${count === 1 ? noun : `${noun}s`}`
}

/** Describes what actually landed, without over-claiming that sites are signed in. */
function summarize({ cookies, passwords }: BrowserChromeImportResult): string | null {
  const parts: string[] = []
  if (cookies.cookiesImported > 0) parts.push(pluralize(cookies.cookiesImported, 'cookie'))
  const saved = passwords.passwordsAdded + passwords.passwordsUpdated
  if (saved > 0) parts.push(pluralize(saved, 'password'))
  return parts.length > 0 ? `Imported ${parts.join(' and ')}` : null
}

interface PasswordsViewProps {
  credentials: BrowserCredentialMetadata[]
  onChange: (credentials: BrowserCredentialMetadata[]) => void
  onBack: () => void
  /** Lets the Browser page refresh its own counts after an import. */
  onImported: () => Promise<unknown>
}

/**
 * The saved-password list, laid out like the integrations page: one card per
 * login, each opening its own detail page. Nothing secret is shown here — the
 * password only exists on the detail page, and only after Touch ID.
 */
export function PasswordsView({ credentials, onChange, onBack, onImported }: PasswordsViewProps) {
  const [searchTerm, setSearchTerm] = useSettingsSearch()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [confirmingDeleteAll, setConfirmingDeleteAll] = useState(false)
  const [deleteAllPending, setDeleteAllPending] = useState(false)
  const [profiles, setProfiles] = useState<BrowserImportProfile[]>([])
  const [importOpen, setImportOpen] = useState(false)
  const [importPending, setImportPending] = useState(false)

  useEffect(() => {
    // Absent on shells without the importer and on platforms where one cannot
    // run, so the action simply does not render there.
    const listProfiles = getDesktopBridge()?.browserImport?.listChromeProfiles
    if (!listProfiles) return
    void listProfiles()
      .then(setProfiles)
      .catch(() => setProfiles([]))
  }, [])

  /**
   * Runs straight off the modal's Import click: the shell only accepts an
   * import while the page has an active user gesture, so this must not be
   * deferred behind another await first.
   */
  const importFromBrowser = useCallback(
    async (profile: BrowserImportProfile) => {
      const runImport = getDesktopBridge()?.browserImport?.importFromChrome
      if (!runImport) return
      setImportPending(true)
      try {
        // 'replace' so a password rotated in the other browser actually lands
        // here. Sim cannot edit passwords itself, so the browser being
        // imported from is always the more current source.
        const result = await runImport(profile.id, 'replace')
        const summary = summarize(result)
        if (summary) {
          toast.success(`${summary} from ${profile.label}`)
          setImportOpen(false)
        } else {
          const error = result.cookies.error ?? result.passwords.error
          toast.error(error ? IMPORT_ERROR_MESSAGES[error] : 'Nothing new to import')
        }
        await onImported()
      } catch {
        toast.error('Could not import from that browser')
      } finally {
        setImportPending(false)
      }
    },
    [onImported]
  )

  const forgetAll = useCallback(async () => {
    const bridge = getDesktopBridge()?.browserCredentials
    if (!bridge?.forgetAll) return
    setDeleteAllPending(true)
    try {
      onChange(await bridge.forgetAll())
      setConfirmingDeleteAll(false)
      toast.success('Deleted every saved password')
    } catch {
      toast.error('Could not delete saved passwords')
    } finally {
      setDeleteAllPending(false)
    }
  }, [onChange])

  const filtered = useMemo(() => {
    const needle = searchTerm.trim().toLowerCase()
    if (!needle) return credentials
    return credentials.filter(
      ({ origin, username }) =>
        origin.toLowerCase().includes(needle) || username.toLowerCase().includes(needle)
    )
  }, [credentials, searchTerm])

  const selected = credentials.find(({ id }) => id === selectedId) ?? null
  if (selected) {
    return (
      <PasswordDetail
        credential={selected}
        onBack={() => setSelectedId(null)}
        onForgotten={onChange}
      />
    )
  }

  const canForgetAll = typeof getDesktopBridge()?.browserCredentials?.forgetAll === 'function'
  const canImport = profiles.length > 0

  return (
    <>
      <SettingsPanel
        back={{ text: 'Browser', icon: ArrowLeft, onSelect: onBack }}
        title='Passwords'
        description='Saved logins for the built-in browser, encrypted on this device.'
        search={{ value: searchTerm, onChange: setSearchTerm, placeholder: 'Search passwords...' }}
        actions={[
          ...(canForgetAll && credentials.length > 0
            ? [
                {
                  text: 'Delete all',
                  variant: 'destructive' as const,
                  onSelect: () => setConfirmingDeleteAll(true),
                  disabled: deleteAllPending,
                },
              ]
            : []),
          ...(canImport
            ? [
                {
                  text: 'Import',
                  icon: Plus,
                  variant: 'primary' as const,
                  onSelect: () => setImportOpen(true),
                  disabled: importPending,
                },
              ]
            : []),
        ]}
      >
        {credentials.length === 0 ? (
          <SettingsEmptyState>
            No saved passwords yet. Import them from another browser to bring them over.
          </SettingsEmptyState>
        ) : (
          <>
            <div className={CARD_GRID}>
              {filtered.map((credential) => (
                <button
                  key={credential.id}
                  type='button'
                  className={CARD_CLASSES}
                  onClick={() => setSelectedId(credential.id)}
                >
                  <SettingsResourceRow
                    icon={
                      credential.icon ? (
                        // A `data:` URL copied from the source browser at
                        // import time — never a network request, which would
                        // disclose which sites the user has passwords for.
                        // Fills the tile like any other brand logo.
                        <img src={credential.icon} alt='' className='object-contain' />
                      ) : (
                        <Key />
                      )
                    }
                    iconFill
                    title={siteLabel(credential.origin)}
                    description={credential.username || 'No username'}
                    trailing={<ArrowRight className='size-4 text-[var(--text-icon)]' />}
                  />
                </button>
              ))}
            </div>

            {filtered.length === 0 && (
              <SettingsEmptyState variant='inline'>
                No passwords found matching &ldquo;{searchTerm}&rdquo;
              </SettingsEmptyState>
            )}
          </>
        )}
      </SettingsPanel>

      <ImportModal
        open={importOpen}
        onOpenChange={setImportOpen}
        profiles={profiles}
        pending={importPending}
        onImport={(profile) => void importFromBrowser(profile)}
      />

      <ChipConfirmModal
        open={confirmingDeleteAll}
        onOpenChange={(open) => !open && setConfirmingDeleteAll(false)}
        title='Delete all passwords'
        text={[
          'This permanently deletes ',
          { text: `all ${pluralize(credentials.length, 'saved password')}`, bold: true },
          ' from this device. Your accounts on those sites are not affected, and you can import again from another browser.',
        ]}
        confirm={{
          label: 'Delete all',
          pending: deleteAllPending,
          pendingLabel: 'Deleting...',
          onClick: () => void forgetAll(),
        }}
      />
    </>
  )
}
