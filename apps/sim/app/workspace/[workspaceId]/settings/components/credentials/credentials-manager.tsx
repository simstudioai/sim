'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { useQueryClient } from '@tanstack/react-query'
import { Check, Clipboard, Key, Search } from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import {
  Avatar,
  AvatarFallback,
  Badge,
  Button,
  Combobox,
  Input as EmcnInput,
  Label,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Skeleton,
  Textarea,
  Tooltip,
  Trash,
} from '@/components/emcn'
import { Input } from '@/components/ui'
import { useSession } from '@/lib/auth/auth-client'
import { cn } from '@/lib/core/utils/cn'
import {
  clearPendingCredentialCreateRequest,
  PENDING_CREDENTIAL_CREATE_REQUEST_EVENT,
  type PendingCredentialCreateRequest,
  readPendingCredentialCreateRequest,
} from '@/lib/credentials/client-state'
import type { WorkspaceEnvironmentData } from '@/lib/environment/api'
import { getUserColor } from '@/lib/workspaces/colors'
import { isValidEnvVarName } from '@/executor/constants'
import {
  useCreateWorkspaceCredential,
  useRemoveWorkspaceCredentialMember,
  useUpdateWorkspaceCredential,
  useUpsertWorkspaceCredentialMember,
  useWorkspaceCredentialMembers,
  useWorkspaceCredentials,
  type WorkspaceCredential,
  type WorkspaceCredentialRole,
  workspaceCredentialKeys,
} from '@/hooks/queries/credentials'
import {
  usePersonalEnvironment,
  useRemoveWorkspaceEnvironment,
  useSavePersonalEnvironment,
  useUpsertWorkspaceEnvironment,
  useWorkspaceEnvironment,
} from '@/hooks/queries/environment'
import { useWorkspacePermissionsQuery } from '@/hooks/queries/workspace'
import { useSettingsDirtyStore } from '@/stores/settings/dirty/store'

const logger = createLogger('SecretsManager')

const GRID_COLS = 'grid grid-cols-[minmax(0,1fr)_8px_minmax(0,1fr)_auto_auto] items-center'
const COL_SPAN_ALL = 'col-span-5'
const CONFLICT_CLASS = 'border-[var(--text-error)] bg-[var(--error-muted)]'

const ROLE_OPTIONS = [
  { value: 'member', label: 'Member' },
  { value: 'admin', label: 'Admin' },
] as const

const generateRowId = (() => {
  let counter = 0
  return () => {
    counter += 1
    return Date.now() + counter
  }
})()

const createEmptyEnvVar = (): UIEnvironmentVariable => ({
  key: '',
  value: '',
  id: generateRowId(),
})

interface UIEnvironmentVariable {
  key: string
  value: string
  id?: number
}

/**
 * Updates an env var array with auto-add (new empty row when typing in last)
 * and auto-remove (drop non-last empty rows).
 */
function updateEnvVarArray(
  vars: UIEnvironmentVariable[],
  index: number,
  field: 'key' | 'value',
  value: string
): UIEnvironmentVariable[] {
  const updated = [...vars]
  if (updated[index]) {
    updated[index] = { ...updated[index], [field]: value }
  }

  const lastIdx = updated.length - 1
  if (index === lastIdx && updated[lastIdx] && (updated[lastIdx].key || updated[lastIdx].value)) {
    updated.push(createEmptyEnvVar())
  }

  const lastIndex = updated.length - 1
  return updated.filter((v, i) => i === lastIndex || v.key !== '' || v.value !== '')
}

/**
 * Validates an environment variable key.
 * Returns an error message if invalid, undefined if valid.
 */
function validateEnvVarKey(key: string): string | undefined {
  if (!key) return undefined
  if (key.includes(' ')) return 'Spaces are not allowed'
  if (!isValidEnvVarName(key)) return 'Only letters, numbers, and underscores allowed'
  return undefined
}

/**
 * Parses a single `.env`-style line into a key/value pair.
 * Handles `export KEY=VALUE`, quoted values, inline comments, and base64 false positives.
 * Returns null for blank lines, comments, and invalid entries.
 */
function parseEnvVarLine(line: string): UIEnvironmentVariable | null {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) return null

  const withoutExport = trimmed.replace(/^export\s+/, '')
  const equalIndex = withoutExport.indexOf('=')
  if (equalIndex === -1 || equalIndex === 0) return null

  const potentialKey = withoutExport.substring(0, equalIndex).trim()
  if (!isValidEnvVarName(potentialKey)) return null

  let value = withoutExport.substring(equalIndex + 1)

  const looksLikeBase64Key = /^[A-Za-z0-9+/]+$/.test(potentialKey) && !potentialKey.includes('_')
  const valueIsJustPadding = /^=+$/.test(value.trim())
  if (looksLikeBase64Key && valueIsJustPadding && potentialKey.length > 20) return null

  const trimmedValue = value.trim()
  if (
    !trimmedValue.startsWith('"') &&
    !trimmedValue.startsWith("'") &&
    !trimmedValue.startsWith('`')
  ) {
    const commentIndex = value.search(/\s#/)
    if (commentIndex !== -1) value = value.substring(0, commentIndex)
  }

  value = value.trim()

  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")) ||
      (value.startsWith('`') && value.endsWith('`')))
  ) {
    value = value.slice(1, -1)
  }

  return { key: potentialKey, value, id: generateRowId() }
}

/** Parses an array of raw text lines, returning only valid non-empty KEY=VALUE entries. */
function parseValidEnvVars(lines: string[]): UIEnvironmentVariable[] {
  return lines
    .map(parseEnvVarLine)
    .filter((parsed): parsed is UIEnvironmentVariable => parsed !== null)
    .filter(({ key, value }) => key && value)
}

interface WorkspaceVariableRowProps {
  envKey: string
  value: string
  renamingKey: string | null
  pendingKeyValue: string
  hasCredential: boolean
  canEdit: boolean
  onRenameStart: (key: string) => void
  onPendingKeyChange: (value: string) => void
  onRenameEnd: (key: string, value: string) => void
  onValueChange: (key: string, value: string) => void
  onDelete: (key: string) => void
  onViewDetails: (envKey: string) => void
}

