'use client'

import { useCallback, useState } from 'react'
import { createLogger } from '@sim/logger'
import { ArrowLeft, Loader2, Plus, User } from 'lucide-react'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
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
import { cn } from '@/lib/core/utils/cn'
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
      <div className='flex flex-col gap-[8px]'>
        <Skeleton className='h-[14px] w-[100px]' />
        <div className='flex items-center justify-between'>
          <div className='flex items-center gap-[12px]'>
            <Skeleton className='h-9 w-9 rounded-[6px]' />
            <div className='flex flex-col gap-[4px]'>
              <Skeleton className='h-[14px] w-[120px]' />
              <Skeleton className='h-[12px] w-[80px]' />
            </div>
          </div>
          <Skeleton className='h-[32px] w-[60px] rounded-[6px]' />
        </div>
      </div>
      <div className='flex flex-col gap-[8px]'>
        <Skeleton className='h-[14px] w-[60px]' />
        <div className='flex items-center justify-between'>
          <div className='flex items-center gap-[12px]'>
            <Skeleton className='h-9 w-9 rounded-[6px]' />
            <div className='flex flex-col gap-[4px]'>
              <Skeleton className='h-[14px] w-[140px]' />
              <Skeleton className='h-[12px] w-[100px]' />
            </div>
          </div>
          <Skeleton className='h-[32px] w-[80px] rounded-[6px]' />
        </div>
      </div>
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
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g
    const matches = text.match(emailRegex) || []
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
      const result = await createCredentialSet.mutateAsync({
        organizationId: activeOrganization.id,
        name: newSetName.trim(),
        description: newSetDescription.trim() || undefined,
        providerId: newSetProvider,
      })
      setShowCreateModal(false)
      setNewSetName('')
      setNewSetDescription('')
      setNewSetProvider('google-email')

      // Open invite modal for the newly created group
      if (result?.credentialSet?.id) {
        setSelectedSetId(result.credentialSet.id)
        setShowInviteModal(true)
      }
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

  const getProviderIcon = (providerId: string | null) => {
    if (providerId === 'outlook') return <OutlookIcon className='h-4 w-4' />
    return <GmailIcon className='h-4 w-4' />
  }

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
      <>
        <div className='flex h-full flex-col gap-[16px]'>
          <div className='flex items-center justify-between'>
            <div className='flex items-center gap-[8px]'>
              <Button variant='ghost' onClick={() => setViewingSet(null)} className='h-9 w-9 p-0'>
                <ArrowLeft className='h-4 w-4' />
              </Button>
              <div className='flex items-center gap-[12px]'>
                <div className='flex h-9 w-9 items-center justify-center rounded-[6px] bg-[var(--surface-5)]'>
                  {getProviderIcon(viewingSet.providerId)}
                </div>
                <span className='font-medium text-[14px]'>{viewingSet.name}</span>
              </div>
            </div>
            <Button
              variant='tertiary'
              onClick={() => {
                setSelectedSetId(viewingSet.id)
                setShowInviteModal(true)
              }}
            >
              <Plus className='mr-[6px] h-[13px] w-[13px]' />
              Add Members
            </Button>
          </div>

          <div className='relative min-h-0 flex-1 overflow-y-auto'>
            {membersLoading ? (
              <div className='flex flex-col gap-[8px]'>
                <Skeleton className='h-[14px] w-[100px]' />
                {[1, 2].map((i) => (
                  <div key={i} className='flex items-center justify-between'>
                    <div className='flex items-center gap-[12px]'>
                      <Skeleton className='h-9 w-9 rounded-full' />
                      <div className='flex flex-col gap-[4px]'>
                        <Skeleton className='h-[14px] w-[100px]' />
                        <Skeleton className='h-[12px] w-[150px]' />
                      </div>
                    </div>
                    <Skeleton className='h-[32px] w-[32px] rounded-[6px]' />
                  </div>
                ))}
              </div>
            ) : members.length === 0 ? (
              <div className='absolute inset-0 flex items-center justify-center text-[13px] text-[var(--text-muted)]'>
                No members yet
              </div>
            ) : (
              <div className='flex flex-col gap-[16px]'>
                {activeMembers.length > 0 && (
                  <div className='flex flex-col gap-[8px]'>
                    <div className='font-medium text-[13px] text-[var(--text-secondary)]'>
                      Active Members ({activeMembers.length})
                    </div>
                    {activeMembers.map((member) => (
                      <div key={member.id} className='flex items-center justify-between'>
                        <div className='flex items-center gap-[12px]'>
                          <Avatar className='h-9 w-9'>
                            <AvatarImage src={member.userImage || undefined} />
                            <AvatarFallback>
                              <User className='h-4 w-4' />
                            </AvatarFallback>
                          </Avatar>
                          <div className='flex flex-col'>
                            <div className='flex items-center gap-[6px]'>
                              <span className='font-medium text-[14px]'>
                                {member.userName || 'Unknown'}
                              </span>
                              {member.credentials.length === 0 && (
                                <Badge variant='red' className='text-[10px]'>
                                  Disconnected
                                </Badge>
                              )}
                            </div>
                            <span className='text-[13px] text-[var(--text-muted)]'>
                              {member.userEmail}
                            </span>
                          </div>
                        </div>
                        <Button
                          variant='ghost'
                          onClick={() => handleRemoveMember(member.id)}
                          disabled={removeMember.isPending}
                        >
                          Remove
                        </Button>
                      </div>
                    ))}
                  </div>
                )}

                {pendingMembers.length > 0 && (
                  <div className='flex flex-col gap-[8px]'>
                    <div className='font-medium text-[13px] text-[var(--text-secondary)]'>
                      Pending ({pendingMembers.length})
                    </div>
                    {pendingMembers.map((member) => (
                      <div key={member.id} className='flex items-center justify-between'>
                        <div className='flex items-center gap-[12px]'>
                          <Avatar className='h-9 w-9'>
                            <AvatarImage src={member.userImage || undefined} />
                            <AvatarFallback>
                              <User className='h-4 w-4' />
                            </AvatarFallback>
                          </Avatar>
                          <div className='flex flex-col'>
                            <span className='font-medium text-[14px]'>
                              {member.userName || 'Unknown'}
                            </span>
                            <span className='text-[13px] text-[var(--text-muted)]'>
                              {member.userEmail}
                            </span>
                          </div>
                        </div>
                        <span className='text-[13px] text-[var(--text-muted)]'>Pending</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <Modal open={showInviteModal} onOpenChange={handleCloseInviteModal}>
          <ModalContent className='w-[400px]'>
            <ModalHeader>Add Members</ModalHeader>
            <ModalBody>
              <div className='flex flex-col gap-[12px]'>
                <Label>Email Addresses</Label>
                <div
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  className={`relative ${isDragging ? 'ring-2 ring-[var(--accent)]' : ''}`}
                >
                  <Textarea
                    value={inviteEmails}
                    onChange={(e) => setInviteEmails(e.target.value)}
                    placeholder='Enter emails separated by commas or newlines'
                    rows={4}
                  />
                  {isDragging && (
                    <div className='pointer-events-none absolute inset-0 flex items-center justify-center rounded-[6px] bg-[var(--accent)]/10'>
                      <span className='font-medium text-[13px] text-[var(--accent)]'>
                        Drop CSV or text file
                      </span>
                    </div>
                  )}
                </div>
                <p className='text-[12px] text-[var(--text-tertiary)]'>
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
                  <Loader2 className='h-4 w-4 animate-spin' />
                ) : (
                  'Send Invites'
                )}
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>
      </>
    )
  }

  return (
    <>
      <div className='flex h-full flex-col gap-[16px]'>
        <div className='relative min-h-0 flex-1 overflow-y-auto'>
          {hasNoContent && !canManageCredentialSets ? (
            <div className='absolute inset-0 flex items-center justify-center text-[13px] text-[var(--text-muted)]'>
              You're not a member of any polling groups yet. When someone invites you, it will
              appear here.
            </div>
          ) : (
            <div className='flex flex-col gap-[16px]'>
              {invitations.length > 0 && (
                <div className='flex flex-col gap-[8px]'>
                  <div className='font-medium text-[13px] text-[var(--text-secondary)]'>
                    Pending Invitations
                  </div>
                  {invitations.map((invitation) => (
                    <div
                      key={invitation.invitationId}
                      className='flex items-center justify-between'
                    >
                      <div className='flex items-center gap-[12px]'>
                        <div className='flex h-9 w-9 items-center justify-center rounded-[6px] bg-[var(--surface-5)]'>
                          {getProviderIcon(invitation.providerId)}
                        </div>
                        <div className='flex flex-col'>
                          <span className='font-medium text-[14px]'>
                            {invitation.credentialSetName}
                          </span>
                          <span className='text-[13px] text-[var(--text-muted)]'>
                            {invitation.organizationName}
                          </span>
                        </div>
                      </div>
                      <Button
                        variant='tertiary'
                        onClick={() => handleAcceptInvitation(invitation.token)}
                        disabled={acceptInvitation.isPending}
                      >
                        {acceptInvitation.isPending ? (
                          <Loader2 className='h-4 w-4 animate-spin' />
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
                  <div className='font-medium text-[13px] text-[var(--text-secondary)]'>
                    My Memberships
                  </div>
                  {activeMemberships.map((membership) => (
                    <div
                      key={membership.membershipId}
                      className='flex items-center justify-between'
                    >
                      <div className='flex items-center gap-[12px]'>
                        <div className='flex h-9 w-9 items-center justify-center rounded-[6px] bg-[var(--surface-5)]'>
                          {getProviderIcon(membership.providerId)}
                        </div>
                        <div className='flex flex-col'>
                          <span className='font-medium text-[14px]'>
                            {membership.credentialSetName}
                          </span>
                          <span className='text-[13px] text-[var(--text-muted)]'>
                            {membership.organizationName}
                          </span>
                        </div>
                      </div>
                      <Button
                        variant='ghost'
                        onClick={() =>
                          handleLeave(membership.credentialSetId, membership.credentialSetName)
                        }
                        disabled={leaveCredentialSet.isPending}
                      >
                        Leave
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              {canManageCredentialSets && (
                <div className='flex flex-col gap-[8px]'>
                  <div className='flex items-center justify-between'>
                    <div className='font-medium text-[13px] text-[var(--text-secondary)]'>
                      Manage
                    </div>
                    <Button variant='tertiary' onClick={() => setShowCreateModal(true)}>
                      <Plus className='mr-[6px] h-[13px] w-[13px]' />
                      Create
                    </Button>
                  </div>
                  {ownedSetsLoading ? (
                    <>
                      {[1, 2].map((i) => (
                        <div key={i} className='flex items-center justify-between'>
                          <div className='flex items-center gap-[12px]'>
                            <Skeleton className='h-9 w-9 rounded-[6px]' />
                            <div className='flex flex-col gap-[4px]'>
                              <Skeleton className='h-[14px] w-[120px]' />
                              <Skeleton className='h-[12px] w-[80px]' />
                            </div>
                          </div>
                          <Skeleton className='h-[32px] w-[100px] rounded-[6px]' />
                        </div>
                      ))}
                    </>
                  ) : ownedSets.length === 0 ? (
                    <div className='text-[13px] text-[var(--text-muted)]'>
                      No polling groups created yet
                    </div>
                  ) : (
                    ownedSets.map((set) => (
                      <div
                        key={set.id}
                        className='flex cursor-pointer items-center justify-between'
                        onClick={() => setViewingSet(set)}
                      >
                        <div className='flex items-center gap-[12px]'>
                          <div className='flex h-9 w-9 items-center justify-center rounded-[6px] bg-[var(--surface-5)]'>
                            {getProviderIcon(set.providerId)}
                          </div>
                          <div className='flex flex-col'>
                            <span className='font-medium text-[14px]'>{set.name}</span>
                            <span className='text-[13px] text-[var(--text-muted)]'>
                              {set.memberCount} member{set.memberCount !== 1 ? 's' : ''}
                            </span>
                          </div>
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
            </div>
          )}
        </div>
      </div>

      <Modal open={showCreateModal} onOpenChange={handleCloseCreateModal}>
        <ModalContent className='w-[400px]'>
          <ModalHeader>Create Polling Group</ModalHeader>
          <ModalBody>
            <div className='flex flex-col gap-[12px]'>
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
                <div className='inline-flex gap-[2px]'>
                  <Button
                    variant={newSetProvider === 'google-email' ? 'active' : 'default'}
                    onClick={() => setNewSetProvider('google-email')}
                    className={cn(
                      'rounded-r-none px-[8px] py-[4px] text-[12px]',
                      newSetProvider === 'google-email' &&
                        'bg-[var(--border-1)] hover:bg-[var(--border-1)] dark:bg-[var(--surface-5)] dark:hover:bg-[var(--border-1)]'
                    )}
                  >
                    Gmail
                  </Button>
                  <Button
                    variant={newSetProvider === 'outlook' ? 'active' : 'default'}
                    onClick={() => setNewSetProvider('outlook')}
                    className={cn(
                      'rounded-l-none px-[8px] py-[4px] text-[12px]',
                      newSetProvider === 'outlook' &&
                        'bg-[var(--border-1)] hover:bg-[var(--border-1)] dark:bg-[var(--surface-5)] dark:hover:bg-[var(--border-1)]'
                    )}
                  >
                    Outlook
                  </Button>
                </div>
                <p className='mt-[4px] text-[11px] text-[var(--text-tertiary)]'>
                  Members will connect their {getProviderDisplayName(newSetProvider)} account
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
                <Loader2 className='h-4 w-4 animate-spin' />
              ) : (
                'Create'
              )}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal open={showInviteModal} onOpenChange={handleCloseInviteModal}>
        <ModalContent className='w-[400px]'>
          <ModalHeader>Add Members</ModalHeader>
          <ModalBody>
            <div className='flex flex-col gap-[12px]'>
              <Label>Email Addresses</Label>
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`relative ${isDragging ? 'ring-2 ring-[var(--accent)]' : ''}`}
              >
                <Textarea
                  value={inviteEmails}
                  onChange={(e) => setInviteEmails(e.target.value)}
                  placeholder='Enter emails separated by commas or newlines'
                  rows={4}
                />
                {isDragging && (
                  <div className='pointer-events-none absolute inset-0 flex items-center justify-center rounded-[6px] bg-[var(--accent)]/10'>
                    <span className='font-medium text-[13px] text-[var(--accent)]'>
                      Drop CSV or text file
                    </span>
                  </div>
                )}
              </div>
              <p className='text-[12px] text-[var(--text-tertiary)]'>
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
                <Loader2 className='h-4 w-4 animate-spin' />
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
            <Button variant='default' onClick={() => setLeavingMembership(null)}>
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
    </>
  )
}
