'use client'

import {
  type ClipboardEvent,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
import { EmptyState } from '@sim/emcn/empty-state'
import { AutofillDecoys } from '@sim/emcn/field/autofill-decoys'
import { Input } from '@sim/emcn/field/inputs'
import { ActionMenu, type MenuAction } from '@sim/emcn/menu/action-menu'
import { SearchField } from '@sim/emcn/search-field'
import { SettingsSection } from '@sim/emcn/settings-section'
import { SaveActions } from '@sim/emcn/settings-section/save-actions'
import { getErrorMessage } from '@sim/utils/errors'
import { countPasteRows } from '@sim/utils/paste'
import {
  SectionStack,
  SectionToolbar,
} from '@/platform/app/(shell)/_components/settings-parts/settings-parts'
import { SecretValueInput } from '@/platform/app/(shell)/workspace/[workspaceId]/settings/_components/sections/secrets/secret-value-input'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/settings/_components/sections/secrets/secrets-editor.module.css'
import {
  applyVariableEdits,
  clearPendingCredentialCreateRequest,
  copySecretName,
  createEmptyEnvVar,
  generateRowId,
  PENDING_CREDENTIAL_CREATE_REQUEST_EVENT,
  type PendingCredentialCreateRequest,
  parseEnvVarLine,
  parseValidEnvVars,
  readPendingCredentialCreateRequest,
  type SecretRowAccess,
  setRecordValue,
  type UIEnvironmentVariable,
  updateEnvVarArray,
  useSettingsSearch,
  validateEnvVarKey,
} from '@/platform/lib/data/secrets'
import { useSettingsUnsavedGuard } from '@/platform/lib/data/settings-guard'
import { toast } from '@/platform/shared/toast'

const MAX_ENV_PASTE_ROWS = 10_000
/** A pending create request older than this came from a tab the viewer has moved on from. */
const PENDING_CREATE_REQUEST_MAX_AGE_MS = 15 * 60 * 1000

type InputKind = 'key' | 'value'

function secretRowActions({
  onCopyName,
  onViewDetails,
  onDelete,
}: {
  onCopyName: () => void
  onViewDetails?: () => void
  onDelete?: () => void
}): MenuAction[] {
  return [
    ...(onViewDetails ? [{ id: 'details', label: 'View details', onSelect: onViewDetails }] : []),
    { id: 'copy', label: 'Copy name', onSelect: onCopyName },
    ...(onDelete
      ? [
          {
            id: 'delete',
            label: 'Delete',
            destructive: true,
            separatorBefore: true,
            onSelect: onDelete,
          },
        ]
      : []),
  ]
}

function SecretRowMenu(props: Parameters<typeof secretRowActions>[0]) {
  return (
    <ActionMenu label='Secret actions' icon='I108' align='end' actions={secretRowActions(props)} />
  )
}

/** Clears a field's read-only state on focus so a password manager never fills it first. */
function unlockOnFocus(event: { currentTarget: HTMLInputElement }) {
  event.currentTarget.removeAttribute('readOnly')
}

interface WorkspaceVariableRowProps {
  envKey: string
  value: string
  renamingKey: string | null
  pendingKeyValue: string
  canEdit: boolean
  canReveal: boolean
  /** Renaming creates a new key and deletes the old, so it also needs create access. */
  canRename: boolean
  onRenameStart: (key: string) => void
  onPendingKeyChange: (value: string) => void
  onRenameEnd: (key: string, value: string) => void
  onValueChange: (key: string, value: string) => void
  onDelete: (key: string) => void
  onViewDetails?: () => void
}

function WorkspaceVariableRow({
  envKey,
  value,
  renamingKey,
  pendingKeyValue,
  canEdit,
  canReveal,
  canRename,
  onRenameStart,
  onPendingKeyChange,
  onRenameEnd,
  onValueChange,
  onDelete,
  onViewDetails,
}: WorkspaceVariableRowProps) {
  /** Salts the `name` attributes so password managers cannot match them to a known field. */
  const autofillSalt = useId()
  return (
    <>
      <Input
        label={`Name of ${envKey}`}
        placeholder='API_KEY'
        value={renamingKey === envKey ? pendingKeyValue : envKey}
        onChange={(next) => {
          if (renamingKey !== envKey) onRenameStart(envKey)
          onPendingKeyChange(next)
        }}
        onBlur={() => onRenameEnd(envKey, value)}
        onFocus={canRename ? unlockOnFocus : undefined}
        name={`workspace_env_key_${envKey}_${autofillSalt}`}
        autoComplete='off'
        autoCapitalize='off'
        spellCheck={false}
        readOnly
      />
      <SecretValueInput
        label={`Value of ${envKey}`}
        value={value}
        onChange={(next) => onValueChange(envKey, next)}
        canEdit={canEdit}
        canReveal={canReveal}
        placeholder='Enter value'
        name={`workspace_env_value_${envKey}_${autofillSalt}`}
      />
      <SecretRowMenu
        onCopyName={() => copySecretName(envKey)}
        onViewDetails={onViewDetails}
        onDelete={canEdit ? () => onDelete(envKey) : undefined}
      />
    </>
  )
}

interface DraftRowProps {
  envVar: UIEnvironmentVariable
  index: number
  scope: 'workspace' | 'personal'
  /** A same-named workspace key overrides this personal one. */
  conflicted?: boolean
  onUpdate: (index: number, field: InputKind, value: string) => void
  onPaste: (event: ClipboardEvent<HTMLInputElement>, index: number, kind: InputKind) => void
  onDelete: () => void
}

/** A secret being typed: a new workspace key, or any personal key. */
function DraftRow({
  envVar,
  index,
  scope,
  conflicted = false,
  onUpdate,
  onPaste,
  onDelete,
}: DraftRowProps) {
  const autofillSalt = useId()
  const keyError = validateEnvVarKey(envVar.key)
  const hasContent = Boolean(envVar.key || envVar.value)
  const prefix = scope === 'workspace' ? 'new_workspace' : 'env_variable'
  const message =
    keyError ??
    (conflicted
      ? 'Workspace variable with the same name overrides this. Rename your personal key to use it.'
      : undefined)
  return (
    <>
      <Input
        label={envVar.key ? `Name of ${envVar.key}` : `New ${scope} secret name`}
        placeholder='API_KEY'
        value={envVar.key}
        invalid={Boolean(keyError) || conflicted}
        onChange={(next) => onUpdate(index, 'key', next)}
        onPaste={(event) => onPaste(event, index, 'key')}
        onFocus={unlockOnFocus}
        name={`${prefix}_key_${envVar.id ?? index}_${autofillSalt}`}
        autoComplete='off'
        autoCapitalize='off'
        spellCheck={false}
        readOnly
      />
      <SecretValueInput
        label={envVar.key ? `Value of ${envVar.key}` : `New ${scope} secret value`}
        value={envVar.value}
        onChange={(next) => onUpdate(index, 'value', next)}
        onPaste={(event) => onPaste(event, index, 'value')}
        unmasked={conflicted}
        readOnly={conflicted}
        placeholder={conflicted ? 'Workspace override active' : 'Enter value'}
        name={`${prefix}_value_${envVar.id ?? index}_${autofillSalt}`}
      />
      {hasContent ? (
        <SecretRowMenu onCopyName={() => copySecretName(envVar.key)} onDelete={onDelete} />
      ) : (
        <span />
      )}
      {message && (
        <p className={styles.message} data-type='T060' role='alert'>
          {message}
        </p>
      )}
    </>
  )
}

function scrollToEnd(grid: RefObject<HTMLDivElement | null>) {
  requestAnimationFrame(() => {
    grid.current?.lastElementChild?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  })
}

interface SecretsEditorProps {
  workspaceId: string
  variables: Record<string, string>
  personalVariables: Record<string, { key: string; value: string }>
  canCreate: boolean
  rowAccess: ReadonlyMap<string, SecretRowAccess>
  savePersonal: (variables: Record<string, string>) => Promise<unknown>
  saveWorkspace: (changes: { upsert: Record<string, string>; remove: string[] }) => Promise<unknown>
  isSaving: boolean
  onViewDetails: (credentialId: string) => void
}

/**
 * The workspace's and the viewer's own secrets as one editable list: rename, edit, add and delete
 * in place, paste a `.env` block into new rows, then save both scopes together. A secret named by
 * a `{{` suggestion's "Create Secret" arrives as a pending create request.
 */
export function SecretsEditor({
  workspaceId,
  variables,
  personalVariables,
  canCreate,
  rowAccess,
  savePersonal,
  saveWorkspace,
  isSaving,
  onViewDetails,
}: SecretsEditorProps) {
  const [envVars, setEnvVars] = useState<UIEnvironmentVariable[]>([])
  const [workspaceDraft, setWorkspaceDraft] = useState<{
    variables: Record<string, string>
    rows: UIEnvironmentVariable[]
  }>(() => ({ variables: {}, rows: [createEmptyEnvVar()] }))
  const workspaceVars = workspaceDraft.variables
  const newWorkspaceRows = workspaceDraft.rows
  const [searchTerm, setSearchTerm] = useSettingsSearch()
  const [renamingKey, setRenamingKey] = useState<string | null>(null)
  const [pendingKeyValue, setPendingKeyValue] = useState('')
  const initialWorkspaceVarsRef = useRef<Record<string, string>>({})
  const initialVarsRef = useRef<UIEnvironmentVariable[]>([])
  const acknowledgedPersonalRef = useRef<typeof personalVariables | null>(null)
  const acknowledgedWorkspaceRef = useRef<typeof variables | undefined>(undefined)
  const workspaceGridRef = useRef<HTMLDivElement>(null)
  const personalGridRef = useRef<HTMLDivElement>(null)

  const term = searchTerm.trim().toLowerCase()

  const filteredEnvVars = useMemo(() => {
    const mapped = envVars.map((envVar, index) => ({ envVar, originalIndex: index }))
    if (!term) return mapped
    return mapped.filter(({ envVar }) => envVar.key.toLowerCase().includes(term))
  }, [envVars, term])

  /** A description-only match is legible only on the secret's detail page. */
  const filteredWorkspaceEntries = useMemo(() => {
    const entries = Object.entries(workspaceVars)
    if (!term) return entries
    return entries.filter(
      ([key]) =>
        key.toLowerCase().includes(term) ||
        Boolean(rowAccess.get(key)?.description?.toLowerCase().includes(term))
    )
  }, [workspaceVars, term, rowAccess])

  const filteredNewWorkspaceRows = useMemo(() => {
    const mapped = newWorkspaceRows.map((row, index) => ({ row, originalIndex: index }))
    if (!term) return mapped
    return mapped.filter(({ row }) => row.key.toLowerCase().includes(term))
  }, [newWorkspaceRows, term])

  const allWorkspaceKeys = useMemo(() => {
    const keys = new Set(Object.keys(workspaceVars))
    for (const row of newWorkspaceRows) {
      if (row.key) keys.add(row.key)
    }
    return keys
  }, [workspaceVars, newWorkspaceRows])

  const hasChanges = useMemo(() => {
    const initialMap = new Map(
      initialVarsRef.current.filter((v) => v.key || v.value).map((v) => [v.key, v.value])
    )
    const currentMap = new Map(envVars.filter((v) => v.key || v.value).map((v) => [v.key, v.value]))
    if (initialMap.size !== currentMap.size) return true
    for (const [key, value] of currentMap) {
      if (initialMap.get(key) !== value) return true
    }
    for (const key of initialMap.keys()) {
      if (!currentMap.has(key)) return true
    }

    const before = initialWorkspaceVarsRef.current
    const after = workspaceVars
    if (Object.keys(before).length !== Object.keys(after).length) return true
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (before[key] !== after[key]) return true
    }

    if (newWorkspaceRows.some((row) => row.key || row.value)) return true
    if (renamingKey && pendingKeyValue !== renamingKey) return true
    return false
  }, [envVars, workspaceVars, newWorkspaceRows, renamingKey, pendingKeyValue])

  const initialPersonalVariables = Object.fromEntries(
    initialVarsRef.current.filter((row) => row.key).map(({ key, value }) => [key, value])
  )
  const hasIncompleteRows =
    newWorkspaceRows.some((row) => Boolean(row.key) !== Boolean(row.value)) ||
    envVars.some(
      (row) =>
        Boolean(row.key) !== Boolean(row.value) &&
        (!Object.hasOwn(initialPersonalVariables, row.key) ||
          initialPersonalVariables[row.key] !== row.value)
    )
  const hasConflicts = envVars.some((envVar) => !!envVar.key && allWorkspaceKeys.has(envVar.key))
  const hasInvalidKeys =
    envVars.some((envVar) => !!envVar.key && validateEnvVarKey(envVar.key)) ||
    newWorkspaceRows.some((row) => !!row.key && validateEnvVarKey(row.key))

  const resetToSaved = () => {
    if (isSaving) return
    setEnvVars(structuredClone(initialVarsRef.current))
    setWorkspaceDraft({
      variables: { ...initialWorkspaceVarsRef.current },
      rows: [createEmptyEnvVar()],
    })
    setRenamingKey(null)
    setPendingKeyValue('')
  }

  const guard = useSettingsUnsavedGuard({
    isDirty: hasChanges,
    navigationBlocked: isSaving,
    onDiscard: resetToSaved,
  })

  useEffect(() => {
    if (hasChanges || isSaving || acknowledgedPersonalRef.current === personalVariables) return
    acknowledgedPersonalRef.current = personalVariables
    const initialVars = [
      ...Object.values(personalVariables).map((envVar) => ({ ...envVar, id: generateRowId() })),
      createEmptyEnvVar(),
    ]
    initialVarsRef.current = structuredClone(initialVars)
    setEnvVars(structuredClone(initialVars))
  }, [personalVariables, hasChanges, isSaving])

  useEffect(() => {
    if (hasChanges || isSaving || acknowledgedWorkspaceRef.current === variables) return
    acknowledgedWorkspaceRef.current = variables
    setWorkspaceDraft((current) => ({ ...current, variables }))
    initialWorkspaceVarsRef.current = variables
  }, [variables, hasChanges, isSaving])

  const applyPendingCredentialCreateRequest = useCallback(
    (request: PendingCredentialCreateRequest) => {
      if (request.workspaceId !== workspaceId) return
      if (Date.now() - request.requestedAt > PENDING_CREATE_REQUEST_MAX_AGE_MS) {
        clearPendingCredentialCreateRequest()
        return
      }
      const envKey = request.envKey || ''
      if (envKey) {
        setEnvVars((prev) => {
          if (prev.some((v) => v.key.toLowerCase() === envKey.toLowerCase())) return prev
          const nonEmpty = prev.filter((v) => v.key || v.value)
          return [...nonEmpty, { key: envKey, value: '', id: generateRowId() }]
        })
        scrollToEnd(personalGridRef)
      }
      clearPendingCredentialCreateRequest()
    },
    [workspaceId]
  )

  useEffect(() => {
    const request = readPendingCredentialCreateRequest()
    if (request) applyPendingCredentialCreateRequest(request)
  }, [applyPendingCredentialCreateRequest])

  useEffect(() => {
    const handlePendingCreateRequest = (event: Event) => {
      const request = (event as CustomEvent<PendingCredentialCreateRequest>).detail
      if (request) applyPendingCredentialCreateRequest(request)
    }
    window.addEventListener(PENDING_CREDENTIAL_CREATE_REQUEST_EVENT, handlePendingCreateRequest)
    return () =>
      window.removeEventListener(
        PENDING_CREDENTIAL_CREATE_REQUEST_EVENT,
        handlePendingCreateRequest
      )
  }, [applyPendingCredentialCreateRequest])

  const handleWorkspaceKeyRename = (currentKey: string, currentValue: string) => {
    const newKey = pendingKeyValue.trim()
    if (!renamingKey || renamingKey !== currentKey) return
    setRenamingKey(null)
    if (!newKey || newKey === currentKey) return
    if (validateEnvVarKey(newKey) || Object.hasOwn(workspaceVars, newKey)) {
      toast.error('Use a valid, unique secret name')
      return
    }
    setWorkspaceDraft((current) => {
      const next = { ...current.variables }
      delete next[currentKey]
      setRecordValue(next, newKey, currentValue)
      return { ...current, variables: next }
    })
  }

  const handleWorkspaceValueChange = (key: string, value: string) => {
    setWorkspaceDraft((current) => ({
      ...current,
      variables: { ...current.variables, [key]: value },
    }))
  }

  const handleDeleteWorkspaceVar = (key: string) => {
    setWorkspaceDraft((current) => {
      const next = { ...current.variables }
      delete next[key]
      return { ...current, variables: next }
    })
  }

  const updateNewWorkspaceRow = (index: number, field: InputKind, value: string) => {
    setWorkspaceDraft((current) => ({
      ...current,
      rows: updateEnvVarArray(current.rows, index, field, value),
    }))
  }

  const updateEnvVar = (index: number, field: InputKind, value: string) => {
    setEnvVars((prev) => updateEnvVarArray(prev, index, field, value))
  }

  const removeEnvVar = (index: number) => {
    setEnvVars((prev) => {
      const filtered = prev.filter((_, i) => i !== index)
      const last = filtered.at(-1)
      return last && !last.key && !last.value ? filtered : [...filtered, createEmptyEnvVar()]
    })
  }

  /** Splits a paste into lines, refusing one with more rows than a save may carry. */
  const pastedLines = (event: ClipboardEvent<HTMLInputElement>) => {
    const text = event.clipboardData.getData('text').trim()
    if (!text) return null
    if (countPasteRows(text, MAX_ENV_PASTE_ROWS) > MAX_ENV_PASTE_ROWS) {
      event.preventDefault()
      toast.warning('Paste has too many secrets', {
        description: `Add up to ${MAX_ENV_PASTE_ROWS.toLocaleString()} rows at once.`,
      })
      return null
    }
    const lines = text.split(/\r?\n/).filter((line) => line.trim())
    return lines.length ? { text, lines } : null
  }

  /**
   * A personal row's paste: `KEY=VALUE` lines become rows; a plain value overwrites the field. A
   * pattern whose values are all empty (`KEY=`) falls through to the native paste.
   */
  const handlePersonalPaste = (
    event: ClipboardEvent<HTMLInputElement>,
    index: number,
    kind: InputKind
  ) => {
    const pasted = pastedLines(event)
    if (!pasted) return
    if (!pasted.lines.some((line) => parseEnvVarLine(line) !== null)) {
      event.preventDefault()
      setEnvVars((prev) => {
        const next = [...prev]
        next[index] = { ...next[index], [kind]: pasted.text }
        return next
      })
      return
    }
    const parsedVars = parseValidEnvVars(pasted.lines)
    if (parsedVars.length > 0) {
      event.preventDefault()
      setEnvVars((prev) => [
        ...prev.filter((v) => v.key || v.value),
        ...parsedVars,
        createEmptyEnvVar(),
      ])
      scrollToEnd(personalGridRef)
    }
  }

  /** A new workspace row's paste: only `KEY=VALUE` lines are taken over; plain text pastes natively. */
  const handleWorkspacePaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const pasted = pastedLines(event)
    if (!pasted) return
    if (!pasted.lines.some((line) => parseEnvVarLine(line) !== null)) return
    const parsedVars = parseValidEnvVars(pasted.lines)
    if (parsedVars.length > 0) {
      event.preventDefault()
      setWorkspaceDraft((current) => ({
        ...current,
        rows: [...current.rows.filter((v) => v.key || v.value), ...parsedVars, createEmptyEnvVar()],
      }))
      scrollToEnd(workspaceGridRef)
    }
  }

  const handleSave = async () => {
    if (isSaving || hasIncompleteRows || hasConflicts || hasInvalidKeys) return

    const mutations: Promise<unknown>[] = []
    const mergedWorkspaceVars = { ...workspaceVars }
    for (const row of newWorkspaceRows) {
      if (row.key && row.value) setRecordValue(mergedWorkspaceVars, row.key, row.value)
    }

    const validVariables = Object.fromEntries(
      envVars.filter((v) => v.key).map(({ key, value }) => [key, value])
    )
    const latestPersonalVariables = Object.fromEntries(
      Object.values(personalVariables).map(({ key, value }) => [key, value])
    )
    const personalVariablesToSave = applyVariableEdits(
      initialPersonalVariables,
      validVariables,
      latestPersonalVariables
    )

    const before = initialWorkspaceVarsRef.current
    const after = mergedWorkspaceVars
    const toUpsert: Record<string, string> = {}
    const toDelete: string[] = []
    for (const [key, value] of Object.entries(after)) {
      if (!Object.hasOwn(before, key) || before[key] !== value) setRecordValue(toUpsert, key, value)
    }
    for (const key of Object.keys(before)) {
      if (!Object.hasOwn(after, key)) toDelete.push(key)
    }

    const initialMap = new Map<string, string>()
    for (const v of initialVarsRef.current) {
      if (v.key) initialMap.set(v.key, v.value)
    }
    const personalChanged =
      initialMap.size !== Object.keys(validVariables).length ||
      Object.entries(validVariables).some(([key, value]) => initialMap.get(key) !== value)
    const workspaceChanged = Object.keys(toUpsert).length > 0 || toDelete.length > 0

    if (personalChanged) mutations.push(savePersonal(personalVariablesToSave))
    if (workspaceChanged) mutations.push(saveWorkspace({ upsert: toUpsert, remove: toDelete }))

    try {
      const results = await Promise.allSettled(mutations)
      const firstFailure = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')
      if (firstFailure) throw firstFailure.reason

      if (personalChanged) acknowledgedPersonalRef.current = personalVariables
      if (workspaceChanged) acknowledgedWorkspaceRef.current = variables
      const savedWorkspaceVars = applyVariableEdits(before, mergedWorkspaceVars, variables)
      initialWorkspaceVarsRef.current = savedWorkspaceVars
      initialVarsRef.current = structuredClone(
        Object.entries(personalVariablesToSave).map(([key, value]) => ({
          key,
          value,
          id: generateRowId(),
        }))
      )
      setEnvVars((current) => {
        const rowIds = new Map(current.map((row) => [row.key, row.id]))
        const currentVariables = Object.fromEntries(
          current.filter((row) => row.key).map(({ key, value }) => [key, value])
        )
        const rebasedVariables = applyVariableEdits(
          validVariables,
          currentVariables,
          personalVariablesToSave
        )
        const incompleteRows = current.filter(
          (row) => !row.key || (!row.value && validVariables[row.key] !== row.value)
        )
        const incompleteKeys = new Set(incompleteRows.map((row) => row.key).filter(Boolean))
        const rows = Object.entries(rebasedVariables)
          .filter(([key]) => !incompleteKeys.has(key))
          .map(([key, value]) => ({ key, value, id: rowIds.get(key) ?? generateRowId() }))
        return [...rows, ...incompleteRows]
      })

      const submittedRows = new Map(
        newWorkspaceRows.filter((row) => row.key && row.value).map((row) => [row.id, row])
      )
      setWorkspaceDraft((current) => {
        const next = { ...savedWorkspaceVars }
        for (const submitted of submittedRows.values()) {
          if (Object.hasOwn(workspaceVars, submitted.key))
            setRecordValue(next, submitted.key, workspaceVars[submitted.key])
          else delete next[submitted.key]
        }
        const rows: UIEnvironmentVariable[] = []
        for (const row of current.rows) {
          if (submittedRows.has(row.id) && row.key && row.value)
            setRecordValue(next, row.key, row.value)
          else rows.push(row)
        }
        return {
          variables: applyVariableEdits(workspaceVars, current.variables, next),
          rows: rows.length > 0 ? rows : [createEmptyEnvVar()],
        }
      })
      if (mutations.length > 0) toast.success('Secrets saved')
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to save secrets'))
    }
  }

  const visibleWorkspaceEntries = term ? filteredWorkspaceEntries : Object.entries(workspaceVars)
  const visibleNewWorkspaceRows = term
    ? filteredNewWorkspaceRows
    : newWorkspaceRows.map((row, index) => ({ row, originalIndex: index }))
  const showWorkspace =
    !term || filteredWorkspaceEntries.length > 0 || filteredNewWorkspaceRows.length > 0
  const showPersonal = !term || filteredEnvVars.length > 0
  const noMatches =
    Boolean(term) &&
    filteredEnvVars.length === 0 &&
    filteredWorkspaceEntries.length === 0 &&
    filteredNewWorkspaceRows.length === 0

  return (
    <SectionStack>
      <AutofillDecoys />
      <SectionToolbar
        grow={
          <SearchField
            label='Search secrets'
            placeholder='Search secrets...'
            value={searchTerm}
            onValueChange={setSearchTerm}
          />
        }
      />
      {showWorkspace && (
        <SettingsSection title='Workspace'>
          <div className={styles.grid} ref={workspaceGridRef}>
            {visibleWorkspaceEntries.map(([key, value]) => {
              const access = rowAccess.get(key)
              const canEditRow = canCreate && (access?.canEdit ?? true)
              const credentialId = access?.credentialId
              return (
                <WorkspaceVariableRow
                  key={key}
                  envKey={key}
                  value={value}
                  renamingKey={renamingKey}
                  pendingKeyValue={pendingKeyValue}
                  canEdit={canEditRow}
                  canReveal={access?.canReveal ?? true}
                  canRename={canCreate && canEditRow}
                  onRenameStart={setRenamingKey}
                  onPendingKeyChange={setPendingKeyValue}
                  onRenameEnd={handleWorkspaceKeyRename}
                  onValueChange={handleWorkspaceValueChange}
                  onDelete={handleDeleteWorkspaceVar}
                  onViewDetails={
                    credentialId
                      ? () => guard.guardBack(() => onViewDetails(credentialId))
                      : undefined
                  }
                />
              )
            })}
            {canCreate &&
              visibleNewWorkspaceRows.map(({ row, originalIndex }) => (
                <DraftRow
                  key={row.id ?? originalIndex}
                  envVar={row}
                  index={originalIndex}
                  scope='workspace'
                  onUpdate={updateNewWorkspaceRow}
                  onPaste={handleWorkspacePaste}
                  onDelete={() => {
                    updateNewWorkspaceRow(originalIndex, 'key', '')
                    updateNewWorkspaceRow(originalIndex, 'value', '')
                  }}
                />
              ))}
          </div>
        </SettingsSection>
      )}
      {showPersonal && (
        <SettingsSection title='Personal'>
          <div className={styles.grid} ref={personalGridRef}>
            {filteredEnvVars.map(({ envVar, originalIndex }) => (
              <DraftRow
                key={envVar.id ?? originalIndex}
                envVar={envVar}
                index={originalIndex}
                scope='personal'
                conflicted={!!envVar.key && allWorkspaceKeys.has(envVar.key)}
                onUpdate={updateEnvVar}
                onPaste={handlePersonalPaste}
                onDelete={() => removeEnvVar(originalIndex)}
              />
            ))}
          </div>
        </SettingsSection>
      )}
      {noMatches && <EmptyState title={`No secrets found matching "${searchTerm}"`} />}
      <SaveActions
        dirty={hasChanges}
        saving={isSaving}
        blockedReason={
          hasConflicts
            ? 'Resolve all conflicts before saving'
            : hasInvalidKeys
              ? 'Fix invalid variable names before saving'
              : hasIncompleteRows
                ? 'Enter both a name and value for each secret'
                : undefined
        }
        onSave={() => void handleSave()}
        onDiscard={resetToSaved}
      />
    </SectionStack>
  )
}
