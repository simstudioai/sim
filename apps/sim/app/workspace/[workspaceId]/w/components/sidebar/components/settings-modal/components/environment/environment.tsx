'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { Plus, Search, Share2, Undo2 } from 'lucide-react'
import { useParams } from 'next/navigation'
import {
  Button,
  Input as EmcnInput,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Tooltip,
} from '@/components/emcn'
import { Trash } from '@/components/emcn/icons/trash'
import { Input, Skeleton } from '@/components/ui'
import { isValidEnvVarName } from '@/executor/constants'
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
 * Validates an environment variable key.
 * Returns an error message if invalid, undefined if valid.
 */
function validateEnvVarKey(key: string): string | undefined {
  if (!key) return undefined
  if (key.includes(' ')) return 'Spaces are not allowed'
  if (!isValidEnvVarName(key)) return 'Only letters, numbers, and underscores allowed'
  return undefined
}

interface EnvironmentVariablesProps {
  registerBeforeLeaveHandler?: (handler: (onProceed: () => void) => void) => void
}

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
            <Tooltip.Content>Change to personal scope</Tooltip.Content>
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

  const hasInvalidKeys = useMemo(() => {
    return envVars.some((envVar) => !!envVar.key && validateEnvVarKey(envVar.key))
  }, [envVars])

  useEffect(() => {
    hasChangesRef.current = hasChanges
  }, [hasChanges])

  const handleBeforeLeave = useCallback((onProceed: () => void) => {
    if (hasChangesRef.current) {
      setShowUnsavedChanges(true)
      pendingProceedCallback.current = onProceed
    } else {
      onProceed()
    }
  }, [])

  useEffect(() => {
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
        setConflicts(workspaceEnvData?.conflicts || [])
        hasSavedRef.current = false
      } else {
        setWorkspaceVars(workspaceEnvData?.workspace || {})
        initialWorkspaceVarsRef.current = workspaceEnvData?.workspace || {}
        setConflicts(workspaceEnvData?.conflicts || [])
      }
    }
  }, [workspaceEnvData])

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

  const parseEnvVarLine = useCallback((line: string): UIEnvironmentVariable | null => {
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
    if (looksLikeBase64Key && valueIsJustPadding && potentialKey.length > 20) {
      return null
    }

    const trimmedValue = value.trim()
    if (
      !trimmedValue.startsWith('"') &&
      !trimmedValue.startsWith("'") &&
      !trimmedValue.startsWith('`')
    ) {
      const commentIndex = value.search(/\s#/)
      if (commentIndex !== -1) {
        value = value.substring(0, commentIndex)
      }
    }

    value = value.trim()

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")) ||
      (value.startsWith('`') && value.endsWith('`'))
    ) {
      value = value.slice(1, -1)
    }

    return { key: potentialKey, value, id: generateRowId() }
  }, [])

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

  const handleCancel = useCallback(() => {
    setEnvVars(JSON.parse(JSON.stringify(initialVarsRef.current)))
    setWorkspaceVars({ ...initialWorkspaceVarsRef.current })
    setShowUnsavedChanges(false)

    pendingProceedCallback.current?.()
    pendingProceedCallback.current = null
  }, [])

  const handleSave = useCallback(async () => {
    const onProceed = pendingProceedCallback.current

    const prevInitialVars = [...initialVarsRef.current]
    const prevInitialWorkspaceVars = { ...initialWorkspaceVarsRef.current }

    try {
      setShowUnsavedChanges(false)
      hasSavedRef.current = true

      initialWorkspaceVarsRef.current = { ...workspaceVars }
      initialVarsRef.current = JSON.parse(JSON.stringify(envVars.filter((v) => v.key && v.value)))

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

  const renderEnvVarRow = useCallback(
    (envVar: UIEnvironmentVariable, originalIndex: number) => {
      const isConflict = !!envVar.key && Object.hasOwn(workspaceVars, envVar.key)
      const keyError = validateEnvVarKey(envVar.key)
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
              className={`h-9 ${isConflict ? conflictClassName : ''} ${keyError ? 'border-[var(--text-error)]' : ''}`}
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
                <Tooltip.Content>Change to workspace scope</Tooltip.Content>
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
          {keyError && (
            <div className='col-span-3 mt-[4px] text-[12px] text-[var(--text-error)] leading-tight'>
              {keyError}
            </div>
          )}
          {isConflict && !keyError && (
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
          <div className='flex flex-1 items-center gap-[8px] rounded-[8px] border border-[var(--border)] bg-transparent px-[8px] py-[5px] transition-colors duration-100 dark:bg-[var(--surface-4)] dark:hover:border-[var(--border-1)] dark:hover:bg-[var(--surface-5)]'>
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
          <Button onClick={addEnvVar} variant='tertiary' disabled={isLoading}>
            <Plus className='mr-[6px] h-[13px] w-[13px]' />
            Add
          </Button>
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <Button
                onClick={handleSave}
                disabled={isLoading || !hasChanges || hasConflicts || hasInvalidKeys}
                variant='tertiary'
                className={`${hasConflicts || hasInvalidKeys ? 'cursor-not-allowed opacity-50' : ''}`}
              >
                Save
              </Button>
            </Tooltip.Trigger>
            {hasConflicts && <Tooltip.Content>Resolve all conflicts before saving</Tooltip.Content>}
            {hasInvalidKeys && !hasConflicts && (
              <Tooltip.Content>Fix invalid variable names before saving</Tooltip.Content>
            )}
          </Tooltip.Root>
        </div>

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
        <ModalContent size='sm'>
          <ModalHeader>Unsaved Changes</ModalHeader>
          <ModalBody>
            <p className='text-[12px] text-[var(--text-secondary)]'>
              {hasConflicts || hasInvalidKeys
                ? `You have unsaved changes, but ${hasConflicts ? 'conflicts must be resolved' : 'invalid variable names must be fixed'} before saving. You can discard your changes to close the modal.`
                : 'You have unsaved changes. Do you want to save them before closing?'}
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant='destructive' onClick={handleCancel}>
              Discard Changes
            </Button>
            {hasConflicts || hasInvalidKeys ? (
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <Button
                    disabled={true}
                    variant='tertiary'
                    className='cursor-not-allowed opacity-50'
                  >
                    Save Changes
                  </Button>
                </Tooltip.Trigger>
                <Tooltip.Content>
                  {hasConflicts
                    ? 'Resolve all conflicts before saving'
                    : 'Fix invalid variable names before saving'}
                </Tooltip.Content>
              </Tooltip.Root>
            ) : (
              <Button onClick={handleSave} variant='tertiary'>
                Save Changes
              </Button>
            )}
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  )
}
