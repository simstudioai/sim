'use client'

import { type ReactNode, useState } from 'react'
import { Chip, ChipConfirmModal, ChipModalError, toast } from '@sim/emcn'
import { Plus } from '@sim/emcn/icons'
import { useQueryState } from 'nuqs'
import { SEARCH_DEBOUNCE_MS } from '@/lib/url-state'
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
import { useDebounce } from '@/hooks/use-debounce'
import { useDebouncedSearchSetter } from '@/hooks/use-debounced-search-setter'

interface OrganizationAccountPeopleProps {
  organizationId: string
  enabled?: boolean
  setupFallback?: ReactNode
}
export function OrganizationAccountPeople({
  organizationId,
  enabled = true,
  setupFallback,
}: OrganizationAccountPeopleProps) {
  const resend = useResendOrganizationAccountInvitation()
  const revoke = useRevokeOrganizationAccountEnrollment()
  const [peopleSearch, setPeopleSearchParam] = useQueryState(credentialGroupPeopleSearchParam.key, {
    ...credentialGroupPeopleSearchParam.parser,
    ...credentialGroupPeopleSearchUrlKeys,
  })
  const setPeopleSearch = useDebouncedSearchSetter(setPeopleSearchParam)
  const search = useDebounce(peopleSearch.trim(), SEARCH_DEBOUNCE_MS)
  const people = useOrganizationAccountPeople(organizationId, search, { enabled })
  const [inviteOpen, setInviteOpen] = useState(false)
  const [revokingPerson, setRevokingPerson] = useState<{ id: string; email: string } | null>(null)
  const error = resend.error ?? revoke.error
  const pending = resend.isPending || revoke.isPending
  const enrollments = people.data?.pages.flatMap((page) => page.enrollments) ?? []
  const peopleLabel = `People (${enrollments.length}${people.hasNextPage ? '+' : ''})`
  const awaitingSetup = setupFallback !== undefined
  return (
    <SettingsPanel
      search={{ value: peopleSearch, onChange: setPeopleSearch, placeholder: 'Search people...' }}
      actions={[
        {
          text: 'Request connections',
          icon: Plus,
          variant: 'primary',
          disabled: pending || awaitingSetup,
          onSelect: () => setInviteOpen(true),
        },
      ]}
    >
      {awaitingSetup ? (
        setupFallback
      ) : (
        <>
          {people.error && !people.isFetchNextPageError && (
            <SettingsQueryErrorState
              error={people.error}
              fallback='Could not load people'
              isRetrying={people.isFetching}
              onRetry={() => void people.refetch()}
              variant='inline'
            />
          )}
          {error && (
            <p role='alert' className='text-[var(--text-error)] text-caption'>
              {error.message}
            </p>
          )}
          {!people.isPending && (!people.error || people.isFetchNextPageError) && (
            <SettingsSection
              label={peopleLabel}
              action={
                people.hasNextPage && !people.isFetchNextPageError ? (
                  <Chip
                    disabled={people.isFetchingNextPage}
                    onClick={() => void people.fetchNextPage()}
                  >
                    {people.isFetchingNextPage ? 'Loading...' : 'Load more'}
                  </Chip>
                ) : undefined
              }
            >
              {enrollments.length === 0 ? (
                <SettingsEmptyState variant='inline'>
                  {search ? 'No people match your search' : 'No people invited yet'}
                </SettingsEmptyState>
              ) : (
                <div className={RESOURCE_LIST_STACK}>
                  {enrollments.map((person) => (
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
          {people.isFetchNextPageError && (
            <SettingsQueryErrorState
              error={people.error}
              fallback='Could not load more people'
              isRetrying={people.isFetchingNextPage}
              onRetry={() => void people.fetchNextPage()}
              variant='inline'
            />
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
        </>
      )}
    </SettingsPanel>
  )
}
