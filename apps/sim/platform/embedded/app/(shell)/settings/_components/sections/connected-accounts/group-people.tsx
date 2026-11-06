'use client'

import { useState } from 'react'
import { toast } from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import { SEARCH_DEBOUNCE_MS } from '@/lib/url-state'
import { personConnectionSummaries } from '@/ee/credential-groups/person-connections'
import {
  useOrganizationAccountPeople,
  useResendOrganizationAccountInvitation,
  useRevokeOrganizationAccountEnrollment,
} from '@/hooks/queries/organization-accounts'
import { useOrganizationAccountPeopleSearch } from '@/hooks/use-organization-account-people-search'
import { useSearchFilterValue } from '@/hooks/use-search-filter-value'
import {
  ActionMenu,
  Avatar,
  Button,
  ConfirmDialog,
  EmptyState,
  errorMessageOr,
  FailureNotice,
  InlineNotice,
  QueryBoundary,
  SectionSearch,
  StatusTag,
} from '@/platform/design-system/components'
import { useScrollEdges } from '@/platform/design-system/components/scroll-area/use-scroll-edges'
import {
  SettingsRow,
  SettingsSection,
} from '@/platform/design-system/components/settings-section/settings-section'
import { IntegrationMark } from '@/platform/embedded/app/(shell)/_components/integration-mark/integration-mark'
import {
  Muted,
  SectionStack,
  SectionToolbar,
} from '@/platform/embedded/app/(shell)/_components/section-parts/section-parts'
import styles from '@/platform/embedded/app/(shell)/settings/_components/sections/connected-accounts/group-people.module.css'
import { PeopleInviteModal } from '@/platform/embedded/app/(shell)/settings/_components/sections/connected-accounts/people-invite-modal'

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
  const resend = useResendOrganizationAccountInvitation()
  const revoke = useRevokeOrganizationAccountEnrollment()
  const [peopleSearch, setPeopleSearch] = useOrganizationAccountPeopleSearch()
  const search = useSearchFilterValue(peopleSearch, SEARCH_DEBOUNCE_MS).trim()
  const people = useOrganizationAccountPeople(organizationId, search, { enabled: true })
  const [inviteOpen, setInviteOpen] = useState(false)
  const [revoking, setRevoking] = useState<{ id: string; email: string } | null>(null)
  const error = resend.error ?? revoke.error
  const pending = resend.isPending || revoke.isPending
  const enrollments = people.data?.pages.flatMap((page) => page.enrollments) ?? []
  const listFailed = people.error && !people.isFetchNextPageError

  return (
    <SectionStack>
      <SectionToolbar
        grow={
          <SectionSearch subject='people' value={peopleSearch} onValueChange={setPeopleSearch} />
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
          query={{
            data: listFailed ? undefined : people.data,
            error: people.error,
            isFetching: people.isFetching,
            refetch: people.refetch,
          }}
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
                      onSelect: () =>
                        resend.mutate(
                          { organizationId, enrollmentId: person.id },
                          { onSuccess: () => toast.success('Invitation sent') }
                        ),
                    },
                    {
                      id: 'revoke',
                      label: 'Revoke',
                      destructive: true,
                      separatorBefore: true,
                      disabled: pending || person.status === 'revoked',
                      onSelect: () => {
                        revoke.reset()
                        setRevoking({ id: person.id, email: person.email })
                      },
                    },
                  ]}
                />
              </SettingsRow>
            ))
          }
        </QueryBoundary>
        {people.hasNextPage && !people.isFetchNextPageError && !listFailed && (
          <SettingsRow label='More people'>
            <Button
              size='compact'
              disabled={people.isFetchingNextPage}
              onClick={() => void people.fetchNextPage()}
            >
              {people.isFetchingNextPage ? 'Loading…' : 'Load more'}
            </Button>
          </SettingsRow>
        )}
        {people.isFetchNextPageError && (
          <FailureNotice
            message={getErrorMessage(people.error, 'Could not load more people')}
            retrying={people.isFetchingNextPage}
            onRetry={() => void people.fetchNextPage()}
          />
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
          onConfirm={async () => {
            await revoke.mutateAsync({ organizationId, enrollmentId: revoking.id })
            toast.success('Access revoked')
          }}
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