function WorkspaceVariableRow({
  envKey,
  value,
  renamingKey,
  pendingKeyValue,
  hasCredential,
  canEdit,
  onRenameStart,
  onPendingKeyChange,
  onRenameEnd,
  onValueChange,
  onDelete,
  onViewDetails,
}: WorkspaceVariableRowProps) {
  const [valueFocused, setValueFocused] = useState(false)

  return (
    <div className='contents'>
      <EmcnInput
        value={renamingKey === envKey ? pendingKeyValue : envKey}
        onChange={(e) => {
          if (renamingKey !== envKey) onRenameStart(envKey)
          onPendingKeyChange(e.target.value)
        }}
        onBlur={() => onRenameEnd(envKey, value)}
        name={`workspace_env_key_${envKey}_${Math.random()}`}
        autoComplete='off'
        autoCapitalize='off'
        spellCheck='false'
        readOnly
        onFocus={(e) => {
          if (canEdit) e.target.removeAttribute('readOnly')
        }}
        className='h-9'
      />
      <div />
      <EmcnInput
        value={canEdit ? value : value ? '\u2022'.repeat(value.length) : ''}
        type={canEdit && !valueFocused ? 'password' : 'text'}
        onChange={(e) => onValueChange(envKey, e.target.value)}
        readOnly
        onFocus={(e) => {
          if (canEdit) {
            setValueFocused(true)
            e.target.removeAttribute('readOnly')
          }
        }}
        onBlur={() => {
          if (canEdit) setValueFocused(false)
        }}
        name={`workspace_env_value_${envKey}_${Math.random()}`}
        autoComplete='off'
        autoCorrect='off'
        autoCapitalize='off'
        spellCheck='false'
        className='h-9'
      />
      <Button
        variant='default'
        onClick={() => onViewDetails(envKey)}
        disabled={!hasCredential}
        className={cn('ml-2 h-9', !hasCredential && 'opacity-40')}
      >
        Details
      </Button>
      {canEdit ? (
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <Button variant='ghost' onClick={() => onDelete(envKey)} className='h-9 w-9'>
              <Trash />
            </Button>
          </Tooltip.Trigger>
          <Tooltip.Content>Delete secret</Tooltip.Content>
        </Tooltip.Root>
      ) : (
        <div />
      )}
    </div>
  )
}

interface NewWorkspaceVariableRowProps {
  envVar: UIEnvironmentVariable
  index: number
  onUpdate: (index: number, field: 'key' | 'value', value: string) => void
  onPaste?: (e: React.ClipboardEvent<HTMLInputElement>, index: number) => void
}

function NewWorkspaceVariableRow({
  envVar,
  index,
  onUpdate,
  onPaste,
}: NewWorkspaceVariableRowProps) {
  const [valueFocused, setValueFocused] = useState(false)
  const keyError = validateEnvVarKey(envVar.key)
  const hasContent = Boolean(envVar.key || envVar.value)

  return (
    <div className='contents'>
      <EmcnInput
        data-input-type='key'
        value={envVar.key}
        onChange={(e) => onUpdate(index, 'key', e.target.value)}
        onPaste={onPaste ? (e) => onPaste(e, index) : undefined}
        placeholder='API_KEY'
        name={`new_workspace_key_${envVar.id || index}_${Math.random()}`}
        autoComplete='off'
        autoCapitalize='off'
        spellCheck='false'
        readOnly
        onFocus={(e) => e.target.removeAttribute('readOnly')}
        className={cn('h-9', keyError && 'border-[var(--text-error)]')}
      />
      <div />
      <EmcnInput
        data-input-type='value'
        value={envVar.value}
        onChange={(e) => onUpdate(index, 'value', e.target.value)}
        onPaste={onPaste ? (e) => onPaste(e, index) : undefined}
        placeholder='Enter value'
        type={valueFocused ? 'text' : 'password'}
        name={`new_workspace_value_${envVar.id || index}_${Math.random()}`}
        autoComplete='off'
        autoCapitalize='off'
        spellCheck='false'
        readOnly
        onFocus={(e) => {
          setValueFocused(true)
          e.target.removeAttribute('readOnly')
        }}
        onBlur={() => setValueFocused(false)}
        className='col-span-2 ml-0 h-9'
      />
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <Button
            variant='ghost'
            onClick={() => {
              onUpdate(index, 'key', '')
              onUpdate(index, 'value', '')
            }}
            disabled={!hasContent}
            className={cn('h-9 w-9', !hasContent && 'opacity-30')}
          >
            <Trash />
          </Button>
        </Tooltip.Trigger>
        {hasContent && <Tooltip.Content>Delete secret</Tooltip.Content>}
      </Tooltip.Root>
      {keyError && (
        <div
          className={cn(
            COL_SPAN_ALL,
            'mt-[-4px] text-[var(--text-error)] text-caption leading-tight'
          )}
        >
          {keyError}
        </div>
      )}
    </div>
  )
}

