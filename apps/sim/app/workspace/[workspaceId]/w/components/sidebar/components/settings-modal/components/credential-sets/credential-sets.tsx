'use client'

import { useCallback, useState } from 'react'
import { createLogger } from '@sim/logger'
import { ArrowLeft, Loader2, LogOut, Plus, Trash2, User } from 'lucide-react'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  Input,
  Label,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Textarea,
} from '@/components/emcn'
import { GmailIcon, OutlookIcon } from '@/components/icons'
import { Skeleton } from '@/components/ui'
import { useSession } from '@/lib/auth/auth-client'
import { getSubscriptionStatus } from '@/lib/billing/client'
import { getProviderDisplayName, type PollingProvider } from '@/lib/credential-sets/providers'
import { getUserRole } from '@/lib/workspaces/organization'
import {
  type CredentialSet,
  useAcceptCredentialSetInvitation,
  useCreateCredentialSet,
  useCreateCredentialSetInvitation,
  useCredentialSetInvitations,
  useCredentialSetMembers,
  useCredentialSetMemberships,
  useCredentialSets,
  useLeaveCredentialSet,
  useRemoveCredentialSetMember,
} from '@/hooks/queries/credential-sets'
import { useOrganizations } from '@/hooks/queries/organization'
import { useSubscriptionData } from '@/hooks/queries/subscription'

