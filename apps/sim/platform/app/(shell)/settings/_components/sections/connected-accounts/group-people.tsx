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
import {
  FieldStack,
  SectionStack,
} from '@/platform/app/(shell)/settings/_components/section-parts/section-parts'
import type { CredentialGroupsData } from '@/platform/app/(shell)/settings/_components/sections/connected-accounts/model'
import { toast } from '@/platform/lib/data/toast'

interface GroupPeopleProps {
  people: CredentialGroupsData['people']
  nextCursor?: string | null
  editable: boolean
  onChange: (people: CredentialGroupsData['people']) => void
}

export function GroupPeople({ people, nextCursor, editable, onChange }: GroupPeopleProps) {
  const [search, setSearch] = useQueryState(
    'credential-group-people',
    parseAsString.withDefault('').withOptions({ shallow: editable })
  )
  const [, setCursor] = useQueryState('cursor', parseAsString.withOptions({ shallow: false }))
  const [invite, setInvite] = useState(false)
  const [revoking, setRevoking] = useState<string>()
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
          if (!editable) void setCursor(null)
        }}
      />
      <SettingsSection title='People'>
        {visible.slice(0, limit).map((person) => (
          <SettingsRow
            key={person.email}
            label={person.email}
            leading={<Avatar name={person.email} size='inline' />}
            description={person.revoked ? 'Revoked' : person.accounts.join(', ') || 'Invited'}
          >
            {editable && (
              <ActionMenu
                icon='I108'
                label={`${person.email} actions`}
                actions={[
                  {
                    id: 'resend',
                    label: 'Resend',
                    disabled: person.revoked,
                    onSelect: () => toast.success('Connection request renewed'),
                  },
                  {
                    id: 'revoke',
                    label: 'Revoke',
                    destructive: true,
                    disabled: person.revoked,
                    onSelect: () => setRevoking(person.email),
                  },
                ]}
              />
            )}
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
        {!editable && nextCursor && (
          <Button size='compact' onClick={() => void setCursor(nextCursor)}>
            Next page
          </Button>
        )}
        {editable && (
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
        )}
      </SettingsSection>
      <Modal
        open={invite}
        onOpenChange={setInvite}
        title='Request account connections'
        confirmLabel='Send requests'
        confirmDisabled={!recipients.length || recipients.some((item) => item.invalid)}
        onConfirm={() => {
          const addresses = new Set(recipients.map((item) => item.address.toLowerCase()))
          onChange([
            ...people.filter((person) => !addresses.has(person.email.toLowerCase())),
            ...Array.from(addresses, (email) => ({
              email,
              revoked: false,
              accounts:
                people.find((person) => person.email.toLowerCase() === email)?.accounts ?? [],
            })),
          ])
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
        title={`Revoke ${revoking ?? 'account access'}`}
        description='This removes all accounts contributed by this person from organization workflows and Search. Their organization membership remains active.'
        confirmLabel='Revoke'
        onConfirm={() =>
          onChange(
            people.map((person) =>
              person.email === revoking ? { ...person, revoked: true, accounts: [] } : person
            )
          )
        }
      />
    </SectionStack>
  )
}
