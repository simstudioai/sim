'use client'

import { useState } from 'react'
import { ActivityRow } from '@sim/emcn/activity-row'
import { Button } from '@sim/emcn/button'
import { EmptyState } from '@sim/emcn/empty-state'
import { ConfirmDialog } from '@sim/emcn/modal/confirm-dialog'
import { SearchField } from '@sim/emcn/search-field'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import { toast } from '@/lib/toast/sink'
import {
  DetailHeader,
  ResourceList,
  SectionToolbar,
} from '@/app/(product)/_components/settings-parts/settings-parts'
import { SettingsRead } from '@/app/(product)/_components/settings-parts/settings-read'
import { CredentialIcon } from '@/app/(product)/o/[organizationId]/settings/_components/sections/browser/credential-icon'
import { ImportModal } from '@/app/(product)/o/[organizationId]/settings/_components/sections/browser/import-modal'
import {
  PasswordDetail,
  siteLabel,
} from '@/app/(product)/o/[organizationId]/settings/_components/sections/browser/password-detail'
import {
  type BrowserCredential,
  getDesktopBridge,
  useBrowserCredentials,
  useDeleteBrowserCredentials,
  useRefreshBrowserCredentials,
  useSettingsSearch,
} from '@/platform/lib/data/desktop'
import { useSettingsSubview } from '@/platform/lib/data/settings-subview'
import { plural } from '@/platform/shared/plural'

const DESCRIPTION = 'Saved logins for the built-in browser, encrypted on this device'

interface PasswordsViewProps {
  initialImportOpen: boolean
  onBack: () => void
}

/**
 * Saved logins for the built-in browser, one row per login. Nothing secret is shown here: the
 * password exists only on the detail view, and only after Touch ID.
 */
export function PasswordsView({ initialImportOpen, onBack }: PasswordsViewProps) {
  const query = useBrowserCredentials()
  const subview = useSettingsSubview({ idParam: 'password' })
  const [importOpen, setImportOpen] = useState(initialImportOpen)
  const refresh = useRefreshBrowserCredentials()
  const canImport = Boolean(getDesktopBridge()?.browserImport?.importFromChrome)

  const selected = query.data?.find(({ id }) => id === subview.id)
  if (selected)
    return <PasswordDetail key={selected.id} credential={selected} onBack={subview.close} />
  if (subview.id && query.data === undefined && !query.isLoadingError) return null

  return (
    <>
      <DetailHeader backLabel='Browser' onBack={onBack} title='Passwords' description={DESCRIPTION}>
        {canImport && (
          <Button variant='primary' icon='I074' onClick={() => setImportOpen(true)}>
            Import
          </Button>
        )}
      </DetailHeader>
      <SettingsRead query={query} failureMessage='Could not load saved passwords'>
        {(credentials) => <PasswordList credentials={credentials} onOpen={subview.open} />}
      </SettingsRead>
      <ImportModal open={importOpen} onOpenChange={setImportOpen} onImported={refresh} />
    </>
  )
}

interface PasswordListProps {
  credentials: BrowserCredential[]
  onOpen: (id: string) => void
}

function PasswordList({ credentials, onOpen }: PasswordListProps) {
  const [searchTerm, setSearchTerm] = useSettingsSearch()
  const [confirmingDeleteAll, setConfirmingDeleteAll] = useState(false)
  const deleteCredentials = useDeleteBrowserCredentials()

  if (credentials.length === 0)
    return (
      <EmptyState
        title='No saved passwords yet'
        description='Import them from another browser to bring them over'
      />
    )

  const needle = searchTerm.trim().toLowerCase()
  const filtered = needle
    ? credentials.filter(
        ({ origin, username }) =>
          origin.toLowerCase().includes(needle) || username.toLowerCase().includes(needle)
      )
    : credentials

  return (
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
              onOpen={() => onOpen(credential.id)}
            />
          ))}
        </ResourceList>
      ) : (
        <EmptyState title='No matching passwords' />
      )}
      <SettingsSection title='Manage passwords'>
        <SettingsRow
          label='Delete all passwords'
          description='Delete every saved password from this device'
        >
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
      <ConfirmDialog
        target={confirmingDeleteAll}
        onClose={() => setConfirmingDeleteAll(false)}
        title='Delete all passwords'
        description={`This permanently deletes all ${plural(credentials.length, 'saved password')} from this device. Your accounts on those sites are not affected, and you can import again from another browser.`}
        confirmLabel='Delete all'
        pendingLabel='Deleting…'
        onConfirm={async () => {
          try {
            await deleteCredentials.mutateAsync(undefined)
          } catch {
            throw new Error('Could not delete saved passwords')
          }
          toast.success('Deleted every saved password')
        }}
      />
    </>
  )
}
