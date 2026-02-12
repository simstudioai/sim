'use client'

import { createElement, useEffect, useMemo, useState } from 'react'
import { createLogger } from '@sim/logger'
import { Plus, Search, Trash2 } from 'lucide-react'
import { useParams } from 'next/navigation'
import {
  Badge,
  Button,
  ButtonGroup,
  ButtonGroupItem,
  Combobox,
  Input,
  Label,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Textarea,
} from '@/components/emcn'
import { Skeleton } from '@/components/ui'
import { useSession } from '@/lib/auth/auth-client'
import { cn } from '@/lib/core/utils/cn'
import {
  clearPendingCredentialCreateRequest,
  readPendingCredentialCreateRequest,
} from '@/lib/credentials/client-state'
import {
  getCanonicalScopesForProvider,
  getServiceConfigByProviderId,
  type OAuthProvider,
} from '@/lib/oauth'
import { OAuthRequiredModal } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/credential-selector/components/oauth-required-modal'
import { isValidEnvVarName } from '@/executor/constants'
import {
  useCreateWorkspaceCredential,
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
  usePersonalEnvironment,
  useSavePersonalEnvironment,
  useUpsertWorkspaceEnvironment,
  useWorkspaceEnvironment,
} from '@/hooks/queries/environment'
import {
  useConnectOAuthService,
  useDisconnectOAuthService,
  useOAuthConnections,
} from '@/hooks/queries/oauth-connections'
import { useWorkspacePermissionsQuery } from '@/hooks/queries/workspace'

const logger = createLogger('CredentialsManager')

const roleOptions = [
  { value: 'member', label: 'Member' },
  { value: 'admin', label: 'Admin' },
] as const

type CreateCredentialType = 'oauth' | 'secret'
type SecretScope = 'workspace' | 'personal'

const createTypeOptions = [
  { value: 'oauth', label: 'OAuth Account' },
  { value: 'secret', label: 'Secret' },
] as const

function getSecretCredentialType(
  scope: SecretScope
): Extract<WorkspaceCredential['type'], 'env_workspace' | 'env_personal'> {
  return scope === 'workspace' ? 'env_workspace' : 'env_personal'
}

function typeBadgeVariant(type: WorkspaceCredential['type']): 'blue' | 'amber' | 'gray-secondary' {
  if (type === 'oauth') return 'blue'
  if (type === 'env_workspace') return 'amber'
  return 'gray-secondary'
}

function typeLabel(type: WorkspaceCredential['type']): string {
  if (type === 'oauth') return 'OAuth'
  if (type === 'env_workspace') return 'Workspace Secret'
  return 'Personal Secret'
}

function normalizeEnvKeyInput(raw: string): string {
  const trimmed = raw.trim()
  const wrappedMatch = /^\{\{\s*([A-Za-z0-9_]+)\s*\}\}$/.exec(trimmed)
  return wrappedMatch ? wrappedMatch[1] : trimmed
}

