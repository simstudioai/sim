'use client'

import { useState } from 'react'
import { ActivityRow } from '@sim/emcn/activity-row'
import { Button } from '@sim/emcn/button'
import { EmptyState } from '@sim/emcn/empty-state'
import { Modal } from '@sim/emcn/modal'
import { SearchField } from '@sim/emcn/search-field'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import { toast } from '@/lib/toast/sink'
import {
  DetailHeader,
  ResourceList,
  SectionToolbar,
} from '@/app/(product)/_components/settings-parts/settings-parts'
import { CredentialIcon } from '@/app/(product)/o/[organizationId]/settings/_components/sections/browser/credential-icon'
import { ImportModal } from '@/app/(product)/o/[organizationId]/settings/_components/sections/browser/import-modal'
import {
  PasswordDetail,
  siteLabel,
} from '@/app/(product)/o/[organizationId]/settings/_components/sections/browser/password-detail'
import {
  type BrowserCredential,
  getDesktopBridge,
  useSettingsSearch,
} from '@/platform/lib/data/desktop'

function pluralize(count: number, noun: string): string {
  return `${count} ${count === 1 ? noun : `${noun}s`}`
}

interface PasswordsViewProps {
  credentials: BrowserCredential[]
  initialImportOpen: boolean
  onChange: (credentials: BrowserCredential[]) => void
  onBack: () => void
  /** Lets the Browser page refresh its own list after an import. */
  onImported: () => Promise<unknown>
}

/**
 * Saved logins for the built-in browser, one row per login. Nothing secret is shown here: the
 * password exists only on the detail view, and only after Touch ID.
 */
export function PasswordsView({
  credentials,
  initialImportOpen,
  onChange,
  onBack,
  onImported,
}: PasswordsViewProps) {
  const [searchTerm, setSearchTerm] = useSettingsSearch()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [confirmingDeleteAll, setConfirmingDeleteAll] = useState(false)
  const [importOpen, setImportOpen] = useState(initialImportOpen)

  const selected = credentials.find(({ id }) => id === selectedId)
  if (selected) {
    return (
      <PasswordDetail
        key={selected.id}
        credential={selected}
        onBack={() => setSelectedId(null)}
        onForgotten={onChange}
      />
    )
  }

  const needle = searchTerm.trim().toLowerCase()
  const filtered = needle
    ? credentials.filter(
        ({ origin, username }) =>
          origin.toLowerCase().includes(needle) || username.toLowerCase().includes(needle)
      )
    : credentials
  const canImport = Boolean(getDesktopBridge()?.browserImport?.importFromChrome)

  const forgetAll = async () => {
    const vault = getDesktopBridge()?.browserCredentials
    if (!vault) return
    try {
      onChange(await vault.forgetAll())
      toast.success('Deleted every saved password')
    } catch {
      toast.error('Could not delete saved passwords')
      return false
    }
  }

  return (
    <>
      <DetailHeader backLabel='Browser' onBack={onBack} title='Passwords'>
        {canImport && (
          <Button variant='primary' icon='I074' onClick={() => setImportOpen(true)}>
            Import
          </Button>
        )}
      </DetailHeader>
      {credentials.length === 0 ? (
        <EmptyState
          title='No saved passwords yet'
          description='Import them from another browser to bring them over.'
        />
      ) : (
        <>
          <SectionToolbar
            grow={
              <SearchField
                label='Search passwords'
                placeholder='Search passwords…'
                value={searchTerm}
                onValueChange={setSearchTerm}
              />
            }
          />
          {filtered.length > 0 ? (
            <ResourceList>
              {filtered.map((credential) => (
                <ActivityRow
                  key={credential.id}
                  leading={<CredentialIcon icon={credential.icon} />}
                  title={siteLabel(credential.origin)}
                  detail={credential.username || 'No username'}
                  onOpen={() => setSelectedId(credential.id)}
                />
              ))}
            </ResourceList>
          ) : (
            <EmptyState title={`No passwords found matching "${searchTerm}"`} />
          )}
          <SettingsSection title='Manage passwords'>
            <SettingsRow label='Delete all passwords'>
              <Button
                variant='quiet'
                destructive
                size='compact'
                onClick={() => setConfirmingDeleteAll(true)}
              >
                Delete all
              </Button>
            </SettingsRow>
          </SettingsSection>
        </>
      )}
      <ImportModal open={importOpen} onOpenChange={setImportOpen} onImported={onImported} />
      <Modal
        variant='confirm'
        destructive
        open={confirmingDeleteAll}
        onOpenChange={setConfirmingDeleteAll}
        title='Delete all passwords'
        description={`This permanently deletes all ${pluralize(credentials.length, 'saved password')} from this device. Your accounts on those sites are not affected, and you can import again from another browser.`}
        confirmLabel='Delete all'
        onConfirm={forgetAll}
      />
    </>
  )
}
