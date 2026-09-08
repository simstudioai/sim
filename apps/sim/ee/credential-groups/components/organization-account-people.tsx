'use client'

import { useState } from 'react'
import { Chip, ChipConfirmModal, ChipModalError, ChipTag, toast } from '@sim/emcn'
import { SettingsQueryErrorState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsResourceRow } from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import { OrganizationAccountInviteModal } from '@/ee/credential-groups/components/organization-account-invite-modal'
import {
  useCreateOrganizationAccountInvitationLink,
  useOrganizationAccountPeople,
  useResendOrganizationAccountInvitation,
  useRevokeOrganizationAccountEnrollment,
} from '@/hooks/queries/organization-accounts'

interface OrganizationAccountPeopleProps {
  organizationId: string
}
export function OrganizationAccountPeople({ organizationId }: OrganizationAccountPeopleProps) {
  const people = useOrganizationAccountPeople(organizationId)
  const resend = useResendOrganizationAccountInvitation()
  const revoke = useRevokeOrganizationAccountEnrollment()
  const link = useCreateOrganizationAccountInvitationLink()
  const [inviteOpen, setInviteOpen] = useState(false)
  const [revokingPerson, setRevokingPerson] = useState<{ id: string; email: string } | null>(null)
  const error = resend.error ?? revoke.error ?? link.error
  const pending = resend.isPending || revoke.isPending || link.isPending
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
    <div className='flex flex-col gap-4'>
      <div>
        <Chip variant='primary' onClick={() => setInviteOpen(true)}>
          Invite people
        </Chip>
      </div>
      <p className='text-[var(--text-muted)] text-caption'>
        Invitees sign in to Sim with their verified invitation email. They can contribute accounts
        without joining the organization. Revoking a person stops workflows from using their
        accounts.
      </p>
      {error && (
        <p role='alert' className='text-[var(--text-error)] text-caption'>
          {error.message}
        </p>
      )}
      {people.isPending ? (
        <p className='text-[var(--text-muted)] text-caption'>Loading people…</p>
      ) : (
        people.data?.pages
          .flatMap((page) => page.enrollments)
          .map((person) => (
            <SettingsResourceRow
              key={person.id}
              title={person.email}
              description={
                [
                  ...person.connections.map(
                    (connection) => `${connection.provider}: ${connection.status}`
                  ),
                  ...person.mcpConnections.map(
                    (connection) => `${connection.name}: ${connection.status}`
                  ),
                ].join(' · ') || 'No accounts connected'
              }
              badge={
                <ChipTag>
                  {person.expired && person.status === 'invited'
                    ? 'Invitation expired'
                    : person.status}
                </ChipTag>
              }
              trailing={
                <div className='flex gap-2'>
                  <Chip
                    disabled={pending}
                    onClick={() =>
                      resend.mutate(
                        { organizationId, enrollmentId: person.id },
                        { onSuccess: () => toast.success('Invitation sent') }
                      )
                    }
                  >
                    Resend
                  </Chip>
                  <Chip
                    disabled={pending}
                    onClick={() =>
                      link.mutate(
                        { organizationId, email: person.email },
                        {
                          onSuccess: (result) => {
                            void navigator.clipboard.writeText(result.invitationLink).then(
                              () => toast.success('New invitation link copied'),
                              () => toast.error('Could not copy the invitation link')
                            )
                          },
                        }
                      )
                    }
                  >
                    Copy new link
                  </Chip>
                  <Chip
                    variant='destructive'
                    disabled={pending || person.status === 'revoked'}
                    onClick={() => {
                      revoke.reset()
                      setRevokingPerson({ id: person.id, email: person.email })
                    }}
                  >
                    Revoke
                  </Chip>
                </div>
              }
            />
          ))
      )}
      {people.data?.pages[0]?.enrollments.length === 0 && (
        <p className='text-[var(--text-muted)] text-caption'>No one has been invited yet.</p>
      )}
      {people.hasNextPage && (
        <div>
          <Chip disabled={people.isFetchingNextPage} onClick={() => void people.fetchNextPage()}>
            Load more
          </Chip>
        </div>
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
    </div>
  )
}
