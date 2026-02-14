'use client'

import { createElement, useEffect, useMemo, useState } from 'react'
import { createLogger } from '@sim/logger'
import { AlertTriangle, Check, Copy, Plus, RefreshCw, Search, Share2, Trash2 } from 'lucide-react'
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
  Tooltip,
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
type SecretInputMode = 'single' | 'bulk'

const createTypeOptions = [
  { value: 'oauth', label: 'OAuth Account' },
  { value: 'secret', label: 'Secret' },
] as const

interface ParsedEnvEntry {
  key: string
  value: string
}

/**
 * Parses `.env`-style text into key-value pairs.
 * Supports `KEY=VALUE`, quoted values, comments (#), and blank lines.
 */
function parseEnvText(text: string): { entries: ParsedEnvEntry[]; errors: string[] } {
  const entries: ParsedEnvEntry[] = []
  const errors: string[] = []
  const seenKeys = new Set<string>()

  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim()
    if (!raw || raw.startsWith('#')) continue

    const eqIndex = raw.indexOf('=')
    if (eqIndex === -1) {
      errors.push(`Line ${i + 1}: missing "=" separator`)
      continue
    }

    const key = raw.slice(0, eqIndex).trim()
    let value = raw.slice(eqIndex + 1).trim()

    if (!key) {
      errors.push(`Line ${i + 1}: empty key`)
      continue
    }

    if (!isValidEnvVarName(key)) {
      errors.push(`Line ${i + 1}: "${key}" must contain only letters, numbers, and underscores`)
      continue
    }

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    if (!value) {
      errors.push(`Line ${i + 1}: "${key}" has an empty value`)
      continue
    }

    if (seenKeys.has(key.toUpperCase())) {
      errors.push(`Line ${i + 1}: duplicate key "${key}"`)
      continue
    }

    seenKeys.add(key.toUpperCase())
    entries.push({ key, value })
  }

  return { entries, errors }
}

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
  const [memberRole, setMemberRole] = useState<WorkspaceCredentialRole>('admin')
  const [memberUserId, setMemberUserId] = useState('')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createType, setCreateType] = useState<CreateCredentialType>('oauth')
  const [createSecretScope, setCreateSecretScope] = useState<SecretScope>('workspace')
  const [createDisplayName, setCreateDisplayName] = useState('')
  const [createDescription, setCreateDescription] = useState('')
  const [createEnvKey, setCreateEnvKey] = useState('')
  const [createEnvValue, setCreateEnvValue] = useState('')
  const [createOAuthProviderId, setCreateOAuthProviderId] = useState('')
  const [createSecretInputMode, setCreateSecretInputMode] = useState<SecretInputMode>('single')
  const [createBulkText, setCreateBulkText] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)
  const [detailsError, setDetailsError] = useState<string | null>(null)
  const [selectedEnvValueDraft, setSelectedEnvValueDraft] = useState('')
  const [isEditingEnvValue, setIsEditingEnvValue] = useState(false)
  const [selectedDescriptionDraft, setSelectedDescriptionDraft] = useState('')
  const [selectedDisplayNameDraft, setSelectedDisplayNameDraft] = useState('')
  const [showCreateOAuthRequiredModal, setShowCreateOAuthRequiredModal] = useState(false)
  const [copyIdSuccess, setCopyIdSuccess] = useState(false)
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
    if (createType !== 'secret' || createSecretInputMode !== 'single') return null
    const envKey = normalizeEnvKeyInput(createEnvKey)
    if (!envKey) return null
    return (
      credentials.find(
        (row) =>
          row.type === createSecretType && (row.envKey || '').toLowerCase() === envKey.toLowerCase()
      ) ?? null
    )
  }, [credentials, createEnvKey, createSecretType, createType, createSecretInputMode])

  const crossScopeEnvConflict = useMemo(() => {
    if (createType !== 'secret' || createSecretInputMode !== 'single') return null
    if (createSecretScope !== 'personal') return null
    const envKey = normalizeEnvKeyInput(createEnvKey)
    if (!envKey) return null
    return (
      credentials.find(
        (row) =>
          row.type === 'env_workspace' && (row.envKey || '').toLowerCase() === envKey.toLowerCase()
      ) ?? null
    )
  }, [credentials, createEnvKey, createSecretScope, createType, createSecretInputMode])

  const existingOAuthDisplayName = useMemo(() => {
    if (createType !== 'oauth') return null
    const name = createDisplayName.trim()
    if (!name) return null
    return (
      credentials.find(
        (row) => row.type === 'oauth' && row.displayName.toLowerCase() === name.toLowerCase()
      ) ?? null
    )
  }, [credentials, createDisplayName, createType])
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

  const isDescriptionDirty = useMemo(() => {
    if (!selectedCredential) return false
    return selectedDescriptionDraft !== (selectedCredential.description || '')
  }, [selectedCredential, selectedDescriptionDraft])

  const isDisplayNameDirty = useMemo(() => {
    if (!selectedCredential) return false
    return selectedDisplayNameDraft !== selectedCredential.displayName
  }, [selectedCredential, selectedDisplayNameDraft])

  const isDetailsDirty = isEnvValueDirty || isDescriptionDirty || isDisplayNameDirty
  const [isSavingDetails, setIsSavingDetails] = useState(false)

  const handleSaveDetails = async () => {
    if (!selectedCredential || !isSelectedAdmin || !isDetailsDirty) return
    setDetailsError(null)
    setIsSavingDetails(true)

    try {
      if (isDisplayNameDirty || isDescriptionDirty) {
        await updateCredential.mutateAsync({
          credentialId: selectedCredential.id,
          ...(isDisplayNameDirty && selectedCredential.type === 'oauth'
            ? { displayName: selectedDisplayNameDraft.trim() }
            : {}),
          ...(isDescriptionDirty ? { description: selectedDescriptionDraft.trim() || null } : {}),
        })
      }

      if (isEnvValueDirty && canEditSelectedEnvValue) {
        const envKey = selectedCredential.envKey || ''
        if (envKey) {
          if (selectedCredential.type === 'env_workspace') {
            await upsertWorkspaceEnvironment.mutateAsync({
              workspaceId,
              variables: { [envKey]: selectedEnvValueDraft },
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
              variables: { ...personalVariables, [envKey]: selectedEnvValueDraft },
            })
          }
        }
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
      setSelectedDisplayNameDraft('')
      return
    }

    setDetailsError(null)
    setSelectedDescriptionDraft(selectedCredential.description || '')
    setSelectedDisplayNameDraft(selectedCredential.displayName)

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
    setCreateSecretScope('workspace')
    setCreateSecretInputMode('single')
    setCreateDisplayName('')
    setCreateDescription('')
    setCreateEnvKey('')
    setCreateEnvValue('')
    setCreateBulkText('')
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

      if (createSecretInputMode === 'bulk') {
        await handleBulkCreateSecrets()
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

  const handleBulkCreateSecrets = async () => {
    if (!workspaceId) return
    setCreateError(null)

    const { entries, errors } = parseEnvText(createBulkText)
    if (errors.length > 0) {
      setCreateError(errors.join('\n'))
      return
    }

    if (entries.length === 0) {
      setCreateError('No valid KEY=VALUE pairs found. Add one per line, e.g. API_KEY=sk-abc123')
      return
    }

    try {
      const newVars: Record<string, string> = {}
      for (const entry of entries) {
        newVars[entry.key] = entry.value
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
          variables: { ...personalVariables, ...newVars },
        })
      } else {
        const workspaceVariables = workspaceEnvironmentData?.workspace ?? {}
        await upsertWorkspaceEnvironment.mutateAsync({
          workspaceId,
          variables: { ...workspaceVariables, ...newVars },
        })
      }

      let lastCredentialId: string | null = null
      for (const entry of entries) {
        const response = await createCredential.mutateAsync({
          workspaceId,
          type: createSecretType,
          envKey: entry.key,
        })
        if (response?.credential?.id) {
          lastCredentialId = response.credential.id
        }
      }

      if (lastCredentialId) {
        setSelectedCredentialId(lastCredentialId)
      }

      await refetchCredentials()

      setShowCreateModal(false)
      resetCreateForm()
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to create secrets'
      setCreateError(message)
      logger.error('Failed to bulk create secrets', error)
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

  const [isPromoting, setIsPromoting] = useState(false)
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

  const handlePromoteToWorkspace = async () => {
    if (!selectedCredential || selectedCredential.type !== 'env_personal' || !workspaceId) return
    const envKey = selectedCredential.envKey || ''
    if (!envKey) return

    setDetailsError(null)
    setIsPromoting(true)

    try {
      const currentValue =
        personalEnvironment[envKey]?.value || workspaceEnvironmentData?.personal?.[envKey] || ''

      if (!currentValue) {
        setDetailsError('Cannot promote: secret value is empty.')
        setIsPromoting(false)
        return
      }

      const workspaceVariables = workspaceEnvironmentData?.workspace ?? {}
      await upsertWorkspaceEnvironment.mutateAsync({
        workspaceId,
        variables: { ...workspaceVariables, [envKey]: currentValue },
      })

      const response = await createCredential.mutateAsync({
        workspaceId,
        type: 'env_workspace',
        envKey,
        description: selectedCredential.description || undefined,
      })

      await deleteCredential.mutateAsync(selectedCredential.id)

      const newCredentialId = response?.credential?.id
      if (newCredentialId) {
        setSelectedCredentialId(newCredentialId)
      } else {
        setSelectedCredentialId(null)
      }

      await refetchCredentials()
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to promote secret'
      setDetailsError(message)
      logger.error('Failed to promote personal secret to workspace', error)
    } finally {
      setIsPromoting(false)
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
      await fetch('/api/credentials/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId,
          providerId: selectedCredential.providerId,
          displayName: selectedCredential.displayName,
          description: selectedCredential.description || undefined,
          credentialId: selectedCredential.id,
        }),
      })

      window.sessionStorage.setItem(
        'sim.oauth-connect-pending',
        JSON.stringify({
          displayName: selectedCredential.displayName,
          providerId: selectedCredential.providerId,
          preCount: credentials.filter((c) => c.type === 'oauth').length,
          workspaceId,
          reconnect: true,
        })
      )

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

  return (
    <div className='flex h-full min-h-0 gap-[16px]'>
      <div className='flex w-[320px] min-w-[320px] flex-col gap-[12px] border-[var(--border-1)] border-r pr-[16px]'>
        <div className='flex items-center gap-[8px]'>
          <div className='relative flex-1'>
            <Search className='-translate-y-1/2 absolute top-1/2 left-[10px] h-[14px] w-[14px] text-[var(--text-tertiary)]' />
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
                    <p className='min-w-0 truncate font-medium text-[13px] text-[var(--text-primary)]'>
                      {credential.displayName}
                    </p>
                    <Badge
                      variant={typeBadgeVariant(credential.type)}
                      className='shrink-0 whitespace-nowrap'
                    >
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
                    <Button
                      variant='tertiary'
                      onClick={handleSaveDetails}
                      disabled={!isDetailsDirty || isSavingDetails}
                    >
                      {isSavingDetails ? 'Saving...' : 'Save'}
                    </Button>
                    {selectedCredential.type === 'oauth' && (
                      <Tooltip.Root>
                        <Tooltip.Trigger asChild>
                          <Button
                            variant='ghost'
                            onClick={handleReconnectOAuth}
                            disabled={connectOAuthService.isPending}
                          >
                            <RefreshCw className='h-[14px] w-[14px]' />
                          </Button>
                        </Tooltip.Trigger>
                        <Tooltip.Content>Reconnect account</Tooltip.Content>
                      </Tooltip.Root>
                    )}
                    {selectedCredential.type === 'env_personal' && (
                      <Tooltip.Root>
                        <Tooltip.Trigger asChild>
                          <Button
                            variant='ghost'
                            onClick={handlePromoteToWorkspace}
                            disabled={isPromoting || deleteCredential.isPending}
                          >
                            <Share2 className='h-[14px] w-[14px]' />
                          </Button>
                        </Tooltip.Trigger>
                        <Tooltip.Content>Promote to Workspace Secret</Tooltip.Content>
                      </Tooltip.Root>
                    )}
                    {selectedCredential.type === 'oauth' &&
                      (workspaceUserOptions.length > 0 || isShareingWithWorkspace) && (
                        <Tooltip.Root>
                          <Tooltip.Trigger asChild>
                            <Button
                              variant='ghost'
                              onClick={handleShareWithWorkspace}
                              disabled={
                                isShareingWithWorkspace || workspaceUserOptions.length === 0
                              }
                            >
                              <Share2 className='h-[14px] w-[14px]' />
                            </Button>
                          </Tooltip.Trigger>
                          <Tooltip.Content>
                            {isShareingWithWorkspace ? 'Sharing...' : 'Share with workspace'}
                          </Tooltip.Content>
                        </Tooltip.Root>
                      )}
                    <Tooltip.Root>
                      <Tooltip.Trigger asChild>
                        <Button
                          variant='destructive'
                          onClick={handleDeleteCredential}
                          disabled={
                            deleteCredential.isPending ||
                            isPromoting ||
                            disconnectOAuthService.isPending
                          }
                        >
                          <Trash2 className='h-[14px] w-[14px]' />
                        </Button>
                      </Tooltip.Trigger>
                      <Tooltip.Content>
                        {selectedCredential.type === 'oauth'
                          ? 'Disconnect account'
                          : 'Delete credential'}
                      </Tooltip.Content>
                    </Tooltip.Root>
                  </div>
                )}
              </div>

              {selectedCredential.type === 'oauth' ? (
                <div className='flex flex-col gap-[10px]'>
                  <div>
                    <div className='flex items-center gap-[6px]'>
                      <Label htmlFor='credential-display-name'>Display Name</Label>
                      <Tooltip.Root>
                        <Tooltip.Trigger asChild>
                          <Button
                            variant='ghost'
                            className='h-[20px] w-[20px] p-0'
                            onClick={() => {
                              navigator.clipboard.writeText(selectedCredential.id)
                              setCopyIdSuccess(true)
                              setTimeout(() => setCopyIdSuccess(false), 2000)
                            }}
                          >
                            {copyIdSuccess ? (
                              <Check className='h-[11px] w-[11px]' />
                            ) : (
                              <Copy className='h-[11px] w-[11px]' />
                            )}
                          </Button>
                        </Tooltip.Trigger>
                        <Tooltip.Content>Copy credential ID</Tooltip.Content>
                      </Tooltip.Root>
                    </div>
                    <Input
                      id='credential-display-name'
                      value={selectedDisplayNameDraft}
                      onChange={(event) => setSelectedDisplayNameDraft(event.target.value)}
                      autoComplete='off'
                      disabled={!isSelectedAdmin}
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
                      className='grid grid-cols-[1fr_120px_auto] items-center gap-[8px] rounded-[8px] border border-[var(--border-1)] px-[10px] py-[8px]'
                    >
                      <div className='min-w-0'>
                        <p className='truncate font-medium text-[12px] text-[var(--text-primary)]'>
                          {member.userName || member.userEmail || member.userId}
                        </p>
                        <p className='truncate text-[11px] text-[var(--text-tertiary)]'>
                          {member.userEmail || member.userId}
                        </p>
                      </div>

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
                          />
                          {selectedCredential.type !== 'env_workspace' ? (
                            <Button
                              variant='ghost'
                              onClick={() => handleRemoveMember(member.userId)}
                              disabled={member.role === 'admin' && adminMemberCount <= 1}
                            >
                              Remove
                            </Button>
                          ) : (
                            <div />
                          )}
                        </>
                      ) : (
                        <>
                          <Badge variant={member.role === 'admin' ? 'blue' : 'gray-secondary'}>
                            {member.role}
                          </Badge>
                          <div />
                        </>
                      )}
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
                  {existingOAuthDisplayName && (
                    <div className='rounded-[8px] border border-red-500/50 bg-red-50 p-[12px] dark:bg-red-950/30'>
                      <div className='flex items-start gap-[10px]'>
                        <AlertTriangle className='mt-[1px] h-4 w-4 flex-shrink-0 text-red-600 dark:text-red-400' />
                        <p className='text-[12px] text-red-700 dark:text-red-300'>
                          A credential named{' '}
                          <span className='font-medium'>
                            {existingOAuthDisplayName.displayName}
                          </span>{' '}
                          already exists.
                        </p>
                      </div>
                    </div>
                  )}
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
                          value='workspace'
                          className='h-[28px] min-w-[80px] px-[10px] py-0 text-[12px]'
                        >
                          Workspace
                        </ButtonGroupItem>
                        <ButtonGroupItem
                          value='personal'
                          className='h-[28px] min-w-[72px] px-[10px] py-0 text-[12px]'
                        >
                          Personal
                        </ButtonGroupItem>
                      </ButtonGroup>
                    </div>
                  </div>
                  <div>
                    <Label className='block'>Mode</Label>
                    <div className='mt-[6px]'>
                      <ButtonGroup
                        value={createSecretInputMode}
                        onValueChange={(value) => {
                          setCreateSecretInputMode(value as SecretInputMode)
                          setCreateError(null)
                        }}
                      >
                        <ButtonGroupItem
                          value='single'
                          className='h-[28px] min-w-[56px] px-[10px] py-0 text-[12px]'
                        >
                          Single
                        </ButtonGroupItem>
                        <ButtonGroupItem
                          value='bulk'
                          className='h-[28px] min-w-[56px] px-[10px] py-0 text-[12px]'
                        >
                          Bulk
                        </ButtonGroupItem>
                      </ButtonGroup>
                    </div>
                  </div>

                  {createSecretInputMode === 'single' ? (
                    <>
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
                        <div className='rounded-[8px] border border-red-500/50 bg-red-50 p-[12px] dark:bg-red-950/30'>
                          <div className='flex items-start gap-[10px]'>
                            <AlertTriangle className='mt-[1px] h-4 w-4 flex-shrink-0 text-red-600 dark:text-red-400' />
                            <p className='text-[12px] text-red-700 dark:text-red-300'>
                              A secret with key{' '}
                              <span className='font-medium'>
                                {selectedExistingEnvCredential.displayName}
                              </span>{' '}
                              already exists.
                            </p>
                          </div>
                        </div>
                      )}
                      {!selectedExistingEnvCredential && crossScopeEnvConflict && (
                        <div className='rounded-[8px] border border-amber-500/50 bg-amber-50 p-[12px] dark:bg-amber-950/30'>
                          <div className='flex items-start gap-[10px]'>
                            <AlertTriangle className='mt-[1px] h-4 w-4 flex-shrink-0 text-amber-600 dark:text-amber-400' />
                            <p className='text-[12px] text-amber-700 dark:text-amber-300'>
                              A workspace secret with key{' '}
                              <span className='font-medium'>{crossScopeEnvConflict.envKey}</span>{' '}
                              already exists. Workspace secrets take precedence at runtime.
                            </p>
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <div>
                      <Label>Secrets</Label>
                      <Textarea
                        value={createBulkText}
                        onChange={(event) => {
                          setCreateBulkText(event.target.value)
                          setCreateError(null)
                        }}
                        placeholder={
                          'OPENAI_API_KEY=sk-abc123\nANTHROPIC_API_KEY=sk-ant-xyz\nSTRIPE_SECRET=sk_live_...'
                        }
                        autoComplete='off'
                        spellCheck={false}
                        className='mt-[6px] min-h-[160px] resize-none font-mono text-[12px]'
                      />
                      <p className='mt-[4px] text-[11px] text-[var(--text-tertiary)]'>
                        Paste KEY=VALUE pairs, one per line. Lines starting with # are ignored.
                      </p>
                      {createBulkText.trim()
                        ? (() => {
                            const { entries } = parseEnvText(createBulkText)
                            return entries.length > 0 ? (
                              <p className='mt-[2px] text-[11px] text-[var(--text-secondary)]'>
                                {entries.length} secret{entries.length === 1 ? '' : 's'} detected
                              </p>
                            ) : null
                          })()
                        : null}
                    </div>
                  )}
                </div>
              )}

              {createError && (
                <div className='rounded-[8px] border border-red-500/50 bg-red-50 p-[12px] dark:bg-red-950/30'>
                  <div className='flex items-start gap-[10px]'>
                    <AlertTriangle className='mt-[1px] h-4 w-4 flex-shrink-0 text-red-600 dark:text-red-400' />
                    <p className='whitespace-pre-wrap text-[12px] text-red-700 dark:text-red-300'>
                      {createError}
                    </p>
                  </div>
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
                    connectOAuthService.isPending ||
                    Boolean(existingOAuthDisplayName)
                  : createSecretInputMode === 'bulk'
                    ? !createBulkText.trim()
                    : !createEnvKey.trim() ||
                      !createEnvValue.trim() ||
                      Boolean(selectedExistingEnvCredential)) ||
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
                : createSecretInputMode === 'bulk'
                  ? createCredential.isPending ||
                    savePersonalEnvironment.isPending ||
                    upsertWorkspaceEnvironment.isPending
                    ? 'Importing...'
                    : 'Import all'
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
          newScopes={[]}
          serviceId={selectedOAuthService?.id || createOAuthProviderId}
          onConnect={async () => {
            await handleConnectOAuthService()
          }}
        />
      )}
    </div>
  )
}
