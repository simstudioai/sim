'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Search, Share2, Undo2 } from 'lucide-react'
import { useParams } from 'next/navigation'
import { Button, Input as EmcnInput, Tooltip } from '@/components/emcn'
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from '@/components/emcn/components/modal/modal'
import { Trash } from '@/components/emcn/icons/trash'
import { Input, Skeleton } from '@/components/ui'
import { createLogger } from '@/lib/logs/console/logger'
import {
  usePersonalEnvironment,
  useRemoveWorkspaceEnvironment,
  useSavePersonalEnvironment,
  useUpsertWorkspaceEnvironment,
  useWorkspaceEnvironment,
  type WorkspaceEnvironmentData,
} from '@/hooks/queries/environment'

const logger = createLogger('EnvironmentVariables')

const GRID_COLS = 'grid grid-cols-[minmax(0,1fr)_8px_minmax(0,1fr)_auto] items-center'
const ENV_VAR_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/
const PRIMARY_BUTTON_STYLES =
  '!bg-[var(--brand-tertiary-2)] !text-[var(--text-inverse)] hover:!bg-[var(--brand-tertiary-2)]/90'

/**
 * Generates a unique row identifier by combining timestamp with an incrementing counter
 */
const generateRowId = (() => {
  let counter = 0
  return () => {
    counter += 1
    return Date.now() + counter
  }
})()

/**
 * Creates a new empty environment variable with a unique ID
 */
const createEmptyEnvVar = (): UIEnvironmentVariable => ({
  key: '',
  value: '',
  id: generateRowId(),
})

/**
 * Represents an environment variable in the UI with optional ID for tracking
 */
interface UIEnvironmentVariable {
  key: string
  value: string
  id?: number
}

/**
 * Props for the EnvironmentVariables component
 */
interface EnvironmentVariablesProps {
  /** Callback to register a handler that intercepts navigation away from this section */
  registerBeforeLeaveHandler?: (handler: (onProceed: () => void) => void) => void
}

/**
 * Props for the WorkspaceVariableRow component
 */
interface WorkspaceVariableRowProps {
  envKey: string
  value: string
  renamingKey: string | null
  pendingKeyValue: string
  isNewlyPromoted: boolean
  onRenameStart: (key: string) => void
  onPendingKeyChange: (value: string) => void
  onRenameEnd: (key: string, value: string) => void
  onDelete: (key: string) => void
  onDemote: (key: string, value: string) => void
}

/**
 * Renders a single workspace environment variable row with edit and delete capabilities
 */
function WorkspaceVariableRow({
  envKey,
  value,
  renamingKey,
  pendingKeyValue,
  isNewlyPromoted,
  onRenameStart,
  onPendingKeyChange,
  onRenameEnd,
  onDelete,
  onDemote,
}: WorkspaceVariableRowProps) {
  return (
    <div className={GRID_COLS}>
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
        onFocus={(e) => e.target.removeAttribute('readOnly')}
        className='h-9'
      />
      <div />
      <EmcnInput
        value={value ? '•'.repeat(value.length) : ''}
        readOnly
        autoComplete='off'
        autoCorrect='off'
        autoCapitalize='off'
        spellCheck='false'
        className='h-9'
      />
      <div className='ml-[8px] flex'>
        {isNewlyPromoted && (
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <Button variant='ghost' onClick={() => onDemote(envKey, value)} className='h-9 w-9'>
                <Undo2 className='h-3.5 w-3.5' />
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content>Scope: workspace</Tooltip.Content>
          </Tooltip.Root>
        )}
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <Button variant='ghost' onClick={() => onDelete(envKey)} className='h-9 w-9'>
              <Trash />
            </Button>
          </Tooltip.Trigger>
          <Tooltip.Content>Delete environment variable</Tooltip.Content>
        </Tooltip.Root>
      </div>
    </div>
  )
}

