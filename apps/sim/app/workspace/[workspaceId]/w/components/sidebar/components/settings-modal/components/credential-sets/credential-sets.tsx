'use client'

import { useCallback, useMemo, useState } from 'react'
import { createLogger } from '@sim/logger'
import { Plus, Search } from 'lucide-react'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Button,
  type FileInputOptions,
  Input,
  Label,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  TagInput,
  type TagItem,
} from '@/components/emcn'
import { GmailIcon, OutlookIcon } from '@/components/icons'
import { Input as BaseInput, Skeleton } from '@/components/ui'
import { useSession } from '@/lib/auth/auth-client'
import { getSubscriptionStatus } from '@/lib/billing/client'
import { cn } from '@/lib/core/utils/cn'
import { getProviderDisplayName, type PollingProvider } from '@/lib/credential-sets/providers'
import { quickValidateEmail } from '@/lib/messaging/email/validation'
import { getUserColor } from '@/lib/workspaces/colors'
import { getUserRole } from '@/lib/workspaces/organization'
import {
  type CredentialSet,
  useAcceptCredentialSetInvitation,
  useCancelCredentialSetInvitation,
  useCreateCredentialSet,
  useCreateCredentialSetInvitation,
  useCredentialSetInvitations,
  useCredentialSetInvitationsDetail,
  useCredentialSetMembers,
  useCredentialSetMemberships,
  useCredentialSets,
  useDeleteCredentialSet,
  useLeaveCredentialSet,
  useRemoveCredentialSetMember,
  useResendCredentialSetInvitation,
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

  const [searchTerm, setSearchTerm] = useState('')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [viewingSet, setViewingSet] = useState<CredentialSet | null>(null)
  const [newSetName, setNewSetName] = useState('')
  const [newSetDescription, setNewSetDescription] = useState('')
  const [newSetProvider, setNewSetProvider] = useState<PollingProvider>('google-email')
  const [createError, setCreateError] = useState<string | null>(null)
  const [emailItems, setEmailItems] = useState<TagItem[]>([])
  const [emailError, setEmailError] = useState<string | null>(null)
  const [leavingMembership, setLeavingMembership] = useState<{
    credentialSetId: string
    name: string
  } | null>(null)

  const { data: members = [], isPending: membersLoading } = useCredentialSetMembers(viewingSet?.id)
  const { data: pendingInvitations = [], isPending: pendingInvitationsLoading } =
    useCredentialSetInvitationsDetail(viewingSet?.id)
  const removeMember = useRemoveCredentialSetMember()
  const leaveCredentialSet = useLeaveCredentialSet()
  const deleteCredentialSet = useDeleteCredentialSet()
  const cancelInvitation = useCancelCredentialSetInvitation()
  const resendInvitation = useResendCredentialSetInvitation()

  const [deletingSet, setDeletingSet] = useState<{ id: string; name: string } | null>(null)
  const [deletingSetIds, setDeletingSetIds] = useState<Set<string>>(new Set())
  const [cancellingInvitations, setCancellingInvitations] = useState<Set<string>>(new Set())
  const [resendingInvitations, setResendingInvitations] = useState<Set<string>>(new Set())
  const [resendCooldowns, setResendCooldowns] = useState<Record<string, number>>({})

  const addEmail = useCallback(
    (email: string) => {
      if (!email.trim()) return false

      const normalized = email.trim().toLowerCase()
      const validation = quickValidateEmail(normalized)
      const isValid = validation.isValid

      if (emailItems.some((item) => item.value === normalized)) {
        return false
      }

      const isPendingInvitation = pendingInvitations.some(
        (inv) => inv.email?.toLowerCase() === normalized
      )
      if (isPendingInvitation) {
        setEmailError(`${normalized} already has a pending invitation`)
        return false
      }

      const isActiveMember = members.some(
        (m) => m.userEmail?.toLowerCase() === normalized && m.status === 'active'
      )
      if (isActiveMember) {
        setEmailError(`${normalized} is already a member of this group`)
        return false
      }

      setEmailItems((prev) => [...prev, { value: normalized, isValid }])

      if (isValid) {
        setEmailError(null)
      }

      return isValid
    },
    [emailItems, pendingInvitations, members]
  )

  const removeEmailItem = useCallback((_value: string, index: number, _isValid: boolean) => {
    setEmailItems((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const fileInputOptions: FileInputOptions = useMemo(
    () => ({
      enabled: true,
      accept: '.csv,.txt,text/csv,text/plain',
      extractValues: (text: string) => {
        const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g
        const matches = text.match(emailRegex) || []
        return [...new Set(matches.map((e) => e.toLowerCase()))]
      },
    }),
    []
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

      if (result?.credentialSet) {
        setViewingSet(result.credentialSet)
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

  const validEmails = useMemo(
    () => emailItems.filter((item) => item.isValid).map((item) => item.value),
    [emailItems]
  )

  const handleInviteMembers = useCallback(async () => {
    if (!viewingSet?.id) return

    if (validEmails.length === 0) return

    try {
      for (const email of validEmails) {
        await createInvitation.mutateAsync({
          credentialSetId: viewingSet.id,
          email,
        })
      }
      setEmailItems([])
      setEmailError(null)
    } catch (error) {
      logger.error('Failed to create invitations', error)
    }
  }, [viewingSet?.id, validEmails, createInvitation])

  const handleCloseCreateModal = useCallback(() => {
    setShowCreateModal(false)
    setNewSetName('')
    setNewSetDescription('')
    setNewSetProvider('google-email')
    setCreateError(null)
  }, [])

  const handleBackToList = useCallback(() => {
    setViewingSet(null)
    setEmailItems([])
    setEmailError(null)
  }, [])

  const handleCancelInvitation = useCallback(
    async (invitationId: string) => {
      if (!viewingSet?.id) return

      setCancellingInvitations((prev) => new Set([...prev, invitationId]))
      try {
        await cancelInvitation.mutateAsync({
          credentialSetId: viewingSet.id,
          invitationId,
        })
      } catch (error) {
        logger.error('Failed to cancel invitation', error)
      } finally {
        setCancellingInvitations((prev) => {
          const next = new Set(prev)
          next.delete(invitationId)
          return next
        })
      }
    },
    [viewingSet?.id, cancelInvitation]
  )

  const handleResendInvitation = useCallback(
    async (invitationId: string, email: string) => {
      if (!viewingSet?.id) return

      const secondsLeft = resendCooldowns[invitationId]
      if (secondsLeft && secondsLeft > 0) return

      setResendingInvitations((prev) => new Set([...prev, invitationId]))
      try {
        await resendInvitation.mutateAsync({
          credentialSetId: viewingSet.id,
          invitationId,
          email,
        })

        setResendCooldowns((prev) => ({ ...prev, [invitationId]: 60 }))
        const interval = setInterval(() => {
          setResendCooldowns((prev) => {
            const current = prev[invitationId]
            if (current === undefined) return prev
            if (current <= 1) {
              const next = { ...prev }
              delete next[invitationId]
              clearInterval(interval)
              return next
            }
            return { ...prev, [invitationId]: current - 1 }
          })
        }, 1000)
      } catch (error) {
        logger.error('Failed to resend invitation', error)
      } finally {
        setResendingInvitations((prev) => {
          const next = new Set(prev)
          next.delete(invitationId)
          return next
        })
      }
    },
    [viewingSet?.id, resendInvitation, resendCooldowns]
  )

  const handleDeleteClick = useCallback((set: CredentialSet) => {
    setDeletingSet({ id: set.id, name: set.name })
  }, [])

  const confirmDelete = useCallback(async () => {
    if (!deletingSet || !activeOrganization?.id) return
    setDeletingSetIds((prev) => new Set(prev).add(deletingSet.id))
    try {
      await deleteCredentialSet.mutateAsync({
        credentialSetId: deletingSet.id,
        organizationId: activeOrganization.id,
      })
      setDeletingSet(null)
    } catch (error) {
      logger.error('Failed to delete polling group', error)
    } finally {
      setDeletingSetIds((prev) => {
        const next = new Set(prev)
        next.delete(deletingSet.id)
        return next
      })
    }
  }, [deletingSet, activeOrganization?.id, deleteCredentialSet])

  const getProviderIcon = (providerId: string | null) => {
    if (providerId === 'outlook') return <OutlookIcon className='h-4 w-4' />
    return <GmailIcon className='h-4 w-4' />
  }

  const activeMemberships = useMemo(
    () => memberships.filter((m) => m.status === 'active'),
    [memberships]
  )

  const filteredInvitations = useMemo(() => {
    if (!searchTerm.trim()) return invitations
    const searchLower = searchTerm.toLowerCase()
    return invitations.filter(
      (inv) =>
        inv.credentialSetName.toLowerCase().includes(searchLower) ||
        inv.organizationName.toLowerCase().includes(searchLower)
    )
  }, [invitations, searchTerm])

  const filteredMemberships = useMemo(() => {
    if (!searchTerm.trim()) return activeMemberships
    const searchLower = searchTerm.toLowerCase()
    return activeMemberships.filter(
      (m) =>
        m.credentialSetName.toLowerCase().includes(searchLower) ||
        m.organizationName.toLowerCase().includes(searchLower)
    )
  }, [activeMemberships, searchTerm])

  const filteredOwnedSets = useMemo(() => {
    if (!searchTerm.trim()) return ownedSets
    const searchLower = searchTerm.toLowerCase()
    return ownedSets.filter((set) => set.name.toLowerCase().includes(searchLower))
  }, [ownedSets, searchTerm])

  const hasNoContent =
    invitations.length === 0 && activeMemberships.length === 0 && ownedSets.length === 0
  const hasNoResults =
    searchTerm.trim() &&
    filteredInvitations.length === 0 &&
    filteredMemberships.length === 0 &&
    filteredOwnedSets.length === 0 &&
    !hasNoContent

  if (membershipsLoading || invitationsLoading) {
    return <CredentialSetsSkeleton />
  }

  if (viewingSet) {
    const activeMembers = members.filter((m) => m.status === 'active')
    const totalCount = activeMembers.length + pendingInvitations.length

    return (
      <>
        <div className='flex h-full flex-col gap-[16px]'>
          <div className='min-h-0 flex-1 overflow-y-auto'>
            <div className='flex flex-col gap-[16px]'>
              <div className='flex items-center gap-[16px]'>
                <div className='flex items-center gap-[8px]'>
                  <span className='font-medium text-[13px] text-[var(--text-primary)]'>
                    Group Name
                  </span>
                  <span className='text-[13px] text-[var(--text-secondary)]'>
                    {viewingSet.name}
                  </span>
                </div>
                <div className='h-4 w-px bg-[var(--border)]' />
                <div className='flex items-center gap-[8px]'>
                  <span className='font-medium text-[13px] text-[var(--text-primary)]'>
                    Provider
                  </span>
                  <div className='flex items-center gap-[6px]'>
                    {getProviderIcon(viewingSet.providerId)}
                    <span className='text-[13px] text-[var(--text-secondary)]'>
                      {getProviderDisplayName(viewingSet.providerId as PollingProvider)}
                    </span>
                  </div>
                </div>
              </div>

              <div className='flex flex-col gap-[4px]'>
                <div className='flex items-center gap-[8px]'>
                  <TagInput
                    items={emailItems}
                    onAdd={(value) => addEmail(value)}
                    onRemove={removeEmailItem}
                    placeholder='Enter email addresses'
                    placeholderWithTags='Add another email'
                    disabled={createInvitation.isPending}
                    fileInputOptions={fileInputOptions}
                    className='flex-1'
                  />
                  <Button
                    variant='default'
                    onClick={handleInviteMembers}
                    disabled={createInvitation.isPending || validEmails.length === 0}
                  >
                    {createInvitation.isPending ? 'Sending...' : 'Invite'}
                  </Button>
                </div>
                {emailError && <p className='text-[12px] text-[var(--text-error)]'>{emailError}</p>}
              </div>

              <div className='flex flex-col gap-[16px]'>
                <h4 className='font-medium text-[14px] text-[var(--text-primary)]'>Members</h4>

                {membersLoading || pendingInvitationsLoading ? (
                  <div className='flex flex-col gap-[16px]'>
                    {[1, 2].map((i) => (
                      <div key={i} className='flex items-center justify-between'>
                        <div className='flex items-center gap-[12px]'>
                          <Skeleton className='h-8 w-8 rounded-full' />
                          <div className='flex flex-col gap-[4px]'>
                            <Skeleton className='h-[14px] w-[100px]' />
                            <Skeleton className='h-[12px] w-[150px]' />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : totalCount === 0 ? (
                  <p className='text-[13px] text-[var(--text-muted)]'>
                    No members yet. Send invitations above.
                  </p>
                ) : (
                  <div className='flex flex-col gap-[16px]'>
                    {activeMembers.map((member) => {
                      const name = member.userName || 'Unknown'
                      const avatarInitial = name.charAt(0).toUpperCase()

                      return (
                        <div key={member.id} className='flex items-center justify-between'>
                          <div className='flex flex-1 items-center gap-[12px]'>
                            <Avatar size='md'>
                              {member.userImage && (
                                <AvatarImage src={member.userImage} alt={name} />
                              )}
                              <AvatarFallback
                                style={{
                                  background: getUserColor(member.userId || member.userEmail || ''),
                                }}
                                className='border-0 text-white'
                              >
                                {avatarInitial}
                              </AvatarFallback>
                            </Avatar>

                            <div className='min-w-0'>
                              <div className='flex items-center gap-[8px]'>
                                <span className='truncate font-medium text-[14px] text-[var(--text-primary)]'>
                                  {name}
                                </span>
                                {member.credentials.length === 0 && (
                                  <Badge variant='red' size='sm'>
                                    Disconnected
                                  </Badge>
                                )}
                              </div>
                              <div className='truncate text-[12px] text-[var(--text-muted)]'>
                                {member.userEmail}
                              </div>
                            </div>
                          </div>

                          <div className='ml-[16px] flex items-center gap-[4px]'>
                            <Button
                              variant='destructive'
                              onClick={() => handleRemoveMember(member.id)}
                              disabled={removeMember.isPending}
                              className='h-8'
                            >
                              Remove
                            </Button>
                          </div>
                        </div>
                      )
                    })}

                    {pendingInvitations.map((invitation) => {
                      const email = invitation.email || 'Unknown'
                      const emailPrefix = email.split('@')[0]
                      const avatarInitial = emailPrefix.charAt(0).toUpperCase()

                      return (
                        <div key={invitation.id} className='flex items-center justify-between'>
                          <div className='flex flex-1 items-center gap-[12px]'>
                            <Avatar size='md'>
                              <AvatarFallback
                                style={{ background: getUserColor(email) }}
                                className='border-0 text-white'
                              >
                                {avatarInitial}
                              </AvatarFallback>
                            </Avatar>

                            <div className='min-w-0'>
                              <div className='flex items-center gap-[8px]'>
                                <span className='truncate font-medium text-[14px] text-[var(--text-primary)]'>
                                  {emailPrefix}
                                </span>
                                <Badge variant='gray-secondary' size='sm'>
                                  Pending
                                </Badge>
                              </div>
                              <div className='truncate text-[12px] text-[var(--text-muted)]'>
                                {email}
                              </div>
                            </div>
                          </div>

                          <div className='ml-[16px] flex items-center gap-[4px]'>
                            <Button
                              variant='ghost'
                              onClick={() => handleResendInvitation(invitation.id, email)}
                              disabled={
                                resendingInvitations.has(invitation.id) ||
                                (resendCooldowns[invitation.id] ?? 0) > 0
                              }
                              className='h-8'
                            >
                              {resendingInvitations.has(invitation.id)
                                ? 'Sending...'
                                : resendCooldowns[invitation.id]
                                  ? `Resend (${resendCooldowns[invitation.id]}s)`
                                  : 'Resend'}
                            </Button>
                            <Button
                              variant='ghost'
                              onClick={() => handleCancelInvitation(invitation.id)}
                              disabled={cancellingInvitations.has(invitation.id)}
                              className='h-8'
                            >
                              {cancellingInvitations.has(invitation.id)
                                ? 'Cancelling...'
                                : 'Cancel'}
                            </Button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className='mt-auto flex items-center justify-end'>
            <Button onClick={handleBackToList} variant='tertiary'>
              Back
            </Button>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <div className='flex h-full flex-col gap-[16px]'>
        <div className='flex items-center gap-[8px]'>
          <div className='flex flex-1 items-center gap-[8px] rounded-[8px] border border-[var(--border)] bg-transparent px-[8px] py-[5px] transition-colors duration-100 dark:bg-[var(--surface-4)] dark:hover:border-[var(--border-1)] dark:hover:bg-[var(--surface-5)]'>
            <Search
              className='h-[14px] w-[14px] flex-shrink-0 text-[var(--text-tertiary)]'
              strokeWidth={2}
            />
            <BaseInput
              placeholder='Search polling groups...'
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className='h-auto flex-1 border-0 bg-transparent p-0 font-base leading-none placeholder:text-[var(--text-tertiary)] focus-visible:ring-0 focus-visible:ring-offset-0'
            />
          </div>
          {canManageCredentialSets && (
            <Button variant='tertiary' onClick={() => setShowCreateModal(true)}>
              <Plus className='mr-[6px] h-[13px] w-[13px]' />
              Create
            </Button>
          )}
        </div>

        <div className='relative min-h-0 flex-1 overflow-y-auto'>
          {hasNoContent && !canManageCredentialSets ? (
            <div className='absolute inset-0 flex items-center justify-center text-[13px] text-[var(--text-muted)]'>
              You're not a member of any polling groups yet. When someone invites you, it will
              appear here.
            </div>
          ) : hasNoResults ? (
            <div className='py-[16px] text-center text-[13px] text-[var(--text-muted)]'>
              No results found matching "{searchTerm}"
            </div>
          ) : (
            <div className='flex flex-col gap-[16px]'>
              {filteredInvitations.length > 0 && (
                <div className='flex flex-col gap-[8px]'>
                  <div className='font-medium text-[13px] text-[var(--text-secondary)]'>
                    Pending Invitations
                  </div>
                  {filteredInvitations.map((invitation) => (
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
                        {acceptInvitation.isPending ? 'Accepting...' : 'Accept'}
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              {filteredMemberships.length > 0 && (
                <div className='flex flex-col gap-[8px]'>
                  <div className='font-medium text-[13px] text-[var(--text-secondary)]'>
                    My Memberships
                  </div>
                  {filteredMemberships.map((membership) => (
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

              {canManageCredentialSets &&
                (filteredOwnedSets.length > 0 ||
                  ownedSetsLoading ||
                  (!searchTerm.trim() && ownedSets.length === 0)) && (
                  <div className='flex flex-col gap-[8px]'>
                    <div className='font-medium text-[13px] text-[var(--text-secondary)]'>
                      Manage
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
                          </div>
                        ))}
                      </>
                    ) : !searchTerm.trim() && ownedSets.length === 0 ? (
                      <div className='text-[13px] text-[var(--text-muted)]'>
                        No polling groups created yet
                      </div>
                    ) : (
                      filteredOwnedSets.map((set) => (
                        <div key={set.id} className='flex items-center justify-between'>
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
                          <div className='flex items-center gap-[8px]'>
                            <Button variant='default' onClick={() => setViewingSet(set)}>
                              Details
                            </Button>
                            <Button
                              variant='ghost'
                              onClick={() => handleDeleteClick(set)}
                              disabled={deletingSetIds.has(set.id)}
                            >
                              {deletingSetIds.has(set.id) ? 'Deleting...' : 'Delete'}
                            </Button>
                          </div>
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
        <ModalContent size='sm'>
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
              {createCredentialSet.isPending ? 'Creating...' : 'Create'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal open={!!leavingMembership} onOpenChange={() => setLeavingMembership(null)}>
        <ModalContent size='sm'>
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

      <Modal open={!!deletingSet} onOpenChange={() => setDeletingSet(null)}>
        <ModalContent size='sm'>
          <ModalHeader>Delete Polling Group</ModalHeader>
          <ModalBody>
            <p className='text-[12px] text-[var(--text-secondary)]'>
              Are you sure you want to delete{' '}
              <span className='font-medium text-[var(--text-primary)]'>{deletingSet?.name}</span>?{' '}
              <span className='text-[var(--text-error)]'>This action cannot be undone.</span>
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant='default' onClick={() => setDeletingSet(null)}>
              Cancel
            </Button>
            <Button
              variant='destructive'
              onClick={confirmDelete}
              disabled={deleteCredentialSet.isPending}
            >
              {deleteCredentialSet.isPending ? 'Deleting...' : 'Delete'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  )
}
