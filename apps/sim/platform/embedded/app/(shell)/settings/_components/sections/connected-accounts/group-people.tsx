'use client'

import { useState } from 'react'
import { Avatar } from '@sim/emcn/avatar'
import { Button } from '@sim/emcn/button'
import { EmptyState } from '@sim/emcn/empty-state'
import { ActionMenu } from '@sim/emcn/menu/action-menu'
import { ConfirmDialog } from '@sim/emcn/modal/confirm-dialog'
import { useScrollEdges } from '@sim/emcn/scroll-area/use-scroll-edges'
import { SectionSearch } from '@sim/emcn/search-field/section-search'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import { FailureNotice, InlineNotice, StatusTag } from '@sim/emcn/status'
import { errorMessageOr, QueryBoundary } from '@sim/emcn/status/query-boundary'
import { personConnectionSummaries } from '@/ee/credential-groups/person-connections'
import { IntegrationMark } from '@/platform/embedded/app/(shell)/_components/integration-mark/integration-mark'
import {
  Muted,
  SectionStack,
  SectionToolbar,
} from '@/platform/embedded/app/(shell)/_components/section-parts/section-parts'
import styles from '@/platform/embedded/app/(shell)/settings/_components/sections/connected-accounts/group-people.module.css'
import { PeopleInviteModal } from '@/platform/embedded/app/(shell)/settings/_components/sections/connected-accounts/people-invite-modal'
import { useCredentialGroupPeople } from '@/platform/embedded/lib/data/integrations'

interface PersonConnectionsProps {
  person: Parameters<typeof personConnectionSummaries>[0]
}

/** The accounts a person has connected, as tags that scroll rather than wrap the row. */
function PersonConnections({ person }: PersonConnectionsProps) {
  const scrollRef = useScrollEdges<HTMLSpanElement>('horizontal')
  const accounts = personConnectionSummaries(person)
  if (accounts.length === 0) return null
  return (
    <span ref={scrollRef} role='group' aria-label='Connected accounts' className={styles.tags}>
      {accounts.map(({ key, name, icon, count, providerId }) => (
        <StatusTag
          key={key}
          label={count > 1 ? `${name} (${count})` : name}
          leading={
            icon || providerId ? <IntegrationMark providerId={providerId} icon={icon} /> : undefined
          }
        />
      ))}
    </span>
  )
}

interface GroupPeopleProps {
  organizationId: string
}

export function GroupPeople({ organizationId }: GroupPeopleProps) {
  const people = useCredentialGroupPeople(organizationId)
  const { search, enrollments, more, pending, error } = people
  const [inviteOpen, setInviteOpen] = useState(false)
  const [revoking, setRevoking] = useState<{ id: string; email: string } | null>(null)

  return (
    <SectionStack>
      <SectionToolbar
        grow={
          <SectionSearch
            subject='people'
            value={people.searchInput}
            onValueChange={people.setSearchInput}
          />
        }
      >
        <Button
          variant='primary'
          size='compact'
          icon='I074'
          disabled={pending}
          onClick={() => setInviteOpen(true)}
        >
          Request connections
        </Button>
      </SectionToolbar>
      {error && !revoking && <InlineNotice intent='danger' message={error.message} />}
      <SettingsSection title='People'>
        <QueryBoundary
          query={people.list}
          failure={errorMessageOr('Could not load people')}
          loadingLabel='Loading people…'
          empty={() =>
            enrollments.length === 0 && (
              <EmptyState
                title={search ? 'No people match your search' : 'No people invited yet'}
              />
            )
          }
        >
          {() =>
            enrollments.map((person) => (
              <SettingsRow
                key={person.id}
                label={person.email}
                description={<PersonConnections person={person} />}
                leading={<Avatar name={person.email} />}
              >
                <ActionMenu
                  label={`${person.email} actions`}
                  icon='I108'
                  actions={[
                    {
                      id: 'resend',
                      label: 'Resend',
                      disabled: pending || person.status === 'revoked',
                      onSelect: () => people.resend(person.id),
                    },
                    {
                      id: 'revoke',
                      label: 'Revoke',
                      destructive: true,
                      separatorBefore: true,
                      disabled: pending || person.status === 'revoked',
                      onSelect: () => {
                        people.resetRevoke()
                        setRevoking({ id: person.id, email: person.email })
                      },
                    },
                  ]}
                />
              </SettingsRow>
            ))
          }
        </QueryBoundary>
        {more.available && (
          <SettingsRow label='More people'>
            <Button size='compact' disabled={more.loading} onClick={more.load}>
              {more.loading ? 'Loading…' : 'Load more'}
            </Button>
          </SettingsRow>
        )}
        {more.failure && (
          <FailureNotice message={more.failure} retrying={more.loading} onRetry={more.load} />
        )}
      </SettingsSection>
      {inviteOpen && (
        <PeopleInviteModal organizationId={organizationId} onClose={() => setInviteOpen(false)} />
      )}
      {revoking && (
        <ConfirmDialog
          target
          onClose={() => setRevoking(null)}
          title={`Revoke ${revoking.email}`}
          confirmLabel='Revoke'
          pendingLabel='Revoking…'
          onConfirm={() => people.revoke(revoking.id)}
        >
          <Muted>
            This removes all accounts contributed by this person from organization workflows and
            Search. It does not remove their organization membership.
          </Muted>
        </ConfirmDialog>
      )}
    </SectionStack>
  )
}
