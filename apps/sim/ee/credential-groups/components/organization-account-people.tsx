'use client'

import { useState } from 'react'
import { Chip, ChipConfirmModal, ChipInput, ChipModalError, toast } from '@sim/emcn'
import { Plus, Search } from '@sim/emcn/icons'
import { useQueryState } from 'nuqs'
import {
  credentialGroupPeopleSearchParam,
  credentialGroupPeopleSearchUrlKeys,
} from '@/app/workspace/[workspaceId]/settings/[section]/search-params'
import { MemberAvatar } from '@/app/workspace/[workspaceId]/settings/components/member-list'
import { RowActionsMenu } from '@/app/workspace/[workspaceId]/settings/components/row-actions-menu'
import {
  SettingsEmptyState,
  SettingsQueryErrorState,
} from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import {
  RESOURCE_LIST_STACK,
  SettingsResourceRow,
} from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import { EnrollmentConnections } from '@/ee/credential-groups/components/credential-group-enrollment-connections'
import { OrganizationAccountInviteModal } from '@/ee/credential-groups/components/organization-account-invite-modal'
import {
  useOrganizationAccountPeople,
  useResendOrganizationAccountInvitation,
  useRevokeOrganizationAccountEnrollment,
} from '@/hooks/queries/organization-accounts'
import { useDebouncedSearchSetter } from '@/hooks/use-debounced-search-setter'

interface OrganizationAccountPeopleProps {
  organizationId: string
}
export function OrganizationAccountPeople({ organizationId }: OrganizationAccountPeopleProps) {
  const people = useOrganizationAccountPeople(organizationId)
  const resend = useResendOrganizationAccountInvitation()
  const revoke = useRevokeOrganizationAccountEnrollment()
  const [peopleSearch, setPeopleSearchParam] = useQueryState(credentialGroupPeopleSearchParam.key, {
    ...credentialGroupPeopleSearchParam.parser,
    ...credentialGroupPeopleSearchUrlKeys,
  })
  const setPeopleSearch = useDebouncedSearchSetter(setPeopleSearchParam)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [revokingPerson, setRevokingPerson] = useState<{ id: string; email: string } | null>(null)
  const error = resend.error ?? revoke.error
  const pending = resend.isPending || revoke.isPending
  const enrollments = people.data?.pages.flatMap((page) => page.enrollments) ?? []
  const filter = peopleSearch.trim().toLowerCase()
  const visibleEnrollments = filter
    ? enrollments.filter((person) => person.email.toLowerCase().includes(filter))
    : enrollments
  const loadedTotal = `${enrollments.length}${people.hasNextPage ? '+' : ''}`
  const searchLabel = people.hasNextPage ? 'Search loaded people' : 'Search people'
  const peopleLabel = filter
    ? `People (${visibleEnrollments.length} of ${loadedTotal})`
    : `People (${loadedTotal})`
  if (people.error)
    return (
      <SettingsQueryErrorState
        error={people.error}
        fallback='Could not load people'
        isRetrying={people.isFetching}
        onRetry={() => void people.refetch()}
      />
    )
  return (
    <SettingsPanel>
      <ChipInput
        icon={Search}
        aria-label={searchLabel}
        placeholder={`${searchLabel}...`}
        value={peopleSearch}
        onChange={(event) => setPeopleSearch(event.target.value)}
        disabled={people.isPending}
        autoComplete='off'
        className='w-full'
      />
      {error && (
        <p role='alert' className='text-[var(--text-error)] text-caption'>
          {error.message}
        </p>
      )}
      {!people.isPending && (
        <SettingsSection
          label={peopleLabel}
          action={
            <div className='flex items-center gap-2'>
              {people.hasNextPage && (
                <Chip
                  disabled={people.isFetchingNextPage}
                  onClick={() => void people.fetchNextPage()}
                >
                  {people.isFetchingNextPage ? 'Loading...' : 'Load more'}
                </Chip>
              )}
              <Chip
                leftAdornment={<Plus className='size-[14px]' />}
                disabled={pending}
                onClick={() => setInviteOpen(true)}
              >
                Request connections
              </Chip>
            </div>
          }
        >
          {visibleEnrollments.length === 0 ? (
            <SettingsEmptyState variant='inline'>
              {filter
                ? people.hasNextPage
                  ? 'No loaded people match your search. Load more to search additional people.'
                  : 'No people match your search'
                : 'No people invited yet'}
            </SettingsEmptyState>
          ) : (
            <div className={RESOURCE_LIST_STACK}>
              {visibleEnrollments.map((person) => (
                <SettingsResourceRow
                  key={person.id}
                  icon={<MemberAvatar name={person.email} image={null} />}
                  iconVariant='custom'
                  title={person.email}
                  description={
                    <EnrollmentConnections
                      connections={person.connections}
                      mcpConnections={person.mcpConnections}
                    />
                  }
                  trailing={
                    <RowActionsMenu
                      label={`${person.email} actions`}
                      actions={[
                        {
                          label: 'Resend',
                          disabled: pending,
                          onSelect: () =>
                            resend.mutate(
                              { organizationId, enrollmentId: person.id },
                              { onSuccess: () => toast.success('Invitation sent') }
                            ),
                        },
                        {
                          label: 'Revoke',
                          destructive: true,
                          disabled: pending || person.status === 'revoked',
                          onSelect: () => {
                            revoke.reset()
                            setRevokingPerson({ id: person.id, email: person.email })
                          },
                        },
                      ]}
                    />
                  }
                />
              ))}
            </div>
          )}
        </SettingsSection>
      )}
      {inviteOpen && (
        <OrganizationAccountInviteModal
          organizationId={organizationId}
          onClose={() => setInviteOpen(false)}
        />
      )}
      {revokingPerson && (
        <ChipConfirmModal
          open
          onOpenChange={(open) => {
            if (!open && !revoke.isPending) setRevokingPerson(null)
          }}
          title={`Revoke ${revokingPerson.email}`}
          text='Organization workflows will no longer be able to use accounts contributed by this person.'
          defaultAction='none'
          confirm={{
            label: 'Revoke',
            pendingLabel: 'Revoking…',
            pending: revoke.isPending,
            variant: 'destructive',
            onClick: () =>
              revoke.mutate(
                { organizationId, enrollmentId: revokingPerson.id },
                {
                  onSuccess: () => {
                    setRevokingPerson(null)
                    toast.success('Access revoked')
                  },
                }
              ),
          }}
        >
          <ChipModalError>{revoke.error?.message}</ChipModalError>
        </ChipConfirmModal>
      )}
    </SettingsPanel>
  )
}
