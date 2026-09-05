'use client'

import { useCallback, useMemo, useState } from 'react'
import type { BrowserCredentialMetadata } from '@sim/desktop-bridge'
import { ArrowLeft, ChipConfirmModal, Plus, toast } from '@sim/emcn'
import { BrowserCredentialIcon } from '@/components/browser-credential-icon'
import { BrowserImportDialog } from '@/components/browser-import/browser-import-dialog'
import { getDesktopBridge } from '@/lib/desktop'
import { PasswordDetail } from '@/app/workspace/[workspaceId]/settings/components/browser/components/password-detail/password-detail'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import {
  RESOURCE_LIST_GRID,
  SettingsResourceRow,
} from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import { useSettingsSearch } from '@/app/workspace/[workspaceId]/settings/components/use-settings-search'

function siteLabel(origin: string): string {
  return origin.replace(/^https?:\/\//, '')
}

function pluralize(count: number, noun: string): string {
  return `${count} ${count === 1 ? noun : `${noun}s`}`
}

interface PasswordsViewProps {
  credentials: BrowserCredentialMetadata[]
  initialImportOpen?: boolean
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
export function PasswordsView({
  credentials,
  initialImportOpen = false,
  onChange,
  onBack,
  onImported,
}: PasswordsViewProps) {
  const [searchTerm, setSearchTerm] = useSettingsSearch()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [confirmingDeleteAll, setConfirmingDeleteAll] = useState(false)
  const [deleteAllPending, setDeleteAllPending] = useState(false)
  const [importOpen, setImportOpen] = useState(initialImportOpen)

  const forgetAll = useCallback(async () => {
    const bridge = getDesktopBridge()?.browserCredentials
    if (!bridge) return
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

  const canImport = Boolean(getDesktopBridge()?.browserImport?.importFromChrome)

  return (
    <>
      <SettingsPanel
        back={{ text: 'Browser', icon: ArrowLeft, onSelect: onBack }}
        title='Passwords'
        description='Saved logins for the built-in browser, encrypted on this device.'
        search={{ value: searchTerm, onChange: setSearchTerm, placeholder: 'Search passwords...' }}
        actions={[
          ...(credentials.length > 0
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
            <div className={RESOURCE_LIST_GRID}>
              {filtered.map((credential) => (
                <SettingsResourceRow
                  key={credential.id}
                  icon={<BrowserCredentialIcon icon={credential.icon} />}
                  iconFill
                  title={siteLabel(credential.origin)}
                  description={credential.username || 'No username'}
                  onClick={() => setSelectedId(credential.id)}
                  clickLabel={`Open ${siteLabel(credential.origin)}`}
                  navigable
                />
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

      <BrowserImportDialog open={importOpen} onOpenChange={setImportOpen} onImported={onImported} />

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