/**
 * Environment Variables management component for handling personal and workspace-scoped variables.
 * Provides functionality to create, edit, delete, and share environment variables between
 * personal and workspace scopes with conflict detection.
 */
export function EnvironmentVariables({ registerBeforeLeaveHandler }: EnvironmentVariablesProps) {
  const params = useParams()
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

  const isLoading = isPersonalLoading || isWorkspaceLoading
  const variables = useMemo(() => personalEnvData || {}, [personalEnvData])

  const [envVars, setEnvVars] = useState<UIEnvironmentVariable[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [focusedValueIndex, setFocusedValueIndex] = useState<number | null>(null)
  const [showUnsavedChanges, setShowUnsavedChanges] = useState(false)
  const [shouldScrollToBottom, setShouldScrollToBottom] = useState(false)
  const [workspaceVars, setWorkspaceVars] = useState<Record<string, string>>({})
  const [conflicts, setConflicts] = useState<string[]>([])
  const [renamingKey, setRenamingKey] = useState<string | null>(null)
  const [pendingKeyValue, setPendingKeyValue] = useState<string>('')
  const [changeToken, setChangeToken] = useState(0)

  const initialWorkspaceVarsRef = useRef<Record<string, string>>({})
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const pendingProceedCallback = useRef<(() => void) | null>(null)
  const initialVarsRef = useRef<UIEnvironmentVariable[]>([])
  const hasChangesRef = useRef(false)
  const hasSavedRef = useRef(false)

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

    return false
  }, [envVars, workspaceVars, changeToken])

  const hasConflicts = useMemo(() => {
    return envVars.some((envVar) => !!envVar.key && Object.hasOwn(workspaceVars, envVar.key))
  }, [envVars, workspaceVars])

  useEffect(() => {
    hasChangesRef.current = hasChanges
  }, [hasChanges])

  /**
   * Handles navigation attempts away from this section.
   * Shows unsaved changes modal if there are changes, otherwise proceeds immediately.
   */
  const handleBeforeLeave = useCallback((onProceed: () => void) => {
    if (hasChangesRef.current) {
      setShowUnsavedChanges(true)
      pendingProceedCallback.current = onProceed
    } else {
      onProceed()
    }
  }, [])

  useEffect(() => {
    // Skip sync from server after a save - we already have correct local state
    if (hasSavedRef.current) return

    const existingVars = Object.values(variables)
    const initialVars = existingVars.length
      ? existingVars.map((envVar) => ({
          ...envVar,
          id: generateRowId(),
        }))
      : [createEmptyEnvVar()]
    initialVarsRef.current = JSON.parse(JSON.stringify(initialVars))
    setEnvVars(JSON.parse(JSON.stringify(initialVars)))
    pendingProceedCallback.current = null
  }, [variables])

  useEffect(() => {
    if (workspaceEnvData) {
      if (hasSavedRef.current) {
        // After a save, only update conflicts - refs were already set optimistically
        setConflicts(workspaceEnvData?.conflicts || [])
        hasSavedRef.current = false
      } else {
        setWorkspaceVars(workspaceEnvData?.workspace || {})
        initialWorkspaceVarsRef.current = workspaceEnvData?.workspace || {}
        setConflicts(workspaceEnvData?.conflicts || [])
      }
    }
  }, [workspaceEnvData])

  // Register the before-leave handler
  useEffect(() => {
    if (registerBeforeLeaveHandler) {
      registerBeforeLeaveHandler(handleBeforeLeave)
    }
  }, [registerBeforeLeaveHandler, handleBeforeLeave])

  useEffect(() => {
    if (shouldScrollToBottom && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTo({
        top: scrollContainerRef.current.scrollHeight,
        behavior: 'smooth',
      })
      setShouldScrollToBottom(false)
    }
  }, [shouldScrollToBottom])

  useEffect(() => {
    const personalKeys = envVars.map((envVar) => envVar.key.trim()).filter((key) => key.length > 0)

    const uniquePersonalKeys = Array.from(new Set(personalKeys))

    const computedConflicts = uniquePersonalKeys.filter((key) => Object.hasOwn(workspaceVars, key))

    setConflicts((prev) => {
      if (prev.length === computedConflicts.length) {
        const sameKeys = prev.every((key) => computedConflicts.includes(key))
        if (sameKeys) return prev
      }
      return computedConflicts
    })
  }, [envVars, workspaceVars])

  const handleWorkspaceKeyRename = useCallback(
    (currentKey: string, currentValue: string) => {
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
    },
    [pendingKeyValue, renamingKey]
  )

  const handleDeleteWorkspaceVar = useCallback((key: string) => {
    setWorkspaceVars((prev) => {
      const next = { ...prev }
      delete next[key]
      return next
    })
  }, [])

  const addEnvVar = useCallback(() => {
    setEnvVars((prev) => [...prev, createEmptyEnvVar()])
    setSearchTerm('')
    setShouldScrollToBottom(true)
  }, [])

  const updateEnvVar = useCallback((index: number, field: 'key' | 'value', value: string) => {
    setEnvVars((prev) => {
      const newEnvVars = [...prev]
      newEnvVars[index][field] = value
      return newEnvVars
    })
  }, [])

  const removeEnvVar = useCallback((index: number) => {
    setEnvVars((prev) => {
      const newEnvVars = prev.filter((_, i) => i !== index)
      return newEnvVars.length ? newEnvVars : [createEmptyEnvVar()]
    })
  }, [])

  const handleValueFocus = useCallback((index: number, e: React.FocusEvent<HTMLInputElement>) => {
    setFocusedValueIndex(index)
    e.target.scrollLeft = 0
  }, [])

  const handleValueClick = useCallback((e: React.MouseEvent<HTMLInputElement>) => {
    e.preventDefault()
    e.currentTarget.scrollLeft = 0
  }, [])

  /**
   * Parses a single line to extract environment variable key-value pair
   */
  const parseEnvVarLine = useCallback((line: string): UIEnvironmentVariable | null => {
    const equalIndex = line.indexOf('=')
    if (equalIndex === -1 || equalIndex === 0) return null

    const potentialKey = line.substring(0, equalIndex).trim()
    if (!ENV_VAR_PATTERN.test(potentialKey)) return null

    const value = line.substring(equalIndex + 1).trim()
    return { key: potentialKey, value, id: generateRowId() }
  }, [])

  /**
   * Handles pasting a single value into a specific field
   */
  const handleSingleValuePaste = useCallback(
    (text: string, index: number, inputType: 'key' | 'value') => {
      setEnvVars((prev) => {
        const newEnvVars = [...prev]
        newEnvVars[index][inputType] = text
        return newEnvVars
      })
    },
    []
  )

  /**
   * Handles pasting multiple key=value pairs
   */
  const handleKeyValuePaste = useCallback(
    (lines: string[]) => {
      const parsedVars = lines
        .map(parseEnvVarLine)
        .filter((parsed): parsed is UIEnvironmentVariable => parsed !== null)
        .filter(({ key, value }) => key && value)

      if (parsedVars.length > 0) {
        setEnvVars((prev) => {
          const existingVars = prev.filter((v) => v.key || v.value)
          return [...existingVars, ...parsedVars]
        })
        setShouldScrollToBottom(true)
      }
    },
    [parseEnvVarLine]
  )

  /**
   * Handles paste events for environment variable inputs with smart detection
   * of key=value pairs vs single values
   */
  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLInputElement>, index: number) => {
      const text = e.clipboardData.getData('text').trim()
      if (!text) return

      const lines = text.split('\n').filter((line) => line.trim())
      if (lines.length === 0) return

      e.preventDefault()

      const inputType = (e.target as HTMLInputElement).getAttribute('data-input-type') as
        | 'key'
        | 'value'

      if (inputType) {
        const hasValidEnvVarPattern = lines.some((line) => parseEnvVarLine(line) !== null)
        if (!hasValidEnvVarPattern) {
          handleSingleValuePaste(text, index, inputType)
          return
        }
      }

      handleKeyValuePaste(lines)
    },
    [parseEnvVarLine, handleSingleValuePaste, handleKeyValuePaste]
  )

  /**
   * Discards all changes and reverts to initial state
   */
  const handleCancel = useCallback(() => {
    setEnvVars(JSON.parse(JSON.stringify(initialVarsRef.current)))
    setWorkspaceVars({ ...initialWorkspaceVarsRef.current })
    setShowUnsavedChanges(false)

    pendingProceedCallback.current?.()
    pendingProceedCallback.current = null
  }, [])

  /**
   * Saves all personal and workspace environment variables with optimistic updates
   */
  const handleSave = useCallback(async () => {
    const onProceed = pendingProceedCallback.current

    // Save previous state for rollback on error
    const prevInitialVars = [...initialVarsRef.current]
    const prevInitialWorkspaceVars = { ...initialWorkspaceVarsRef.current }

    try {
      setShowUnsavedChanges(false)
      hasSavedRef.current = true

      // Optimistically update refs to mark current state as "saved"
      initialWorkspaceVarsRef.current = { ...workspaceVars }
      initialVarsRef.current = JSON.parse(JSON.stringify(envVars.filter((v) => v.key && v.value)))

      // Force recomputation of change tracking based on updated baselines
      setChangeToken((prev) => prev + 1)

      const validVariables = envVars
        .filter((v) => v.key && v.value)
        .reduce<Record<string, string>>((acc, { key, value }) => ({ ...acc, [key]: value }), {})

      await savePersonalMutation.mutateAsync({ variables: validVariables })

      const before = prevInitialWorkspaceVars
      const after = workspaceVars
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

      if (workspaceId) {
        if (Object.keys(toUpsert).length) {
          await upsertWorkspaceMutation.mutateAsync({ workspaceId, variables: toUpsert })
        }
        if (toDelete.length) {
          await removeWorkspaceMutation.mutateAsync({ workspaceId, keys: toDelete })
        }
      }

      onProceed?.()
      pendingProceedCallback.current = null
    } catch (error) {
      // Rollback optimistic updates on error
      hasSavedRef.current = false
      initialVarsRef.current = prevInitialVars
      initialWorkspaceVarsRef.current = prevInitialWorkspaceVars
      logger.error('Failed to save environment variables:', error)
    }
  }, [
    envVars,
    workspaceVars,
    workspaceId,
    savePersonalMutation,
    upsertWorkspaceMutation,
    removeWorkspaceMutation,
  ])

  /**
   * Promotes a personal environment variable to workspace scope
   */
  const promoteToWorkspace = useCallback(
    (envVar: UIEnvironmentVariable) => {
      if (!envVar.key || !envVar.value || !workspaceId) return
      setWorkspaceVars((prev) => ({ ...prev, [envVar.key]: envVar.value }))
      setEnvVars((prev) => {
        const filtered = prev.filter((entry) => entry !== envVar)
        return filtered.length ? filtered : [createEmptyEnvVar()]
      })
    },
    [workspaceId]
  )

  /**
   * Demotes a newly promoted workspace variable back to personal scope.
   * Only works for variables that were promoted during this session (before save).
   */
  const demoteToPersonal = useCallback((key: string, value: string) => {
    if (!key) return
    setWorkspaceVars((prev) => {
      const next = { ...prev }
      delete next[key]
      return next
    })
    setEnvVars((prev) => [...prev, { key, value, id: generateRowId() }])
  }, [])

  const conflictClassName = 'border-[var(--text-error)] bg-[#F6D2D2] dark:bg-[#442929]'

  /**
   * Renders a single personal environment variable row with conflict detection
   */
  const renderEnvVarRow = useCallback(
    (envVar: UIEnvironmentVariable, originalIndex: number) => {
      const isConflict = !!envVar.key && Object.hasOwn(workspaceVars, envVar.key)
      const maskedValueStyle =
        focusedValueIndex !== originalIndex && !isConflict
          ? ({ WebkitTextSecurity: 'disc' } as React.CSSProperties)
          : undefined

      return (
        <>
          <div className={GRID_COLS}>
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
              className={`h-9 ${isConflict ? conflictClassName : ''}`}
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
              className={`h-9 ${isConflict ? `cursor-not-allowed ${conflictClassName}` : ''}`}
            />
            <div className='ml-[8px] flex items-center'>
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <Button
                    variant='ghost'
                    disabled={!envVar.key || !envVar.value || isConflict || !workspaceId}
                    onClick={() => promoteToWorkspace(envVar)}
                    className='h-9 w-9'
                  >
                    <Share2 className='h-3.5 w-3.5' />
                  </Button>
                </Tooltip.Trigger>
                <Tooltip.Content>Scope: personal</Tooltip.Content>
              </Tooltip.Root>
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <Button
                    variant='ghost'
                    onClick={() => removeEnvVar(originalIndex)}
                    className='h-9 w-9'
                  >
                    <Trash />
                  </Button>
                </Tooltip.Trigger>
                <Tooltip.Content>Delete environment variable</Tooltip.Content>
              </Tooltip.Root>
            </div>
          </div>
          {isConflict && (
            <div className='col-span-3 mt-[4px] text-[12px] text-[var(--text-error)] leading-tight'>
              Workspace variable with the same name overrides this. Rename your personal key to use
              it.
            </div>
          )}
        </>
      )
    },
    [
      workspaceVars,
      workspaceId,
      focusedValueIndex,
      updateEnvVar,
      handlePaste,
      handleValueFocus,
      handleValueClick,
      promoteToWorkspace,
      removeEnvVar,
    ]
  )

  return (
    <>
      <div className='flex h-full flex-col gap-[16px]'>
        {/* Hidden inputs to prevent browser password manager autofill interference */}
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
        <div className='flex items-center gap-[8px]'>
          <div className='flex flex-1 items-center gap-[8px] rounded-[8px] border bg-[var(--surface-6)] px-[8px] py-[5px]'>
            <Search
              className='h-[14px] w-[14px] flex-shrink-0 text-[var(--text-tertiary)]'
              strokeWidth={2}
            />
            <Input
              placeholder='Search variables...'
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
          <Button
            onClick={addEnvVar}
            variant='primary'
            disabled={isLoading}
            className={PRIMARY_BUTTON_STYLES}
          >
            <Plus className='mr-[6px] h-[13px] w-[13px]' />
            Add
          </Button>
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <Button
                onClick={handleSave}
                disabled={isLoading || !hasChanges || hasConflicts}
                variant='primary'
                className={`${PRIMARY_BUTTON_STYLES} ${hasConflicts ? 'cursor-not-allowed opacity-50' : ''}`}
              >
                Save
              </Button>
            </Tooltip.Trigger>
            {hasConflicts && <Tooltip.Content>Resolve all conflicts before saving</Tooltip.Content>}
          </Tooltip.Root>
        </div>

        {/* Scrollable Content */}
        <div ref={scrollContainerRef} className='min-h-0 flex-1 overflow-y-auto'>
          <div className='flex flex-col gap-[16px]'>
            {isLoading ? (
              <>
                <div className='flex flex-col gap-[8px]'>
                  <Skeleton className='h-5 w-[70px]' />
                  <div className='text-[13px] text-[var(--text-muted)]'>
                    <Skeleton className='h-5 w-[160px]' />
                  </div>
                </div>
                <div className='flex flex-col gap-[8px]'>
                  <Skeleton className='h-5 w-[55px]' />
                  {Array.from({ length: 2 }, (_, i) => (
                    <div key={`personal-${i}`} className={GRID_COLS}>
                      <Skeleton className='h-9 rounded-[6px]' />
                      <div />
                      <Skeleton className='h-9 rounded-[6px]' />
                      <div className='ml-[8px] flex items-center gap-0'>
                        <Skeleton className='h-9 w-9 rounded-[6px]' />
                        <Skeleton className='h-9 w-9 rounded-[6px]' />
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <>
                {/* Workspace section */}
                {(!searchTerm.trim() || filteredWorkspaceEntries.length > 0) && (
                  <div className='flex flex-col gap-[8px]'>
                    <div className='font-medium text-[13px] text-[var(--text-secondary)]'>
                      Workspace
                    </div>
                    {!searchTerm.trim() && Object.keys(workspaceVars).length === 0 ? (
                      <div className='text-[13px] text-[var(--text-muted)]'>
                        No workspace variables yet
                      </div>
                    ) : (
                      (searchTerm.trim()
                        ? filteredWorkspaceEntries
                        : Object.entries(workspaceVars)
                      ).map(([key, value]) => (
                        <WorkspaceVariableRow
                          key={key}
                          envKey={key}
                          value={value}
                          renamingKey={renamingKey}
                          pendingKeyValue={pendingKeyValue}
                          isNewlyPromoted={!Object.hasOwn(initialWorkspaceVarsRef.current, key)}
                          onRenameStart={setRenamingKey}
                          onPendingKeyChange={setPendingKeyValue}
                          onRenameEnd={handleWorkspaceKeyRename}
                          onDelete={handleDeleteWorkspaceVar}
                          onDemote={demoteToPersonal}
                        />
                      ))
                    )}
                  </div>
                )}

                {/* Personal section */}
                {(!searchTerm.trim() || filteredEnvVars.length > 0) && (
                  <div className='flex flex-col gap-[8px]'>
                    <div className='font-medium text-[13px] text-[var(--text-secondary)]'>
                      Personal
                    </div>
                    {filteredEnvVars.map(({ envVar, originalIndex }) => (
                      <div key={envVar.id || originalIndex}>
                        {renderEnvVarRow(envVar, originalIndex)}
                      </div>
                    ))}
                  </div>
                )}
                {/* Show message when search has no results across both sections */}
                {searchTerm.trim() &&
                  filteredEnvVars.length === 0 &&
                  filteredWorkspaceEntries.length === 0 &&
                  (envVars.length > 0 || Object.keys(workspaceVars).length > 0) && (
                    <div className='py-[16px] text-center text-[13px] text-[var(--text-muted)]'>
                      No environment variables found matching "{searchTerm}"
                    </div>
                  )}
              </>
            )}
          </div>
        </div>
      </div>

      <Modal open={showUnsavedChanges} onOpenChange={setShowUnsavedChanges}>
        <ModalContent className='w-[400px]'>
          <ModalHeader>Unsaved Changes</ModalHeader>
          <ModalBody>
            <p className='text-[12px] text-[var(--text-tertiary)]'>
              {hasConflicts
                ? 'You have unsaved changes, but conflicts must be resolved before saving. You can discard your changes to close the modal.'
                : 'You have unsaved changes. Do you want to save them before closing?'}
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant='default' onClick={handleCancel}>
              Discard Changes
            </Button>
            {hasConflicts ? (
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <Button
                    disabled={true}
                    variant='primary'
                    className='cursor-not-allowed opacity-50'
                  >
                    Save Changes
                  </Button>
                </Tooltip.Trigger>
                <Tooltip.Content>Resolve all conflicts before saving</Tooltip.Content>
              </Tooltip.Root>
            ) : (
              <Button onClick={handleSave} variant='primary' className={PRIMARY_BUTTON_STYLES}>
                Save Changes
              </Button>
            )}
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  )
}
