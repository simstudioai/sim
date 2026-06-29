'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { generateShortId } from '@sim/utils/id'
import { useQueryClient } from '@tanstack/react-query'
import { useParams, useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Chip, ChipInput, Tooltip, toast } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import {
  clearPendingCredentialCreateRequest,
  PENDING_CREDENTIAL_CREATE_REQUEST_EVENT,
  type PendingCredentialCreateRequest,
  readPendingCredentialCreateRequest,
} from '@/lib/credentials/client-state'
import type { WorkspaceEnvironmentData } from '@/lib/environment/api'
import { UnsavedChangesModal } from '@/app/workspace/[workspaceId]/components/credential-detail'
import { RowActionsMenu } from '@/app/workspace/[workspaceId]/settings/components/row-actions-menu'
import { SecretValueField } from '@/app/workspace/[workspaceId]/settings/components/secrets/components/secret-value-field'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
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
}

/**
 * Trailing `...` actions menu for a secret row. Mirrors the Teammates /
 * Organization member menu so the settings experience is consistent.
 */
function SecretRowMenu({ onCopyName, onViewDetails, onDelete }: SecretRowMenuProps) {
  const t = useTranslations('auto')
  return (
    <RowActionsMenu
      label={t('secret_actions')}
      triggerClassName='ml-2'
      actions={[
        ...(onViewDetails ? [{ label: 'View details', onSelect: onViewDetails }] : []),
        { label: 'Copy name', onSelect: onCopyName },
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
  /** Renaming creates a new key + deletes the old, so it also needs create access. */
  canRename: boolean
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
  canRename,
  onRenameStart,
  onPendingKeyChange,
  onRenameEnd,
  onValueChange,
  onDelete,
  onViewDetails,
}: WorkspaceVariableRowProps) {
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
        name={`workspace_env_key_${envKey}_${generateShortId()}`}
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
        name={`workspace_env_value_${envKey}_${generateShortId()}`}
      />
      <SecretRowMenu
        onCopyName={() => copyName(envKey)}
        onViewDetails={hasCredential ? () => onViewDetails(envKey) : undefined}
        onDelete={canEdit ? () => onDelete(envKey) : undefined}
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
  const t = useTranslations('auto')
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
        name={`new_workspace_key_${envVar.id || index}_${generateShortId()}`}
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
        placeholder={t('enter_value')}
        name={`new_workspace_value_${envVar.id || index}_${generateShortId()}`}
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
  const tI18n = useTranslations('auto')
  const t = useTranslations('auto')
  const params = useParams()
  const router = useRouter()
  const workspaceId = (params?.workspaceId as string) || ''

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

  const { data: workspacePermissions } = useWorkspacePermissionsQuery(workspaceId || null)
  const queryClient = useQueryClient()

  const isWorkspaceAdmin = workspacePermissions?.viewer?.isAdmin ?? false
  const canCreateWorkspaceSecret =
    isWorkspaceAdmin || workspacePermissions?.viewer?.permissionType === 'write'

  const isLoading = isPersonalLoading || isWorkspaceLoading

  const [envVars, setEnvVars] = useState<UIEnvironmentVariable[]>([])
  const [newWorkspaceRows, setNewWorkspaceRows] = useState<UIEnvironmentVariable[]>([
    createEmptyEnvVar(),
  ])
  const [searchTerm, setSearchTerm] = useState('')
  const [showUnsavedChanges, setShowUnsavedChanges] = useState(false)
  const [workspaceVars, setWorkspaceVars] = useState<Record<string, string>>({})
  const [renamingKey, setRenamingKey] = useState<string | null>(null)
  const [pendingKeyValue, setPendingKeyValue] = useState<string>('')
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
  }, [envVars, workspaceVars, newWorkspaceRows])

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

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
    }
    if (hasChanges) {
      window.addEventListener('beforeunload', handler)
    }
    return () => window.removeEventListener('beforeunload', handler)
  }, [hasChanges])

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
    setShowUnsavedChanges(false)
  }

  const handleCancel = resetToSaved

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
      const initialMap = new Map(
        initialVarsRef.current.filter((v) => v.key && v.value).map((v) => [v.key, v.value])
      )
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
            await upsertWorkspaceMutation.mutateAsync({ workspaceId, variables: toUpsert })
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
      setNewWorkspaceRows([createEmptyEnvVar()])
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
          name={`env_variable_name_${envVar.id || originalIndex}_${generateShortId()}`}
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
          placeholder={isConflicted ? tI18n('workspace_override_active') : tI18n('enter_value')}
          name={`env_variable_value_${envVar.id || originalIndex}_${generateShortId()}`}
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
            {t('workspace_variable_with_the_same_name')}
          </div>
        )}
      </div>
    )
  }

  const isPendingNavigation = pendingNavigationUrlRef.current !== null

  return (
    <>
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

      <SettingsPanel
        scrollContainerRef={scrollContainerRef}
        search={{
          value: searchTerm,
          onChange: setSearchTerm,
          placeholder: 'Search secrets...',
        }}
        actions={
          <>
            {hasChanges && (
              <Chip onClick={handleCancel} disabled={isListSaving}>
                {t('discard')}
              </Chip>
            )}
            {hasConflicts || hasInvalidKeys ? (
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <div className='inline-flex'>
                    <Chip disabled>{t('save')}</Chip>
                  </div>
                </Tooltip.Trigger>
                {hasConflicts ? (
                  <Tooltip.Content>{t('resolve_all_conflicts_before_saving')}</Tooltip.Content>
                ) : (
                  <Tooltip.Content>{t('fix_invalid_variable_names_before_saving')}</Tooltip.Content>
                )}
              </Tooltip.Root>
            ) : (
              <Chip onClick={handleSave} disabled={isLoading || !hasChanges || isListSaving}>
                {isListSaving ? 'Saving...' : tI18n('save')}
              </Chip>
            )}
          </>
        }
      >
        {!isLoading && (
          <div className='flex flex-col gap-7'>
            {(!searchTerm.trim() ||
              filteredWorkspaceEntries.length > 0 ||
              filteredNewWorkspaceRows.length > 0) && (
              <section className='flex flex-col'>
                <span className='pl-0.5 text-[var(--text-muted)] text-small'>{t('workspace')}</span>
                <div className='mt-[9px] mb-3 h-px bg-[var(--border)]' />
                <div className={`${GRID_COLS} gap-y-2`}>
                  {(searchTerm.trim()
                    ? filteredWorkspaceEntries
                    : Object.entries(workspaceVars)
                  ).map(([key, value]) => {
                    const cred = workspaceEnvKeyToCredential.get(key)
                    const canEditRow = cred?.role === 'admin'
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
                        onViewDetails={handleViewDetails}
                      />
                    )
                  })}
                  {canCreateWorkspaceSecret &&
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
                </div>
              </section>
            )}

            {(!searchTerm.trim() || filteredEnvVars.length > 0) && (
              <section className='flex flex-col'>
                <span className='pl-0.5 text-[var(--text-muted)] text-small'>{t('personal')}</span>
                <div className='mt-[9px] mb-3 h-px bg-[var(--border)]' />
                <div className={`${GRID_COLS} gap-y-2`}>
                  {filteredEnvVars.map(({ envVar, originalIndex }) => (
                    <div key={envVar.id || originalIndex} className='contents'>
                      {renderEnvVarRow(envVar, originalIndex)}
                    </div>
                  ))}
                </div>
              </section>
            )}
            {searchTerm.trim() &&
              filteredEnvVars.length === 0 &&
              filteredWorkspaceEntries.length === 0 &&
              filteredNewWorkspaceRows.length === 0 &&
              (envVars.length > 0 ||
                Object.keys(workspaceVars).length > 0 ||
                newWorkspaceRows.length > 0) && (
                <SettingsEmptyState variant='inline'>
                  {t('no_secrets_found_matching_ldquo')}
                  {searchTerm}
                  {t('rdquo')}
                </SettingsEmptyState>
              )}
          </div>
        )}
      </SettingsPanel>

      <UnsavedChangesModal
        open={showUnsavedChanges}
        onOpenChange={setShowUnsavedChanges}
        onDiscard={isPendingNavigation ? handleDiscardAndNavigate : handleCancel}
      />
    </>
  )
}
