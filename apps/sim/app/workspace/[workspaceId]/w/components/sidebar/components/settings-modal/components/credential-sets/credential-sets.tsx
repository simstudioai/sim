'use client'

import { useCallback, useMemo, useState } from 'react'
import { createLogger } from '@sim/logger'
import { ArrowLeft, Check, Copy, Loader2, Plus, Trash2, User } from 'lucide-react'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  Combobox,
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
import { OAUTH_PROVIDERS } from '@/lib/oauth'
import { getUserRole } from '@/lib/workspaces/organization'
import {
  type CredentialSet,
  type CredentialSetType,
  useAcceptCredentialSetInvitation,
  useCreateCredentialSet,
  useCreateCredentialSetInvitation,
  useCredentialSetInvitations,
  useCredentialSetMembers,
  useCredentialSetMemberships,
  useCredentialSets,
  useRemoveCredentialSetMember,
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
  const [viewingSet, setViewingSet] = useState<CredentialSet | null>(null)
  const [newSetName, setNewSetName] = useState('')
  const [newSetDescription, setNewSetDescription] = useState('')
  const [newSetType, setNewSetType] = useState<CredentialSetType>('all')
  const [newSetProviderId, setNewSetProviderId] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [copiedLink, setCopiedLink] = useState(false)
  const [generatedInviteUrl, setGeneratedInviteUrl] = useState<string | null>(null)

  const { data: members = [], isPending: membersLoading } = useCredentialSetMembers(viewingSet?.id)
  const removeMember = useRemoveCredentialSetMember()

  const providerOptions = useMemo(() => {
    const options: { label: string; value: string }[] = []
    for (const [, provider] of Object.entries(OAUTH_PROVIDERS)) {
      if (provider.services) {
        for (const [, service] of Object.entries(provider.services)) {
          options.push({
            label: service.name,
            value: service.providerId,
          })
        }
      }
    }
    return options.sort((a, b) => a.label.localeCompare(b.label))
  }, [])

  const getProviderName = useCallback((providerId: string) => {
    for (const [, provider] of Object.entries(OAUTH_PROVIDERS)) {
      if (provider.services) {
        for (const [, service] of Object.entries(provider.services)) {
          if (service.providerId === providerId) {
            return service.name
          }
        }
      }
    }
    return providerId
  }, [])

  const handleRemoveMember = useCallback(
    async (memberId: string) => {
      if (!viewingSet) return
      try {
        await removeMember.mutateAsync({
          credentialSetId: viewingSet.id,
          memberId,
        })
      } catch (error) {
        logger.error('Failed to remove member', error)
      }
    },
    [viewingSet, removeMember]
  )

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
    if (newSetType === 'specific' && !newSetProviderId) return
    try {
      await createCredentialSet.mutateAsync({
        organizationId: activeOrganization.id,
        name: newSetName.trim(),
        description: newSetDescription.trim() || undefined,
        type: newSetType,
        providerId: newSetType === 'specific' ? newSetProviderId : undefined,
      })
      setShowCreateModal(false)
      setNewSetName('')
      setNewSetDescription('')
      setNewSetType('all')
      setNewSetProviderId('')
    } catch (error) {
      logger.error('Failed to create credential set', error)
    }
  }, [
    newSetName,
    newSetDescription,
    newSetType,
    newSetProviderId,
    activeOrganization?.id,
    createCredentialSet,
  ])

  const handleCreateInvite = useCallback(async () => {
    if (!selectedSetId) return
    try {
      const result = await createInvitation.mutateAsync({
        credentialSetId: selectedSetId,
        email: inviteEmail.trim() || undefined,
      })
      const inviteUrl = result.invitation?.inviteUrl
      if (inviteUrl) {
        setGeneratedInviteUrl(inviteUrl)
        try {
          await navigator.clipboard.writeText(inviteUrl)
          setCopiedLink(true)
          setTimeout(() => setCopiedLink(false), 2000)
        } catch {
          // Clipboard failed, URL is shown in modal for manual copy
        }
      }
      setInviteEmail('')
    } catch (error) {
      logger.error('Failed to create invitation', error)
    }
  }, [selectedSetId, inviteEmail, createInvitation])

  const handleCopyInviteUrl = useCallback(async () => {
    if (!generatedInviteUrl) return
    try {
      await navigator.clipboard.writeText(generatedInviteUrl)
      setCopiedLink(true)
      setTimeout(() => setCopiedLink(false), 2000)
    } catch {
      // Fallback: select the input text
    }
  }, [generatedInviteUrl])

  const handleCloseInviteModal = useCallback(() => {
    setShowInviteModal(false)
    setInviteEmail('')
    setSelectedSetId(null)
    setGeneratedInviteUrl(null)
    setCopiedLink(false)
  }, [])

  if (membershipsLoading || invitationsLoading) {
    return <CredentialSetsSkeleton />
  }

  const activeMemberships = memberships.filter((m) => m.status === 'active')
  const hasNoContent =
    invitations.length === 0 && activeMemberships.length === 0 && ownedSets.length === 0

  // Detail view for a credential set
  if (viewingSet) {
    const activeMembers = members.filter((m) => m.status === 'active')
    const pendingMembers = members.filter((m) => m.status === 'pending')

    return (
      <div className='flex h-full flex-col gap-[16px] overflow-y-auto'>
        <div className='flex items-center gap-[8px]'>
          <Button variant='ghost' onClick={() => setViewingSet(null)} className='p-[4px]'>
            <ArrowLeft className='h-[16px] w-[16px]' />
          </Button>
          <div className='flex flex-col'>
            <span className='font-medium text-[14px] text-[var(--text-primary)]'>
              {viewingSet.name}
            </span>
            <span className='text-[12px] text-[var(--text-secondary)]'>
              {viewingSet.type === 'all'
                ? 'All Integrations'
                : `${getProviderName(viewingSet.providerId || '')} Only`}
            </span>
          </div>
        </div>

        {membersLoading ? (
          <div className='flex flex-col gap-[8px]'>
            <Skeleton className='h-[60px] w-full rounded-[8px]' />
            <Skeleton className='h-[60px] w-full rounded-[8px]' />
          </div>
        ) : (
          <>
            {activeMembers.length > 0 && (
              <div className='flex flex-col gap-[8px]'>
                <Label className='text-[12px] text-[var(--text-tertiary)]'>
                  Active Members ({activeMembers.length})
                </Label>
                {activeMembers.map((member) => (
                  <div
                    key={member.id}
                    className='flex items-center justify-between rounded-[8px] border border-[var(--border)] px-[12px] py-[10px]'
                  >
                    <div className='flex items-center gap-[10px]'>
                      <Avatar className='h-[32px] w-[32px]'>
                        <AvatarImage src={member.userImage || undefined} />
                        <AvatarFallback>
                          <User className='h-[14px] w-[14px]' />
                        </AvatarFallback>
                      </Avatar>
                      <div className='flex flex-col'>
                        <span className='font-medium text-[13px] text-[var(--text-primary)]'>
                          {member.userName || 'Unknown'}
                        </span>
                        <span className='text-[11px] text-[var(--text-secondary)]'>
                          {member.userEmail}
                        </span>
                      </div>
                    </div>
                    <Button
                      variant='ghost'
                      onClick={() => handleRemoveMember(member.id)}
                      disabled={removeMember.isPending}
                      className='p-[6px] text-[var(--text-muted)] hover:text-[var(--text-error)]'
                    >
                      <Trash2 className='h-[14px] w-[14px]' />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {pendingMembers.length > 0 && (
              <div className='flex flex-col gap-[8px]'>
                <Label className='text-[12px] text-[var(--text-tertiary)]'>
                  Pending ({pendingMembers.length})
                </Label>
                {pendingMembers.map((member) => (
                  <div
                    key={member.id}
                    className='flex items-center justify-between rounded-[8px] border border-dashed border-[var(--border)] px-[12px] py-[10px]'
                  >
                    <div className='flex items-center gap-[10px]'>
                      <Avatar className='h-[32px] w-[32px]'>
                        <AvatarImage src={member.userImage || undefined} />
                        <AvatarFallback>
                          <User className='h-[14px] w-[14px]' />
                        </AvatarFallback>
                      </Avatar>
                      <div className='flex flex-col'>
                        <span className='font-medium text-[13px] text-[var(--text-primary)]'>
                          {member.userName || 'Unknown'}
                        </span>
                        <span className='text-[11px] text-[var(--text-secondary)]'>
                          {member.userEmail}
                        </span>
                      </div>
                    </div>
                    <span className='text-[11px] text-[var(--text-muted)]'>Pending</span>
                  </div>
                ))}
              </div>
            )}

            {members.length === 0 && (
              <div className='flex flex-col items-center justify-center gap-[8px] py-[32px] text-center'>
                <p className='text-[13px] text-[var(--text-secondary)]'>No members yet</p>
                <p className='text-[12px] text-[var(--text-tertiary)]'>
                  Invite people to join this credential set
                </p>
              </div>
            )}
          </>
        )}

        <div className='pt-[8px]'>
          <Button
            variant='tertiary'
            onClick={() => {
              setSelectedSetId(viewingSet.id)
              setShowInviteModal(true)
            }}
          >
            <Plus className='mr-[4px] h-[14px] w-[14px]' />
            Invite Member
          </Button>
        </div>

        <Modal open={showInviteModal} onOpenChange={handleCloseInviteModal}>
          <ModalContent size='sm'>
            <ModalHeader>Invite to Credential Set</ModalHeader>
            <ModalBody>
              <div className='flex flex-col gap-[16px]'>
                {generatedInviteUrl ? (
                  <>
                    <div className='flex flex-col gap-[4px]'>
                      <Label>Invite Link</Label>
                      <div className='flex gap-[8px]'>
                        <Input
                          value={generatedInviteUrl}
                          readOnly
                          onClick={(e) => (e.target as HTMLInputElement).select()}
                        />
                        <Button variant='ghost' onClick={handleCopyInviteUrl}>
                          {copiedLink ? (
                            <Check className='h-[14px] w-[14px]' />
                          ) : (
                            <Copy className='h-[14px] w-[14px]' />
                          )}
                        </Button>
                      </div>
                    </div>
                    <p className='text-[12px] text-[var(--text-secondary)]'>
                      Share this link with the person you want to invite.
                    </p>
                  </>
                ) : (
                  <>
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
                      Generate an invite link to share.
                    </p>
                  </>
                )}
              </div>
            </ModalBody>
            <ModalFooter>
              {generatedInviteUrl ? (
                <Button variant='default' onClick={handleCloseInviteModal}>
                  Done
                </Button>
              ) : (
                <>
                  <Button variant='default' onClick={handleCloseInviteModal}>
                    Cancel
                  </Button>
                  <Button
                    variant='tertiary'
                    onClick={handleCreateInvite}
                    disabled={createInvitation.isPending}
                  >
                    {createInvitation.isPending ? (
                      <Loader2 className='h-[14px] w-[14px] animate-spin' />
                    ) : (
                      'Generate Link'
                    )}
                  </Button>
                </>
              )}
            </ModalFooter>
          </ModalContent>
        </Modal>
      </div>
    )
  }

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
                variant='tertiary'
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
            <Button variant='tertiary' onClick={() => setShowCreateModal(true)}>
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
                className='flex cursor-pointer items-center justify-between rounded-[8px] border border-[var(--border)] px-[12px] py-[10px] transition-colors hover:bg-[var(--bg-surface)]'
                onClick={() => setViewingSet(set)}
              >
                <div className='flex flex-col'>
                  <span className='font-medium text-[13px] text-[var(--text-primary)]'>
                    {set.name}
                  </span>
                  <span className='text-[12px] text-[var(--text-secondary)]'>
                    {set.memberCount} member{set.memberCount !== 1 ? 's' : ''}
                    {set.type === 'specific' && set.providerId && (
                      <> · {getProviderName(set.providerId)}</>
                    )}
                  </span>
                </div>
                <Button
                  variant='tertiary'
                  onClick={(e) => {
                    e.stopPropagation()
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
              <div className='flex flex-col gap-[4px]'>
                <Label>Type</Label>
                <div className='flex gap-[8px]'>
                  <Button
                    variant={newSetType === 'all' ? 'active' : 'default'}
                    onClick={() => {
                      setNewSetType('all')
                      setNewSetProviderId('')
                    }}
                    className='flex-1'
                  >
                    All Integrations
                  </Button>
                  <Button
                    variant={newSetType === 'specific' ? 'active' : 'default'}
                    onClick={() => setNewSetType('specific')}
                    className='flex-1'
                  >
                    Specific Integration
                  </Button>
                </div>
                <p className='mt-[4px] text-[11px] text-[var(--text-tertiary)]'>
                  {newSetType === 'all'
                    ? 'Members share all their connected credentials'
                    : 'Members share only credentials for a specific integration'}
                </p>
              </div>
              {newSetType === 'specific' && (
                <div className='flex flex-col gap-[4px]'>
                  <Label>Integration</Label>
                  <Combobox
                    options={providerOptions}
                    value={
                      providerOptions.find((p) => p.value === newSetProviderId)?.label ||
                      newSetProviderId
                    }
                    selectedValue={newSetProviderId}
                    onChange={(value) => setNewSetProviderId(value)}
                    placeholder='Select an integration'
                    filterOptions
                  />
                </div>
              )}
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant='default' onClick={() => setShowCreateModal(false)}>
              Cancel
            </Button>
            <Button
              variant='tertiary'
              onClick={handleCreateCredentialSet}
              disabled={
                !newSetName.trim() ||
                (newSetType === 'specific' && !newSetProviderId) ||
                createCredentialSet.isPending
              }
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

      <Modal open={showInviteModal} onOpenChange={handleCloseInviteModal}>
        <ModalContent size='sm'>
          <ModalHeader>Invite to Credential Set</ModalHeader>
          <ModalBody>
            <div className='flex flex-col gap-[16px]'>
              {generatedInviteUrl ? (
                <>
                  <div className='flex flex-col gap-[4px]'>
                    <Label>Invite Link</Label>
                    <div className='flex gap-[8px]'>
                      <Input
                        value={generatedInviteUrl}
                        readOnly
                        onClick={(e) => (e.target as HTMLInputElement).select()}
                      />
                      <Button variant='ghost' onClick={handleCopyInviteUrl}>
                        {copiedLink ? (
                          <Check className='h-[14px] w-[14px]' />
                        ) : (
                          <Copy className='h-[14px] w-[14px]' />
                        )}
                      </Button>
                    </div>
                  </div>
                  <p className='text-[12px] text-[var(--text-secondary)]'>
                    Share this link with the person you want to invite.
                  </p>
                </>
              ) : (
                <>
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
                    Generate an invite link to share.
                  </p>
                </>
              )}
            </div>
          </ModalBody>
          <ModalFooter>
            {generatedInviteUrl ? (
              <Button variant='default' onClick={handleCloseInviteModal}>
                Done
              </Button>
            ) : (
              <>
                <Button variant='default' onClick={handleCloseInviteModal}>
                  Cancel
                </Button>
                <Button
                  variant='tertiary'
                  onClick={handleCreateInvite}
                  disabled={createInvitation.isPending}
                >
                  {createInvitation.isPending ? (
                    <Loader2 className='h-[14px] w-[14px] animate-spin' />
                  ) : (
                    'Generate Link'
                  )}
                </Button>
              </>
            )}
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  )
}
