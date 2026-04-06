'use client'

import { createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { AlertTriangle, Check, Clipboard, Plus, Search, Share2 } from 'lucide-react'
import { useParams } from 'next/navigation'
import {
  Avatar,
  AvatarFallback,
  Badge,
  Button,
  Combobox,
  Input,
  Label,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Skeleton,
  Textarea,
  Tooltip,
} from '@/components/emcn'
import { Input as UiInput } from '@/components/ui'
import { useSession } from '@/lib/auth/auth-client'
import { cn } from '@/lib/core/utils/cn'
import {
  clearPendingCredentialCreateRequest,
  PENDING_CREDENTIAL_CREATE_REQUEST_EVENT,
  type PendingCredentialCreateRequest,
  readPendingCredentialCreateRequest,
  writeOAuthReturnContext,
} from '@/lib/credentials/client-state'
import { getCanonicalScopesForProvider, getServiceConfigByProviderId } from '@/lib/oauth'
import { getScopeDescription } from '@/lib/oauth/utils'
import { getUserColor } from '@/lib/workspaces/colors'
import { CredentialSkeleton } from '@/app/workspace/[workspaceId]/settings/components/credentials/credential-skeleton'
import {
  useCreateCredentialDraft,
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
  useConnectOAuthService,
  useDisconnectOAuthService,
  useOAuthConnections,
} from '@/hooks/queries/oauth/oauth-connections'
import { useWorkspacePermissionsQuery } from '@/hooks/queries/workspace'
import { useOAuthReturnRouter } from '@/hooks/use-oauth-return'

const logger = createLogger('IntegrationsManager')

const roleOptions = [
  { value: 'member', label: 'Member' },
  { value: 'admin', label: 'Admin' },
] as const

const roleComboOptions = roleOptions.map((option) => ({ value: option.value, label: option.label }))

export function IntegrationsManager() {
  const params = useParams()
  const workspaceId = (params?.workspaceId as string) || ''

  useOAuthReturnRouter()

  const [searchTerm, setSearchTerm] = useState('')
  const [selectedCredentialId, setSelectedCredentialId] = useState<string | null>(null)
  const [memberRole, setMemberRole] = useState<WorkspaceCredentialRole>('admin')
  const [memberUserId, setMemberUserId] = useState('')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createDisplayName, setCreateDisplayName] = useState('')
  const [createDescription, setCreateDescription] = useState('')
  const [createOAuthProviderId, setCreateOAuthProviderId] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)
  const [detailsError, setDetailsError] = useState<string | null>(null)
  const [selectedDescriptionDraft, setSelectedDescriptionDraft] = useState('')
  const [selectedDisplayNameDraft, setSelectedDisplayNameDraft] = useState('')
  const [createStep, setCreateStep] = useState<1 | 2>(1)
  const [serviceSearch, setServiceSearch] = useState('')
  const [copyIdSuccess, setCopyIdSuccess] = useState(false)
  const [credentialToDelete, setCredentialToDelete] = useState<WorkspaceCredential | null>(null)
  const [showDeleteConfirmDialog, setShowDeleteConfirmDialog] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [showUnsavedChangesAlert, setShowUnsavedChangesAlert] = useState(false)
  const pendingReturnOriginRef = useRef<
    | { type: 'workflow'; workflowId: string }
    | { type: 'kb-connectors'; knowledgeBaseId: string }
    | undefined
  >(undefined)
  const [saJsonInput, setSaJsonInput] = useState('')
  const [saDisplayName, setSaDisplayName] = useState('')
  const [saDescription, setSaDescription] = useState('')
  const [saError, setSaError] = useState<string | null>(null)
  const [saIsSubmitting, setSaIsSubmitting] = useState(false)
  const [saDragActive, setSaDragActive] = useState(false)

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

  const { data: workspacePermissions } = useWorkspacePermissionsQuery(workspaceId || null)

  const oauthCredentials = useMemo(
    () => credentials.filter((c) => c.type === 'oauth' || c.type === 'service_account'),
    [credentials]
  )

  const selectedCredential = useMemo(
    () => oauthCredentials.find((credential) => credential.id === selectedCredentialId) || null,
    [oauthCredentials, selectedCredentialId]
  )

  const { data: members = [], isPending: membersLoading } = useWorkspaceCredentialMembers(
    selectedCredential?.id
  )

  const createDraft = useCreateCredentialDraft()
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
    if (!searchTerm.trim()) return oauthCredentials
    const normalized = searchTerm.toLowerCase()
    return oauthCredentials.filter((credential) => {
      return (
        credential.displayName.toLowerCase().includes(normalized) ||
        (credential.description || '').toLowerCase().includes(normalized) ||
        (credential.providerId || '').toLowerCase().includes(normalized) ||
        resolveProviderLabel(credential.providerId).toLowerCase().includes(normalized)
      )
    })
  }, [oauthCredentials, searchTerm, oauthConnections])

  const sortedCredentials = useMemo(() => {
    return [...filteredCredentials].sort((a, b) => {
      const aProvider = a.providerId || ''
      const bProvider = b.providerId || ''
      return aProvider.localeCompare(bProvider)
    })
  }, [filteredCredentials])

  const filteredAvailableIntegrations = useMemo(() => {
    if (!searchTerm.trim()) return oauthConnections
    const normalized = searchTerm.toLowerCase()
    return oauthConnections.filter((service) => service.name.toLowerCase().includes(normalized))
  }, [oauthConnections, searchTerm])

  const oauthServiceOptions = useMemo(
    () =>
      oauthConnections.map((service) => ({
        value: service.providerId,
        label: service.name,
        icon: getServiceConfigByProviderId(service.providerId)?.icon,
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

  const createDisplayScopes = useMemo(
    () =>
      createOAuthRequiredScopes.filter(
        (s) => !s.includes('userinfo.email') && !s.includes('userinfo.profile')
      ),
    [createOAuthRequiredScopes]
  )

  const existingOAuthDisplayName = useMemo(() => {
    const name = createDisplayName.trim()
    if (!name) return null
    return (
      credentials.find(
        (row) => row.type === 'oauth' && row.displayName.toLowerCase() === name.toLowerCase()
      ) ?? null
    )
  }, [credentials, createDisplayName])

  const isDescriptionDirty = useMemo(() => {
    if (!selectedCredential) return false
    return selectedDescriptionDraft !== (selectedCredential.description || '')
  }, [selectedCredential, selectedDescriptionDraft])

  const isDisplayNameDirty = useMemo(() => {
    if (!selectedCredential) return false
    return selectedDisplayNameDraft !== selectedCredential.displayName
  }, [selectedCredential, selectedDisplayNameDraft])

  const isDetailsDirty = isDescriptionDirty || isDisplayNameDirty
  const [isSavingDetails, setIsSavingDetails] = useState(false)

  const handleSaveDetails = async () => {
    if (!selectedCredential || !isSelectedAdmin || !isDetailsDirty) return
    setDetailsError(null)
    setIsSavingDetails(true)

    try {
      if (isDisplayNameDirty || isDescriptionDirty) {
        await updateCredential.mutateAsync({
          credentialId: selectedCredential.id,
          ...(isDisplayNameDirty ? { displayName: selectedDisplayNameDraft.trim() } : {}),
          ...(isDescriptionDirty ? { description: selectedDescriptionDraft.trim() || null } : {}),
        })
        if (isDisplayNameDirty) setSelectedDisplayNameDraft((v) => v.trim())
        if (isDescriptionDirty) setSelectedDescriptionDraft((v) => v.trim())
      }

      await refetchCredentials()
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to save changes'
      setDetailsError(message)
      logger.error('Failed to save credential details', error)
    } finally {
      setIsSavingDetails(false)
    }
  }

  const handleBackAttempt = useCallback(() => {
    if (isDetailsDirty && !isSavingDetails) {
      setShowUnsavedChangesAlert(true)
    } else {
      setSelectedCredentialId(null)
      setSelectedDescriptionDraft('')
      setSelectedDisplayNameDraft('')
    }
  }, [isDetailsDirty, isSavingDetails])

  const handleDiscardChanges = useCallback(() => {
    setShowUnsavedChangesAlert(false)
    setSelectedDescriptionDraft('')
    setSelectedDisplayNameDraft('')
    setSelectedCredentialId(null)
  }, [])

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
    }
    if (selectedCredentialId && isDetailsDirty) {
      window.addEventListener('beforeunload', handler)
    }
    return () => window.removeEventListener('beforeunload', handler)
  }, [selectedCredentialId, isDetailsDirty])

  const applyPendingCredentialCreateRequest = useCallback(
    (request: PendingCredentialCreateRequest) => {
      if (request.workspaceId !== workspaceId) {
        return
      }

      if (Date.now() - request.requestedAt > 15 * 60 * 1000) {
        clearPendingCredentialCreateRequest()
        return
      }

      if (request.type !== 'oauth') return

      pendingReturnOriginRef.current = request.returnOrigin

      setShowCreateModal(true)
      setCreateError(null)
      setCreateDescription('')
      setCreateOAuthProviderId(request.providerId)
      setCreateDisplayName(request.displayName)

      clearPendingCredentialCreateRequest()
    },
    [workspaceId]
  )

  useEffect(() => {
    if (!workspaceId) return
    const request = readPendingCredentialCreateRequest()
    if (!request) return
    applyPendingCredentialCreateRequest(request)
  }, [workspaceId, applyPendingCredentialCreateRequest])

  useEffect(() => {
    if (!workspaceId) return

    const handlePendingCreateRequest = (event: Event) => {
      const request = (event as CustomEvent<PendingCredentialCreateRequest>).detail
      if (!request) return
      applyPendingCredentialCreateRequest(request)
    }

    window.addEventListener(
      PENDING_CREDENTIAL_CREATE_REQUEST_EVENT,
      handlePendingCreateRequest as EventListener
    )

    return () => {
      window.removeEventListener(
        PENDING_CREDENTIAL_CREATE_REQUEST_EVENT,
        handlePendingCreateRequest as EventListener
      )
    }
  }, [workspaceId, applyPendingCredentialCreateRequest])

  const isSelectedAdmin = selectedCredential?.role === 'admin'
  const selectedOAuthServiceConfig = useMemo(() => {
    if (!selectedCredential?.providerId) {
      return null
    }

    return getServiceConfigByProviderId(selectedCredential.providerId)
  }, [selectedCredential])

  const resetCreateForm = () => {
    setCreateDisplayName('')
    setCreateDescription('')
    setCreateOAuthProviderId('')
    setCreateError(null)
    setCreateStep(1)
    setServiceSearch('')
    setSaJsonInput('')
    setSaDisplayName('')
    setSaDescription('')
    setSaError(null)
    pendingReturnOriginRef.current = undefined
  }

  const handleSelectCredential = (credential: WorkspaceCredential) => {
    setSelectedCredentialId(credential.id)
    setDetailsError(null)
    setSelectedDescriptionDraft(credential.description || '')
    setSelectedDisplayNameDraft(credential.displayName)
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
      await createDraft.mutateAsync({
        workspaceId,
        providerId: selectedOAuthService.providerId,
        displayName,
        description: createDescription.trim() || undefined,
      })

      const oauthPreCount = credentials.filter(
        (c) => c.type === 'oauth' && c.providerId === selectedOAuthService.providerId
      ).length
      const returnOrigin = pendingReturnOriginRef.current
      pendingReturnOriginRef.current = undefined

      if (returnOrigin?.type === 'workflow') {
        writeOAuthReturnContext({
          origin: 'workflow',
          workflowId: returnOrigin.workflowId,
          displayName,
          providerId: selectedOAuthService.providerId,
          preCount: oauthPreCount,
          workspaceId,
          requestedAt: Date.now(),
        })
      } else if (returnOrigin?.type === 'kb-connectors') {
        writeOAuthReturnContext({
          origin: 'kb-connectors',
          knowledgeBaseId: returnOrigin.knowledgeBaseId,
          displayName,
          providerId: selectedOAuthService.providerId,
          preCount: oauthPreCount,
          workspaceId,
          requestedAt: Date.now(),
        })
      } else {
        writeOAuthReturnContext({
          origin: 'integrations',
          displayName,
          providerId: selectedOAuthService.providerId,
          preCount: oauthPreCount,
          workspaceId,
          requestedAt: Date.now(),
        })
      }

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

  const handleDeleteClick = (credential: WorkspaceCredential) => {
    setCredentialToDelete(credential)
    setDeleteError(null)
    setShowDeleteConfirmDialog(true)
  }

  const handleConfirmDelete = async () => {
    if (!credentialToDelete) return
    setDeleteError(null)

    try {
      if (credentialToDelete.type === 'service_account') {
        await deleteCredential.mutateAsync(credentialToDelete.id)
        await refetchCredentials()
      } else {
        if (!credentialToDelete.accountId || !credentialToDelete.providerId) {
          const errorMessage =
            'Cannot disconnect: missing account information. Please try reconnecting this credential first.'
          setDeleteError(errorMessage)
          logger.error('Cannot disconnect OAuth credential: missing accountId or providerId')
          return
        }
        await disconnectOAuthService.mutateAsync({
          provider: credentialToDelete.providerId.split('-')[0] || credentialToDelete.providerId,
          providerId: credentialToDelete.providerId,
          serviceId: credentialToDelete.providerId,
          accountId: credentialToDelete.accountId,
        })
        await refetchCredentials()
        window.dispatchEvent(
          new CustomEvent('oauth-credentials-updated', {
            detail: { providerId: credentialToDelete.providerId, workspaceId },
          })
        )
      }

      if (selectedCredentialId === credentialToDelete.id) {
        setSelectedCredentialId(null)
        setSelectedDescriptionDraft('')
        setSelectedDisplayNameDraft('')
      }
      setShowDeleteConfirmDialog(false)
      setCredentialToDelete(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to disconnect integration'
      setDeleteError(message)
      logger.error('Failed to disconnect integration', error)
    }
  }

  const [isShareingWithWorkspace, setIsSharingWithWorkspace] = useState(false)

  const handleShareWithWorkspace = async () => {
    if (!selectedCredential || !isSelectedAdmin) return
    const usersToAdd = workspaceUserOptions
    if (usersToAdd.length === 0) return

    setDetailsError(null)
    setIsSharingWithWorkspace(true)

    try {
      for (const user of usersToAdd) {
        await upsertMember.mutateAsync({
          credentialId: selectedCredential.id,
          userId: user.value,
          role: 'member',
        })
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to share with workspace'
      setDetailsError(message)
      logger.error('Failed to share credential with workspace', error)
    } finally {
      setIsSharingWithWorkspace(false)
    }
  }

  const handleReconnectOAuth = async () => {
    if (
      !selectedCredential ||
      selectedCredential.type !== 'oauth' ||
      !selectedCredential.providerId ||
      !workspaceId
    )
      return

    setDetailsError(null)

    try {
      await createDraft.mutateAsync({
        workspaceId,
        providerId: selectedCredential.providerId,
        displayName: selectedCredential.displayName,
        description: selectedCredential.description || undefined,
        credentialId: selectedCredential.id,
      })

      const oauthPreCount = credentials.filter(
        (c) => c.type === 'oauth' && c.providerId === selectedCredential.providerId
      ).length
      writeOAuthReturnContext({
        origin: 'integrations',
        displayName: selectedCredential.displayName,
        providerId: selectedCredential.providerId,
        preCount: oauthPreCount,
        workspaceId,
        reconnect: true,
        requestedAt: Date.now(),
      })

      await connectOAuthService.mutateAsync({
        providerId: selectedCredential.providerId,
        callbackURL: window.location.href,
      })
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to start reconnect'
      setDetailsError(message)
      logger.error('Failed to reconnect OAuth credential', error)
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
      setMemberRole('admin')
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

  const hasCredentials = oauthCredentials && oauthCredentials.length > 0

  const connectedProviderIds = useMemo(
    () => new Set(oauthCredentials.map((c) => c.providerId).filter(Boolean) as string[]),
    [oauthCredentials]
  )

  const showNoResults =
    searchTerm.trim() &&
    sortedCredentials.length === 0 &&
    filteredAvailableIntegrations.length === 0

  const handleAddForProvider = useCallback((providerId: string) => {
    setCreateOAuthProviderId(providerId)
    setCreateStep(2)
    setCreateDisplayName('')
    setCreateDescription('')
    setCreateError(null)
    setShowCreateModal(true)
  }, [])

  const validateServiceAccountJson = (raw: string): { valid: boolean; error?: string } => {
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(raw)
    } catch {
      return { valid: false, error: 'Invalid JSON. Paste the full service account key file.' }
    }
    if (parsed.type !== 'service_account') {
      return { valid: false, error: 'JSON key must have "type": "service_account".' }
    }
    if (!parsed.client_email || typeof parsed.client_email !== 'string') {
      return { valid: false, error: 'Missing "client_email" field.' }
    }
    if (!parsed.private_key || typeof parsed.private_key !== 'string') {
      return { valid: false, error: 'Missing "private_key" field.' }
    }
    if (!parsed.project_id || typeof parsed.project_id !== 'string') {
      return { valid: false, error: 'Missing "project_id" field.' }
    }
    return { valid: true }
  }

  const handleCreateServiceAccount = async () => {
    setSaError(null)
    const trimmed = saJsonInput.trim()
    if (!trimmed) {
      setSaError('Paste the service account JSON key.')
      return
    }
    const validation = validateServiceAccountJson(trimmed)
    if (!validation.valid) {
      setSaError(validation.error ?? 'Invalid JSON')
      return
    }
    setSaIsSubmitting(true)
    try {
      await createCredential.mutateAsync({
        workspaceId,
        type: 'service_account',
        displayName: saDisplayName.trim() || undefined,
        description: saDescription.trim() || undefined,
        serviceAccountJson: trimmed,
      })
      setShowCreateModal(false)
      resetCreateForm()
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to add service account'
      setSaError(message)
      logger.error('Failed to create service account credential', error)
    } finally {
      setSaIsSubmitting(false)
    }
  }

  const readSaJsonFile = useCallback(
    (file: File) => {
      if (!file.name.endsWith('.json')) {
        setSaError('Only .json files are supported')
        return
      }
      const reader = new FileReader()
      reader.onload = (e) => {
        const text = e.target?.result
        if (typeof text === 'string') {
          setSaJsonInput(text)
          setSaError(null)
          try {
            const parsed = JSON.parse(text)
            if (parsed.client_email && !saDisplayName.trim()) {
              setSaDisplayName(parsed.client_email)
            }
          } catch {
            // validation will catch this on submit
          }
        }
      }
      reader.readAsText(file)
    },
    [saDisplayName]
  )

  const handleSaFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    readSaJsonFile(file)
    event.target.value = ''
  }

  const handleSaDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    setSaDragActive(true)
  }, [])

  const handleSaDragLeave = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    setSaDragActive(false)
  }, [])

  const handleSaDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()
      event.stopPropagation()
      setSaDragActive(false)
      const file = event.dataTransfer.files[0]
      if (file) readSaJsonFile(file)
    },
    [readSaJsonFile]
  )

  const filteredServices = useMemo(() => {
    if (!serviceSearch.trim()) return oauthServiceOptions
    const q = serviceSearch.toLowerCase()
    return oauthServiceOptions.filter((s) => s.label.toLowerCase().includes(q))
  }, [oauthServiceOptions, serviceSearch])

  const createModalJsx = (
    <Modal
      open={showCreateModal}
      onOpenChange={(open) => {
        setShowCreateModal(open)
        if (!open) resetCreateForm()
      }}
    >
      <ModalContent size='md'>
        {createStep === 1 ? (
          <>
            <ModalHeader>Connect Integration</ModalHeader>
            <ModalBody>
              <div className='flex flex-col gap-3'>
                <div className='flex items-center gap-2 rounded-[8px] border border-[var(--border)] bg-transparent px-2 py-[5px]'>
                  <Search
                    className='h-[14px] w-[14px] flex-shrink-0 text-[var(--text-tertiary)]'
                    strokeWidth={2}
                  />
                  <UiInput
                    placeholder='Search services...'
                    value={serviceSearch}
                    onChange={(e) => setServiceSearch(e.target.value)}
                    className='h-auto flex-1 border-0 bg-transparent p-0 font-base leading-none placeholder:text-[var(--text-tertiary)] focus-visible:ring-0 focus-visible:ring-offset-0'
                    autoFocus
                  />
                </div>
                <div className='flex max-h-[320px] flex-col overflow-y-auto'>
                  {filteredServices.map((service) => {
                    const config = getServiceConfigByProviderId(service.value)
                    return (
                      <button
                        key={service.value}
                        type='button'
                        onClick={() => {
                          setCreateOAuthProviderId(service.value)
                          setCreateStep(2)
                          setServiceSearch('')
                        }}
                        className='flex items-center gap-2.5 rounded-[6px] px-2 py-2 text-left hover:bg-[var(--surface-5)]'
                      >
                        <div className='flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[6px] bg-[var(--surface-5)]'>
                          {config ? (
                            createElement(config.icon, { className: 'h-4 w-4' })
                          ) : (
                            <span className='font-medium text-[11px] text-[var(--text-tertiary)]'>
                              {service.label.slice(0, 2)}
                            </span>
                          )}
                        </div>
                        <span className='font-medium text-[15px] text-[var(--text-primary)]'>
                          {service.label}
                        </span>
                      </button>
                    )
                  })}
                  {filteredServices.length === 0 && (
                    <div className='py-6 text-center text-[13px] text-[var(--text-muted)]'>
                      No services found
                    </div>
                  )}
                </div>
              </div>
            </ModalBody>
            <ModalFooter>
              <Button variant='default' onClick={() => setShowCreateModal(false)}>
                Cancel
              </Button>
            </ModalFooter>
          </>
        ) : selectedOAuthService?.authType !== 'service_account' ? (
          <>
            <ModalHeader>
              <div className='flex items-center gap-2.5'>
                <button
                  type='button'
                  onClick={() => {
                    setCreateStep(1)
                    setCreateError(null)
                  }}
                  className='flex h-6 w-6 items-center justify-center rounded-[4px] text-[var(--text-muted)] hover:bg-[var(--surface-5)] hover:text-[var(--text-primary)]'
                  aria-label='Back'
                >
                  ←
                </button>
                <span>
                  Connect{' '}
                  {selectedOAuthService?.name || resolveProviderLabel(createOAuthProviderId)}
                </span>
              </div>
            </ModalHeader>
            <ModalBody>
              {(createError || existingOAuthDisplayName) && (
                <div className='mb-3 flex flex-col gap-2'>
                  {createError && (
                    <Badge variant='red' size='lg' dot className='max-w-full'>
                      {createError}
                    </Badge>
                  )}
                  {existingOAuthDisplayName && (
                    <Badge variant='red' size='lg' dot className='max-w-full'>
                      An integration named "{existingOAuthDisplayName.displayName}" already exists.
                    </Badge>
                  )}
                </div>
              )}
              <div className='flex flex-col gap-4'>
                <div className='flex items-center gap-3'>
                  <div className='flex h-[40px] w-[40px] flex-shrink-0 items-center justify-center rounded-[8px] bg-[var(--surface-5)]'>
                    {selectedOAuthService &&
                      createElement(selectedOAuthService.icon, { className: 'h-[18px] w-[18px]' })}
                  </div>
                  <div>
                    <p className='font-medium text-[13px] text-[var(--text-primary)]'>
                      Connect your {selectedOAuthService?.name} account
                    </p>
                    <p className='text-[12px] text-[var(--text-tertiary)]'>
                      Grant access to use {selectedOAuthService?.name} in your workflows
                    </p>
                  </div>
                </div>

                {createDisplayScopes.length > 0 && (
                  <div className='rounded-[8px] border border-[var(--border-1)] bg-[var(--surface-5)]'>
                    <div className='border-[var(--border-1)] border-b px-3.5 py-2.5'>
                      <h4 className='font-medium text-[12px] text-[var(--text-primary)]'>
                        Permissions requested
                      </h4>
                    </div>
                    <ul className='max-h-[200px] space-y-2.5 overflow-y-auto px-3.5 py-3'>
                      {createDisplayScopes.map((scope) => (
                        <li key={scope} className='flex items-start gap-2.5'>
                          <div className='mt-0.5 flex h-[16px] w-[16px] flex-shrink-0 items-center justify-center'>
                            <Check className='h-[10px] w-[10px] text-[var(--text-primary)]' />
                          </div>
                          <span className='text-[12px] text-[var(--text-primary)]'>
                            {getScopeDescription(scope)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div>
                  <Label>
                    Display name<span className='ml-1'>*</span>
                  </Label>
                  <Input
                    value={createDisplayName}
                    onChange={(event) => setCreateDisplayName(event.target.value)}
                    placeholder='Integration name'
                    autoComplete='off'
                    data-lpignore='true'
                    className='mt-1.5'
                    autoFocus
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
                    data-lpignore='true'
                    className='mt-1.5 min-h-[80px] resize-none'
                  />
                </div>
              </div>
            </ModalBody>
            <ModalFooter>
              <Button
                variant='default'
                onClick={() => {
                  setCreateStep(1)
                  setCreateError(null)
                }}
              >
                Back
              </Button>
              <Button
                variant='primary'
                onClick={handleConnectOAuthService}
                disabled={
                  !createOAuthProviderId ||
                  !createDisplayName.trim() ||
                  connectOAuthService.isPending ||
                  Boolean(existingOAuthDisplayName) ||
                  disconnectOAuthService.isPending
                }
              >
                {connectOAuthService.isPending ? 'Connecting...' : 'Connect'}
              </Button>
            </ModalFooter>
          </>
        ) : (
          <>
            <ModalHeader>
              <div className='flex items-center gap-2.5'>
                <button
                  type='button'
                  onClick={() => {
                    setCreateStep(1)
                    setSaError(null)
                  }}
                  className='flex h-6 w-6 items-center justify-center rounded-[4px] text-[var(--text-muted)] hover:bg-[var(--surface-5)] hover:text-[var(--text-primary)]'
                  aria-label='Back'
                >
                  ←
                </button>
                <span>
                  Add {selectedOAuthService?.name || resolveProviderLabel(createOAuthProviderId)}
                </span>
              </div>
            </ModalHeader>
            <ModalBody>
              {saError && (
                <div className='mb-3'>
                  <Badge variant='red' size='lg' dot className='max-w-full'>
                    {saError}
                  </Badge>
                </div>
              )}
              <div className='flex flex-col gap-4'>
                <div className='flex items-center gap-3'>
                  <div className='flex h-[40px] w-[40px] flex-shrink-0 items-center justify-center rounded-[8px] bg-[var(--surface-5)]'>
                    {selectedOAuthService &&
                      createElement(selectedOAuthService.icon, { className: 'h-[18px] w-[18px]' })}
                  </div>
                  <div>
                    <p className='font-medium text-[13px] text-[var(--text-primary)]'>
                      Add {selectedOAuthService?.name || 'service account'}
                    </p>
                    <p className='text-[12px] text-[var(--text-tertiary)]'>
                      {selectedOAuthService?.description || 'Paste or upload the JSON key file'}
                    </p>
                    <a
                      href='https://docs.sim.ai/credentials/google-service-account'
                      target='_blank'
                      rel='noopener noreferrer'
                      className='text-[12px] text-[var(--accent)] hover:underline'
                    >
                      View setup guide
                    </a>
                  </div>
                </div>

                <div>
                  <Label>
                    JSON Key<span className='ml-1'>*</span>
                  </Label>
                  <div
                    onDragOver={handleSaDragOver}
                    onDragLeave={handleSaDragLeave}
                    onDrop={handleSaDrop}
                    className={cn(
                      'relative mt-1.5 rounded-md border-2 border-dashed transition-colors',
                      saDragActive
                        ? 'border-[var(--accent)] bg-[var(--accent)]/5'
                        : 'border-transparent'
                    )}
                  >
                    {saDragActive && (
                      <div className='pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-md bg-[var(--accent)]/5'>
                        <p className='font-medium text-[13px] text-[var(--accent)]'>
                          Drop JSON key file here
                        </p>
                      </div>
                    )}
                    <Textarea
                      value={saJsonInput}
                      onChange={(event) => {
                        setSaJsonInput(event.target.value)
                        setSaError(null)
                        if (!saDisplayName.trim()) {
                          try {
                            const parsed = JSON.parse(event.target.value)
                            if (parsed.client_email) setSaDisplayName(parsed.client_email)
                          } catch {
                            // not valid yet
                          }
                        }
                      }}
                      placeholder='Paste your service account JSON key here or drag & drop a .json file...'
                      autoComplete='off'
                      data-lpignore='true'
                      className={cn(
                        'min-h-[120px] resize-none border-0 font-mono text-[12px]',
                        saDragActive && 'opacity-30'
                      )}
                      autoFocus
                    />
                  </div>
                  <div className='mt-1.5'>
                    <label className='inline-flex cursor-pointer items-center gap-1.5 text-[12px] text-[var(--text-muted)] hover:text-[var(--text-secondary)]'>
                      <input
                        type='file'
                        accept='.json'
                        onChange={handleSaFileUpload}
                        className='hidden'
                      />
                      Or upload a .json file
                    </label>
                  </div>
                </div>
                <div>
                  <Label>Display name</Label>
                  <Input
                    value={saDisplayName}
                    onChange={(event) => setSaDisplayName(event.target.value)}
                    placeholder='Auto-populated from client_email'
                    autoComplete='off'
                    data-lpignore='true'
                    className='mt-1.5'
                  />
                </div>
                <div>
                  <Label>Description</Label>
                  <Textarea
                    value={saDescription}
                    onChange={(event) => setSaDescription(event.target.value)}
                    placeholder='Optional description'
                    maxLength={500}
                    autoComplete='off'
                    data-lpignore='true'
                    className='mt-1.5 min-h-[80px] resize-none'
                  />
                </div>
              </div>
            </ModalBody>
            <ModalFooter>
              <Button
                variant='default'
                onClick={() => {
                  setCreateStep(1)
                  setSaError(null)
                }}
              >
                Back
              </Button>
              <Button
                variant='primary'
                onClick={handleCreateServiceAccount}
                disabled={!saJsonInput.trim() || saIsSubmitting}
              >
                {saIsSubmitting ? 'Adding...' : 'Add Service Account'}
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  )

  const handleCloseDeleteDialog = () => {
    setShowDeleteConfirmDialog(false)
    setCredentialToDelete(null)
    setDeleteError(null)
  }

  const deleteConfirmDialogJsx = (
    <Modal
      open={showDeleteConfirmDialog}
      onOpenChange={(open) => !open && handleCloseDeleteDialog()}
    >
      <ModalContent size='sm'>
        <ModalHeader>Disconnect Integration</ModalHeader>
        <ModalBody>
          <p className='text-[var(--text-secondary)]'>
            Are you sure you want to disconnect{' '}
            <span className='font-medium text-[var(--text-primary)]'>
              {credentialToDelete?.displayName}
            </span>
            ? <span className='text-[var(--text-error)]'>This action cannot be undone.</span>
          </p>
          {deleteError && (
            <div className='mt-3 rounded-lg border border-red-500/50 bg-red-50 p-3 dark:bg-red-950/30'>
              <div className='flex items-start gap-2.5'>
                <AlertTriangle className='mt-[1px] h-4 w-4 flex-shrink-0 text-red-600 dark:text-red-400' />
                <p className='text-red-700 text-small dark:text-red-300'>{deleteError}</p>
              </div>
            </div>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant='default' onClick={handleCloseDeleteDialog}>
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
  )

  const unsavedChangesAlertJsx = (
    <Modal open={showUnsavedChangesAlert} onOpenChange={setShowUnsavedChangesAlert}>
      <ModalContent size='sm'>
        <ModalHeader>Unsaved Changes</ModalHeader>
        <ModalBody>
          <p className='text-[var(--text-secondary)]'>
            You have unsaved changes. Are you sure you want to discard them?
          </p>
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
  )

  if (selectedCredential) {
    return (
      <>
        <div className='flex h-full flex-col gap-4.5'>
          <div className='min-h-0 flex-1 overflow-y-auto'>
            <div className='flex flex-col gap-4.5'>
              <div className='flex items-center gap-2.5 border-[var(--border)] border-b pb-3'>
                <div className='flex h-9 w-9 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[var(--surface-5)]'>
                  {selectedOAuthServiceConfig ? (
                    createElement(selectedOAuthServiceConfig.icon, {
                      className: 'h-[18px] w-[18px]',
                    })
                  ) : (
                    <span className='font-medium text-[var(--text-tertiary)] text-small'>
                      {resolveProviderLabel(selectedCredential.providerId).slice(0, 1)}
                    </span>
                  )}
                </div>
                <div className='min-w-0 flex-1'>
                  <div className='flex items-center gap-2'>
                    <p className='truncate font-medium text-[var(--text-primary)] text-base'>
                      {selectedOAuthServiceConfig?.name ||
                        resolveProviderLabel(selectedCredential.providerId) ||
                        'Unknown service'}
                    </p>
                    <Badge variant='gray-secondary' size='sm'>
                      {selectedOAuthServiceConfig?.authType === 'service_account'
                        ? 'service account'
                        : 'oauth'}
                    </Badge>
                    {selectedCredential.role && (
                      <Badge variant='gray-secondary' size='sm'>
                        {selectedCredential.role}
                      </Badge>
                    )}
                  </div>
                  <p className='text-[var(--text-muted)] text-small'>
                    {selectedOAuthServiceConfig?.description || 'Connected service'}
                  </p>
                </div>
              </div>

              <div className='flex flex-col gap-1.5'>
                <Label className='flex items-center gap-1.5'>
                  Display Name
                  <Tooltip.Root>
                    <Tooltip.Trigger asChild>
                      <button
                        type='button'
                        className='-my-1 flex h-5 w-5 items-center justify-center'
                        onClick={() => {
                          navigator.clipboard.writeText(selectedCredential.id)
                          setCopyIdSuccess(true)
                          setTimeout(() => setCopyIdSuccess(false), 2000)
                        }}
                        aria-label='Copy value'
                      >
                        {copyIdSuccess ? (
                          <Check className='h-3 w-3 text-green-500' />
                        ) : (
                          <Clipboard className='h-3 w-3 text-[var(--text-icon)]' />
                        )}
                      </button>
                    </Tooltip.Trigger>
                    <Tooltip.Content>
                      {copyIdSuccess ? 'Copied!' : 'Copy credential ID'}
                    </Tooltip.Content>
                  </Tooltip.Root>
                </Label>
                <Input
                  id='credential-display-name'
                  value={selectedDisplayNameDraft}
                  onChange={(event) => setSelectedDisplayNameDraft(event.target.value)}
                  autoComplete='off'
                  data-lpignore='true'
                  disabled={!isSelectedAdmin}
                />
              </div>

              <div className='flex flex-col gap-1.5'>
                <Label>Description</Label>
                <Textarea
                  id='credential-description'
                  value={selectedDescriptionDraft}
                  onChange={(event) => setSelectedDescriptionDraft(event.target.value)}
                  placeholder='Add a description...'
                  maxLength={500}
                  autoComplete='off'
                  data-lpignore='true'
                  disabled={!isSelectedAdmin}
                  className='min-h-[60px] resize-none'
                />
              </div>

              {detailsError && (
                <div className='rounded-lg border border-[color-mix(in_srgb,var(--status-red)_40%,transparent)] bg-[color-mix(in_srgb,var(--status-red)_10%,transparent)] px-2.5 py-2 text-[var(--status-red)] text-small'>
                  {detailsError}
                </div>
              )}

              <div className='flex flex-col gap-1.5 border-[var(--border)] border-t pt-4'>
                <Label>Members ({activeMembers.length})</Label>

                {membersLoading ? (
                  <div className='flex flex-col gap-2'>
                    <Skeleton className='h-[44px] w-full rounded-lg' />
                    <Skeleton className='h-[44px] w-full rounded-lg' />
                  </div>
                ) : (
                  <div className='flex flex-col gap-2'>
                    {activeMembers.map((member) => (
                      <div
                        key={member.id}
                        className='grid grid-cols-[1fr_120px_72px] items-center gap-2'
                      >
                        <div className='flex min-w-0 items-center gap-2.5'>
                          <Avatar className='h-8 w-8 flex-shrink-0'>
                            <AvatarFallback
                              style={{
                                background: getUserColor(member.userId || member.userEmail || ''),
                              }}
                              className='border-0 text-small text-white'
                            >
                              {(member.userName || member.userEmail || '?').charAt(0).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <div className='min-w-0'>
                            <p className='truncate font-medium text-[var(--text-primary)] text-sm'>
                              {member.userName || member.userEmail || member.userId}
                            </p>
                            <p className='truncate text-[var(--text-tertiary)] text-caption'>
                              {member.userEmail || member.userId}
                            </p>
                          </div>
                        </div>

                        <Combobox
                          options={roleComboOptions}
                          value={
                            roleOptions.find((option) => option.value === member.role)?.label || ''
                          }
                          selectedValue={member.role}
                          onChange={(value) =>
                            handleChangeMemberRole(member.userId, value as WorkspaceCredentialRole)
                          }
                          placeholder='Role'
                          disabled={
                            !isSelectedAdmin || (member.role === 'admin' && adminMemberCount <= 1)
                          }
                          size='sm'
                        />
                        {isSelectedAdmin ? (
                          <Button
                            variant='ghost'
                            onClick={() => handleRemoveMember(member.userId)}
                            disabled={member.role === 'admin' && adminMemberCount <= 1}
                            className='w-full justify-end'
                          >
                            Remove
                          </Button>
                        ) : (
                          <div />
                        )}
                      </div>
                    ))}
                    {isSelectedAdmin && (
                      <div className='grid grid-cols-[1fr_120px_72px] items-center gap-2 border-[var(--border)] border-t pt-2'>
                        <Combobox
                          options={workspaceUserOptions}
                          value={
                            workspaceUserOptions.find((option) => option.value === memberUserId)
                              ?.label || ''
                          }
                          selectedValue={memberUserId}
                          onChange={setMemberUserId}
                          placeholder='Add member...'
                          searchable
                          searchPlaceholder='Search members...'
                          size='sm'
                        />
                        <Combobox
                          options={roleComboOptions}
                          value={
                            roleOptions.find((option) => option.value === memberRole)?.label || ''
                          }
                          selectedValue={memberRole}
                          onChange={(value) => setMemberRole(value as WorkspaceCredentialRole)}
                          placeholder='Role'
                          size='sm'
                        />
                        <Button
                          variant='ghost'
                          onClick={handleAddMember}
                          disabled={!memberUserId || upsertMember.isPending}
                          className='w-full justify-end'
                        >
                          Add
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className='mt-auto flex items-center justify-between border-[var(--border)] border-t pt-2.5'>
            <div className='flex items-center gap-2'>
              {isSelectedAdmin && (
                <>
                  {selectedOAuthServiceConfig?.authType !== 'service_account' && (
                    <Button
                      variant='default'
                      onClick={handleReconnectOAuth}
                      disabled={connectOAuthService.isPending}
                    >
                      {`Reconnect to ${
                        resolveProviderLabel(selectedCredential.providerId) || 'service'
                      }`}
                    </Button>
                  )}
                  {(workspaceUserOptions.length > 0 || isShareingWithWorkspace) && (
                    <Button
                      variant='default'
                      onClick={handleShareWithWorkspace}
                      disabled={isShareingWithWorkspace || workspaceUserOptions.length === 0}
                    >
                      <Share2 className='mr-1.5 h-[13px] w-[13px]' />
                      {isShareingWithWorkspace ? 'Sharing...' : 'Share'}
                    </Button>
                  )}
                  <Button
                    variant='ghost'
                    onClick={() => handleDeleteClick(selectedCredential)}
                    disabled={disconnectOAuthService.isPending || deleteCredential.isPending}
                  >
                    Disconnect
                  </Button>
                </>
              )}
            </div>
            <div className='flex items-center gap-2'>
              <Button onClick={handleBackAttempt} variant='default'>
                Back
              </Button>
              {isSelectedAdmin && (
                <Button
                  variant='primary'
                  onClick={handleSaveDetails}
                  disabled={!isDetailsDirty || isSavingDetails}
                >
                  {isSavingDetails ? 'Saving...' : 'Save'}
                </Button>
              )}
            </div>
          </div>
        </div>

        {createModalJsx}
        {deleteConfirmDialogJsx}
        {unsavedChangesAlertJsx}
      </>
    )
  }

  return (
    <>
      <div className='flex h-full flex-col gap-4.5'>
        <div className='flex items-center gap-2'>
          <div className='flex flex-1 items-center gap-2 rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 transition-colors duration-100 dark:bg-[var(--surface-4)] dark:hover-hover:border-[var(--border-1)] dark:hover-hover:bg-[var(--surface-5)]'>
            <Search
              className='h-[14px] w-[14px] flex-shrink-0 text-[var(--text-tertiary)]'
              strokeWidth={2}
            />
            <UiInput
              placeholder='Search integrations...'
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              disabled={credentialsLoading}
              className='h-auto flex-1 border-0 bg-transparent p-0 font-base leading-none placeholder:text-[var(--text-tertiary)] focus-visible:ring-0 focus-visible:ring-offset-0'
            />
          </div>
          <Button
            onClick={() => setShowCreateModal(true)}
            disabled={credentialsLoading}
            variant='primary'
          >
            <Plus className='mr-1.5 h-[13px] w-[13px]' />
            Connect
          </Button>
        </div>

        <div className='min-h-0 flex-1 overflow-y-auto'>
          {credentialsLoading ? (
            <div className='flex flex-col gap-2'>
              <CredentialSkeleton />
              <CredentialSkeleton />
              <CredentialSkeleton />
            </div>
          ) : (
            <div className='flex flex-col gap-2'>
              {sortedCredentials.map((credential) => {
                const serviceConfig = credential.providerId
                  ? getServiceConfigByProviderId(credential.providerId)
                  : null
                return (
                  <div key={credential.id} className='flex items-center justify-between gap-3'>
                    <div className='flex min-w-0 items-center gap-2.5'>
                      {serviceConfig && (
                        <div className='flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-[var(--surface-5)]'>
                          {createElement(serviceConfig.icon, { className: 'h-4 w-4' })}
                        </div>
                      )}
                      <div className='flex min-w-0 flex-col justify-center gap-[1px]'>
                        <span className='truncate font-medium text-base'>
                          {credential.displayName}
                        </span>
                        <p className='truncate text-[var(--text-muted)] text-sm'>
                          {credential.description || resolveProviderLabel(credential.providerId)}
                        </p>
                      </div>
                    </div>
                    <div className='flex flex-shrink-0 items-center gap-1'>
                      <Button variant='default' onClick={() => handleSelectCredential(credential)}>
                        Details
                      </Button>
                      {credential.role === 'admin' && (
                        <Button
                          variant='ghost'
                          onClick={() => handleDeleteClick(credential)}
                          disabled={
                            credential.type === 'service_account'
                              ? deleteCredential.isPending
                              : disconnectOAuthService.isPending
                          }
                        >
                          Disconnect
                        </Button>
                      )}
                    </div>
                  </div>
                )
              })}

              {showNoResults && (
                <div className='py-4 text-center text-[var(--text-muted)] text-sm'>
                  No integrations found matching &ldquo;{searchTerm}&rdquo;
                </div>
              )}

              {filteredAvailableIntegrations.length > 0 && (
                <div
                  className={`flex flex-col gap-2${hasCredentials || showNoResults ? ' mt-2 border-[var(--border)] border-t pt-4' : ''}`}
                >
                  <p className='mb-1 font-medium text-[12px] text-[var(--text-muted)]'>
                    Available integrations
                  </p>
                  {filteredAvailableIntegrations.map((service) => {
                    const serviceConfig = getServiceConfigByProviderId(service.providerId)
                    const isConnected = connectedProviderIds.has(service.providerId)
                    return (
                      <div
                        key={service.providerId}
                        className='flex items-center justify-between gap-3'
                      >
                        <div className='flex min-w-0 items-center gap-2.5'>
                          {serviceConfig && (
                            <div className='flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[6px] bg-[var(--surface-5)]'>
                              {createElement(serviceConfig.icon, { className: 'h-4 w-4' })}
                            </div>
                          )}
                          <span className='truncate font-medium text-[15px]'>{service.name}</span>
                        </div>
                        <Button
                          variant='default'
                          onClick={() => handleAddForProvider(service.providerId)}
                        >
                          {isConnected ? 'Add account' : 'Connect'}
                        </Button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {createModalJsx}
      {deleteConfirmDialogJsx}
    </>
  )
}
