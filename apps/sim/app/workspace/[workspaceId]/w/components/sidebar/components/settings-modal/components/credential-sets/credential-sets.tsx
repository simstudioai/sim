'use client'

import { useCallback, useState } from 'react'
import { createLogger } from '@sim/logger'
import { Check, Copy, Loader2, Plus } from 'lucide-react'
import {
  Button,
  Input,
  Label,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from '@/components/emcn'
import { Skeleton } from '@/components/ui'
import { useSession } from '@/lib/auth/auth-client'
import { getSubscriptionStatus } from '@/lib/billing/client'
import { getUserRole } from '@/lib/workspaces/organization'
import {
  useAcceptCredentialSetInvitation,
  useCreateCredentialSet,
  useCreateCredentialSetInvitation,
  useCredentialSetInvitations,
  useCredentialSetMemberships,
  useCredentialSets,
} from '@/hooks/queries/credential-sets'
import { useOrganizations } from '@/hooks/queries/organization'
import { useSubscriptionData } from '@/hooks/queries/subscription'

const logger = createLogger('CredentialSets')

function CredentialSetsSkeleton() {
  return (
    <div className='flex h-full flex-col gap-[16px]'>
      <Skeleton className='h-[48px] w-full rounded-[8px]' />
      <Skeleton className='h-[48px] w-full rounded-[8px]' />
      <Skeleton className='h-[48px] w-full rounded-[8px]' />
    </div>
  )
}

export function CredentialSets() {
  const { data: session } = useSession()
  const { data: organizationsData } = useOrganizations()
  const { data: subscriptionData } = useSubscriptionData()

  const activeOrganization = organizationsData?.activeOrganization
  const subscriptionStatus = getSubscriptionStatus(subscriptionData?.data)
  const hasTeamPlan = subscriptionStatus.isTeam || subscriptionStatus.isEnterprise
  const userRole = getUserRole(activeOrganization, session?.user?.email)
  const isAdmin = userRole === 'admin' || userRole === 'owner'
  const canManageCredentialSets = hasTeamPlan && isAdmin && !!activeOrganization?.id

  const { data: memberships = [], isPending: membershipsLoading } = useCredentialSetMemberships()
  const { data: invitations = [], isPending: invitationsLoading } = useCredentialSetInvitations()
  const { data: ownedSets = [], isPending: ownedSetsLoading } = useCredentialSets(
    activeOrganization?.id,
    canManageCredentialSets
  )

  const acceptInvitation = useAcceptCredentialSetInvitation()
  const createCredentialSet = useCreateCredentialSet()
  const createInvitation = useCreateCredentialSetInvitation()

  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [selectedSetId, setSelectedSetId] = useState<string | null>(null)
  const [newSetName, setNewSetName] = useState('')
  const [newSetDescription, setNewSetDescription] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [copiedLink, setCopiedLink] = useState(false)

  const handleAcceptInvitation = useCallback(
    async (token: string) => {
      try {
        await acceptInvitation.mutateAsync(token)
      } catch (error) {
        logger.error('Failed to accept invitation', error)
      }
    },
    [acceptInvitation]
  )

  const handleCreateCredentialSet = useCallback(async () => {
    if (!newSetName.trim() || !activeOrganization?.id) return
    try {
      await createCredentialSet.mutateAsync({
        organizationId: activeOrganization.id,
        name: newSetName.trim(),
        description: newSetDescription.trim() || undefined,
      })
      setShowCreateModal(false)
      setNewSetName('')
      setNewSetDescription('')
    } catch (error) {
      logger.error('Failed to create credential set', error)
    }
  }, [newSetName, newSetDescription, activeOrganization?.id, createCredentialSet])

  const handleCreateInvite = useCallback(async () => {
    if (!selectedSetId) return
    try {
      const result = await createInvitation.mutateAsync({
        credentialSetId: selectedSetId,
        email: inviteEmail.trim() || undefined,
      })
      const inviteUrl = result.invitation?.inviteUrl
      if (inviteUrl) {
        await navigator.clipboard.writeText(inviteUrl)
        setCopiedLink(true)
        setTimeout(() => setCopiedLink(false), 2000)
      }
      setShowInviteModal(false)
      setInviteEmail('')
      setSelectedSetId(null)
    } catch (error) {
      logger.error('Failed to create invitation', error)
    }
  }, [selectedSetId, inviteEmail, createInvitation])

  if (membershipsLoading || invitationsLoading) {
    return <CredentialSetsSkeleton />
  }

  const activeMemberships = memberships.filter((m) => m.status === 'active')
  const hasNoContent =
    invitations.length === 0 && activeMemberships.length === 0 && ownedSets.length === 0

  return (
    <div className='flex h-full flex-col gap-[16px] overflow-y-auto'>
      {hasNoContent && !canManageCredentialSets && (
        <div className='flex flex-1 flex-col items-center justify-center gap-[8px] text-center'>
          <p className='text-[13px] text-[var(--text-secondary)]'>
            You're not a member of any credential sets yet.
          </p>
          <p className='text-[12px] text-[var(--text-tertiary)]'>
            When someone invites you to a credential set, it will appear here.
          </p>
        </div>
      )}

      {invitations.length > 0 && (
        <div className='flex flex-col gap-[8px]'>
          <Label className='text-[12px] text-[var(--text-tertiary)]'>Pending Invitations</Label>
          {invitations.map((invitation) => (
            <div
              key={invitation.invitationId}
              className='flex items-center justify-between rounded-[8px] border border-[var(--border)] px-[12px] py-[10px]'
            >
              <div className='flex flex-col'>
                <span className='font-medium text-[13px] text-[var(--text-primary)]'>
                  {invitation.credentialSetName}
                </span>
                <span className='text-[12px] text-[var(--text-secondary)]'>
                  {invitation.organizationName}
                </span>
              </div>
              <Button
                variant='secondary'
                onClick={() => handleAcceptInvitation(invitation.token)}
                disabled={acceptInvitation.isPending}
              >
                {acceptInvitation.isPending ? (
                  <Loader2 className='h-[14px] w-[14px] animate-spin' />
                ) : (
                  'Accept'
                )}
              </Button>
            </div>
          ))}
        </div>
      )}

      {activeMemberships.length > 0 && (
        <div className='flex flex-col gap-[8px]'>
          <Label className='text-[12px] text-[var(--text-tertiary)]'>My Memberships</Label>
          {activeMemberships.map((membership) => (
            <div
              key={membership.membershipId}
              className='flex items-center justify-between rounded-[8px] border border-[var(--border)] px-[12px] py-[10px]'
            >
              <div className='flex flex-col'>
                <span className='font-medium text-[13px] text-[var(--text-primary)]'>
                  {membership.credentialSetName}
                </span>
                <span className='text-[12px] text-[var(--text-secondary)]'>
                  {membership.organizationName}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {canManageCredentialSets && (
        <div className='flex flex-col gap-[8px]'>
          <div className='flex items-center justify-between'>
            <Label className='text-[12px] text-[var(--text-tertiary)]'>Manage</Label>
            <Button variant='secondary' onClick={() => setShowCreateModal(true)}>
              <Plus className='mr-[4px] h-[14px] w-[14px]' />
              Create
            </Button>
          </div>

          {ownedSetsLoading ? (
            <>
              <Skeleton className='h-[48px] w-full rounded-[8px]' />
              <Skeleton className='h-[48px] w-full rounded-[8px]' />
            </>
          ) : ownedSets.length === 0 ? (
            <div className='rounded-[8px] border border-dashed border-[var(--border)] px-[12px] py-[16px] text-center'>
              <p className='text-[12px] text-[var(--text-tertiary)]'>
                No credential sets created yet
              </p>
            </div>
          ) : (
            ownedSets.map((set) => (
              <div
                key={set.id}
                className='flex items-center justify-between rounded-[8px] border border-[var(--border)] px-[12px] py-[10px]'
              >
                <div className='flex flex-col'>
                  <span className='font-medium text-[13px] text-[var(--text-primary)]'>
                    {set.name}
                  </span>
                  <span className='text-[12px] text-[var(--text-secondary)]'>
                    {set.memberCount} member{set.memberCount !== 1 ? 's' : ''}
                  </span>
                </div>
                <Button
                  variant='secondary'
                  onClick={() => {
                    setSelectedSetId(set.id)
                    setShowInviteModal(true)
                  }}
                >
                  Invite
                </Button>
              </div>
            ))
          )}
        </div>
      )}

      <Modal open={showCreateModal} onOpenChange={setShowCreateModal}>
        <ModalContent size='sm'>
          <ModalHeader>Create Credential Set</ModalHeader>
          <ModalBody>
            <div className='flex flex-col gap-[16px]'>
              <div className='flex flex-col gap-[4px]'>
                <Label>Name</Label>
                <Input
                  value={newSetName}
                  onChange={(e) => setNewSetName(e.target.value)}
                  placeholder='e.g., Marketing Team'
                />
              </div>
              <div className='flex flex-col gap-[4px]'>
                <Label>Description (optional)</Label>
                <Input
                  value={newSetDescription}
                  onChange={(e) => setNewSetDescription(e.target.value)}
                  placeholder='e.g., Credentials for marketing automations'
                />
              </div>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant='secondary' onClick={() => setShowCreateModal(false)}>
              Cancel
            </Button>
            <Button
              variant='primary'
              onClick={handleCreateCredentialSet}
              disabled={!newSetName.trim() || createCredentialSet.isPending}
            >
              {createCredentialSet.isPending ? (
                <Loader2 className='h-[14px] w-[14px] animate-spin' />
              ) : (
                'Create'
              )}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal open={showInviteModal} onOpenChange={setShowInviteModal}>
        <ModalContent size='sm'>
          <ModalHeader>Invite to Credential Set</ModalHeader>
          <ModalBody>
            <div className='flex flex-col gap-[16px]'>
              <div className='flex flex-col gap-[4px]'>
                <Label>Email (optional)</Label>
                <Input
                  type='email'
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder='Leave empty for a shareable link'
                />
              </div>
              <p className='text-[12px] text-[var(--text-secondary)]'>
                An invite link will be copied to your clipboard.
              </p>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant='secondary' onClick={() => setShowInviteModal(false)}>
              Cancel
            </Button>
            <Button
              variant='primary'
              onClick={handleCreateInvite}
              disabled={createInvitation.isPending}
            >
              {createInvitation.isPending ? (
                <Loader2 className='h-[14px] w-[14px] animate-spin' />
              ) : copiedLink ? (
                <>
                  <Check className='mr-[4px] h-[14px] w-[14px]' />
                  Copied!
                </>
              ) : (
                <>
                  <Copy className='mr-[4px] h-[14px] w-[14px]' />
                  Copy Invite Link
                </>
              )}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  )
}
