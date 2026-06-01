'use client'

import {
  type ComponentType,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { useRouter } from 'next/navigation'
import {
  Avatar,
  AvatarFallback,
  Button,
  Chip,
  ChipDropdown,
  ChipLink,
  ChipModal,
  ChipModalBody,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  Send,
  TagInput,
  Tooltip,
  toast,
} from '@/components/emcn'
import { ArrowLeft, Check, Duplicate } from '@/components/emcn/icons'
import { cn } from '@/lib/core/utils/cn'
import { writeOAuthReturnContext } from '@/lib/credentials/client-state'
import { INTEGRATIONS } from '@/lib/integrations'
import { getServiceConfigByProviderId } from '@/lib/oauth'
import { getUserColor } from '@/lib/workspaces/colors'
import { IntegrationTile } from '@/app/workspace/[workspaceId]/integrations/components/integrations-showcase'
import {
  useCreateCredentialDraft,
  useDeleteWorkspaceCredential,
  useRemoveWorkspaceCredentialMember,
  useUpdateWorkspaceCredential,
  useUpsertWorkspaceCredentialMember,
  useWorkspaceCredentialMembers,
  useWorkspaceCredentials,
  type WorkspaceCredential,
  type WorkspaceCredentialRole,
} from '@/hooks/queries/credentials'
import {
  useConnectOAuthService,
  useDisconnectOAuthService,
  useOAuthConnections,
} from '@/hooks/queries/oauth/oauth-connections'
import { useWorkspacePermissionsQuery } from '@/hooks/queries/workspace'
import { useOAuthReturnRouter } from '@/hooks/use-oauth-return'

const logger = createLogger('ConnectedCredentialDetail')

const ROLE_OPTIONS = [
  { value: 'member', label: 'Member' },
  { value: 'admin', label: 'Admin' },
] as const

interface SectionProps {
  title: ReactNode
  children: ReactNode
}

/**
 * Local "labeled section" primitive used by the credential detail page. Pairs
 * a muted section title with a thin inset separator above the body so all
 * four sections (Credential ID, Display Name, Description, Members) share
 * the same vertical rhythm without repeating the markup at every callsite.
 */
function Section({ title, children }: SectionProps) {
  return (
    <section className='flex flex-col'>
      <span className='pl-0.5 text-[var(--text-muted)] text-small'>{title}</span>
      <div className='mt-[9px] mb-3 h-px bg-[var(--border)]' />
      {children}
    </section>
  )
}

interface ConnectedCredentialDetailProps {
  workspaceId: string
  credentialId: string
}

export function ConnectedCredentialDetail({
  workspaceId,
  credentialId,
}: ConnectedCredentialDetailProps) {
  const router = useRouter()
  const integrationsHref = `/workspace/${workspaceId}/integrations`

  useOAuthReturnRouter()

  const { data: credentials = [], isPending: credentialsLoading } = useWorkspaceCredentials({
    workspaceId,
    enabled: Boolean(workspaceId),
  })

  const { data: oauthConnections = [] } = useOAuthConnections()
  const connectOAuthService = useConnectOAuthService()
  const disconnectOAuthService = useDisconnectOAuthService()
  const { data: workspacePermissions } = useWorkspacePermissionsQuery(workspaceId || null)

  const createDraft = useCreateCredentialDraft()
  const updateCredential = useUpdateWorkspaceCredential()
  const deleteCredential = useDeleteWorkspaceCredential()
  const upsertMember = useUpsertWorkspaceCredentialMember()
  const removeMember = useRemoveWorkspaceCredentialMember()

  const credential = useMemo<WorkspaceCredential | null>(
    () => credentials.find((c) => c.id === credentialId) ?? null,
    [credentials, credentialId]
  )

  const { data: members = [], isPending: membersLoading } = useWorkspaceCredentialMembers(
    credential?.id
  )

  const oauthServiceNameByProviderId = useMemo(
    () => new Map(oauthConnections.map((service) => [service.providerId, service.name])),
    [oauthConnections]
  )
  const resolveProviderLabel = useCallback(
    (providerId?: string | null): string => {
      if (!providerId) return ''
      return oauthServiceNameByProviderId.get(providerId) || providerId
    },
    [oauthServiceNameByProviderId]
  )

  const serviceConfig = useMemo(() => {
    if (!credential?.providerId) return null
    return getServiceConfigByProviderId(credential.providerId)
  }, [credential])

  /**
   * Resolve the integration block type from the OAuth service name so the
   * header tile can render with the same brand background used by the rows
   * on the integrations list page.
   */
  const integrationBlockType = useMemo(() => {
    const name = serviceConfig?.name.toLowerCase()
    if (!name) return ''
    const match = INTEGRATIONS.find((i) => i.name.toLowerCase() === name)
    return match?.type ?? ''
  }, [serviceConfig])

  const isAdmin = credential?.role === 'admin'

  const [displayNameDraft, setDisplayNameDraft] = useState('')
  const [descriptionDraft, setDescriptionDraft] = useState('')
  const [copyIdSuccess, setCopyIdSuccess] = useState(false)

  const [showDeleteConfirmDialog, setShowDeleteConfirmDialog] = useState(false)
  const [showUnsavedChangesAlert, setShowUnsavedChangesAlert] = useState(false)
  const [isShareModalOpen, setIsShareModalOpen] = useState(false)
  const [inviteRole, setInviteRole] = useState<WorkspaceCredentialRole>('member')

  // Sync drafts when credential loads or changes.
  useEffect(() => {
    setDisplayNameDraft(credential?.displayName ?? '')
    setDescriptionDraft(credential?.description ?? '')
  }, [credential?.id, credential?.displayName, credential?.description])

  const isDescriptionDirty = credential
    ? descriptionDraft !== (credential.description || '')
    : false
  const isDisplayNameDirty = credential ? displayNameDraft !== credential.displayName : false
  const isDetailsDirty = isDescriptionDirty || isDisplayNameDirty

  const activeMembers = useMemo(() => members.filter((m) => m.status === 'active'), [members])
  const adminMemberCount = activeMembers.filter((m) => m.role === 'admin').length

  const workspaceUserOptions = useMemo(() => {
    const activeMemberUserIds = new Set(activeMembers.map((m) => m.userId))
    return (workspacePermissions?.users || [])
      .filter((u) => !activeMemberUserIds.has(u.userId))
      .map((u) => ({ value: u.userId, label: u.name || u.email }))
  }, [workspacePermissions?.users, activeMembers])

  // Browser-level guard against discarding unsaved changes.
  useEffect(() => {
    if (!isDetailsDirty) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isDetailsDirty])

  const handleBackClick = useCallback(
    (event: React.MouseEvent) => {
      if (isDetailsDirty && !updateCredential.isPending) {
        event.preventDefault()
        setShowUnsavedChangesAlert(true)
      }
    },
    [isDetailsDirty, updateCredential.isPending]
  )

  const handleDiscardChanges = useCallback(() => {
    setShowUnsavedChangesAlert(false)
    router.push(integrationsHref)
  }, [router, integrationsHref])

  const handleSaveDetails = async () => {
    if (!credential || !isAdmin || !isDetailsDirty || updateCredential.isPending) return
    try {
      await updateCredential.mutateAsync({
        credentialId: credential.id,
        ...(isDisplayNameDirty ? { displayName: displayNameDraft.trim() } : {}),
        ...(isDescriptionDirty ? { description: descriptionDraft.trim() || null } : {}),
      })
      if (isDisplayNameDirty) setDisplayNameDraft((v) => v.trim())
      if (isDescriptionDirty) setDescriptionDraft((v) => v.trim())
    } catch (error: unknown) {
      toast.error("Couldn't save changes", {
        description: getErrorMessage(error, 'Please try again in a moment.'),
      })
      logger.error('Failed to save credential details', error)
    }
  }

  const handleReconnectOAuth = async () => {
    if (!credential || credential.type !== 'oauth' || !credential.providerId || !workspaceId) return
    try {
      await createDraft.mutateAsync({
        workspaceId,
        providerId: credential.providerId,
        displayName: credential.displayName,
        description: credential.description || undefined,
        credentialId: credential.id,
      })

      const oauthPreCount = credentials.filter(
        (c) => c.type === 'oauth' && c.providerId === credential.providerId
      ).length
      writeOAuthReturnContext({
        origin: 'integrations',
        displayName: credential.displayName,
        providerId: credential.providerId,
        preCount: oauthPreCount,
        workspaceId,
        reconnect: true,
        requestedAt: Date.now(),
      })

      await connectOAuthService.mutateAsync({
        providerId: credential.providerId,
        callbackURL: window.location.href,
      })
    } catch (error: unknown) {
      toast.error("Couldn't start reconnect", {
        description: getErrorMessage(error, 'Please try again in a moment.'),
      })
      logger.error('Failed to reconnect OAuth credential', error)
    }
  }

  const handleChangeMemberRole = async (userId: string, role: WorkspaceCredentialRole) => {
    if (!credential) return
    const current = activeMembers.find((m) => m.userId === userId)
    if (current?.role === role) return
    try {
      await upsertMember.mutateAsync({ credentialId: credential.id, userId, role })
    } catch (error) {
      logger.error('Failed to change member role', error)
    }
  }

  const handleRemoveMember = async (userId: string) => {
    if (!credential) return
    try {
      await removeMember.mutateAsync({ credentialId: credential.id, userId })
    } catch (error) {
      logger.error('Failed to remove credential member', error)
    }
  }

  const handleConfirmDelete = async () => {
    if (!credential) return
    try {
      if (credential.type === 'service_account') {
        await deleteCredential.mutateAsync(credential.id)
      } else {
        if (!credential.accountId || !credential.providerId) {
          toast.error("Can't disconnect", {
            description: 'Missing account information. Try reconnecting this credential first.',
          })
          return
        }
        await disconnectOAuthService.mutateAsync({
          provider: credential.providerId.split('-')[0] || credential.providerId,
          providerId: credential.providerId,
          serviceId: credential.providerId,
          accountId: credential.accountId,
        })
        window.dispatchEvent(
          new CustomEvent('oauth-credentials-updated', {
            detail: { providerId: credential.providerId, workspaceId },
          })
        )
      }
      setShowDeleteConfirmDialog(false)
      router.push(integrationsHref)
    } catch (error) {
      toast.error("Couldn't disconnect", {
        description: getErrorMessage(error, 'Please try again in a moment.'),
      })
      logger.error('Failed to disconnect integration', error)
    }
  }

  const headerJsx = (
    <div className='flex flex-shrink-0 items-center justify-between bg-[var(--bg)] px-[16px] pt-[8.5px] pb-[8.5px]'>
      <ChipLink href={integrationsHref} onClick={handleBackClick} leftIcon={ArrowLeft}>
        Integrations
      </ChipLink>
      {credential && isAdmin && (
        <div className='flex items-center'>
          {serviceConfig?.authType !== 'service_account' && (
            <Chip
              onClick={handleReconnectOAuth}
              disabled={connectOAuthService.isPending}
              leftIcon={serviceConfig?.icon}
            >
              Reconnect
            </Chip>
          )}
          <Chip leftIcon={Send} onClick={() => setIsShareModalOpen(true)}>
            Share
          </Chip>
          <Chip
            onClick={() => setShowDeleteConfirmDialog(true)}
            disabled={disconnectOAuthService.isPending || deleteCredential.isPending}
          >
            Disconnect
          </Chip>
          <Chip
            onClick={handleSaveDetails}
            disabled={!isDetailsDirty || updateCredential.isPending}
          >
            {updateCredential.isPending ? 'Saving...' : 'Save'}
          </Chip>
        </div>
      )}
    </div>
  )

  if (credentialsLoading && !credential) {
    return (
      <div className='flex h-full flex-col bg-[var(--bg)]'>
        {headerJsx}
        <div className='min-h-0 flex-1 overflow-y-auto px-6 [scrollbar-gutter:stable_both-edges]'>
          <div className='mx-auto flex max-w-[48rem] flex-col gap-7 pb-3'>
            <p className='py-12 text-center text-[var(--text-muted)] text-sm'>Loading…</p>
          </div>
        </div>
      </div>
    )
  }

  if (!credential) {
    return (
      <div className='flex h-full flex-col bg-[var(--bg)]'>
        {headerJsx}
        <div className='min-h-0 flex-1 overflow-y-auto px-6 [scrollbar-gutter:stable_both-edges]'>
          <div className='mx-auto flex max-w-[48rem] flex-col gap-7 pb-3'>
            <p className='py-12 text-center text-[var(--text-muted)] text-sm'>
              Credential not found.
            </p>
          </div>
        </div>
      </div>
    )
  }

  const serviceLabel =
    serviceConfig?.name || resolveProviderLabel(credential.providerId) || 'Unknown service'

  return (
    <div className='flex h-full flex-col bg-[var(--bg)]'>
      {headerJsx}
      <div className='min-h-0 flex-1 overflow-y-auto px-6 [scrollbar-gutter:stable_both-edges]'>
        <div className='mx-auto flex max-w-[48rem] flex-col gap-7 pb-3'>
          {/* Header: icon tile + service name + service description (matches integrations row) */}
          <div className='flex items-center gap-2.5'>
            {serviceConfig ? (
              <IntegrationTile
                blockType={integrationBlockType}
                icon={serviceConfig.icon as ComponentType<{ className?: string }>}
              />
            ) : (
              <div className='flex size-9 flex-shrink-0 items-center justify-center rounded-xl border border-[var(--border-1)] bg-[var(--bg)]'>
                <span className='font-medium text-[var(--text-tertiary)] text-small'>
                  {resolveProviderLabel(credential.providerId).slice(0, 1) || '?'}
                </span>
              </div>
            )}
            <div className='flex min-w-0 flex-1 flex-col'>
              <span className='truncate text-[14px] text-[var(--text-body)]'>{serviceLabel}</span>
              <span className='truncate text-[12px] text-[var(--text-muted)]'>
                {serviceConfig?.description || 'Connected service'}
              </span>
            </div>
          </div>

          <Section title='Credential ID'>
            <div className='flex h-[30px] items-center gap-2 rounded-lg border border-[var(--border-1)] bg-[var(--surface-5)] px-2 dark:bg-[var(--surface-4)]'>
              <input
                id='credential-id'
                readOnly
                value={credential.id}
                className='h-full w-full cursor-default bg-transparent text-[var(--text-body)] text-sm outline-none placeholder:text-[var(--text-muted)] focus:outline-none'
              />
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <Button
                    variant='quiet'
                    className='size-[18px] rounded-sm p-0'
                    onClick={() => {
                      navigator.clipboard.writeText(credential.id)
                      setCopyIdSuccess(true)
                      setTimeout(() => setCopyIdSuccess(false), 2000)
                    }}
                    aria-label='Copy credential ID'
                  >
                    {copyIdSuccess ? (
                      <Check className='size-[13px]' />
                    ) : (
                      <Duplicate className='size-[13px]' />
                    )}
                  </Button>
                </Tooltip.Trigger>
                <Tooltip.Content>
                  {copyIdSuccess ? 'Copied!' : 'Copy credential ID'}
                </Tooltip.Content>
              </Tooltip.Root>
            </div>
          </Section>

          <Section title='Display Name'>
            <div className='flex h-[30px] items-center gap-2 rounded-lg border border-[var(--border-1)] bg-[var(--surface-5)] px-2 dark:bg-[var(--surface-4)]'>
              <input
                id='credential-display-name'
                value={displayNameDraft}
                onChange={(event) => setDisplayNameDraft(event.target.value)}
                autoComplete='off'
                data-lpignore='true'
                disabled={!isAdmin}
                className='h-full w-full bg-transparent text-[var(--text-body)] text-sm outline-none placeholder:text-[var(--text-muted)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-60'
              />
            </div>
          </Section>

          <Section title='Description'>
            <div className='flex items-start gap-1.5 rounded-lg border border-[var(--border-1)] bg-[var(--surface-5)] px-2 py-2 dark:bg-[var(--surface-4)]'>
              <textarea
                id='credential-description'
                rows={4}
                value={descriptionDraft}
                onChange={(event) => setDescriptionDraft(event.target.value)}
                placeholder='Add a description...'
                maxLength={500}
                autoComplete='off'
                data-lpignore='true'
                disabled={!isAdmin}
                className='w-full resize-none bg-transparent text-[var(--text-body)] text-sm outline-none placeholder:text-[var(--text-muted)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-60'
              />
            </div>
          </Section>

          <Section title={`Members (${activeMembers.length})`}>
            {membersLoading ? null : (
              <div className='flex flex-col gap-2'>
                {activeMembers.map((member) => {
                  const roleLocked = member.role === 'admin' && adminMemberCount <= 1
                  const roleDisabled = !isAdmin || roleLocked
                  return (
                    <div
                      key={member.id}
                      className={cn(
                        'grid items-center gap-2',
                        isAdmin ? 'grid-cols-[1fr_120px_72px]' : 'grid-cols-[1fr_200px]'
                      )}
                    >
                      <div className='flex min-w-0 items-center gap-2.5'>
                        <Avatar className='size-9 flex-shrink-0'>
                          <AvatarFallback
                            style={{
                              background: getUserColor(member.userId || member.userEmail || ''),
                            }}
                            className='border border-[var(--border-1)] text-small text-white'
                          >
                            {(member.userName || member.userEmail || '?').charAt(0).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className='flex min-w-0 flex-col'>
                          <span className='truncate text-[14px] text-[var(--text-body)]'>
                            {member.userName || member.userEmail || member.userId}
                          </span>
                          <span className='truncate text-[12px] text-[var(--text-muted)]'>
                            {member.userEmail || member.userId}
                          </span>
                        </div>
                      </div>
                      <ChipDropdown
                        options={ROLE_OPTIONS}
                        value={member.role}
                        placeholder='Role'
                        disabled={roleDisabled}
                        onChange={(role) =>
                          handleChangeMemberRole(member.userId, role as WorkspaceCredentialRole)
                        }
                      />
                      {isAdmin && (
                        <Chip
                          onClick={() => handleRemoveMember(member.userId)}
                          disabled={roleLocked}
                          flush
                          className='justify-self-end'
                        >
                          Remove
                        </Chip>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </Section>
        </div>
      </div>

      <Modal open={showDeleteConfirmDialog} onOpenChange={setShowDeleteConfirmDialog}>
        <ModalContent size='sm'>
          <ModalHeader>Disconnect Integration</ModalHeader>
          <ModalBody>
            <ModalDescription className='text-[var(--text-secondary)]'>
              Are you sure you want to disconnect{' '}
              <span className='font-medium text-[var(--text-primary)]'>
                {credential.displayName}
              </span>
              ? This action cannot be undone.
            </ModalDescription>
          </ModalBody>
          <ModalFooter>
            <Button variant='default' onClick={() => setShowDeleteConfirmDialog(false)}>
              Cancel
            </Button>
            <Button
              variant='destructive'
              onClick={handleConfirmDelete}
              disabled={disconnectOAuthService.isPending || deleteCredential.isPending}
            >
              {disconnectOAuthService.isPending || deleteCredential.isPending
                ? 'Disconnecting...'
                : 'Disconnect'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <ChipModal
        open={isShareModalOpen}
        onOpenChange={setIsShareModalOpen}
        srTitle='Invite team members'
      >
        <ChipModalHeader onClose={() => setIsShareModalOpen(false)}>
          Invite team members
        </ChipModalHeader>
        <ChipModalBody>
          <ChipModalField type='custom' title='Emails'>
            <TagInput
              items={[]}
              onAdd={() => false}
              onRemove={() => {}}
              placeholder='Enter emails'
              variant='block'
            />
          </ChipModalField>
          <ChipModalField
            type='dropdown'
            title='Invite as'
            options={ROLE_OPTIONS}
            value={inviteRole}
            placeholder='Select role'
            align='start'
            onChange={(role) => setInviteRole(role as WorkspaceCredentialRole)}
          />
        </ChipModalBody>
        <ChipModalFooter>
          <Chip variant='primary'>Send invites</Chip>
        </ChipModalFooter>
      </ChipModal>

      <Modal open={showUnsavedChangesAlert} onOpenChange={setShowUnsavedChangesAlert}>
        <ModalContent size='sm'>
          <ModalHeader>Unsaved Changes</ModalHeader>
          <ModalBody>
            <ModalDescription className='text-[var(--text-secondary)]'>
              You have unsaved changes. Are you sure you want to discard them?
            </ModalDescription>
          </ModalBody>
          <ModalFooter>
            <Button variant='default' onClick={() => setShowUnsavedChangesAlert(false)}>
              Keep Editing
            </Button>
            <Button variant='destructive' onClick={handleDiscardChanges}>
              Discard Changes
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  )
}