export function CredentialsManager() {
  const params = useParams()
  const router = useRouter()
  const workspaceId = (params?.workspaceId as string) || ''
  const { data: session } = useSession()

  const { data: personalEnvData, isLoading: isPersonalLoading } = usePersonalEnvironment()
  const { data: workspaceEnvData, isLoading: isWorkspaceLoading } = useWorkspaceEnvironment(
    workspaceId,
    {
      select: useCallback(
        (data: WorkspaceEnvironmentData): WorkspaceEnvironmentData => ({
          workspace: data.workspace || {},
          personal: data.personal || {},
          conflicts: data.conflicts || [],
        }),
        []
      ),
    }
  )
  const savePersonalMutation = useSavePersonalEnvironment()
  const upsertWorkspaceMutation = useUpsertWorkspaceEnvironment()
  const removeWorkspaceMutation = useRemoveWorkspaceEnvironment()

  const { data: workspaceEnvCredentials = [] } = useWorkspaceCredentials({
    workspaceId,
    type: 'env_workspace',
    enabled: Boolean(workspaceId),
  })

  const { data: personalEnvCredentials = [] } = useWorkspaceCredentials({
    workspaceId,
    type: 'env_personal',
    enabled: Boolean(workspaceId),
  })

  const envCredentials = useMemo(
    () => [...workspaceEnvCredentials, ...personalEnvCredentials],
    [workspaceEnvCredentials, personalEnvCredentials]
  )

  const { data: workspacePermissions } = useWorkspacePermissionsQuery(workspaceId || null)
  const queryClient = useQueryClient()

  const isWorkspaceAdmin = workspacePermissions?.viewer?.isAdmin ?? false

  const isLoading = isPersonalLoading || isWorkspaceLoading
  const variables = useMemo(() => personalEnvData || {}, [personalEnvData])

  const [envVars, setEnvVars] = useState<UIEnvironmentVariable[]>([])
  const [newWorkspaceRows, setNewWorkspaceRows] = useState<UIEnvironmentVariable[]>([
    createEmptyEnvVar(),
  ])
  const [searchTerm, setSearchTerm] = useState('')
  const [focusedValueIndex, setFocusedValueIndex] = useState<number | null>(null)
  const [showUnsavedChanges, setShowUnsavedChanges] = useState(false)
  const [workspaceVars, setWorkspaceVars] = useState<Record<string, string>>({})
  const [renamingKey, setRenamingKey] = useState<string | null>(null)
  const [pendingKeyValue, setPendingKeyValue] = useState<string>('')
  const [changeToken, setChangeToken] = useState(0)

  const [selectedCredentialId, setSelectedCredentialId] = useState<string | null>(null)
  const [prevSelectedCredentialId, setPrevSelectedCredentialId] = useState<
    string | null | undefined
  >(undefined)
  const [selectedDisplayNameDraft, setSelectedDisplayNameDraft] = useState('')
  const [selectedDescriptionDraft, setSelectedDescriptionDraft] = useState('')
  const [copyIdSuccess, setCopyIdSuccess] = useState(false)
  const [detailsError, setDetailsError] = useState<string | null>(null)
  const [showDetailUnsavedChanges, setShowDetailUnsavedChanges] = useState(false)
  const [memberUserId, setMemberUserId] = useState('')
  const [memberRole, setMemberRole] = useState<WorkspaceCredentialRole>('member')

  const initialWorkspaceVarsRef = useRef<Record<string, string>>({})
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const initialVarsRef = useRef<UIEnvironmentVariable[]>([])
  const hasChangesRef = useRef(false)
  const hasSavedRef = useRef(false)
  const shouldBlockNavRef = useRef(false)
  const pendingNavigationUrlRef = useRef<string | null>(null)

  const envKeyToCredential = useMemo(() => {
    const map = new Map<string, WorkspaceCredential>()
    for (const cred of envCredentials) {
      if (cred.envKey) map.set(cred.envKey, cred)
    }
    return map
  }, [envCredentials])

  const selectedCredential = useMemo(
    () => envCredentials.find((c) => c.id === selectedCredentialId) || null,
    [envCredentials, selectedCredentialId]
  )

  const currentCredentialId = selectedCredential?.id ?? null
  if (currentCredentialId !== prevSelectedCredentialId) {
    setPrevSelectedCredentialId(currentCredentialId)
    if (!selectedCredential) {
      setSelectedDescriptionDraft('')
      setSelectedDisplayNameDraft('')
      setDetailsError(null)
    } else {
      setDetailsError(null)
      setSelectedDescriptionDraft(selectedCredential.description || '')
      setSelectedDisplayNameDraft(selectedCredential.displayName)
    }
  }

  const { data: members = [], isPending: membersLoading } = useWorkspaceCredentialMembers(
    selectedCredential?.id
  )
  const createCredential = useCreateWorkspaceCredential()
  const updateCredential = useUpdateWorkspaceCredential()
  const upsertMember = useUpsertWorkspaceCredentialMember()
  const removeMember = useRemoveWorkspaceCredentialMember()

  const activeMembers = useMemo(
    () => members.filter((member) => member.status === 'active'),
    [members]
  )

  const adminMemberCount = useMemo(
    () => activeMembers.filter((member) => member.role === 'admin').length,
    [activeMembers]
  )

  const isSelectedAdmin = selectedCredential?.role === 'admin'

  const workspaceUserOptions = useMemo(() => {
    const activeMemberUserIds = new Set(activeMembers.map((member) => member.userId))
    return (workspacePermissions?.users || [])
      .filter((user) => !activeMemberUserIds.has(user.userId))
      .map((user) => ({
        value: user.userId,
        label: user.name || user.email,
      }))
  }, [workspacePermissions?.users, activeMembers])

  const isDescriptionDirty = selectedCredential
    ? selectedDescriptionDraft !== (selectedCredential.description || '')
    : false
  const isDisplayNameDirty = selectedCredential
    ? selectedDisplayNameDraft !== selectedCredential.displayName
    : false
  const isDetailsDirty = isDescriptionDirty || isDisplayNameDirty

  const filteredEnvVars = useMemo(() => {
    const mapped = envVars.map((envVar, index) => ({ envVar, originalIndex: index }))
    if (!searchTerm.trim()) return mapped
    const term = searchTerm.toLowerCase()
    return mapped.filter(({ envVar }) => envVar.key.toLowerCase().includes(term))
  }, [envVars, searchTerm])

  const filteredWorkspaceEntries = useMemo(() => {
    const entries = Object.entries(workspaceVars)
    if (!searchTerm.trim()) return entries
    const term = searchTerm.toLowerCase()
    return entries.filter(([key]) => key.toLowerCase().includes(term))
  }, [workspaceVars, searchTerm])

  const filteredNewWorkspaceRows = useMemo(() => {
    const mapped = newWorkspaceRows.map((row, index) => ({ row, originalIndex: index }))
    if (!searchTerm.trim()) return mapped
    const term = searchTerm.toLowerCase()
    return mapped.filter(({ row }) => row.key.toLowerCase().includes(term))
  }, [newWorkspaceRows, searchTerm])

  const allWorkspaceKeys = useMemo(() => {
    const keys = new Set(Object.keys(workspaceVars))
    for (const row of newWorkspaceRows) {
      if (row.key) keys.add(row.key)
    }
    return keys
  }, [workspaceVars, newWorkspaceRows])

  const hasChanges = useMemo(() => {
    const initialVars = initialVarsRef.current.filter((v) => v.key || v.value)
    const currentVars = envVars.filter((v) => v.key || v.value)
    const initialMap = new Map(initialVars.map((v) => [v.key, v.value]))
    const currentMap = new Map(currentVars.map((v) => [v.key, v.value]))

    if (initialMap.size !== currentMap.size) return true

    for (const [key, value] of currentMap) {
      if (initialMap.get(key) !== value) return true
    }

    for (const key of initialMap.keys()) {
      if (!currentMap.has(key)) return true
    }

    const before = initialWorkspaceVarsRef.current
    const after = workspaceVars
    const allKeys = new Set([...Object.keys(before), ...Object.keys(after)])

    if (Object.keys(before).length !== Object.keys(after).length) return true

    for (const key of allKeys) {
      if (before[key] !== after[key]) return true
    }

    if (newWorkspaceRows.some((row) => row.key && row.value)) return true

    return false
  }, [envVars, workspaceVars, newWorkspaceRows, changeToken])

  const hasConflicts = useMemo(() => {
    return envVars.some((envVar) => !!envVar.key && allWorkspaceKeys.has(envVar.key))
  }, [envVars, allWorkspaceKeys])

  const hasInvalidKeys = useMemo(() => {
    const personalInvalid = envVars.some((envVar) => !!envVar.key && validateEnvVarKey(envVar.key))
    const workspaceInvalid = newWorkspaceRows.some((row) => !!row.key && validateEnvVarKey(row.key))
    return personalInvalid || workspaceInvalid
  }, [envVars, newWorkspaceRows])

  const isListSaving =
    savePersonalMutation.isPending ||
    upsertWorkspaceMutation.isPending ||
    removeWorkspaceMutation.isPending

  hasChangesRef.current = hasChanges
  shouldBlockNavRef.current = hasChanges || isDetailsDirty

  const setNavGuardDirty = useSettingsDirtyStore((s) => s.setDirty)
  const resetNavGuard = useSettingsDirtyStore((s) => s.reset)

  useEffect(() => {
    setNavGuardDirty(hasChanges || isDetailsDirty)
  }, [hasChanges, isDetailsDirty, setNavGuardDirty])

  useEffect(() => () => resetNavGuard(), [resetNavGuard])

  useEffect(() => {
    if (hasSavedRef.current) return

    const existingVars = Object.values(variables)
    const initialVars = [
      ...existingVars.map((envVar) => ({
        ...envVar,
        id: generateRowId(),
      })),
      createEmptyEnvVar(),
    ]
    initialVarsRef.current = JSON.parse(JSON.stringify(initialVars))
    setEnvVars(JSON.parse(JSON.stringify(initialVars)))
  }, [variables])

  useEffect(() => {
    if (!workspaceEnvData) return
    if (hasSavedRef.current) {
      hasSavedRef.current = false
    } else {
      setWorkspaceVars(workspaceEnvData.workspace || {})
      initialWorkspaceVarsRef.current = workspaceEnvData.workspace || {}
    }
  }, [workspaceEnvData])

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      scrollContainerRef.current?.scrollTo({
        top: scrollContainerRef.current.scrollHeight,
        behavior: 'smooth',
      })
    })
  }, [])

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
    }
    if (hasChanges || isDetailsDirty) {
      window.addEventListener('beforeunload', handler)
    }
    return () => window.removeEventListener('beforeunload', handler)
  }, [hasChanges, isDetailsDirty])

  /**
   * Navigation guard: intercept link clicks in the capture phase before
   * Next.js App Router processes them. This is needed because Next.js
   * internally bypasses window.history.pushState overrides.
   */
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (!shouldBlockNavRef.current) return

      const anchor = (e.target as HTMLElement).closest('a[href]')
      if (!anchor) return

      const href = anchor.getAttribute('href')
      if (!href || href.startsWith('http') || href.startsWith('#')) return

      const currentPath = window.location.pathname
      if (href === currentPath) return

      e.preventDefault()
      e.stopPropagation()
      pendingNavigationUrlRef.current = href
      setShowUnsavedChanges(true)
    }

    const handlePopState = () => {
      if (shouldBlockNavRef.current) {
        window.history.pushState(null, '', window.location.href)
        setShowUnsavedChanges(true)
      }
    }

    document.addEventListener('click', handleClick, true)
    window.addEventListener('popstate', handlePopState)

    return () => {
      document.removeEventListener('click', handleClick, true)
      window.removeEventListener('popstate', handlePopState)
    }
  }, [])

  const applyPendingCredentialCreateRequest = useCallback(
    (request: PendingCredentialCreateRequest) => {
      if (request.workspaceId !== workspaceId) return
      if (Date.now() - request.requestedAt > 15 * 60 * 1000) {
        clearPendingCredentialCreateRequest()
        return
      }
      if (request.type === 'oauth') return

      const envKey = request.envKey || ''
      if (envKey) {
        setEnvVars((prev) => {
          const existing = prev.find((v) => v.key.toLowerCase() === envKey.toLowerCase())
          if (existing) return prev
          const nonEmpty = prev.filter((v) => v.key || v.value)
          return [...nonEmpty, { key: envKey, value: '', id: generateRowId() }]
        })
        scrollToBottom()
      }

      clearPendingCredentialCreateRequest()
    },
    [workspaceId, scrollToBottom]
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

  const handleSelectCredential = (credentialId: string) => {
    setSelectedCredentialId(credentialId)
    setDetailsError(null)
    setMemberUserId('')
    setMemberRole('member')
  }

  const handleViewDetails = async (envKey: string, type: 'env_workspace' | 'env_personal') => {
    const existing = envKeyToCredential.get(envKey)
    if (existing) {
      handleSelectCredential(existing.id)
      return
    }

    try {
      const result = await createCredential.mutateAsync({
        workspaceId,
        type,
        displayName: envKey,
        envKey,
        ...(type === 'env_personal' ? { envOwnerUserId: session?.user?.id } : {}),
      })
      if (result.credential?.id) {
        handleSelectCredential(result.credential.id)
      }
    } catch (error) {
      logger.error('Failed to create credential record', error)
    }
  }

  const handleBackAttempt = () => {
    if (isDetailsDirty && !updateCredential.isPending) {
      setShowDetailUnsavedChanges(true)
    } else {
      setSelectedCredentialId(null)
    }
  }

  const handleDiscardDetailChanges = () => {
    setShowDetailUnsavedChanges(false)
    setSelectedDescriptionDraft(selectedCredential?.description || '')
    setSelectedDisplayNameDraft(selectedCredential?.displayName || '')
    setSelectedCredentialId(null)
  }

  const handleSaveDetails = async () => {
    if (!selectedCredential || !isSelectedAdmin || !isDetailsDirty || updateCredential.isPending)
      return
    setDetailsError(null)

    try {
      if (isDisplayNameDirty || isDescriptionDirty) {
        await updateCredential.mutateAsync({
          credentialId: selectedCredential.id,
          ...(isDisplayNameDirty ? { displayName: selectedDisplayNameDraft.trim() } : {}),
          ...(isDescriptionDirty ? { description: selectedDescriptionDraft.trim() || null } : {}),
        })
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to save changes'
      setDetailsError(message)
      logger.error('Failed to save secret details', error)
    }
  }

  const handleAddMember = async () => {
    if (!memberUserId || !selectedCredential) return
    try {
      await upsertMember.mutateAsync({
        credentialId: selectedCredential.id,
        userId: memberUserId,
        role: memberRole,
      })
      setMemberUserId('')
      setMemberRole('member')
    } catch (error) {
      logger.error('Failed to add member', error)
    }
  }

  const handleRemoveMember = async (userId: string) => {
    if (!selectedCredential) return
    try {
      await removeMember.mutateAsync({ credentialId: selectedCredential.id, userId })
    } catch (error) {
      logger.error('Failed to remove member', error)
    }
  }

  const handleChangeMemberRole = async (userId: string, role: WorkspaceCredentialRole) => {
    if (!selectedCredential) return
    try {
      await upsertMember.mutateAsync({ credentialId: selectedCredential.id, userId, role })
    } catch (error) {
      logger.error('Failed to change member role', error)
    }
  }

  const handleWorkspaceKeyRename = (currentKey: string, currentValue: string) => {
    const newKey = pendingKeyValue.trim()
    if (!renamingKey || renamingKey !== currentKey) return
    setRenamingKey(null)
    if (!newKey || newKey === currentKey) return

    setWorkspaceVars((prev) => {
      const next = { ...prev }
      delete next[currentKey]
      next[newKey] = currentValue
      return next
    })
  }

  const handleWorkspaceValueChange = (key: string, value: string) => {
    setWorkspaceVars((prev) => ({ ...prev, [key]: value }))
  }

  const handleDeleteWorkspaceVar = (key: string) => {
    setWorkspaceVars((prev) => {
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  const updateNewWorkspaceRow = (index: number, field: 'key' | 'value', value: string) => {
    setNewWorkspaceRows((prev) => updateEnvVarArray(prev, index, field, value))
  }

  const updateEnvVar = (index: number, field: 'key' | 'value', value: string) => {
    setEnvVars((prev) => updateEnvVarArray(prev, index, field, value))
  }

  const removeEnvVar = (index: number) => {
    setEnvVars((prev) => {
      const filtered = prev.filter((_, i) => i !== index)
      const hasTrailingEmpty =
        filtered.length > 0 &&
        !filtered[filtered.length - 1].key &&
        !filtered[filtered.length - 1].value
      return hasTrailingEmpty ? filtered : [...filtered, createEmptyEnvVar()]
    })
  }

  const handleValueFocus = (index: number, e: React.FocusEvent<HTMLInputElement>) => {
    setFocusedValueIndex(index)
    e.target.scrollLeft = 0
  }

  const handleValueClick = (e: React.MouseEvent<HTMLInputElement>) => {
    e.preventDefault()
    e.currentTarget.scrollLeft = 0
  }

  const handleSingleValuePaste = (text: string, index: number, inputType: 'key' | 'value') => {
    setEnvVars((prev) => {
      const newEnvVars = [...prev]
      newEnvVars[index] = { ...newEnvVars[index], [inputType]: text }
      return newEnvVars
    })
  }

  /**
   * Paste handler for personal env var rows.
   * Only prevents default when it actually handles the paste: KV patterns destructure into new rows,
   * plain values overwrite the field. Falls through to native paste if pattern is detected but all
   * values are empty (e.g. KEY=), avoiding silently swallowed input.
   */
  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>, index: number) => {
    const text = e.clipboardData.getData('text').trim()
    if (!text) return

    const lines = text.split(/\r?\n/).filter((line) => line.trim())
    if (lines.length === 0) return

    const inputType = (e.target as HTMLInputElement).getAttribute('data-input-type') as
      | 'key'
      | 'value'

    if (inputType) {
      const hasValidEnvVarPattern = lines.some((line) => parseEnvVarLine(line) !== null)
      if (!hasValidEnvVarPattern) {
        e.preventDefault()
        handleSingleValuePaste(text, index, inputType)
        return
      }
    }

    const parsedVars = parseValidEnvVars(lines)
    if (parsedVars.length > 0) {
      e.preventDefault()
      setEnvVars((prev) => {
        const existingVars = prev.filter((v) => v.key || v.value)
        return [...existingVars, ...parsedVars, createEmptyEnvVar()]
      })
      scrollToBottom()
    }
  }

  /**
   * Paste handler for workspace new-row inputs.
   * Only prevents default when pasted text contains KEY=VALUE patterns; otherwise defers to
   * native browser paste so cursor/selection semantics are preserved for plain values.
   */
  const handleWorkspacePaste = (e: React.ClipboardEvent<HTMLInputElement>, _index: number) => {
    const text = e.clipboardData.getData('text').trim()
    if (!text) return

    const lines = text.split(/\r?\n/).filter((line) => line.trim())
    if (lines.length === 0) return

    const inputType = (e.target as HTMLInputElement).getAttribute('data-input-type') as
      | 'key'
      | 'value'

    if (inputType) {
      const hasValidEnvVarPattern = lines.some((line) => parseEnvVarLine(line) !== null)
      if (!hasValidEnvVarPattern) return
    }

    const parsedVars = parseValidEnvVars(lines)
    if (parsedVars.length > 0) {
      e.preventDefault()
      setNewWorkspaceRows((prev) => {
        const existing = prev.filter((v) => v.key || v.value)
        return [...existing, ...parsedVars, createEmptyEnvVar()]
      })
      scrollToBottom()
    }
  }

  const resetToSaved = () => {
    setEnvVars(JSON.parse(JSON.stringify(initialVarsRef.current)))
    setWorkspaceVars({ ...initialWorkspaceVarsRef.current })
    setNewWorkspaceRows([createEmptyEnvVar()])
    setShowUnsavedChanges(false)
  }

  const handleCancel = resetToSaved

  const handleSave = async () => {
    if (isListSaving) return

    const prevInitialVars = [...initialVarsRef.current]
    const prevInitialWorkspaceVars = { ...initialWorkspaceVarsRef.current }
    const mutations: Promise<unknown>[] = []

    try {
      setShowUnsavedChanges(false)
      hasSavedRef.current = true

      const mergedWorkspaceVars = { ...workspaceVars }
      for (const row of newWorkspaceRows) {
        if (row.key && row.value) {
          mergedWorkspaceVars[row.key] = row.value
        }
      }

      initialWorkspaceVarsRef.current = { ...mergedWorkspaceVars }
      initialVarsRef.current = JSON.parse(JSON.stringify(envVars.filter((v) => v.key && v.value)))

      setChangeToken((prev) => prev + 1)

      const validVariables = envVars
        .filter((v) => v.key && v.value)
        .reduce<Record<string, string>>((acc, { key, value }) => ({ ...acc, [key]: value }), {})

      const before = prevInitialWorkspaceVars
      const after = mergedWorkspaceVars
      const toUpsert: Record<string, string> = {}
      const toDelete: string[] = []

      for (const [k, v] of Object.entries(after)) {
        if (!(k in before) || before[k] !== v) {
          toUpsert[k] = v
        }
      }

      for (const k of Object.keys(before)) {
        if (!(k in after)) toDelete.push(k)
      }

      const personalChanged = (() => {
        const initialMap = new Map(
          prevInitialVars.filter((v) => v.key && v.value).map((v) => [v.key, v.value])
        )
        const currentKeys = Object.keys(validVariables)
        if (initialMap.size !== currentKeys.length) return true
        for (const [key, value] of Object.entries(validVariables)) {
          if (initialMap.get(key) !== value) return true
        }
        return false
      })()

      if (personalChanged) {
        mutations.push(savePersonalMutation.mutateAsync({ variables: validVariables }))
      }
      if (workspaceId && (Object.keys(toUpsert).length || toDelete.length)) {
        mutations.push(
          (async () => {
            if (Object.keys(toUpsert).length) {
              await upsertWorkspaceMutation.mutateAsync({ workspaceId, variables: toUpsert })
            }
            if (toDelete.length) {
              await removeWorkspaceMutation.mutateAsync({ workspaceId, keys: toDelete })
            }
          })()
        )
      }

      const results = await Promise.allSettled(mutations)
      const firstFailure = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')
      if (firstFailure) throw firstFailure.reason

      setWorkspaceVars(mergedWorkspaceVars)
      setNewWorkspaceRows([createEmptyEnvVar()])
    } catch (error) {
      hasSavedRef.current = false
      initialVarsRef.current = prevInitialVars
      initialWorkspaceVarsRef.current = prevInitialWorkspaceVars
      logger.error('Failed to save environment variables:', error)
    } finally {
      if (mutations.length > 0) {
        queryClient.invalidateQueries({ queryKey: workspaceCredentialKeys.lists() })
      }
    }
  }

  const handleDiscardAndNavigate = () => {
    shouldBlockNavRef.current = false
    resetNavGuard()
    resetToSaved()
    setSelectedCredentialId(null)

    if (pendingNavigationUrlRef.current) {
      const url = pendingNavigationUrlRef.current
      pendingNavigationUrlRef.current = null
      router.push(url)
    }
  }

  const renderEnvVarRow = (envVar: UIEnvironmentVariable, originalIndex: number) => {
    const isConflict = !!envVar.key && allWorkspaceKeys.has(envVar.key)
    const keyError = validateEnvVarKey(envVar.key)
    const maskedValueStyle =
      focusedValueIndex !== originalIndex && !isConflict
        ? ({ WebkitTextSecurity: 'disc' } as React.CSSProperties)
        : undefined

    const isComplete = Boolean(envVar.key && envVar.value)
    const hasCredential = isComplete && envKeyToCredential.has(envVar.key)

    const hasContent = Boolean(envVar.key || envVar.value)

    return (
      <div className='contents'>
        <EmcnInput
          data-input-type='key'
          value={envVar.key}
          onChange={(e) => updateEnvVar(originalIndex, 'key', e.target.value)}
          onPaste={(e) => handlePaste(e, originalIndex)}
          placeholder='API_KEY'
          name={`env_variable_name_${envVar.id || originalIndex}_${Math.random()}`}
          autoComplete='off'
          autoCapitalize='off'
          spellCheck='false'
          readOnly
          onFocus={(e) => e.target.removeAttribute('readOnly')}
          className={cn(
            'h-9',
            isConflict && CONFLICT_CLASS,
            keyError && 'border-[var(--text-error)]'
          )}
        />
        <div />
        <EmcnInput
          data-input-type='value'
          value={envVar.value}
          onChange={(e) => updateEnvVar(originalIndex, 'value', e.target.value)}
          type='text'
          onFocus={(e) => {
            if (!isConflict) {
              e.target.removeAttribute('readOnly')
              handleValueFocus(originalIndex, e)
            }
          }}
          onClick={handleValueClick}
          onBlur={() => setFocusedValueIndex(null)}
          onPaste={(e) => handlePaste(e, originalIndex)}
          placeholder={isConflict ? 'Workspace override active' : 'Enter value'}
          disabled={isConflict}
          aria-disabled={isConflict}
          name={`env_variable_value_${envVar.id || originalIndex}_${Math.random()}`}
          autoComplete='off'
          autoCapitalize='off'
          spellCheck='false'
          readOnly={isConflict}
          style={maskedValueStyle}
          className={cn(
            'h-9',
            !isComplete && 'col-span-2',
            isConflict && 'cursor-not-allowed',
            isConflict && CONFLICT_CLASS
          )}
        />
        {isComplete && (
          <Button
            variant='default'
            onClick={() => handleViewDetails(envVar.key, 'env_personal')}
            disabled={!hasCredential}
            className={cn('ml-2 h-9', !hasCredential && 'opacity-40')}
          >
            Details
          </Button>
        )}
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <Button
              variant='ghost'
              onClick={() => removeEnvVar(originalIndex)}
              disabled={!hasContent}
              className={cn('h-9 w-9', !hasContent && 'opacity-30')}
            >
              <Trash />
            </Button>
          </Tooltip.Trigger>
          {hasContent && <Tooltip.Content>Delete secret</Tooltip.Content>}
        </Tooltip.Root>
        {keyError && (
          <div
            className={cn(
              COL_SPAN_ALL,
              'mt-[-4px] text-[var(--text-error)] text-caption leading-tight'
            )}
          >
            {keyError}
          </div>
        )}
        {isConflict && !keyError && (
          <div
            className={cn(
              COL_SPAN_ALL,
              'mt-[-4px] text-[var(--text-error)] text-caption leading-tight'
            )}
          >
            Workspace variable with the same name overrides this. Rename your personal key to use
            it.
          </div>
        )}
      </div>
    )
  }

  const isPendingNavigation = pendingNavigationUrlRef.current !== null

  // Detail view (matches integrations detail page layout)
  if (selectedCredential) {
    return (
      <>
        <div className='flex h-full flex-col gap-4.5'>
          <div className='min-h-0 flex-1 overflow-y-auto'>
            <div className='flex flex-col gap-4.5'>
              <div className='flex items-center gap-2.5 border-[var(--border)] border-b pb-3'>
                <div className='flex h-9 w-9 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[var(--surface-5)]'>
                  <Key className='h-[18px] w-[18px] text-[var(--text-tertiary)]' />
                </div>
                <div className='min-w-0 flex-1'>
                  <div className='flex items-center gap-2'>
                    <p className='truncate font-medium text-[var(--text-primary)] text-base'>
                      {selectedCredential.envKey || selectedCredential.displayName}
                    </p>
                    <Badge variant='gray-secondary' size='sm'>
                      {selectedCredential.type === 'env_personal' ? 'personal' : 'workspace'}
                    </Badge>
                    {selectedCredential.role && (
                      <Badge variant='gray-secondary' size='sm'>
                        {selectedCredential.role}
                      </Badge>
                    )}
                  </div>
                  <p className='text-[var(--text-muted)] text-small'>
                    {selectedCredential.type === 'env_personal'
                      ? 'Personal secret'
                      : 'Workspace secret'}
                  </p>
                </div>
              </div>

              <div className='flex flex-col gap-1.5'>
                <Label className='flex items-center gap-1.5'>
                  Display Name
                  <Tooltip.Root>
                    <Tooltip.Trigger asChild>
                      <Button
                        variant='ghost'
                        type='button'
                        className='-my-1 h-5 w-5 p-0'
                        onClick={() => {
                          navigator.clipboard.writeText(selectedCredential.id)
                          setCopyIdSuccess(true)
                          setTimeout(() => setCopyIdSuccess(false), 2000)
                        }}
                        aria-label='Copy value'
                      >
                        {copyIdSuccess ? (
                          <Check className='h-3 w-3 text-[var(--success)]' />
                        ) : (
                          <Clipboard className='h-3 w-3 text-[var(--text-icon)]' />
                        )}
                      </Button>
                    </Tooltip.Trigger>
                    <Tooltip.Content>
                      {copyIdSuccess ? 'Copied!' : 'Copy credential ID'}
                    </Tooltip.Content>
                  </Tooltip.Root>
                </Label>
                <EmcnInput
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

                        {isSelectedAdmin ? (
                          <>
                            <Combobox
                              options={ROLE_OPTIONS.map((option) => ({
                                value: option.value,
                                label: option.label,
                              }))}
                              value={
                                ROLE_OPTIONS.find((option) => option.value === member.role)
                                  ?.label || ''
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
                            <Button
                              variant='ghost'
                              onClick={() => handleRemoveMember(member.userId)}
                              disabled={member.role === 'admin' && adminMemberCount <= 1}
                              className='w-full justify-end'
                            >
                              Remove
                            </Button>
                          </>
                        ) : (
                          <>
                            <Badge variant='gray-secondary'>{member.role}</Badge>
                            <div />
                          </>
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
                          options={ROLE_OPTIONS.map((option) => ({
                            value: option.value,
                            label: option.label,
                          }))}
                          value={
                            ROLE_OPTIONS.find((option) => option.value === memberRole)?.label || ''
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

          <div className='mt-auto flex items-center justify-end border-[var(--border)] border-t pt-2.5'>
            <div className='flex items-center gap-2'>
              <Button onClick={handleBackAttempt} variant='default'>
                Back
              </Button>
              {isSelectedAdmin && (
                <Button
                  variant='primary'
                  onClick={handleSaveDetails}
                  disabled={!isDetailsDirty || updateCredential.isPending}
                >
                  {updateCredential.isPending ? 'Saving...' : 'Save'}
                </Button>
              )}
            </div>
          </div>
        </div>

        <Modal open={showDetailUnsavedChanges} onOpenChange={setShowDetailUnsavedChanges}>
          <ModalContent size='sm'>
            <ModalHeader>Unsaved Changes</ModalHeader>
            <ModalBody>
              <p className='text-[var(--text-secondary)]'>
                You have unsaved changes. Are you sure you want to discard them?
              </p>
            </ModalBody>
            <ModalFooter>
              <Button variant='default' onClick={() => setShowDetailUnsavedChanges(false)}>
                Keep Editing
              </Button>
              <Button variant='destructive' onClick={handleDiscardDetailChanges}>
                Discard Changes
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>

        <Modal open={showUnsavedChanges} onOpenChange={setShowUnsavedChanges}>
          <ModalContent size='sm'>
            <ModalHeader>Unsaved Changes</ModalHeader>
            <ModalBody>
              <p className='text-[var(--text-secondary)]'>
                You have unsaved changes. Are you sure you want to discard them?
              </p>
            </ModalBody>
            <ModalFooter>
              <Button variant='default' onClick={() => setShowUnsavedChanges(false)}>
                Keep Editing
              </Button>
              <Button variant='destructive' onClick={handleDiscardAndNavigate}>
                Discard Changes
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>
      </>
    )
  }

  return (
    <>
      <div className='flex h-full flex-col gap-4'>
        <div className='hidden'>
          <input
            type='text'
            name='fakeusernameremembered'
            autoComplete='username'
            tabIndex={-1}
            readOnly
          />
          <input
            type='password'
            name='fakepasswordremembered'
            autoComplete='current-password'
            tabIndex={-1}
            readOnly
          />
          <input
            type='email'
            name='fakeemailremembered'
            autoComplete='email'
            tabIndex={-1}
            readOnly
          />
        </div>
        <div className='flex items-center gap-2'>
          <div className='flex flex-1 items-center gap-2 rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 transition-colors duration-100 dark:bg-[var(--surface-4)] dark:hover-hover:border-[var(--border-1)] dark:hover-hover:bg-[var(--surface-5)]'>
            <Search
              className='h-[14px] w-[14px] flex-shrink-0 text-[var(--text-tertiary)]'
              strokeWidth={2}
            />
            <Input
              placeholder='Search secrets...'
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              name='env_search_field'
              autoComplete='off'
              autoCapitalize='off'
              spellCheck='false'
              readOnly
              onFocus={(e) => e.target.removeAttribute('readOnly')}
              className='h-auto flex-1 border-0 bg-transparent p-0 font-base leading-none placeholder:text-[var(--text-tertiary)] focus-visible:ring-0 focus-visible:ring-offset-0'
            />
          </div>
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <Button
                onClick={handleSave}
                disabled={
                  isLoading || !hasChanges || hasConflicts || hasInvalidKeys || isListSaving
                }
                variant='primary'
                className={cn((hasConflicts || hasInvalidKeys) && 'cursor-not-allowed opacity-50')}
              >
                {isListSaving ? 'Saving...' : 'Save'}
              </Button>
            </Tooltip.Trigger>
            {hasConflicts && <Tooltip.Content>Resolve all conflicts before saving</Tooltip.Content>}
            {hasInvalidKeys && !hasConflicts && (
              <Tooltip.Content>Fix invalid variable names before saving</Tooltip.Content>
            )}
          </Tooltip.Root>
        </div>

        <div ref={scrollContainerRef} className='min-h-0 flex-1 overflow-y-auto'>
          <div className='flex flex-col gap-4'>
            {isLoading ? (
              <>
                <div className='flex flex-col gap-2'>
                  <Skeleton className='h-5 w-[70px]' />
                  <div className='text-[var(--text-muted)] text-small'>
                    <Skeleton className='h-5 w-[160px]' />
                  </div>
                </div>
                <div className={cn(GRID_COLS, 'gap-y-2')}>
                  <Skeleton className={cn(COL_SPAN_ALL, 'h-5 w-[55px]')} />
                  {Array.from({ length: 2 }, (_, i) => (
                    <div key={`personal-${i}`} className='contents'>
                      <Skeleton className='h-9 rounded-md' />
                      <div />
                      <Skeleton className='h-9 rounded-md' />
                      <Skeleton className='ml-2 h-9 w-[60px] rounded-md' />
                      <Skeleton className='h-9 w-9 rounded-md' />
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className={cn(GRID_COLS, 'gap-y-2')}>
                {(!searchTerm.trim() ||
                  filteredWorkspaceEntries.length > 0 ||
                  filteredNewWorkspaceRows.length > 0) && (
                  <>
                    <div
                      className={cn(
                        COL_SPAN_ALL,
                        'font-medium text-[var(--text-secondary)] text-small'
                      )}
                    >
                      Workspace
                    </div>
                    {(searchTerm.trim()
                      ? filteredWorkspaceEntries
                      : Object.entries(workspaceVars)
                    ).map(([key, value]) => (
                      <WorkspaceVariableRow
                        key={key}
                        envKey={key}
                        value={value}
                        renamingKey={renamingKey}
                        pendingKeyValue={pendingKeyValue}
                        hasCredential={envKeyToCredential.has(key)}
                        canEdit={isWorkspaceAdmin}
                        onRenameStart={setRenamingKey}
                        onPendingKeyChange={setPendingKeyValue}
                        onRenameEnd={handleWorkspaceKeyRename}
                        onValueChange={handleWorkspaceValueChange}
                        onDelete={handleDeleteWorkspaceVar}
                        onViewDetails={(envKey) => handleViewDetails(envKey, 'env_workspace')}
                      />
                    ))}
                    {isWorkspaceAdmin &&
                      (searchTerm.trim()
                        ? filteredNewWorkspaceRows
                        : newWorkspaceRows.map((row, index) => ({ row, originalIndex: index }))
                      ).map(({ row, originalIndex }) => (
                        <NewWorkspaceVariableRow
                          key={row.id || originalIndex}
                          envVar={row}
                          index={originalIndex}
                          onUpdate={updateNewWorkspaceRow}
                          onPaste={handleWorkspacePaste}
                        />
                      ))}
                    <div className={cn(COL_SPAN_ALL, 'h-[8px]')} />
                  </>
                )}

                {(!searchTerm.trim() || filteredEnvVars.length > 0) && (
                  <>
                    <div
                      className={cn(
                        COL_SPAN_ALL,
                        'font-medium text-[var(--text-secondary)] text-small'
                      )}
                    >
                      Personal
                    </div>
                    {filteredEnvVars.map(({ envVar, originalIndex }) => (
                      <div key={envVar.id || originalIndex} className='contents'>
                        {renderEnvVarRow(envVar, originalIndex)}
                      </div>
                    ))}
                  </>
                )}
                {searchTerm.trim() &&
                  filteredEnvVars.length === 0 &&
                  filteredWorkspaceEntries.length === 0 &&
                  filteredNewWorkspaceRows.length === 0 &&
                  (envVars.length > 0 ||
                    Object.keys(workspaceVars).length > 0 ||
                    newWorkspaceRows.length > 0) && (
                    <div
                      className={cn(
                        COL_SPAN_ALL,
                        'py-4 text-center text-[var(--text-muted)] text-small'
                      )}
                    >
                      No secrets found matching &ldquo;{searchTerm}&rdquo;
                    </div>
                  )}
              </div>
            )}
          </div>
        </div>
      </div>

      <Modal open={showUnsavedChanges} onOpenChange={setShowUnsavedChanges}>
        <ModalContent size='sm'>
          <ModalHeader>Unsaved Changes</ModalHeader>
          <ModalBody>
            <p className='text-[var(--text-secondary)]'>
              You have unsaved changes. Are you sure you want to discard them?
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant='default' onClick={() => setShowUnsavedChanges(false)}>
              Keep Editing
            </Button>
            <Button
              variant='destructive'
              onClick={isPendingNavigation ? handleDiscardAndNavigate : handleCancel}
            >
              Discard Changes
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  )
}
