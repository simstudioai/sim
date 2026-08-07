'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { ChipConfirmModal, ChipInput, cn, toast } from '@sim/emcn'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { useQueryClient } from '@tanstack/react-query'
import { useParams, useRouter } from 'next/navigation'
import { canMutateWorkspaceSettingsSection } from '@/components/settings/navigation'
import { saveDiscardActions } from '@/components/settings/save-discard-actions'
import type { EnvVisibility } from '@/lib/api/contracts/environment'
import {
  clearPendingCredentialCreateRequest,
  PENDING_CREDENTIAL_CREATE_REQUEST_EVENT,
  type PendingCredentialCreateRequest,
  readPendingCredentialCreateRequest,
} from '@/lib/credentials/client-state'
import { UnsavedChangesModal } from '@/app/workspace/[workspaceId]/components/credential-detail'
import { RowActionsMenu } from '@/app/workspace/[workspaceId]/settings/components/row-actions-menu'
import { SecretValueField } from '@/app/workspace/[workspaceId]/settings/components/secrets/components/secret-value-field'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import { useSettingsSearch } from '@/app/workspace/[workspaceId]/settings/components/use-settings-search'
import { isValidEnvVarName } from '@/executor/constants'
import { useWorkspaceCredentials, type WorkspaceCredential } from '@/hooks/queries/credentials'
import {
  usePersonalEnvironment,
  useRemoveWorkspaceEnvironment,
  useSavePersonalEnvironment,
  useUpsertWorkspaceEnvironment,
  useWorkspaceEnvironment,
} from '@/hooks/queries/environment'
import { workspaceCredentialKeys } from '@/hooks/queries/utils/credential-keys'
import { useWorkspacePermissionsQuery } from '@/hooks/queries/workspace'
import { useSettingsDirtyStore } from '@/stores/settings/dirty/store'

const logger = createLogger('SecretsManager')

const GRID_COLS = 'grid grid-cols-[minmax(0,1fr)_8px_minmax(0,1fr)_auto] items-center'
const COL_SPAN_ALL = 'col-span-4'

/** Copies a secret's name and confirms with a toast. */
function copyName(key: string) {
  void navigator.clipboard.writeText(key)
  toast.success('Copied name to clipboard')
}

interface SecretRowMenuProps {
  /** Copies the secret's name. */
  onCopyName: () => void
  /** Opens credential details; omit when the row has no backing credential. */
  onViewDetails?: () => void
  /** Deletes the secret (or clears the draft row); omit when the caller can't delete. */
  onDelete?: () => void
  /** Flips the row between secret and non-secret; omit when the caller can't. */
  onToggleVisibility?: () => void
  /** Current disclosure policy, used to label the toggle. */
  visibility?: EnvVisibility
}

/**
 * Trailing `...` actions menu for a secret row. Mirrors the Teammates /
 * Organization member menu so the settings experience is consistent.
 */
function SecretRowMenu({
  onCopyName,
  onViewDetails,
  onDelete,
  onToggleVisibility,
  visibility = 'secret',
}: SecretRowMenuProps) {
  return (
    <RowActionsMenu
      label='Secret actions'
      triggerClassName='ml-2'
      actions={[
        ...(onViewDetails ? [{ label: 'View details', onSelect: onViewDetails }] : []),
        { label: 'Copy name', onSelect: onCopyName },
        ...(onToggleVisibility
          ? [
              {
                label:
                  visibility === 'variable' ? 'Change to secret' : 'Change to non-secret variable',
                onSelect: onToggleVisibility,
              },
            ]
          : []),
        ...(onDelete ? [{ label: 'Delete', destructive: true, onSelect: onDelete }] : []),
      ]}
    />
  )
}

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
  const result: UIEnvironmentVariable[] = []
  for (const line of lines) {
    const parsed = parseEnvVarLine(line)
    if (parsed?.key && parsed.value) {
      result.push(parsed)
    }
  }
  return result
}

