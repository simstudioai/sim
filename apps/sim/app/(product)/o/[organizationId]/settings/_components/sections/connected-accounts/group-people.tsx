'use client'

import { useState } from 'react'
import { Avatar } from '@sim/emcn/avatar'
import { Button } from '@sim/emcn/button'
import { EmptyState } from '@sim/emcn/empty-state'
import { ActionMenu } from '@sim/emcn/menu/action-menu'
import { Modal } from '@sim/emcn/modal'
import { ConfirmDialog } from '@sim/emcn/modal/confirm-dialog'
import { LoadMoreFooter } from '@sim/emcn/scroll-area/load-more-footer'
import { SearchField } from '@sim/emcn/search-field'
import { SettingsRow, SettingsSurface } from '@sim/emcn/settings-section'
import { FailureNotice } from '@sim/emcn/status'
import { RecipientField } from '@sim/emcn-platform/workspace-fields'
import { FieldStack, SectionStack } from '@/app/(product)/_components/settings-parts/settings-parts'
import type { CredentialGroupActions } from '@/platform/lib/data/credential-group-actions'
import { useCredentialGroupPeopleSearch } from '@/platform/lib/data/credential-group-people'
import type {
  CredentialGroupPeople,
  CredentialGroupPerson,
} from '@/platform/lib/data/models/connected-accounts'

interface GroupPeopleProps {
  /** The rows its source has paged in, already matching the search. */
  people: CredentialGroupPeople
  actions: CredentialGroupActions
}

/** The tab names the list, so the rows sit in a surface without a heading of their own. */
export function GroupPeople({ people, actions }: GroupPeopleProps) {
  const [search, setSearch] = useCredentialGroupPeopleSearch()
  const [invite, setInvite] = useState(false)
  const [revoking, setRevoking] = useState<CredentialGroupPerson>()
  const [recipients, setRecipients] = useState<{ address: string; invalid?: boolean }[]>([])
  const searching = search.trim().length > 0
  const requestConnections = (
    <Button
      size='compact'
      onClick={() => {
        setRecipients([])
        setInvite(true)
      }}
    >
      Request connections
    </Button>
  )
  return (
    <SectionStack>
      {(people.rows.length > 0 || searching) && (
        <SearchField
          label='Search people'
          placeholder='Search people…'
          value={search}
          onValueChange={(value) => void setSearch(value)}
        />
      )}
      {people.failure ? (
        <FailureNotice message={people.failure.message} onRetry={people.failure.retry} />
      ) : people.pending ? null : people.rows.length === 0 ? (
        searching ? (
          <EmptyState title='No matching people' />
        ) : (
          <EmptyState
            title='No people invited yet'
            description='Ask people to connect their accounts to this pool'
            action={requestConnections}
          />
        )
      ) : (
        <SettingsSurface>
          {people.rows.map((person) => (
            <SettingsRow
              key={person.id}
              label={person.email}
              leading={<Avatar name={person.email} size='inline' />}
              description={person.revoked ? 'Revoked' : person.accounts.join(', ') || 'Invited'}
            >
              <ActionMenu
                icon='I108'
                label={`${person.email} actions`}
                actions={[
                  {
                    id: 'resend',
                    label: 'Resend',
                    disabled: person.revoked,
                    onSelect: () => void actions.resend(person.id),
                  },
                  {
                    id: 'revoke',
                    label: 'Revoke',
                    destructive: true,
                    separatorBefore: true,
                    disabled: person.revoked,
                    onSelect: () => setRevoking(person),
                  },
                ]}
              />
            </SettingsRow>
          ))}
          {people.loadMore && <LoadMoreFooter state={people.loadMore} />}
          <SettingsRow
            label='Request account connections'
            description='Ask people to connect their accounts to this pool'
          >
            {requestConnections}
          </SettingsRow>
        </SettingsSurface>
      )}
      <Modal
        open={invite}
        onOpenChange={setInvite}
        title='Request account connections'
        confirmLabel='Send requests'
        confirmDisabled={!recipients.some((item) => !item.invalid)}
        onConfirm={async () => {
          // The valid addresses go out and an invalid one stays to be corrected.
          const invalid = recipients.filter((item) => item.invalid)
          const failure = await actions.invite([
            ...new Set(
              recipients.filter((item) => !item.invalid).map((item) => item.address.toLowerCase())
            ),
          ])
          if (failure) {
            setRecipients([...failure.failed.map((address) => ({ address })), ...invalid])
            throw new Error(failure.notice)
          }
          if (!invalid.length) return
          setRecipients(invalid)
          return false
        }}
      >
        <FieldStack>
          <RecipientField
            label='Emails'
            placeholder='name@company.com'
            recipients={recipients}
            onRecipientsChange={setRecipients}
            submitsWithInvalid
          />
        </FieldStack>
      </Modal>
      <ConfirmDialog
        target={revoking}
        onClose={() => setRevoking(undefined)}
        title={({ email }) => `Revoke ${email}`}
        description='This removes every account they contributed from organization workflows and Search. Their organization membership remains active.'
        confirmLabel='Revoke'
        pendingLabel='Revoking…'
        onConfirm={(person) => actions.revoke(person.id)}
      />
    </SectionStack>
  )
}
