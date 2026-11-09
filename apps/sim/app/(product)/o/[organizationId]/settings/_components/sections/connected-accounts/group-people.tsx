'use client'

import { useState } from 'react'
import { Avatar } from '@sim/emcn/avatar'
import { Button } from '@sim/emcn/button'
import { EmptyState } from '@sim/emcn/empty-state'
import { ActionMenu } from '@sim/emcn/menu/action-menu'
import { Modal } from '@sim/emcn/modal'
import { SearchField } from '@sim/emcn/search-field'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import { RecipientField } from '@sim/emcn-platform/workspace-fields'
import { parseAsString, useQueryState } from 'nuqs'
import { FieldStack, SectionStack } from '@/app/(product)/_components/settings-parts/settings-parts'
import type { CredentialGroupsData } from '@/app/(product)/o/[organizationId]/settings/_components/sections/connected-accounts/model'
import type { CredentialGroupActions } from '@/platform/lib/data/credential-group-actions'

interface GroupPeopleProps {
  people: CredentialGroupsData['people']
  nextCursor?: string | null
  /** The whole roster is already here, so search filters it without a server read. */
  shallow: boolean
  actions: CredentialGroupActions
}

export function GroupPeople({ people, nextCursor, shallow, actions }: GroupPeopleProps) {
  const [search, setSearch] = useQueryState(
    'credential-group-people',
    parseAsString.withDefault('').withOptions({ shallow })
  )
  const [, setCursor] = useQueryState('cursor', parseAsString.withOptions({ shallow: false }))
  const [invite, setInvite] = useState(false)
  const [revoking, setRevoking] = useState<CredentialGroupsData['people'][number]>()
  const [recipients, setRecipients] = useState<{ address: string; invalid?: boolean }[]>([])
  const [limit, setLimit] = useState(50)
  const visible = people.filter((person) =>
    person.email.toLowerCase().includes(search.trim().toLowerCase())
  )
  return (
    <SectionStack>
      <SearchField
        label='Search people'
        value={search}
        onValueChange={(value) => {
          setLimit(50)
          void setSearch(value)
          if (!shallow) void setCursor(null)
        }}
      />
      <SettingsSection title='People'>
        {visible.slice(0, limit).map((person) => (
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
                  disabled: person.revoked,
                  onSelect: () => setRevoking(person),
                },
              ]}
            />
          </SettingsRow>
        ))}
        {!visible.length && (
          <EmptyState
            title={search.trim() ? 'No people match your search' : 'No people invited yet'}
          />
        )}
        {visible.length > limit && (
          <Button size='compact' onClick={() => setLimit(limit + 50)}>
            Load more
          </Button>
        )}
        {!shallow && nextCursor && (
          <Button size='compact' onClick={() => void setCursor(nextCursor)}>
            Next page
          </Button>
        )}
        <SettingsRow label='Request account connections'>
          <Button
            size='compact'
            onClick={() => {
              setRecipients([])
              setInvite(true)
            }}
          >
            Request connections
          </Button>
        </SettingsRow>
      </SettingsSection>
      <Modal
        open={invite}
        onOpenChange={setInvite}
        title='Request account connections'
        confirmLabel='Send requests'
        confirmDisabled={!recipients.length || recipients.some((item) => item.invalid)}
        onConfirm={async () => {
          const failure = await actions.invite([
            ...new Set(recipients.map((item) => item.address.toLowerCase())),
          ])
          if (!failure) return
          setRecipients(failure.failed.map((address) => ({ address })))
          throw new Error(failure.notice)
        }}
      >
        <FieldStack>
          <RecipientField
            label='Emails'
            placeholder='name@company.com'
            recipients={recipients}
            onRecipientsChange={setRecipients}
          />
        </FieldStack>
      </Modal>
      <Modal
        variant='confirm'
        destructive
        open={Boolean(revoking)}
        onOpenChange={(open) => {
          if (!open) setRevoking(undefined)
        }}
        title={`Revoke ${revoking?.email ?? 'account access'}`}
        description='This removes all accounts contributed by this person from organization workflows and Search. Their organization membership remains active.'
        confirmLabel='Revoke'
        onConfirm={() => {
          if (revoking) return actions.revoke(revoking.id)
        }}
      />
    </SectionStack>
  )
}
