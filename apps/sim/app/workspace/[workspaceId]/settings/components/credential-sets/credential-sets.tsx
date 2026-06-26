'use client'

import { useCallback, useMemo, useState } from 'react'
import { createLogger } from '@sim/logger'
import { isOrgAdminRole } from '@sim/platform-authz/predicates'
import { Plus } from 'lucide-react'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  ButtonGroup,
  ButtonGroupItem,
  Chip,
  ChipConfirmModal,
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  chipVariants,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  type FileInputOptions,
  MoreHorizontal,
  TagInput,
  type TagItem,
} from '@/components/emcn'
import { ArrowLeft } from '@/components/emcn/icons'
import { GmailIcon, OutlookIcon } from '@/components/icons'
import { useSession } from '@/lib/auth/auth-client'
import { getSubscriptionAccessState } from '@/lib/billing/client'
import { getProviderDisplayName, type PollingProvider } from '@/lib/credential-sets/providers'
import { quickValidateEmail } from '@/lib/messaging/email/validation'
import { getUserColor } from '@/lib/workspaces/colors'
import { getUserRole } from '@/lib/workspaces/organization'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
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

export function CredentialSets() {
  const { data: session } = useSession()
  const { data: organizationsData } = useOrganizations()
  const { data: subscriptionData } = useSubscriptionData()

  const activeOrganization = organizationsData?.activeOrganization
  const subscriptionAccess = getSubscriptionAccessState(subscriptionData?.data)
  const hasTeamPlan = subscriptionAccess.hasUsableTeamAccess
  const userRole = getUserRole(activeOrganization, session?.user?.email)
  const isAdmin = isOrgAdminRole(userRole)
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
  const [deletingSetIds, setDeletingSetIds] = useState<Set<string>>(() => new Set())
  const [cancellingInvitations, setCancellingInvitations] = useState<Set<string>>(() => new Set())
  const [resendingInvitations, setResendingInvitations] = useState<Set<string>>(() => new Set())
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

      setEmailItems((prev) => [
        ...prev,
        {
          value: normalized,
          isValid,
          error: isValid ? undefined : (validation.reason ?? 'Invalid email format'),
        },
      ])

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
    if (providerId === 'outlook') return <OutlookIcon className='size-4' />
    return <GmailIcon className='size-4' />
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
    return null
  }

  if (viewingSet) {
    const activeMembers = members.filter((m) => m.status === 'active')
    const totalCount = activeMembers.length + pendingInvitations.length

    return (
      <div className='flex h-full flex-col bg-[var(--bg)]'>
        <div className='flex flex-shrink-0 items-center justify-between bg-[var(--bg)] px-[16px] pt-[8.5px] pb-[8.5px]'>
          <Chip leftIcon={ArrowLeft} onClick={handleBackToList}>
            Sim Mailer
          </Chip>
          <div />
        </div>

        <div className='min-h-0 flex-1 overflow-y-auto px-6 [scrollbar-gutter:stable_both-edges]'>
          <div className='mx-auto flex max-w-[48rem] flex-col gap-7 pt-4 pb-6'>
            <SettingsSection label='Details'>
              <div className='flex items-center gap-4.5'>
                <div className='flex items-center gap-2'>
                  <span className='font-medium text-[var(--text-primary)] text-sm'>Group Name</span>
                  <span className='text-[var(--text-secondary)] text-sm'>{viewingSet.name}</span>
                </div>
                <div className='h-4 w-px bg-[var(--border)]' />
                <div className='flex items-center gap-2'>
                  <span className='font-medium text-[var(--text-primary)] text-sm'>Provider</span>
                  <div className='flex items-center gap-1.5'>
                    {getProviderIcon(viewingSet.providerId)}
                    <span className='text-[var(--text-secondary)] text-sm'>
                      {getProviderDisplayName(viewingSet.providerId as PollingProvider)}
                    </span>
                  </div>
                </div>
              </div>
            </SettingsSection>

            <SettingsSection label='Invite'>
              <div className='flex flex-col gap-1'>
                <div className='flex items-center gap-2'>
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
                  <Chip
                    onClick={handleInviteMembers}
                    disabled={createInvitation.isPending || validEmails.length === 0}
                  >
                    {createInvitation.isPending ? 'Sending...' : 'Invite'}
                  </Chip>
                </div>
                {emailError && <p className='text-[var(--text-error)] text-small'>{emailError}</p>}
              </div>
            </SettingsSection>

            <SettingsSection label='Members'>
              {membersLoading || pendingInvitationsLoading ? null : totalCount === 0 ? (
                <p className='text-[var(--text-muted)] text-sm'>
                  No members yet. Send invitations above.
                </p>
              ) : (
                <div className='flex flex-col gap-4.5'>
                  {activeMembers.map((member) => {
                    const name = member.userName || 'Unknown'
                    const avatarInitial = name.charAt(0).toUpperCase()

                    return (
                      <div key={member.id} className='flex items-center justify-between'>
                        <div className='flex flex-1 items-center gap-3'>
                          <Avatar size='md'>
                            {member.userImage && <AvatarImage src={member.userImage} alt={name} />}
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
                            <div className='flex items-center gap-2'>
                              <span className='truncate font-medium text-[14px] text-[var(--text-primary)]'>
                                {name}
                              </span>
                              {member.credentials.length === 0 && (
                                <Badge variant='red' size='sm'>
                                  Disconnected
                                </Badge>
                              )}
                            </div>
                            <div className='truncate text-[var(--text-muted)] text-small'>
                              {member.userEmail}
                            </div>
                          </div>
                        </div>

                        <div className='ml-4 flex items-center gap-1'>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button
                                type='button'
                                aria-label='Member actions'
                                className={chipVariants({ flush: true })}
                              >
                                <MoreHorizontal className='size-[14px] flex-shrink-0 text-[var(--text-icon)]' />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align='end'>
                              <DropdownMenuItem
                                className='text-[var(--text-error)]'
                                onSelect={() => handleRemoveMember(member.id)}
                                disabled={removeMember.isPending}
                              >
                                Remove
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
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
                        <div className='flex flex-1 items-center gap-3'>
                          <Avatar size='md'>
                            <AvatarFallback
                              style={{ background: getUserColor(email) }}
                              className='border-0 text-white'
                            >
                              {avatarInitial}
                            </AvatarFallback>
                          </Avatar>

                          <div className='min-w-0'>
                            <div className='flex items-center gap-2'>
                              <span className='truncate font-medium text-[14px] text-[var(--text-primary)]'>
                                {emailPrefix}
                              </span>
                              <Badge variant='gray-secondary' size='sm'>
                                Pending
                              </Badge>
                            </div>
                            <div className='truncate text-[var(--text-muted)] text-small'>
                              {email}
                            </div>
                          </div>
                        </div>

                        <div className='ml-4 flex items-center gap-1'>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button
                                type='button'
                                aria-label='Invitation actions'
                                className={chipVariants({ flush: true })}
                              >
                                <MoreHorizontal className='size-[14px] flex-shrink-0 text-[var(--text-icon)]' />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align='end'>
                              <DropdownMenuItem
                                onSelect={() => handleResendInvitation(invitation.id, email)}
                                disabled={
                                  resendingInvitations.has(invitation.id) ||
                                  (resendCooldowns[invitation.id] ?? 0) > 0
                                }
                              >
                                {resendingInvitations.has(invitation.id)
                                  ? 'Sending...'
                                  : resendCooldowns[invitation.id]
                                    ? `Resend (${resendCooldowns[invitation.id]}s)`
                                    : 'Resend'}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className='text-[var(--text-error)]'
                                onSelect={() => handleCancelInvitation(invitation.id)}
                                disabled={cancellingInvitations.has(invitation.id)}
                              >
                                {cancellingInvitations.has(invitation.id)
                                  ? 'Cancelling...'
                                  : 'Cancel'}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </SettingsSection>
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
      <SettingsPanel
        search={{
          value: searchTerm,
          onChange: setSearchTerm,
          placeholder: 'Search polling groups...',
        }}
        actions={
          canManageCredentialSets && (
            <Chip leftIcon={Plus} variant='primary' onClick={() => setShowCreateModal(true)}>
              Create Group
            </Chip>
          )
        }
      >
        <div className='relative'>
          {hasNoContent && !canManageCredentialSets ? (
            <div className='flex h-full items-center justify-center text-[var(--text-muted)] text-sm'>
              You're not a member of any polling groups yet. When someone invites you, it will
              appear here.
            </div>
          ) : hasNoResults ? (
            <div className='py-4 text-center text-[var(--text-muted)] text-sm'>
              No results found matching "{searchTerm}"
            </div>
          ) : (
            <div className='flex flex-col gap-4.5'>
              {filteredInvitations.length > 0 && (
                <SettingsSection label='Pending Invitations'>
                  <div className='flex flex-col gap-3'>
                    {filteredInvitations.map((invitation) => (
                      <div
                        key={invitation.invitationId}
                        className='flex items-center justify-between rounded-lg p-2 transition-colors hover-hover:bg-[var(--surface-active)]'
                      >
                        <div className='flex items-center gap-2.5'>
                          <div className='flex size-9 flex-shrink-0 items-center justify-center rounded-xl border border-[var(--border-1)] bg-[var(--bg)]'>
                            {getProviderIcon(invitation.providerId)}
                          </div>
                          <div className='flex flex-col'>
                            <span className='text-[14px] text-[var(--text-body)]'>
                              {invitation.credentialSetName}
                            </span>
                            <span className='text-[12px] text-[var(--text-muted)]'>
                              {invitation.organizationName}
                            </span>
                          </div>
                        </div>
                        <Chip
                          variant='primary'
                          onClick={() => handleAcceptInvitation(invitation.token)}
                          disabled={acceptInvitation.isPending}
                        >
                          {acceptInvitation.isPending ? 'Accepting...' : 'Accept'}
                        </Chip>
                      </div>
                    ))}
                  </div>
                </SettingsSection>
              )}

              {filteredMemberships.length > 0 && (
                <SettingsSection label='My Memberships'>
                  <div className='flex flex-col gap-3'>
                    {filteredMemberships.map((membership) => (
                      <div
                        key={membership.membershipId}
                        className='flex items-center justify-between rounded-lg p-2 transition-colors hover-hover:bg-[var(--surface-active)]'
                      >
                        <div className='flex items-center gap-2.5'>
                          <div className='flex size-9 flex-shrink-0 items-center justify-center rounded-xl border border-[var(--border-1)] bg-[var(--bg)]'>
                            {getProviderIcon(membership.providerId)}
                          </div>
                          <div className='flex flex-col'>
                            <span className='text-[14px] text-[var(--text-body)]'>
                              {membership.credentialSetName}
                            </span>
                            <span className='text-[12px] text-[var(--text-muted)]'>
                              {membership.organizationName}
                            </span>
                          </div>
                        </div>
                        <Chip
                          onClick={() =>
                            handleLeave(membership.credentialSetId, membership.credentialSetName)
                          }
                          disabled={leaveCredentialSet.isPending}
                        >
                          Leave
                        </Chip>
                      </div>
                    ))}
                  </div>
                </SettingsSection>
              )}

              {canManageCredentialSets &&
                (filteredOwnedSets.length > 0 ||
                  ownedSetsLoading ||
                  (!searchTerm.trim() && ownedSets.length === 0)) && (
                  <SettingsSection label='Manage'>
                    {ownedSetsLoading ? null : !searchTerm.trim() && ownedSets.length === 0 ? (
                      <div className='text-[var(--text-muted)] text-sm'>
                        No polling groups created yet
                      </div>
                    ) : (
                      <div className='flex flex-col gap-3'>
                        {filteredOwnedSets.map((set) => (
                          <div
                            key={set.id}
                            className='flex items-center justify-between rounded-lg p-2 transition-colors hover-hover:bg-[var(--surface-active)]'
                          >
                            <div className='flex items-center gap-2.5'>
                              <div className='flex size-9 flex-shrink-0 items-center justify-center rounded-xl border border-[var(--border-1)] bg-[var(--bg)]'>
                                {getProviderIcon(set.providerId)}
                              </div>
                              <div className='flex flex-col'>
                                <span className='text-[14px] text-[var(--text-body)]'>
                                  {set.name}
                                </span>
                                <span className='text-[12px] text-[var(--text-muted)]'>
                                  {set.memberCount} member{set.memberCount !== 1 ? 's' : ''}
                                </span>
                              </div>
                            </div>
                            <div className='flex items-center gap-1'>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <button
                                    type='button'
                                    aria-label='Group actions'
                                    className={chipVariants({ flush: true })}
                                  >
                                    <MoreHorizontal className='size-[14px] flex-shrink-0 text-[var(--text-icon)]' />
                                  </button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align='end'>
                                  <DropdownMenuItem onSelect={() => setViewingSet(set)}>
                                    Details
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    className='text-[var(--text-error)]'
                                    onSelect={() => handleDeleteClick(set)}
                                    disabled={deletingSetIds.has(set.id)}
                                  >
                                    Delete
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </SettingsSection>
                )}
            </div>
          )}
        </div>
      </SettingsPanel>

      <ChipModal
        open={showCreateModal}
        onOpenChange={handleCloseCreateModal}
        srTitle='Create Polling Group'
      >
        <ChipModalHeader onClose={handleCloseCreateModal}>Create Polling Group</ChipModalHeader>
        <ChipModalBody>
          <ChipModalField
            type='input'
            title='Name'
            value={newSetName}
            onChange={(value) => {
              setNewSetName(value)
              if (createError) setCreateError(null)
            }}
            required
            placeholder='e.g., Marketing Team'
          />
          <ChipModalField
            type='input'
            title='Description'
            value={newSetDescription}
            onChange={setNewSetDescription}
            placeholder='e.g., Poll emails for marketing automations'
          />
          <ChipModalField type='custom' title='Email Provider'>
            <ButtonGroup
              value={newSetProvider}
              onValueChange={(v) => setNewSetProvider(v as PollingProvider)}
            >
              <ButtonGroupItem value='google-email'>Gmail</ButtonGroupItem>
              <ButtonGroupItem value='outlook'>Outlook</ButtonGroupItem>
            </ButtonGroup>
            <p className='mt-1 text-[var(--text-muted)] text-small'>
              Members will connect their {getProviderDisplayName(newSetProvider)} account
            </p>
          </ChipModalField>
          <ChipModalError>{createError}</ChipModalError>
        </ChipModalBody>
        <ChipModalFooter
          onCancel={handleCloseCreateModal}
          primaryAction={{
            label: createCredentialSet.isPending ? 'Creating...' : 'Create',
            onClick: handleCreateCredentialSet,
            disabled: !newSetName.trim() || createCredentialSet.isPending,
          }}
        />
      </ChipModal>

      <ChipConfirmModal
        open={!!leavingMembership}
        onOpenChange={(open) => {
          if (!open) setLeavingMembership(null)
        }}
        srTitle='Leave Polling Group'
        title='Leave Polling Group'
        text={[
          'Are you sure you want to leave ',
          { text: leavingMembership?.name ?? 'this group', bold: true },
          '? Your email account will no longer be polled in workflows using this group.',
        ]}
        confirm={{
          label: 'Leave',
          onClick: confirmLeave,
          pending: leaveCredentialSet.isPending,
          pendingLabel: 'Leaving...',
        }}
      />

      <ChipConfirmModal
        open={!!deletingSet}
        onOpenChange={(open) => {
          if (!open) setDeletingSet(null)
        }}
        srTitle='Delete Polling Group'
        title='Delete Polling Group'
        text={[
          'Are you sure you want to delete ',
          { text: deletingSet?.name ?? 'this group', bold: true },
          '? This action cannot be undone.',
        ]}
        confirm={{
          label: 'Delete',
          onClick: confirmDelete,
          pending: deleteCredentialSet.isPending,
          pendingLabel: 'Deleting...',
        }}
      />
    </>
  )
}