export function CredentialsManager() {
  const params = useParams()
  const workspaceId = (params?.workspaceId as string) || ''

  const [searchTerm, setSearchTerm] = useState('')
  const [selectedCredentialId, setSelectedCredentialId] = useState<string | null>(null)
  const [memberRole, setMemberRole] = useState<WorkspaceCredentialRole>('member')
  const [memberUserId, setMemberUserId] = useState('')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createType, setCreateType] = useState<CreateCredentialType>('oauth')
  const [createSecretScope, setCreateSecretScope] = useState<SecretScope>('personal')
  const [createDisplayName, setCreateDisplayName] = useState('')
  const [createDescription, setCreateDescription] = useState('')
  const [createEnvKey, setCreateEnvKey] = useState('')
  const [createEnvValue, setCreateEnvValue] = useState('')
  const [createOAuthProviderId, setCreateOAuthProviderId] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)
  const [detailsError, setDetailsError] = useState<string | null>(null)
  const [selectedEnvValueDraft, setSelectedEnvValueDraft] = useState('')
  const [isEditingEnvValue, setIsEditingEnvValue] = useState(false)
  const [selectedDescriptionDraft, setSelectedDescriptionDraft] = useState('')
  const [showCreateOAuthRequiredModal, setShowCreateOAuthRequiredModal] = useState(false)
  const { data: session } = useSession()
  const currentUserId = session?.user?.id || ''

  const {
    data: credentials = [],
    isPending: credentialsLoading,
    refetch: refetchCredentials,
  } = useWorkspaceCredentials({
    workspaceId,
    enabled: Boolean(workspaceId),
  })

  const { data: oauthConnections = [] } = useOAuthConnections()
  const connectOAuthService = useConnectOAuthService()
  const disconnectOAuthService = useDisconnectOAuthService()
  const savePersonalEnvironment = useSavePersonalEnvironment()
  const upsertWorkspaceEnvironment = useUpsertWorkspaceEnvironment()
  const { data: personalEnvironment = {} } = usePersonalEnvironment()
  const { data: workspaceEnvironmentData } = useWorkspaceEnvironment(workspaceId, {
    select: (data) => data,
  })

  const { data: workspacePermissions } = useWorkspacePermissionsQuery(workspaceId || null)
  const selectedCredential = useMemo(
    () => credentials.find((credential) => credential.id === selectedCredentialId) || null,
    [credentials, selectedCredentialId]
  )

  const { data: members = [], isPending: membersLoading } = useWorkspaceCredentialMembers(
    selectedCredential?.id
  )

  const createCredential = useCreateWorkspaceCredential()
  const updateCredential = useUpdateWorkspaceCredential()
  const deleteCredential = useDeleteWorkspaceCredential()
  const upsertMember = useUpsertWorkspaceCredentialMember()
  const removeMember = useRemoveWorkspaceCredentialMember()
  const oauthServiceNameByProviderId = useMemo(
    () => new Map(oauthConnections.map((service) => [service.providerId, service.name])),
    [oauthConnections]
  )
  const resolveProviderLabel = (providerId?: string | null): string => {
    if (!providerId) return ''
    return oauthServiceNameByProviderId.get(providerId) || providerId
  }

  const filteredCredentials = useMemo(() => {
    if (!searchTerm.trim()) return credentials
    const normalized = searchTerm.toLowerCase()
    return credentials.filter((credential) => {
      return (
        credential.displayName.toLowerCase().includes(normalized) ||
        (credential.description || '').toLowerCase().includes(normalized) ||
        (credential.providerId || '').toLowerCase().includes(normalized) ||
        resolveProviderLabel(credential.providerId).toLowerCase().includes(normalized) ||
        typeLabel(credential.type).toLowerCase().includes(normalized)
      )
    })
  }, [credentials, searchTerm, oauthConnections])

  const sortedCredentials = useMemo(() => {
    return [...filteredCredentials].sort((a, b) => {
      const aDate = new Date(a.updatedAt).getTime()
      const bDate = new Date(b.updatedAt).getTime()
      return bDate - aDate
    })
  }, [filteredCredentials])

  const oauthServiceOptions = useMemo(
    () =>
      oauthConnections.map((service) => ({
        value: service.providerId,
        label: service.name,
      })),
    [oauthConnections]
  )

  const activeMembers = useMemo(
    () => members.filter((member) => member.status === 'active'),
    [members]
  )
  const adminMemberCount = useMemo(
    () => activeMembers.filter((member) => member.role === 'admin').length,
    [activeMembers]
  )

  const workspaceUserOptions = useMemo(() => {
    const activeMemberUserIds = new Set(activeMembers.map((member) => member.userId))
    return (workspacePermissions?.users || [])
      .filter((user) => !activeMemberUserIds.has(user.userId))
      .map((user) => ({
        value: user.userId,
        label: user.name || user.email,
      }))
  }, [workspacePermissions?.users, activeMembers])

  const selectedOAuthService = useMemo(
    () => oauthConnections.find((service) => service.providerId === createOAuthProviderId) || null,
    [oauthConnections, createOAuthProviderId]
  )
  const createOAuthRequiredScopes = useMemo(() => {
    if (!createOAuthProviderId) return []
    if (selectedOAuthService?.scopes?.length) {
      return selectedOAuthService.scopes
    }
    return getCanonicalScopesForProvider(createOAuthProviderId)
  }, [selectedOAuthService, createOAuthProviderId])
  const createSecretType = useMemo(
    () => getSecretCredentialType(createSecretScope),
    [createSecretScope]
  )
  const selectedExistingEnvCredential = useMemo(() => {
    if (createType !== 'secret') return null
    const envKey = normalizeEnvKeyInput(createEnvKey)
    if (!envKey) return null
    return (
      credentials.find(
        (row) =>
          row.type === createSecretType && (row.envKey || '').toLowerCase() === envKey.toLowerCase()
      ) ?? null
    )
  }, [credentials, createEnvKey, createSecretType, createType])
  const selectedEnvCurrentValue = useMemo(() => {
    if (!selectedCredential || selectedCredential.type === 'oauth') return ''
    const envKey = selectedCredential.envKey || ''
    if (!envKey) return ''

    if (selectedCredential.type === 'env_workspace') {
      return workspaceEnvironmentData?.workspace?.[envKey] || ''
    }

    if (selectedCredential.envOwnerUserId && selectedCredential.envOwnerUserId !== currentUserId) {
      return ''
    }

    return personalEnvironment[envKey]?.value || workspaceEnvironmentData?.personal?.[envKey] || ''
  }, [selectedCredential, workspaceEnvironmentData, personalEnvironment, currentUserId])
  const isEnvValueDirty = useMemo(() => {
    if (!selectedCredential || selectedCredential.type === 'oauth') return false
    return selectedEnvValueDraft !== selectedEnvCurrentValue
  }, [selectedCredential, selectedEnvValueDraft, selectedEnvCurrentValue])
  useEffect(() => {
    if (!selectedCredential || !isSelectedAdmin) return
    if (selectedDescriptionDraft === (selectedCredential.description || '')) return

    const timer = setTimeout(async () => {
      try {
        await updateCredential.mutateAsync({
          credentialId: selectedCredential.id,
          description: selectedDescriptionDraft.trim() || null,
        })
        await refetchCredentials()
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Failed to update description'
        setDetailsError(message)
        logger.error('Failed to autosave credential description', error)
      }
    }, 600)

    return () => clearTimeout(timer)
  }, [selectedDescriptionDraft])

  useEffect(() => {
    if (createType !== 'oauth') return
    if (createOAuthProviderId || oauthConnections.length === 0) return
    setCreateOAuthProviderId(oauthConnections[0]?.providerId || '')
  }, [createType, createOAuthProviderId, oauthConnections])

  useEffect(() => {
    setCreateError(null)
  }, [createOAuthProviderId])

  useEffect(() => {
    if (!workspaceId) return
    const request = readPendingCredentialCreateRequest()
    if (!request) return

    if (request.workspaceId !== workspaceId) {
      return
    }

    if (Date.now() - request.requestedAt > 15 * 60 * 1000) {
      clearPendingCredentialCreateRequest()
      return
    }

    setShowCreateModal(true)
    setShowCreateOAuthRequiredModal(false)
    setCreateError(null)
    setCreateDescription('')
    setCreateEnvValue('')

    if (request.type === 'oauth') {
      setCreateType('oauth')
      setCreateOAuthProviderId(request.providerId)
      setCreateDisplayName(request.displayName)
      setCreateEnvKey('')
    } else {
      setCreateType('secret')
      setCreateSecretScope(request.type === 'env_workspace' ? 'workspace' : 'personal')
      setCreateOAuthProviderId('')
      setCreateDisplayName('')
      setCreateEnvKey(request.envKey || '')
    }

    clearPendingCredentialCreateRequest()
  }, [workspaceId])

  useEffect(() => {
    if (!selectedCredential) {
      setSelectedEnvValueDraft('')
      setIsEditingEnvValue(false)
      setSelectedDescriptionDraft('')
      return
    }

    setDetailsError(null)
    setSelectedDescriptionDraft(selectedCredential.description || '')

    if (selectedCredential.type === 'oauth') {
      setSelectedEnvValueDraft('')
      setIsEditingEnvValue(false)
      return
    }

    const envKey = selectedCredential.envKey || ''
    if (!envKey) {
      setSelectedEnvValueDraft('')
      return
    }

    setSelectedEnvValueDraft(selectedEnvCurrentValue)
    setIsEditingEnvValue(false)
  }, [selectedCredential, selectedEnvCurrentValue])

  const isSelectedAdmin = selectedCredential?.role === 'admin'
  const selectedOAuthServiceConfig = useMemo(() => {
    if (
      !selectedCredential ||
      selectedCredential.type !== 'oauth' ||
      !selectedCredential.providerId
    ) {
      return null
    }

    return getServiceConfigByProviderId(selectedCredential.providerId)
  }, [selectedCredential])

  const resetCreateForm = () => {
    setCreateType('oauth')
    setCreateSecretScope('personal')
    setCreateDisplayName('')
    setCreateDescription('')
    setCreateEnvKey('')
    setCreateEnvValue('')
    setCreateOAuthProviderId('')
    setCreateError(null)
    setShowCreateOAuthRequiredModal(false)
  }

  const handleSelectCredential = (credential: WorkspaceCredential) => {
    setSelectedCredentialId(credential.id)
    setDetailsError(null)
  }

  const canEditSelectedEnvValue = useMemo(() => {
    if (!selectedCredential || selectedCredential.type === 'oauth') return false
    if (!isSelectedAdmin) return false
    if (selectedCredential.type === 'env_workspace') return true
    return Boolean(
      selectedCredential.envOwnerUserId &&
        currentUserId &&
        selectedCredential.envOwnerUserId === currentUserId
    )
  }, [selectedCredential, isSelectedAdmin, currentUserId])

  useEffect(() => {
    if (!selectedCredential || selectedCredential.type === 'oauth') return
    if (!canEditSelectedEnvValue || !isEditingEnvValue) return
    if (selectedEnvValueDraft === selectedEnvCurrentValue) return

    const envKey = selectedCredential.envKey || ''
    if (!envKey) return

    const timer = setTimeout(async () => {
      try {
        setDetailsError(null)
        const nextValue = selectedEnvValueDraft

        if (selectedCredential.type === 'env_workspace') {
          await upsertWorkspaceEnvironment.mutateAsync({
            workspaceId,
            variables: {
              [envKey]: nextValue,
            },
          })
        } else {
          const personalVariables = Object.entries(personalEnvironment).reduce(
            (acc, [key, value]) => ({
              ...acc,
              [key]: value.value,
            }),
            {} as Record<string, string>
          )

          await savePersonalEnvironment.mutateAsync({
            variables: {
              ...personalVariables,
              [envKey]: nextValue,
            },
          })
        }

        await refetchCredentials()
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Failed to update secret value'
        setDetailsError(message)
        logger.error('Failed to autosave environment credential value', error)
      }
    }, 600)

    return () => clearTimeout(timer)
  }, [selectedEnvValueDraft])

  const handleCreateCredential = async () => {
    if (!workspaceId) return
    setCreateError(null)
    const normalizedDescription = createDescription.trim()

    try {
      if (createType === 'oauth') {
        if (!selectedOAuthService) {
          setCreateError('Select an OAuth service before connecting.')
          return
        }
        if (!createDisplayName.trim()) {
          setCreateError('Display name is required.')
          return
        }
        setShowCreateOAuthRequiredModal(true)
        return
      }

      if (!createEnvKey.trim()) return
      const normalizedEnvKey = normalizeEnvKeyInput(createEnvKey)
      if (!isValidEnvVarName(normalizedEnvKey)) {
        setCreateError('Secret key must contain only letters, numbers, and underscores.')
        return
      }
      if (!createEnvValue.trim()) {
        setCreateError('Secret value is required.')
        return
      }

      if (createSecretType === 'env_personal') {
        const personalVariables = Object.entries(personalEnvironment).reduce(
          (acc, [key, value]) => ({
            ...acc,
            [key]: value.value,
          }),
          {} as Record<string, string>
        )

        await savePersonalEnvironment.mutateAsync({
          variables: {
            ...personalVariables,
            [normalizedEnvKey]: createEnvValue.trim(),
          },
        })
      } else {
        const workspaceVariables = workspaceEnvironmentData?.workspace ?? {}
        await upsertWorkspaceEnvironment.mutateAsync({
          workspaceId,
          variables: {
            ...workspaceVariables,
            [normalizedEnvKey]: createEnvValue.trim(),
          },
        })
      }

      const response = await createCredential.mutateAsync({
        workspaceId,
        type: createSecretType,
        envKey: normalizedEnvKey,
        description: normalizedDescription || undefined,
      })
      const credentialId = response?.credential?.id
      if (credentialId) {
        setSelectedCredentialId(credentialId)
      }

      await refetchCredentials()

      setShowCreateModal(false)
      resetCreateForm()
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to create credential'
      setCreateError(message)
      logger.error('Failed to create credential', error)
    }
  }

  const handleConnectOAuthService = async () => {
    if (!selectedOAuthService) {
      setCreateError('Select an OAuth service before connecting.')
      return
    }

    const displayName = createDisplayName.trim()
    if (!displayName) {
      setCreateError('Display name is required.')
      return
    }

    setCreateError(null)
    try {
      await fetch('/api/credentials/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId,
          providerId: selectedOAuthService.providerId,
          displayName,
          description: createDescription.trim() || undefined,
        }),
      })

      window.sessionStorage.setItem(
        'sim.oauth-connect-pending',
        JSON.stringify({
          displayName,
          providerId: selectedOAuthService.providerId,
          preCount: credentials.filter((c) => c.type === 'oauth').length,
          workspaceId,
        })
      )

      await connectOAuthService.mutateAsync({
        providerId: selectedOAuthService.providerId,
        callbackURL: window.location.href,
      })
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to start OAuth connection'
      setCreateError(message)
      logger.error('Failed to connect OAuth service', error)
    }
  }

  const handleDeleteCredential = async () => {
    if (!selectedCredential) return
    if (selectedCredential.type === 'oauth') {
      await handleDisconnectSelectedCredential()
      return
    }
    try {
      await deleteCredential.mutateAsync(selectedCredential.id)
      setSelectedCredentialId(null)
    } catch (error) {
      logger.error('Failed to delete credential', error)
    }
  }

  const handleDisconnectSelectedCredential = async () => {
    if (!selectedCredential || selectedCredential.type !== 'oauth' || !selectedCredential.accountId)
      return
    if (!selectedCredential.providerId) return

    try {
      await disconnectOAuthService.mutateAsync({
        provider: selectedCredential.providerId.split('-')[0] || selectedCredential.providerId,
        providerId: selectedCredential.providerId,
        serviceId: selectedCredential.providerId,
        accountId: selectedCredential.accountId,
      })

      setSelectedCredentialId(null)
      await refetchCredentials()
      window.dispatchEvent(
        new CustomEvent('oauth-credentials-updated', {
          detail: { providerId: selectedCredential.providerId, workspaceId },
        })
      )
    } catch (error) {
      logger.error('Failed to disconnect credential account', error)
    }
  }

  const handleAddMember = async () => {
    if (!selectedCredential || !memberUserId) return
    try {
      await upsertMember.mutateAsync({
        credentialId: selectedCredential.id,
        userId: memberUserId,
        role: memberRole,
      })
      setMemberUserId('')
      setMemberRole('member')
    } catch (error) {
      logger.error('Failed to add credential member', error)
    }
  }

  const handleChangeMemberRole = async (userId: string, role: WorkspaceCredentialRole) => {
    if (!selectedCredential) return
    const currentMember = activeMembers.find((member) => member.userId === userId)
    if (currentMember?.role === role) return
    try {
      await upsertMember.mutateAsync({
        credentialId: selectedCredential.id,
        userId,
        role,
      })
    } catch (error) {
      logger.error('Failed to change member role', error)
    }
  }

  const handleRemoveMember = async (userId: string) => {
    if (!selectedCredential) return
    try {
      await removeMember.mutateAsync({
        credentialId: selectedCredential.id,
        userId,
      })
    } catch (error) {
      logger.error('Failed to remove credential member', error)
    }
  }

  return (
    <div className='flex h-full min-h-0 gap-[16px]'>
      <div className='flex w-[320px] min-w-[320px] flex-col gap-[12px] border-[var(--border-1)] border-r pr-[16px]'>
        <div className='flex items-center gap-[8px]'>
          <div className='relative flex-1'>
            <Search className='absolute top-1/2 left-[10px] h-[14px] w-[14px] -translate-y-1/2 text-[var(--text-tertiary)]' />
            <Input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder='Search credentials...'
              className='pl-[32px]'
            />
          </div>
          <Button variant='active' onClick={() => setShowCreateModal(true)}>
            <Plus className='h-[14px] w-[14px]' />
          </Button>
        </div>

        <div className='min-h-0 flex-1 overflow-y-auto'>
          {credentialsLoading ? (
            <div className='flex flex-col gap-[8px]'>
              <Skeleton className='h-[64px] w-full rounded-[8px]' />
              <Skeleton className='h-[64px] w-full rounded-[8px]' />
              <Skeleton className='h-[64px] w-full rounded-[8px]' />
            </div>
          ) : sortedCredentials.length === 0 ? (
            <div className='rounded-[8px] border border-[var(--border-1)] px-[12px] py-[10px] text-[12px] text-[var(--text-tertiary)]'>
              No credentials available for this workspace.
            </div>
          ) : (
            <div className='flex flex-col gap-[8px]'>
              {sortedCredentials.map((credential) => (
                <button
                  key={credential.id}
                  type='button'
                  className={cn(
                    'w-full rounded-[8px] border px-[10px] py-[10px] text-left transition-colors',
                    selectedCredentialId === credential.id
                      ? 'border-[var(--brand-9)] bg-[var(--surface-3)]'
                      : 'border-[var(--border-1)] hover:bg-[var(--surface-2)]'
                  )}
                  onClick={() => handleSelectCredential(credential)}
                >
                  <div className='mb-[6px] flex items-center justify-between gap-[8px]'>
                    <p className='truncate font-medium text-[13px] text-[var(--text-primary)]'>
                      {credential.displayName}
                    </p>
                    <Badge variant={typeBadgeVariant(credential.type)}>
                      {typeLabel(credential.type)}
                    </Badge>
                  </div>
                  <p className='truncate text-[12px] text-[var(--text-tertiary)]'>
                    {credential.type === 'oauth'
                      ? resolveProviderLabel(credential.providerId)
                      : credential.envKey || credential.id}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className='min-h-0 flex-1 overflow-y-auto'>
        {!selectedCredential ? (
          <div className='rounded-[8px] border border-[var(--border-1)] px-[14px] py-[12px] text-[13px] text-[var(--text-tertiary)]'>
            Select a credential to manage members.
          </div>
        ) : (
          <div className='flex flex-col gap-[16px]'>
            <div className='rounded-[8px] border border-[var(--border-1)] p-[12px]'>
              <div className='mb-[10px] flex items-center justify-between gap-[12px]'>
                <div className='flex items-center gap-[8px]'>
                  <Badge variant={typeBadgeVariant(selectedCredential.type)}>
                    {typeLabel(selectedCredential.type)}
                  </Badge>
                  {selectedCredential.role && (
                    <Badge
                      variant={selectedCredential.role === 'admin' ? 'blue' : 'gray-secondary'}
                    >
                      {selectedCredential.role}
                    </Badge>
                  )}
                </div>
                {isSelectedAdmin && (
                  <div className='flex items-center gap-[8px]'>
                    {selectedCredential.type === 'oauth' && (
                      <Button
                        variant='ghost'
                        onClick={handleDisconnectSelectedCredential}
                        disabled={disconnectOAuthService.isPending}
                      >
                        Disconnect account
                      </Button>
                    )}
                    {selectedCredential.type !== 'oauth' && (
                      <Button
                        variant='destructive'
                        onClick={handleDeleteCredential}
                        disabled={deleteCredential.isPending}
                      >
                        <Trash2 className='h-[14px] w-[14px]' />
                      </Button>
                    )}
                  </div>
                )}
              </div>

              {selectedCredential.type === 'oauth' ? (
                <div className='flex flex-col gap-[10px]'>
                  <div>
                    <Label htmlFor='credential-display-name'>Display Name</Label>
                    <Input
                      id='credential-display-name'
                      value={selectedCredential.displayName}
                      autoComplete='off'
                      disabled
                      className='mt-[6px]'
                    />
                  </div>
                  <div>
                    <Label htmlFor='credential-description'>Description</Label>
                    <Textarea
                      id='credential-description'
                      value={selectedDescriptionDraft}
                      onChange={(event) => setSelectedDescriptionDraft(event.target.value)}
                      placeholder='Add a description...'
                      maxLength={500}
                      autoComplete='off'
                      disabled={!isSelectedAdmin}
                      className='mt-[6px] min-h-[60px] resize-none'
                    />
                  </div>
                  <div>
                    <Label>Connected service</Label>
                    <div className='mt-[6px] flex items-center gap-[10px] rounded-[8px] border border-[var(--border-1)] px-[10px] py-[8px]'>
                      <div className='flex h-8 w-8 flex-shrink-0 items-center justify-center overflow-hidden rounded-[6px] bg-[var(--surface-5)]'>
                        {selectedOAuthServiceConfig ? (
                          createElement(selectedOAuthServiceConfig.icon, { className: 'h-4 w-4' })
                        ) : (
                          <span className='font-medium text-[12px] text-[var(--text-tertiary)]'>
                            {resolveProviderLabel(selectedCredential.providerId).slice(0, 1)}
                          </span>
                        )}
                      </div>
                      <span className='text-[12px] text-[var(--text-primary)]'>
                        {resolveProviderLabel(selectedCredential.providerId) || 'Unknown service'}
                      </span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className='flex flex-col gap-[10px]'>
                  <Label htmlFor='credential-env-key'>Secret key</Label>
                  <Input
                    id='credential-env-key'
                    value={selectedCredential.envKey || ''}
                    readOnly
                    disabled
                    autoComplete='off'
                    className='mt-[6px]'
                  />
                  <div>
                    <div className='flex items-center justify-between'>
                      <Label htmlFor='credential-env-value'>Secret value</Label>
                      {canEditSelectedEnvValue && (
                        <Button
                          variant='ghost'
                          onClick={() => setIsEditingEnvValue((value) => !value)}
                        >
                          {isEditingEnvValue ? 'Hide' : 'Edit'}
                        </Button>
                      )}
                    </div>
                    <Input
                      id='credential-env-value'
                      type={isEditingEnvValue ? 'text' : 'password'}
                      value={selectedEnvValueDraft}
                      onChange={(event) => setSelectedEnvValueDraft(event.target.value)}
                      onFocus={() => {
                        if (canEditSelectedEnvValue) {
                          setIsEditingEnvValue(true)
                        }
                      }}
                      autoComplete='new-password'
                      autoCapitalize='none'
                      autoCorrect='off'
                      spellCheck={false}
                      data-lpignore='true'
                      data-1p-ignore='true'
                      readOnly={!canEditSelectedEnvValue || !isEditingEnvValue}
                      disabled={!canEditSelectedEnvValue}
                      className='mt-[6px]'
                    />
                  </div>
                  <div>
                    <Label htmlFor='credential-description'>Description</Label>
                    <Textarea
                      id='credential-description'
                      value={selectedDescriptionDraft}
                      onChange={(event) => setSelectedDescriptionDraft(event.target.value)}
                      placeholder='Add a description...'
                      maxLength={500}
                      autoComplete='off'
                      disabled={!isSelectedAdmin}
                      className='mt-[6px] min-h-[60px] resize-none'
                    />
                  </div>
                </div>
              )}
              {detailsError && (
                <div className='mt-[8px] rounded-[8px] border border-[var(--status-red)]/40 bg-[var(--status-red)]/10 px-[10px] py-[8px] text-[12px] text-[var(--status-red)]'>
                  {detailsError}
                </div>
              )}
            </div>

            <div className='rounded-[8px] border border-[var(--border-1)] p-[12px]'>
              <h3 className='mb-[10px] font-medium text-[13px] text-[var(--text-primary)]'>
                Members
              </h3>

              {membersLoading ? (
                <div className='flex flex-col gap-[8px]'>
                  <Skeleton className='h-[44px] w-full rounded-[8px]' />
                  <Skeleton className='h-[44px] w-full rounded-[8px]' />
                </div>
              ) : (
                <div className='flex flex-col gap-[8px]'>
                  {activeMembers.map((member) => (
                    <div
                      key={member.id}
                      className='flex items-center justify-between rounded-[8px] border border-[var(--border-1)] px-[10px] py-[8px]'
                    >
                      <div className='min-w-0'>
                        <p className='truncate font-medium text-[12px] text-[var(--text-primary)]'>
                          {member.userName || member.userEmail || member.userId}
                        </p>
                        <p className='truncate text-[11px] text-[var(--text-tertiary)]'>
                          {member.userEmail || member.userId}
                        </p>
                      </div>

                      <div className='ml-[10px] flex items-center gap-[6px]'>
                        {isSelectedAdmin ? (
                          <>
                            <Combobox
                              options={roleOptions.map((option) => ({
                                value: option.value,
                                label: option.label,
                              }))}
                              value={
                                roleOptions.find((option) => option.value === member.role)?.label ||
                                ''
                              }
                              selectedValue={member.role}
                              onChange={(value) =>
                                handleChangeMemberRole(
                                  member.userId,
                                  value as WorkspaceCredentialRole
                                )
                              }
                              placeholder='Role'
                              disabled={member.role === 'admin' && adminMemberCount <= 1}
                              size='sm'
                              className='min-w-[120px]'
                            />
                            {selectedCredential.type !== 'env_workspace' && (
                              <Button
                                variant='ghost'
                                onClick={() => handleRemoveMember(member.userId)}
                                disabled={member.role === 'admin' && adminMemberCount <= 1}
                              >
                                Remove
                              </Button>
                            )}
                          </>
                        ) : (
                          <Badge variant={member.role === 'admin' ? 'blue' : 'gray-secondary'}>
                            {member.role}
                          </Badge>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {isSelectedAdmin && selectedCredential.type !== 'env_workspace' && (
                <div className='mt-[10px] rounded-[8px] border border-[var(--border-1)] p-[10px]'>
                  <Label>Add member</Label>
                  <div className='mt-[6px] grid grid-cols-[1fr_120px_auto] gap-[8px]'>
                    <Combobox
                      options={workspaceUserOptions}
                      value={
                        workspaceUserOptions.find((option) => option.value === memberUserId)
                          ?.label || ''
                      }
                      selectedValue={memberUserId}
                      onChange={setMemberUserId}
                      placeholder='Select user'
                    />
                    <Combobox
                      options={roleOptions.map((option) => ({
                        value: option.value,
                        label: option.label,
                      }))}
                      value={roleOptions.find((option) => option.value === memberRole)?.label || ''}
                      selectedValue={memberRole}
                      onChange={(value) => setMemberRole(value as WorkspaceCredentialRole)}
                      placeholder='Role'
                    />
                    <Button
                      variant='active'
                      onClick={handleAddMember}
                      disabled={!memberUserId || upsertMember.isPending}
                    >
                      Add
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <Modal
        open={showCreateModal}
        onOpenChange={(open) => {
          setShowCreateModal(open)
          if (!open) resetCreateForm()
        }}
      >
        <ModalContent size='md'>
          <ModalHeader>Create Credential</ModalHeader>
          <ModalBody>
            <div className='flex flex-col gap-[12px]'>
              <div>
                <Label>Type</Label>
                <div className='mt-[6px]'>
                  <Combobox
                    options={createTypeOptions.map((option) => ({
                      value: option.value,
                      label: option.label,
                    }))}
                    value={
                      createTypeOptions.find((option) => option.value === createType)?.label || ''
                    }
                    selectedValue={createType}
                    onChange={(value) => {
                      setCreateType(value as CreateCredentialType)
                      setCreateError(null)
                    }}
                    placeholder='Select credential type'
                  />
                </div>
              </div>

              {createType === 'oauth' ? (
                <div className='flex flex-col gap-[10px]'>
                  <div>
                    <Label>Display name</Label>
                    <Input
                      value={createDisplayName}
                      onChange={(event) => setCreateDisplayName(event.target.value)}
                      placeholder='Credential name'
                      autoComplete='off'
                      className='mt-[6px]'
                    />
                  </div>
                  <div>
                    <Label>Description</Label>
                    <Textarea
                      value={createDescription}
                      onChange={(event) => setCreateDescription(event.target.value)}
                      placeholder='Optional description'
                      maxLength={500}
                      autoComplete='off'
                      className='mt-[6px] min-h-[80px] resize-none'
                    />
                  </div>
                  <div>
                    <Label>OAuth service</Label>
                    <div className='mt-[6px]'>
                      <Combobox
                        options={oauthServiceOptions}
                        value={
                          oauthServiceOptions.find(
                            (option) => option.value === createOAuthProviderId
                          )?.label || ''
                        }
                        selectedValue={createOAuthProviderId}
                        onChange={setCreateOAuthProviderId}
                        placeholder='Select OAuth service'
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div className='flex flex-col gap-[10px]'>
                  <div>
                    <Label className='block'>Scope</Label>
                    <div className='mt-[6px]'>
                      <ButtonGroup
                        value={createSecretScope}
                        onValueChange={(value) => setCreateSecretScope(value as SecretScope)}
                      >
                        <ButtonGroupItem
                          value='personal'
                          className='h-[28px] min-w-[72px] px-[10px] py-0 text-[12px]'
                        >
                          Personal
                        </ButtonGroupItem>
                        <ButtonGroupItem
                          value='workspace'
                          className='h-[28px] min-w-[80px] px-[10px] py-0 text-[12px]'
                        >
                          Workspace
                        </ButtonGroupItem>
                      </ButtonGroup>
                    </div>
                  </div>
                  <div>
                    <Label>Secret key</Label>
                    <Input
                      value={createEnvKey}
                      onChange={(event) => {
                        setCreateEnvKey(event.target.value)
                      }}
                      placeholder='API_KEY'
                      autoComplete='off'
                      autoCapitalize='none'
                      autoCorrect='off'
                      spellCheck={false}
                      data-lpignore='true'
                      data-1p-ignore='true'
                      className='mt-[6px]'
                    />
                    <p className='mt-[4px] text-[11px] text-[var(--text-tertiary)]'>
                      Use it in blocks as {'{{KEY}}'}, for example {'{{API_KEY}}'}.
                    </p>
                  </div>
                  <div>
                    <Label>Secret value</Label>
                    <Input
                      type='password'
                      value={createEnvValue}
                      onChange={(event) => setCreateEnvValue(event.target.value)}
                      placeholder='Enter secret value'
                      autoComplete='new-password'
                      autoCapitalize='none'
                      autoCorrect='off'
                      spellCheck={false}
                      data-lpignore='true'
                      data-1p-ignore='true'
                      className='mt-[6px]'
                    />
                  </div>
                  <div>
                    <Label>Description</Label>
                    <Textarea
                      value={createDescription}
                      onChange={(event) => setCreateDescription(event.target.value)}
                      placeholder='Optional description'
                      maxLength={500}
                      autoComplete='off'
                      className='mt-[6px] min-h-[80px] resize-none'
                    />
                  </div>

                  {selectedExistingEnvCredential && (
                    <div className='rounded-[8px] border border-[var(--brand-9)]/40 bg-[var(--surface-3)] px-[10px] py-[8px]'>
                      <p className='text-[12px] text-[var(--text-primary)]'>
                        This secret key already maps to credential{' '}
                        <span className='font-medium'>
                          {selectedExistingEnvCredential.displayName}
                        </span>
                        .
                      </p>
                      <p className='mt-[4px] text-[11px] text-[var(--text-tertiary)]'>
                        Create will update the secret value and reuse the existing credential.
                      </p>
                      <Button
                        variant='ghost'
                        className='mt-[6px]'
                        onClick={() => {
                          setSelectedCredentialId(selectedExistingEnvCredential.id)
                          setShowCreateModal(false)
                          resetCreateForm()
                        }}
                      >
                        Open existing credential
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {createError && (
                <div className='rounded-[8px] border border-[var(--status-red)]/40 bg-[var(--status-red)]/10 px-[10px] py-[8px] text-[12px] text-[var(--status-red)]'>
                  {createError}
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
              onClick={handleCreateCredential}
              disabled={
                (createType === 'oauth'
                  ? !createOAuthProviderId ||
                    !createDisplayName.trim() ||
                    connectOAuthService.isPending
                  : !createEnvKey.trim() || !createEnvValue.trim()) ||
                createCredential.isPending ||
                savePersonalEnvironment.isPending ||
                upsertWorkspaceEnvironment.isPending ||
                disconnectOAuthService.isPending
              }
            >
              {createType === 'oauth'
                ? connectOAuthService.isPending
                  ? 'Connecting...'
                  : 'Connect'
                : selectedExistingEnvCredential
                  ? 'Update and use existing'
                  : 'Create'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
      {showCreateOAuthRequiredModal && createOAuthProviderId && (
        <OAuthRequiredModal
          isOpen={showCreateOAuthRequiredModal}
          onClose={() => setShowCreateOAuthRequiredModal(false)}
          provider={createOAuthProviderId as OAuthProvider}
          toolName={resolveProviderLabel(createOAuthProviderId)}
          requiredScopes={createOAuthRequiredScopes}
          newScopes={createOAuthRequiredScopes}
          serviceId={selectedOAuthService?.id || createOAuthProviderId}
          onConnect={async () => {
            await handleConnectOAuthService()
          }}
        />
      )}
    </div>
  )
}