interface WorkspaceVariableRowProps {
  envKey: string
  value: string
  renamingKey: string | null
  pendingKeyValue: string
  hasCredential: boolean
  canEdit: boolean
  /** Renaming creates a new key + deletes the old, so it also needs create access. */
  canRename: boolean
  onRenameStart: (key: string) => void
  onPendingKeyChange: (value: string) => void
  onRenameEnd: (key: string, value: string) => void
  onValueChange: (key: string, value: string) => void
  onDelete: (key: string) => void
  onViewDetails?: (envKey: string) => void
  /** Disclosure policy for this key; `variable` renders the value unmasked. */
  visibility: EnvVisibility
  /** Flips the disclosure policy; omit when the caller can't administer the key. */
  onToggleVisibility?: (envKey: string, next: EnvVisibility) => void
}

function WorkspaceVariableRow({
  envKey,
  value,
  renamingKey,
  pendingKeyValue,
  hasCredential,
  canEdit,
  canRename,
  onRenameStart,
  onPendingKeyChange,
  onRenameEnd,
  onValueChange,
  onDelete,
  onViewDetails,
  visibility,
  onToggleVisibility,
}: WorkspaceVariableRowProps) {
  /**
   * Salts the generated `name` attributes so password managers can't match them
   * against a known field. `useId` is stable across SSR and hydration and across
   * re-renders — a fresh `generateShortId()` per render would patch six DOM
   * attributes on every keystroke, and a module-scope one would differ between
   * the server and browser bundles.
   */
  const autofillSalt = useId()

  return (
    <div className='contents'>
      <ChipInput
        className={cn(!canRename && 'cursor-text')}
        value={renamingKey === envKey ? pendingKeyValue : envKey}
        onChange={(e) => {
          if (renamingKey !== envKey) onRenameStart(envKey)
          onPendingKeyChange(e.target.value)
        }}
        onBlur={() => onRenameEnd(envKey, value)}
        name={`workspace_env_key_${envKey}_${autofillSalt}`}
        autoComplete='off'
        autoCapitalize='off'
        spellCheck='false'
        readOnly
        onFocus={(e) => {
          if (canRename) e.target.removeAttribute('readOnly')
        }}
      />
      <div />
      <SecretValueField
        value={value}
        onChange={(next) => onValueChange(envKey, next)}
        canEdit={canEdit}
        visibility={visibility}
        name={`workspace_env_value_${envKey}_${autofillSalt}`}
      />
      {/*
        No per-row kind tag: the section heading already says which kind this is,
        and a tag in the trailing `auto` track widened the column and knocked
        every other row's `...` out of alignment.
      */}
      <SecretRowMenu
        onCopyName={() => copyName(envKey)}
        onViewDetails={hasCredential && onViewDetails ? () => onViewDetails(envKey) : undefined}
        onDelete={canEdit ? () => onDelete(envKey) : undefined}
        visibility={visibility}
        onToggleVisibility={
          canEdit && onToggleVisibility
            ? () => onToggleVisibility(envKey, visibility === 'variable' ? 'secret' : 'variable')
            : undefined
        }
      />
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
  /**
   * Salts the generated `name` attributes so password managers can't match them
   * against a known field. `useId` is stable across SSR and hydration and across
   * re-renders — a fresh `generateShortId()` per render would patch six DOM
   * attributes on every keystroke, and a module-scope one would differ between
   * the server and browser bundles.
   */
  const autofillSalt = useId()

  const keyError = validateEnvVarKey(envVar.key)
  const hasContent = Boolean(envVar.key || envVar.value)

  return (
    <div className='contents'>
      <ChipInput
        data-input-type='key'
        error={Boolean(keyError)}
        value={envVar.key}
        onChange={(e) => onUpdate(index, 'key', e.target.value)}
        onPaste={onPaste ? (e) => onPaste(e, index) : undefined}
        placeholder='API_KEY'
        name={`new_workspace_key_${envVar.id || index}_${autofillSalt}`}
        autoComplete='off'
        autoCapitalize='off'
        spellCheck='false'
        readOnly
        onFocus={(e) => e.target.removeAttribute('readOnly')}
      />
      <div />
      <SecretValueField
        data-input-type='value'
        value={envVar.value}
        onChange={(next) => onUpdate(index, 'value', next)}
        onPaste={onPaste ? (e) => onPaste(e, index) : undefined}
        placeholder='Enter value'
        name={`new_workspace_value_${envVar.id || index}_${autofillSalt}`}
        className='ml-0'
      />
      {hasContent ? (
        <SecretRowMenu
          onCopyName={() => copyName(envVar.key)}
          onDelete={() => {
            onUpdate(index, 'key', '')
            onUpdate(index, 'value', '')
          }}
        />
      ) : (
        <div />
      )}
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

export function SecretsManager() {
  /**
   * Salts the generated `name` attributes so password managers can't match them
   * against a known field. `useId` is stable across SSR and hydration and across
   * re-renders — a fresh `generateShortId()` per render would patch six DOM
   * attributes on every keystroke, and a module-scope one would differ between
   * the server and browser bundles.
   */
  const autofillSalt = useId()

  const params = useParams()
  const router = useRouter()
  const workspaceId = (params?.workspaceId as string) || ''

  const { data: personalEnvData, isLoading: isPersonalLoading } = usePersonalEnvironment()
  const { data: workspaceEnvData, isLoading: isWorkspaceLoading } =
    useWorkspaceEnvironment(workspaceId)
  const savePersonalMutation = useSavePersonalEnvironment()
  const upsertWorkspaceMutation = useUpsertWorkspaceEnvironment()
  const removeWorkspaceMutation = useRemoveWorkspaceEnvironment()

  const { data: workspaceEnvCredentials = [] } = useWorkspaceCredentials({
    workspaceId,
    type: 'env_workspace',
    enabled: Boolean(workspaceId),
  })

  const { data: workspacePermissions } = useWorkspacePermissionsQuery(workspaceId || null)
  const queryClient = useQueryClient()

  const isWorkspaceAdmin = workspacePermissions?.viewer?.isAdmin ?? false
  const canCreateWorkspaceSecret = canMutateWorkspaceSettingsSection('secrets', {
    canEdit: isWorkspaceAdmin || workspacePermissions?.viewer?.permissionType === 'write',
    canAdmin: isWorkspaceAdmin,
  })

  const isLoading = isPersonalLoading || isWorkspaceLoading

  const [envVars, setEnvVars] = useState<UIEnvironmentVariable[]>([])
  // One draft array per section. A single array carrying a `kind` looked
  // tempting, but `updateEnvVarArray`'s auto-add/auto-remove keys off "is this
  // the LAST row", which stops meaning anything once two kinds are interleaved.
  const [newWorkspaceRows, setNewWorkspaceRows] = useState<UIEnvironmentVariable[]>([
    createEmptyEnvVar(),
  ])
  const [newWorkspaceVariableRows, setNewWorkspaceVariableRows] = useState<UIEnvironmentVariable[]>(
    [createEmptyEnvVar()]
  )
  const [searchTerm, setSearchTerm] = useSettingsSearch()
  const [showUnsavedChanges, setShowUnsavedChanges] = useState(false)
  const [workspaceVars, setWorkspaceVars] = useState<Record<string, string>>({})
  const [renamingKey, setRenamingKey] = useState<string | null>(null)
  const [pendingKeyValue, setPendingKeyValue] = useState<string>('')
  const [pendingVisibilityChange, setPendingVisibilityChange] = useState<{
    envKey: string
    next: EnvVisibility
  } | null>(null)
  const initialWorkspaceVarsRef = useRef<Record<string, string>>({})
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const initialVarsRef = useRef<UIEnvironmentVariable[]>([])
  const hasChangesRef = useRef(false)
  const hasSavedPersonalRef = useRef(false)
  const hasSavedWorkspaceRef = useRef(false)
  const shouldBlockNavRef = useRef(false)
  const pendingNavigationUrlRef = useRef<string | null>(null)

  const workspaceEnvKeyToCredential = useMemo(() => {
    const map = new Map<string, WorkspaceCredential>()
    for (const cred of workspaceEnvCredentials) {
      if (cred.envKey) map.set(cred.envKey, cred)
    }
    return map
  }, [workspaceEnvCredentials])

  /**
   * Applies a confirmed disclosure change. Sent as a visibility-only PUT — the
   * value is untouched, so re-sending it would only mean a redundant re-encrypt.
   */
  const handleConfirmVisibilityChange = useCallback(async () => {
    if (!pendingVisibilityChange || !workspaceId) return
    const { envKey, next } = pendingVisibilityChange
    setPendingVisibilityChange(null)
    try {
      await upsertWorkspaceMutation.mutateAsync({
        workspaceId,
        variables: {},
        visibility: { [envKey]: next },
      })
      toast.success(
        next === 'variable' ? `${envKey} is now a non-secret variable` : `${envKey} is now a secret`
      )
    } catch (error) {
      logger.error('Failed to change secret visibility', { error })
      toast.error(getErrorMessage(error, 'Failed to change visibility'))
    }
  }, [pendingVisibilityChange, workspaceId, upsertWorkspaceMutation])

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

  const filteredNewWorkspaceVariableRows = useMemo(() => {
    const mapped = newWorkspaceVariableRows.map((row, index) => ({ row, originalIndex: index }))
    if (!searchTerm.trim()) return mapped
    const term = searchTerm.toLowerCase()
    return mapped.filter(({ row }) => row.key.toLowerCase().includes(term))
  }, [newWorkspaceVariableRows, searchTerm])

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
    if (newWorkspaceVariableRows.some((row) => row.key && row.value)) return true

    return false
  }, [envVars, workspaceVars, newWorkspaceRows, newWorkspaceVariableRows])

  const hasConflicts = useMemo(() => {
    return envVars.some((envVar) => !!envVar.key && allWorkspaceKeys.has(envVar.key))
  }, [envVars, allWorkspaceKeys])

  /**
   * Names drafted in one workspace section that already exist in the other, or
   * in both drafts at once. A new key only takes its section's visibility on
   * create; saving a name that already exists would quietly keep the old
   * policy, so this blocks the save instead of producing a row whose section
   * lies about its kind.
   */
  const duplicateDraftKeys = useMemo(() => {
    const savedVisibility = workspaceEnvData?.visibility ?? {}
    const clashes = new Set<string>()
    const secretDraftKeys = new Set(newWorkspaceRows.filter((r) => r.key).map((r) => r.key))
    for (const row of newWorkspaceVariableRows) {
      if (!row.key) continue
      if (secretDraftKeys.has(row.key)) clashes.add(row.key)
      if (savedVisibility[row.key] === 'secret') clashes.add(row.key)
    }
    for (const row of newWorkspaceRows) {
      if (row.key && savedVisibility[row.key] === 'variable') clashes.add(row.key)
    }
    return clashes
  }, [newWorkspaceRows, newWorkspaceVariableRows, workspaceEnvData?.visibility])

  const hasInvalidKeys = useMemo(() => {
    const personalInvalid = envVars.some((envVar) => !!envVar.key && validateEnvVarKey(envVar.key))
    const workspaceInvalid = [...newWorkspaceRows, ...newWorkspaceVariableRows].some(
      (row) => !!row.key && validateEnvVarKey(row.key)
    )
    return personalInvalid || workspaceInvalid
  }, [envVars, newWorkspaceRows, newWorkspaceVariableRows])

  const isListSaving =
    savePersonalMutation.isPending ||
    upsertWorkspaceMutation.isPending ||
    removeWorkspaceMutation.isPending

  hasChangesRef.current = hasChanges
  shouldBlockNavRef.current = hasChanges

  const setNavGuardDirty = useSettingsDirtyStore((s) => s.setDirty)
  const resetNavGuard = useSettingsDirtyStore((s) => s.reset)

  useEffect(() => {
    setNavGuardDirty(hasChanges)
  }, [hasChanges, setNavGuardDirty])

  useEffect(() => () => resetNavGuard(), [resetNavGuard])

  useEffect(() => {
    if (hasSavedPersonalRef.current) {
      hasSavedPersonalRef.current = false
      return
    }

    const existingVars = Object.values(personalEnvData || {})
    const initialVars = [
      ...existingVars.map((envVar) => ({
        ...envVar,
        id: generateRowId(),
      })),
      createEmptyEnvVar(),
    ]
    initialVarsRef.current = structuredClone(initialVars)
    setEnvVars(structuredClone(initialVars))
  }, [personalEnvData])

  useEffect(() => {
    if (!workspaceEnvData) return
    if (hasSavedWorkspaceRef.current) {
      hasSavedWorkspaceRef.current = false
      return
    }
    setWorkspaceVars(workspaceEnvData.workspace || {})
    initialWorkspaceVarsRef.current = workspaceEnvData.workspace || {}
  }, [workspaceEnvData])

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      scrollContainerRef.current?.scrollTo({
        top: scrollContainerRef.current.scrollHeight,
        behavior: 'smooth',
      })
    })
  }, [])

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

  const handleViewDetails = (envKey: string) => {
    const existing = workspaceEnvKeyToCredential.get(envKey)
    if (!existing) return
    const url = `/workspace/${workspaceId}/settings/secrets/${existing.id}`
    if (shouldBlockNavRef.current) {
      pendingNavigationUrlRef.current = url
      setShowUnsavedChanges(true)
      return
    }
    router.push(url)
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

  const updateNewWorkspaceVariableRow = (index: number, field: 'key' | 'value', value: string) => {
    setNewWorkspaceVariableRows((prev) => updateEnvVarArray(prev, index, field, value))
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
    setEnvVars(structuredClone(initialVarsRef.current))
    setWorkspaceVars({ ...initialWorkspaceVarsRef.current })
    setNewWorkspaceRows([createEmptyEnvVar()])
    setNewWorkspaceVariableRows([createEmptyEnvVar()])
    setShowUnsavedChanges(false)
  }

  const handleCancel = resetToSaved

  /**
   * Saved workspace rows in render order, paired with their disclosure policy so
   * each section can take its own slice. Derived once rather than filtered twice
   * so the two sections cannot disagree about which kind a key is.
   */
  const workspaceEntriesForRender = useMemo(() => {
    const entries = searchTerm.trim() ? filteredWorkspaceEntries : Object.entries(workspaceVars)
    const visibilityMap = workspaceEnvData?.visibility ?? {}
    return entries.map(([key, value]) => ({
      key,
      value,
      visibility: visibilityMap[key] ?? ('secret' as EnvVisibility),
    }))
  }, [searchTerm, filteredWorkspaceEntries, workspaceVars, workspaceEnvData?.visibility])

  /**
   * Renders one workspace section. Both sections share the row component and
   * grid; only the slice of saved rows, the draft array, and the label differ.
   * A section always renders when the search box is empty, so its draft row is
   * there to create that kind directly.
   */
  const renderWorkspaceSection = ({
    label,
    visibility,
    entries,
    draftRows,
    onUpdateDraft,
  }: {
    label: string
    visibility: EnvVisibility
    entries: Array<{ key: string; value: string; visibility: EnvVisibility }>
    draftRows: Array<{ row: UIEnvironmentVariable; originalIndex: number }>
    onUpdateDraft: (index: number, field: 'key' | 'value', value: string) => void
  }) => {
    const rows = entries.filter((entry) => entry.visibility === visibility)
    const searching = Boolean(searchTerm.trim())
    if (searching && rows.length === 0 && draftRows.length === 0) return null

    return (
      <SettingsSection label={label}>
        <div className={`${GRID_COLS} gap-y-2`}>
          {rows.map(({ key, value }) => {
            const cred = workspaceEnvKeyToCredential.get(key)
            const canEditRow = canCreateWorkspaceSecret && cred?.role === 'admin'
            return (
              <WorkspaceVariableRow
                key={key}
                envKey={key}
                value={value}
                renamingKey={renamingKey}
                pendingKeyValue={pendingKeyValue}
                hasCredential={Boolean(cred)}
                canEdit={canEditRow}
                canRename={canCreateWorkspaceSecret && canEditRow}
                onRenameStart={setRenamingKey}
                onPendingKeyChange={setPendingKeyValue}
                onRenameEnd={handleWorkspaceKeyRename}
                onValueChange={handleWorkspaceValueChange}
                onDelete={handleDeleteWorkspaceVar}
                onViewDetails={canCreateWorkspaceSecret && cred ? handleViewDetails : undefined}
                visibility={visibility}
                onToggleVisibility={
                  cred ? (envKey, next) => setPendingVisibilityChange({ envKey, next }) : undefined
                }
              />
            )
          })}
          {canCreateWorkspaceSecret &&
            draftRows.map(({ row, originalIndex }) => (
              <NewWorkspaceVariableRow
                key={row.id || originalIndex}
                envVar={row}
                index={originalIndex}
                onUpdate={onUpdateDraft}
                onPaste={handleWorkspacePaste}
              />
            ))}
        </div>
      </SettingsSection>
    )
  }

  const handleSave = async () => {
    if (isListSaving) return

    const mutations: Promise<unknown>[] = []

    setShowUnsavedChanges(false)

    const mergedWorkspaceVars = { ...workspaceVars }
    for (const row of newWorkspaceRows) {
      if (row.key && row.value) {
        mergedWorkspaceVars[row.key] = row.value
      }
    }
    // Names drafted in the Variables section. Only NEW keys can take a
    // visibility here — the server never flips an existing key through this
    // path (that needs the confirmed disclosure flow), which is why
    // `duplicateDraftKeys` blocks saving a name that already exists as a secret
    // rather than letting it save and silently stay secret.
    const draftVariableVisibility: Record<string, EnvVisibility> = {}
    for (const row of newWorkspaceVariableRows) {
      if (row.key && row.value) {
        mergedWorkspaceVars[row.key] = row.value
        draftVariableVisibility[row.key] = 'variable'
      }
    }

    const validVariables = envVars
      .filter((v) => v.key && v.value)
      .reduce<Record<string, string>>((acc, { key, value }) => ({ ...acc, [key]: value }), {})

    const before = initialWorkspaceVarsRef.current
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
      const initialMap = new Map<string, string>()
      for (const v of initialVarsRef.current) {
        if (v.key && v.value) initialMap.set(v.key, v.value)
      }
      const currentKeys = Object.keys(validVariables)
      if (initialMap.size !== currentKeys.length) return true
      for (const [key, value] of Object.entries(validVariables)) {
        if (initialMap.get(key) !== value) return true
      }
      return false
    })()

    const workspaceChanged =
      workspaceId && (Object.keys(toUpsert).length > 0 || toDelete.length > 0)

    if (personalChanged) {
      mutations.push(savePersonalMutation.mutateAsync({ variables: validVariables }))
    }
    if (workspaceChanged) {
      mutations.push(
        (async () => {
          if (Object.keys(toUpsert).length) {
            const visibility = Object.fromEntries(
              Object.keys(toUpsert)
                .filter((key) => draftVariableVisibility[key])
                .map((key) => [key, draftVariableVisibility[key]])
            )
            await upsertWorkspaceMutation.mutateAsync({
              workspaceId,
              variables: toUpsert,
              ...(Object.keys(visibility).length ? { visibility } : {}),
            })
          }
          if (toDelete.length) {
            await removeWorkspaceMutation.mutateAsync({ workspaceId, keys: toDelete })
          }
        })()
      )
    }

    hasSavedPersonalRef.current = personalChanged
    hasSavedWorkspaceRef.current = Boolean(workspaceChanged)

    try {
      const results = await Promise.allSettled(mutations)
      const firstFailure = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')
      if (firstFailure) throw firstFailure.reason

      initialWorkspaceVarsRef.current = { ...mergedWorkspaceVars }
      initialVarsRef.current = structuredClone(envVars.filter((v) => v.key && v.value))

      setWorkspaceVars(mergedWorkspaceVars)
      // Both draft arrays clear: the saved rows now render from workspaceVars,
      // so leaving either behind shows the same key twice — once saved, once
      // still drafted.
      setNewWorkspaceRows([createEmptyEnvVar()])
      setNewWorkspaceVariableRows([createEmptyEnvVar()])
      if (mutations.length > 0) {
        toast.success('Secrets saved')
      }
    } catch (error) {
      hasSavedPersonalRef.current = false
      hasSavedWorkspaceRef.current = false
      logger.error('Failed to save environment variables:', error)
      toast.error('Failed to save secrets')
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

    if (pendingNavigationUrlRef.current) {
      const url = pendingNavigationUrlRef.current
      pendingNavigationUrlRef.current = null
      router.push(url)
    }
  }

  const renderEnvVarRow = (envVar: UIEnvironmentVariable, originalIndex: number) => {
    const isConflicted = !!envVar.key && allWorkspaceKeys.has(envVar.key)
    const keyError = validateEnvVarKey(envVar.key)

    const hasContent = Boolean(envVar.key || envVar.value)

    return (
      <div className='contents'>
        <ChipInput
          data-input-type='key'
          error={Boolean(isConflicted || keyError)}
          value={envVar.key}
          onChange={(e) => updateEnvVar(originalIndex, 'key', e.target.value)}
          onPaste={(e) => handlePaste(e, originalIndex)}
          placeholder='API_KEY'
          name={`env_variable_name_${envVar.id || originalIndex}_${autofillSalt}`}
          autoComplete='off'
          autoCapitalize='off'
          spellCheck='false'
          readOnly
          onFocus={(e) => e.target.removeAttribute('readOnly')}
        />
        <div />
        <SecretValueField
          data-input-type='value'
          value={envVar.value}
          onChange={(next) => updateEnvVar(originalIndex, 'value', next)}
          onPaste={(e) => handlePaste(e, originalIndex)}
          unmasked={isConflicted}
          readOnly={isConflicted}
          placeholder={isConflicted ? 'Workspace override active' : 'Enter value'}
          name={`env_variable_value_${envVar.id || originalIndex}_${autofillSalt}`}
          className={cn(isConflicted && 'cursor-not-allowed opacity-50')}
        />
        {hasContent ? (
          <SecretRowMenu
            onCopyName={() => copyName(envVar.key)}
            onDelete={() => removeEnvVar(originalIndex)}
          />
        ) : (
          <div />
        )}
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
        {isConflicted && !keyError && (
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

  return (
    <>
      <div className='hidden' aria-hidden='true'>
        <input
          type='text'
          name='fakeusernameremembered'
          autoComplete='username'
          tabIndex={-1}
          readOnly
          aria-hidden='true'
        />
        <input
          type='password'
          name='fakepasswordremembered'
          autoComplete='current-password'
          tabIndex={-1}
          readOnly
          aria-hidden='true'
        />
        <input
          type='email'
          name='fakeemailremembered'
          autoComplete='email'
          tabIndex={-1}
          readOnly
          aria-hidden='true'
        />
      </div>

      <SettingsPanel
        scrollContainerRef={scrollContainerRef}
        search={{
          value: searchTerm,
          onChange: setSearchTerm,
          placeholder: 'Search secrets...',
        }}
        actions={saveDiscardActions({
          dirty: hasChanges,
          saving: isListSaving,
          onSave: handleSave,
          onDiscard: handleCancel,
          saveDisabled: hasConflicts || hasInvalidKeys || duplicateDraftKeys.size > 0 || isLoading,
          saveTooltip: hasConflicts
            ? 'Resolve all conflicts before saving'
            : hasInvalidKeys
              ? 'Fix invalid variable names before saving'
              : duplicateDraftKeys.size > 0
                ? `${[...duplicateDraftKeys].join(', ')} already exists in the other section`
                : undefined,
        })}
      >
        {!isLoading && (
          <div className='flex flex-col gap-7'>
            {renderWorkspaceSection({
              label: 'Workspace secrets',
              visibility: 'secret',
              entries: workspaceEntriesForRender,
              draftRows: searchTerm.trim()
                ? filteredNewWorkspaceRows
                : newWorkspaceRows.map((row, index) => ({ row, originalIndex: index })),
              onUpdateDraft: updateNewWorkspaceRow,
            })}

            {renderWorkspaceSection({
              label: 'Workspace variables',
              visibility: 'variable',
              entries: workspaceEntriesForRender,
              draftRows: searchTerm.trim()
                ? filteredNewWorkspaceVariableRows
                : newWorkspaceVariableRows.map((row, index) => ({ row, originalIndex: index })),
              onUpdateDraft: updateNewWorkspaceVariableRow,
            })}

            {(!searchTerm.trim() || filteredEnvVars.length > 0) && (
              <SettingsSection label='Personal secrets'>
                <div className={`${GRID_COLS} gap-y-2`}>
                  {filteredEnvVars.map(({ envVar, originalIndex }) => (
                    <div key={envVar.id || originalIndex} className='contents'>
                      {renderEnvVarRow(envVar, originalIndex)}
                    </div>
                  ))}
                </div>
              </SettingsSection>
            )}
            {searchTerm.trim() &&
              filteredEnvVars.length === 0 &&
              filteredWorkspaceEntries.length === 0 &&
              filteredNewWorkspaceRows.length === 0 &&
              (envVars.length > 0 ||
                Object.keys(workspaceVars).length > 0 ||
                newWorkspaceRows.length > 0) && (
                <SettingsEmptyState variant='inline'>
                  No secrets found matching &ldquo;{searchTerm}&rdquo;
                </SettingsEmptyState>
              )}
          </div>
        )}
      </SettingsPanel>

      {/*
        The gate for this change is server-side; this dialog's job is the copy.
        Turning a secret into a variable is a disclosure that flipping back does
        not undo, and flipping back is therefore not remediation — rotation is.
      */}
      <ChipConfirmModal
        open={pendingVisibilityChange !== null}
        onOpenChange={(open) => {
          if (!open) setPendingVisibilityChange(null)
        }}
        title={
          pendingVisibilityChange?.next === 'variable'
            ? 'Make this value visible?'
            : 'Make this value secret?'
        }
        text={
          pendingVisibilityChange?.next === 'variable'
            ? [
                'Everyone in this workspace, and Sim, will be able to read ',
                { text: pendingVisibilityChange?.envKey ?? '', bold: true },
                '. Its value will also appear in run logs and traces. Switching it back later will not undo this.',
              ]
            : [
                'New runs will hide ',
                { text: pendingVisibilityChange?.envKey ?? '', bold: true },
                ' again, but its value has already been visible in logs, traces, and Sim conversations. ',
                { text: 'Rotate the value if it is sensitive.', error: true },
              ]
        }
        confirm={{
          label: pendingVisibilityChange?.next === 'variable' ? 'Make visible' : 'Make secret',
          onClick: handleConfirmVisibilityChange,
          // Making a value public is the consequential direction, so it keeps
          // the destructive default; hiding it again is a plain primary.
          variant: pendingVisibilityChange?.next === 'variable' ? 'destructive' : 'primary',
          pending: upsertWorkspaceMutation.isPending,
        }}
      />

      <UnsavedChangesModal
        open={showUnsavedChanges}
        onOpenChange={setShowUnsavedChanges}
        onDiscard={isPendingNavigation ? handleDiscardAndNavigate : handleCancel}
      />
    </>
  )
}