const logger = createLogger('EmailPolling')

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
  const [newSetProvider, setNewSetProvider] = useState<PollingProvider>('google-email')
  const [createError, setCreateError] = useState<string | null>(null)
  const [inviteEmails, setInviteEmails] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const [leavingMembership, setLeavingMembership] = useState<{
    credentialSetId: string
    name: string
  } | null>(null)

  const { data: members = [], isPending: membersLoading } = useCredentialSetMembers(viewingSet?.id)
  const removeMember = useRemoveCredentialSetMember()
  const leaveCredentialSet = useLeaveCredentialSet()

  const extractEmailsFromText = useCallback((text: string): string[] => {
    // Match email patterns in text
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g
    const matches = text.match(emailRegex) || []
    // Deduplicate and return
    return [...new Set(matches.map((e) => e.toLowerCase()))]
  }, [])

  const handleFileDrop = useCallback(
    async (file: File) => {
      try {
        const text = await file.text()
        const emails = extractEmailsFromText(text)
        if (emails.length > 0) {
          setInviteEmails((prev) => {
            const existing = prev
              .split(/[,\n]/)
              .map((e) => e.trim())
              .filter((e) => e.length > 0)
            const combined = [...new Set([...existing, ...emails])]
            return combined.join('\n')
          })
        }
      } catch (error) {
        logger.error('Error reading dropped file', error)
      }
    },
    [extractEmailsFromText]
  )

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'copy'
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragging(false)

      const files = Array.from(e.dataTransfer.files)
      const validFiles = files.filter(
        (f) =>
          f.type === 'text/csv' ||
          f.type === 'text/plain' ||
          f.name.endsWith('.csv') ||
          f.name.endsWith('.txt')
      )

      for (const file of validFiles) {
        await handleFileDrop(file)
      }
    },
    [handleFileDrop]
  )

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

  const handleLeave = useCallback((credentialSetId: string, name: string) => {
    setLeavingMembership({ credentialSetId, name })
  }, [])

  const confirmLeave = useCallback(async () => {
    if (!leavingMembership) return
    try {
      await leaveCredentialSet.mutateAsync(leavingMembership.credentialSetId)
      setLeavingMembership(null)
    } catch (error) {
      logger.error('Failed to leave polling group', error)
    }
  }, [leavingMembership, leaveCredentialSet])

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
    setCreateError(null)
    try {
      await createCredentialSet.mutateAsync({
        organizationId: activeOrganization.id,
        name: newSetName.trim(),
        description: newSetDescription.trim() || undefined,
        providerId: newSetProvider,
      })
      setShowCreateModal(false)
      setNewSetName('')
      setNewSetDescription('')
      setNewSetProvider('google-email')
    } catch (error) {
      logger.error('Failed to create polling group', error)
      if (error instanceof Error) {
        setCreateError(error.message)
      } else {
        setCreateError('Failed to create polling group')
      }
    }
  }, [newSetName, newSetDescription, newSetProvider, activeOrganization?.id, createCredentialSet])

  const handleCreateInvite = useCallback(async () => {
    if (!selectedSetId) return

    // Parse comma-separated or newline-separated emails
    const emails = inviteEmails
      .split(/[,\n]/)
      .map((e) => e.trim())
      .filter((e) => e.length > 0 && e.includes('@'))

    if (emails.length === 0) return

    try {
      for (const email of emails) {
        await createInvitation.mutateAsync({
          credentialSetId: selectedSetId,
          email,
        })
      }
      setInviteEmails('')
      setShowInviteModal(false)
      setSelectedSetId(null)
    } catch (error) {
      logger.error('Failed to create invitations', error)
    }
  }, [selectedSetId, inviteEmails, createInvitation])

  const handleCloseCreateModal = useCallback(() => {
    setShowCreateModal(false)
    setNewSetName('')
    setNewSetDescription('')
    setNewSetProvider('google-email')
    setCreateError(null)
  }, [])

  const handleCloseInviteModal = useCallback(() => {
    setShowInviteModal(false)
    setInviteEmails('')
    setSelectedSetId(null)
  }, [])

  if (membershipsLoading || invitationsLoading) {
    return <CredentialSetsSkeleton />
  }

  const activeMemberships = memberships.filter((m) => m.status === 'active')
  const hasNoContent =
    invitations.length === 0 && activeMemberships.length === 0 && ownedSets.length === 0

  // Detail view for a polling group
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
              {getProviderDisplayName(viewingSet.providerId || '')}
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
                  Invite people to join this polling group
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
            Add Member
          </Button>
        </div>

        <Modal open={showInviteModal} onOpenChange={handleCloseInviteModal}>
          <ModalContent size='sm'>
            <ModalHeader>Add Members</ModalHeader>
            <ModalBody>
              <div className='flex flex-col gap-[16px]'>
                <div className='flex flex-col gap-[4px]'>
                  <Label>Email Addresses</Label>
                  <div
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    className={`relative rounded-[8px] transition-colors ${isDragging ? 'ring-2 ring-[var(--accent)]' : ''}`}
                  >
                    <Textarea
                      value={inviteEmails}
                      onChange={(e) => setInviteEmails(e.target.value)}
                      placeholder='Enter emails separated by commas or newlines, or drag and drop a CSV file'
                      rows={4}
                    />
                    {isDragging && (
                      <div className='pointer-events-none absolute inset-0 flex items-center justify-center rounded-[8px] bg-[var(--accent)]/10'>
                        <span className='text-[13px] font-medium text-[var(--accent)]'>
                          Drop CSV or text file
                        </span>
                      </div>
                    )}
                  </div>
                </div>
                <p className='text-[12px] text-[var(--text-secondary)]'>
                  Invitees will receive an email with a link to connect their account.
                </p>
              </div>
            </ModalBody>
            <ModalFooter>
              <Button variant='default' onClick={handleCloseInviteModal}>
                Cancel
              </Button>
              <Button
                variant='tertiary'
                onClick={handleCreateInvite}
                disabled={createInvitation.isPending || !inviteEmails.trim()}
              >
                {createInvitation.isPending ? (
                  <Loader2 className='h-[14px] w-[14px] animate-spin' />
                ) : (
                  'Send Invites'
                )}
              </Button>
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
            You're not a member of any polling groups yet.
          </p>
          <p className='text-[12px] text-[var(--text-tertiary)]'>
            When someone invites you to a polling group, it will appear here.
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
              <Button
                variant='ghost'
                size='sm'
                onClick={() =>
                  handleLeave(membership.credentialSetId, membership.credentialSetName)
                }
                disabled={leaveCredentialSet.isPending}
                className='text-[var(--text-secondary)] hover:text-[var(--text-error)]'
              >
                {leaveCredentialSet.isPending ? (
                  <Loader2 className='h-[14px] w-[14px] animate-spin' />
                ) : (
                  <LogOut className='h-[14px] w-[14px]' />
                )}
              </Button>
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
                No polling groups created yet
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
                    {set.providerId && <> · {getProviderDisplayName(set.providerId)}</>}
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
                  Add Members
                </Button>
              </div>
            ))
          )}
        </div>
      )}

      <Modal open={showCreateModal} onOpenChange={handleCloseCreateModal}>
        <ModalContent size='sm'>
          <ModalHeader>Create Polling Group</ModalHeader>
          <ModalBody>
            <div className='flex flex-col gap-[16px]'>
              <div className='flex flex-col gap-[4px]'>
                <Label>Name</Label>
                <Input
                  value={newSetName}
                  onChange={(e) => {
                    setNewSetName(e.target.value)
                    if (createError) setCreateError(null)
                  }}
                  placeholder='e.g., Marketing Team'
                />
              </div>
              <div className='flex flex-col gap-[4px]'>
                <Label>Description (optional)</Label>
                <Input
                  value={newSetDescription}
                  onChange={(e) => setNewSetDescription(e.target.value)}
                  placeholder='e.g., Poll emails for marketing automations'
                />
              </div>
              <div className='flex flex-col gap-[4px]'>
                <Label>Email Provider</Label>
                <div className='flex gap-[8px]'>
                  <Button
                    variant={newSetProvider === 'google-email' ? 'active' : 'default'}
                    onClick={() => setNewSetProvider('google-email')}
                    className='flex-1'
                  >
                    <GmailIcon className='mr-[6px] h-[16px] w-[16px]' />
                    Gmail
                  </Button>
                  <Button
                    variant={newSetProvider === 'outlook' ? 'active' : 'default'}
                    onClick={() => setNewSetProvider('outlook')}
                    className='flex-1'
                  >
                    <OutlookIcon className='mr-[6px] h-[16px] w-[16px]' />
                    Outlook
                  </Button>
                </div>
                <p className='mt-[4px] text-[11px] text-[var(--text-tertiary)]'>
                  Members will connect their {getProviderDisplayName(newSetProvider)} account for
                  email polling
                </p>
              </div>
              {createError && <p className='text-[12px] text-[var(--text-error)]'>{createError}</p>}
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant='default' onClick={handleCloseCreateModal}>
              Cancel
            </Button>
            <Button
              variant='tertiary'
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

      <Modal open={showInviteModal} onOpenChange={handleCloseInviteModal}>
        <ModalContent size='sm'>
          <ModalHeader>Add Members</ModalHeader>
          <ModalBody>
            <div className='flex flex-col gap-[16px]'>
              <div className='flex flex-col gap-[4px]'>
                <Label>Email Addresses</Label>
                <div
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  className={`relative rounded-[8px] transition-colors ${isDragging ? 'ring-2 ring-[var(--accent)]' : ''}`}
                >
                  <Textarea
                    value={inviteEmails}
                    onChange={(e) => setInviteEmails(e.target.value)}
                    placeholder='Enter emails separated by commas or newlines, or drag and drop a CSV file'
                    rows={4}
                  />
                  {isDragging && (
                    <div className='pointer-events-none absolute inset-0 flex items-center justify-center rounded-[8px] bg-[var(--accent)]/10'>
                      <span className='text-[13px] font-medium text-[var(--accent)]'>
                        Drop CSV or text file
                      </span>
                    </div>
                  )}
                </div>
              </div>
              <p className='text-[12px] text-[var(--text-secondary)]'>
                Invitees will receive an email with a link to connect their account.
              </p>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant='default' onClick={handleCloseInviteModal}>
              Cancel
            </Button>
            <Button
              variant='tertiary'
              onClick={handleCreateInvite}
              disabled={createInvitation.isPending || !inviteEmails.trim()}
            >
              {createInvitation.isPending ? (
                <Loader2 className='h-[14px] w-[14px] animate-spin' />
              ) : (
                'Send Invites'
              )}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal open={!!leavingMembership} onOpenChange={() => setLeavingMembership(null)}>
        <ModalContent className='w-[400px]'>
          <ModalHeader>Leave Polling Group</ModalHeader>
          <ModalBody>
            <p className='text-[12px] text-[var(--text-secondary)]'>
              Are you sure you want to leave{' '}
              <span className='font-medium text-[var(--text-primary)]'>
                {leavingMembership?.name}
              </span>
              ? Your email account will no longer be polled in workflows using this group.
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant='active' onClick={() => setLeavingMembership(null)}>
              Cancel
            </Button>
            <Button
              variant='destructive'
              onClick={confirmLeave}
              disabled={leaveCredentialSet.isPending}
            >
              {leaveCredentialSet.isPending ? 'Leaving...' : 'Leave'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  )
}
