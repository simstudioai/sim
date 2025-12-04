'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Info, Plus, Search, Share2 } from 'lucide-react'
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

const generateRowId = (() => {
  let counter = 0
  return () => {
    counter += 1
    return Date.now() + counter
  }
})()

interface UIEnvironmentVariable {
  key: string
  value: string
  id?: number
}

interface EnvironmentVariablesProps {
  registerBeforeLeaveHandler?: (handler: (onProceed: () => void) => void) => void
}

interface VariableRowProps {
  envKey: string
  value: string
  isNew: boolean
  focusedValueIndex: number | null
  rowIndex: number
  onKeyChange: (value: string) => void
  onValueChange: (value: string) => void
  onValueFocus: (index: number, e: React.FocusEvent<HTMLInputElement>) => void
  onValueBlur: () => void
  onDelete: () => void
  onPromote?: () => void
  canPromote?: boolean
  isConflict?: boolean
}

function VariableRow({
  envKey,
  value,
  isNew,
  focusedValueIndex,
  rowIndex,
  onKeyChange,
  onValueChange,
  onValueFocus,
  onValueBlur,
  onDelete,
  onPromote,
  canPromote,
  isConflict,
}: VariableRowProps) {
  const conflictClassName = 'border-[var(--text-error)] bg-[#F6D2D2] dark:bg-[#442929]'
  const maskedValueStyle =
    focusedValueIndex !== rowIndex && !isConflict
      ? ({ WebkitTextSecurity: 'disc' } as React.CSSProperties)
      : undefined

  return (
    <>
      <div className={GRID_COLS}>
        <EmcnInput
          value={envKey}
          onChange={(e) => isNew && onKeyChange(e.target.value)}
          placeholder='API_KEY'
          name={`env_key_${rowIndex}_${Math.random()}`}
          autoComplete='off'
          autoCapitalize='off'
          spellCheck='false'
          disabled={!isNew}
          readOnly={!isNew}
          onFocus={(e) => isNew && e.target.removeAttribute('readOnly')}
          className={`h-9 ${!isNew ? 'cursor-not-allowed' : ''} ${isConflict ? conflictClassName : ''}`}
        />
        <div />
        <EmcnInput
          value={isNew ? value : value ? '•'.repeat(value.length) : ''}
          onChange={(e) => isNew && onValueChange(e.target.value)}
          type='text'
          onFocus={(e) => {
            if (isNew && !isConflict) {
              e.target.removeAttribute('readOnly')
              onValueFocus(rowIndex, e)
            }
          }}
          onBlur={onValueBlur}
          placeholder={isConflict ? 'Workspace override active' : 'Enter value'}
          disabled={!isNew || isConflict}
          name={`env_value_${rowIndex}_${Math.random()}`}
          autoComplete='off'
          autoCapitalize='off'
          spellCheck='false'
          readOnly={!isNew || isConflict}
          style={isNew ? maskedValueStyle : undefined}
          className={`h-9 ${!isNew || isConflict ? 'cursor-not-allowed' : ''} ${isConflict ? conflictClassName : ''}`}
        />
        <div className='ml-[8px] flex items-center'>
          {onPromote && (
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <Button
                  variant='ghost'
                  disabled={!canPromote}
                  onClick={onPromote}
                  className='h-9 w-9'
                >
                  <Share2 className='h-3.5 w-3.5' />
                </Button>
              </Tooltip.Trigger>
              <Tooltip.Content>Promote to workspace</Tooltip.Content>
            </Tooltip.Root>
          )}
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <Button variant='ghost' onClick={onDelete} className='h-9 w-9'>
                <Trash />
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content>Delete</Tooltip.Content>
          </Tooltip.Root>
        </div>
      </div>
      {isConflict && (
        <div className='mt-[4px] text-[12px] text-[var(--text-error)] leading-tight'>
          Workspace variable with the same name overrides this. Rename your personal key to use it.
        </div>
      )}
    </>
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

  const [personalVars, setPersonalVars] = useState<UIEnvironmentVariable[]>([])
  const [workspaceVars, setWorkspaceVars] = useState<UIEnvironmentVariable[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [focusedValueIndex, setFocusedValueIndex] = useState<number | null>(null)
  const [showUnsavedChanges, setShowUnsavedChanges] = useState(false)
  const [shouldScrollToBottom, setShouldScrollToBottom] = useState(false)
  const [initialPersonalVars, setInitialPersonalVars] = useState<UIEnvironmentVariable[]>([])
  const [initialWorkspaceVars, setInitialWorkspaceVars] = useState<UIEnvironmentVariable[]>([])

  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const pendingProceedCallback = useRef<(() => void) | null>(null)
  const hasChangesRef = useRef(false)
  const hasSavedRef = useRef(false)

  const filteredPersonalVars = useMemo(() => {
    if (!searchTerm.trim()) return personalVars
    const term = searchTerm.toLowerCase()
    return personalVars.filter((v) => v.key.toLowerCase().includes(term))
  }, [personalVars, searchTerm])

  const filteredWorkspaceVars = useMemo(() => {
    if (!searchTerm.trim()) return workspaceVars
    const term = searchTerm.toLowerCase()
    return workspaceVars.filter((v) => v.key.toLowerCase().includes(term))
  }, [workspaceVars, searchTerm])

  const workspaceKeysSet = useMemo(
    () => new Set(workspaceVars.map((v) => v.key).filter(Boolean)),
    [workspaceVars]
  )

  const hasChanges = useMemo(() => {
    const compareVars = (current: UIEnvironmentVariable[], initial: UIEnvironmentVariable[]) => {
      const currentFiltered = current.filter((v) => v.key || v.value)
      const initialFiltered = initial.filter((v) => v.key || v.value)
      if (currentFiltered.length !== initialFiltered.length) return true
      const initialMap = new Map(initialFiltered.map((v) => [v.key, v.value]))
      for (const v of currentFiltered) {
        if (initialMap.get(v.key) !== v.value) return true
      }
      return false
    }
    return (
      compareVars(personalVars, initialPersonalVars) ||
      compareVars(workspaceVars, initialWorkspaceVars)
    )
  }, [personalVars, workspaceVars, initialPersonalVars, initialWorkspaceVars])

  const hasConflicts = useMemo(
    () => personalVars.some((v) => v.key && workspaceKeysSet.has(v.key)),
    [personalVars, workspaceKeysSet]
  )

  const hasDuplicateWorkspaceKeys = useMemo(() => {
    const keys = workspaceVars.map((v) => v.key).filter(Boolean)
    return keys.length !== new Set(keys).size
  }, [workspaceVars])

  const hasDuplicatePersonalKeys = useMemo(() => {
    const keys = personalVars.map((v) => v.key).filter(Boolean)
    return keys.length !== new Set(keys).size
  }, [personalVars])

  useEffect(() => {
    hasChangesRef.current = hasChanges
  }, [hasChanges])

  useEffect(() => {
    if (hasSavedRef.current) return
    const vars = Object.values(personalEnvData || {}).map((v) => ({
      ...v,
      id: generateRowId(),
    }))
    setInitialPersonalVars(JSON.parse(JSON.stringify(vars)))
    setPersonalVars(JSON.parse(JSON.stringify(vars)))
  }, [personalEnvData])

  useEffect(() => {
    if (hasSavedRef.current) {
      hasSavedRef.current = false
      return
    }
    if (workspaceEnvData?.workspace) {
      const vars = Object.entries(workspaceEnvData.workspace).map(([key, value]) => ({
        key,
        value,
        id: generateRowId(),
      }))
      setInitialWorkspaceVars(JSON.parse(JSON.stringify(vars)))
      setWorkspaceVars(JSON.parse(JSON.stringify(vars)))
    }
  }, [workspaceEnvData])

  const handleBeforeLeave = useCallback((onProceed: () => void) => {
    if (hasChangesRef.current) {
      setShowUnsavedChanges(true)
      pendingProceedCallback.current = onProceed
    } else {
      onProceed()
    }
  }, [])

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

  const addWorkspaceVar = useCallback(() => {
    setWorkspaceVars((prev) => [...prev, { key: '', value: '', id: generateRowId() }])
    setSearchTerm('')
    setShouldScrollToBottom(true)
  }, [])

  const addPersonalVar = useCallback(() => {
    setPersonalVars((prev) => [...prev, { key: '', value: '', id: generateRowId() }])
    setSearchTerm('')
    setShouldScrollToBottom(true)
  }, [])

  const updateWorkspaceVar = useCallback((index: number, field: 'key' | 'value', value: string) => {
    setWorkspaceVars((prev) => {
      const updated = [...prev]
      updated[index] = { ...updated[index], [field]: value }
      return updated
    })
  }, [])

  const updatePersonalVar = useCallback((index: number, field: 'key' | 'value', value: string) => {
    setPersonalVars((prev) => {
      const updated = [...prev]
      updated[index] = { ...updated[index], [field]: value }
      return updated
    })
  }, [])

  const removeWorkspaceVar = useCallback((index: number) => {
    setWorkspaceVars((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const removePersonalVar = useCallback((index: number) => {
    setPersonalVars((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const promoteToWorkspace = useCallback(
    (index: number) => {
      const varToPromote = personalVars[index]
      if (!varToPromote?.key || !varToPromote?.value) return

      const keyExists = workspaceVars.some((ws) => ws.key === varToPromote.key)
      if (keyExists) return

      setWorkspaceVars((prev) => [...prev, { ...varToPromote, id: generateRowId() }])
      setPersonalVars((prev) => prev.filter((_, i) => i !== index))
    },
    [personalVars, workspaceVars]
  )

  const handleCancel = useCallback(() => {
    setPersonalVars(JSON.parse(JSON.stringify(initialPersonalVars)))
    setWorkspaceVars(JSON.parse(JSON.stringify(initialWorkspaceVars)))
    setShowUnsavedChanges(false)
    pendingProceedCallback.current?.()
    pendingProceedCallback.current = null
  }, [initialPersonalVars, initialWorkspaceVars])

  const handleSave = useCallback(async () => {
    const onProceed = pendingProceedCallback.current
    const prevPersonal = [...initialPersonalVars]
    const prevWorkspace = [...initialWorkspaceVars]

    try {
      setShowUnsavedChanges(false)
      hasSavedRef.current = true

      const newPersonalInitial = JSON.parse(
        JSON.stringify(personalVars.filter((v) => v.key && v.value))
      )
      const newWorkspaceInitial = JSON.parse(
        JSON.stringify(workspaceVars.filter((v) => v.key && v.value))
      )

      const personalToSave = personalVars
        .filter((v) => v.key && v.value)
        .reduce<Record<string, string>>((acc, { key, value }) => ({ ...acc, [key]: value }), {})

      await savePersonalMutation.mutateAsync({ variables: personalToSave })

      if (workspaceId) {
        const currentWsMap = new Map(
          workspaceVars.filter((v) => v.key && v.value).map((v) => [v.key, v.value])
        )
        const initialWsMap = new Map(
          prevWorkspace.filter((v) => v.key && v.value).map((v) => [v.key, v.value])
        )

        const toUpsert: Record<string, string> = {}
        const toDelete: string[] = []

        for (const [k, v] of currentWsMap) {
          if (!initialWsMap.has(k) || initialWsMap.get(k) !== v) {
            toUpsert[k] = v
          }
        }

        for (const k of initialWsMap.keys()) {
          if (!currentWsMap.has(k)) {
            toDelete.push(k)
          }
        }

        if (Object.keys(toUpsert).length) {
          await upsertWorkspaceMutation.mutateAsync({ workspaceId, variables: toUpsert })
        }
        if (toDelete.length) {
          await removeWorkspaceMutation.mutateAsync({ workspaceId, keys: toDelete })
        }
      }

      setInitialPersonalVars(newPersonalInitial)
      setInitialWorkspaceVars(newWorkspaceInitial)
      setPersonalVars(newPersonalInitial)
      setWorkspaceVars(newWorkspaceInitial)

      onProceed?.()
      pendingProceedCallback.current = null
    } catch (error) {
      hasSavedRef.current = false
      setInitialPersonalVars(prevPersonal)
      setInitialWorkspaceVars(prevWorkspace)
      logger.error('Failed to save environment variables:', error)
    }
  }, [
    personalVars,
    workspaceVars,
    workspaceId,
    initialPersonalVars,
    initialWorkspaceVars,
    savePersonalMutation,
    upsertWorkspaceMutation,
    removeWorkspaceMutation,
  ])

  const handleValueFocus = useCallback((index: number, e: React.FocusEvent<HTMLInputElement>) => {
    setFocusedValueIndex(index)
    e.target.scrollLeft = 0
  }, [])

  return (
    <>
      <div className='flex h-full flex-col gap-[16px]'>
        <div className='hidden'>
          <input type='text' name='fake_username' autoComplete='username' tabIndex={-1} readOnly />
          <input
            type='password'
            name='fake_password'
            autoComplete='current-password'
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
              name='env_search'
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
                  isLoading ||
                  !hasChanges ||
                  hasConflicts ||
                  hasDuplicateWorkspaceKeys ||
                  hasDuplicatePersonalKeys
                }
                variant='primary'
                className={`${PRIMARY_BUTTON_STYLES} ${hasConflicts || hasDuplicateWorkspaceKeys || hasDuplicatePersonalKeys ? 'cursor-not-allowed opacity-50' : ''}`}
              >
                Save
              </Button>
            </Tooltip.Trigger>
            {(hasConflicts || hasDuplicateWorkspaceKeys || hasDuplicatePersonalKeys) && (
              <Tooltip.Content>
                {hasDuplicateWorkspaceKeys || hasDuplicatePersonalKeys
                  ? 'Remove duplicate keys before saving'
                  : 'Resolve all conflicts before saving'}
              </Tooltip.Content>
            )}
          </Tooltip.Root>
        </div>

        <div ref={scrollContainerRef} className='min-h-0 flex-1 overflow-y-auto'>
          <div className='flex flex-col gap-[20px]'>
            {isLoading ? (
              <>
                <div className='flex flex-col gap-[8px]'>
                  <Skeleton className='h-[14px] w-[70px]' />
                  <Skeleton className='h-9 rounded-[6px]' />
                </div>
                <div className='flex flex-col gap-[8px]'>
                  <Skeleton className='h-[14px] w-[55px]' />
                  <Skeleton className='h-9 rounded-[6px]' />
                </div>
              </>
            ) : (
              <>
                <div className='flex flex-col gap-[8px]'>
                  <div className='flex items-center justify-between'>
                    <span className='font-medium text-[13px] text-[var(--text-secondary)]'>
                      Workspace
                    </span>
                    <Button onClick={addWorkspaceVar} variant='ghost' className='h-7 px-2'>
                      <Plus className='mr-1 h-3 w-3' />
                      Add
                    </Button>
                  </div>
                  {filteredWorkspaceVars.length === 0 && !searchTerm.trim() ? (
                    <div className='text-[13px] text-[var(--text-muted)]'>
                      No workspace variables yet
                    </div>
                  ) : (
                    filteredWorkspaceVars.map((v, idx) => {
                      const originalIndex = workspaceVars.findIndex((wv) => wv.id === v.id)
                      const isNew = !initialWorkspaceVars.some(
                        (iv) => iv.key === v.key && iv.value === v.value
                      )
                      return (
                        <VariableRow
                          key={v.id}
                          envKey={v.key}
                          value={v.value}
                          isNew={isNew}
                          focusedValueIndex={focusedValueIndex}
                          rowIndex={originalIndex}
                          onKeyChange={(val) => updateWorkspaceVar(originalIndex, 'key', val)}
                          onValueChange={(val) => updateWorkspaceVar(originalIndex, 'value', val)}
                          onValueFocus={handleValueFocus}
                          onValueBlur={() => setFocusedValueIndex(null)}
                          onDelete={() => removeWorkspaceVar(originalIndex)}
                        />
                      )
                    })
                  )}
                </div>

                <div className='flex flex-col gap-[8px]'>
                  <div className='flex items-center justify-between'>
                    <div className='flex items-center gap-[6px]'>
                      <span className='font-medium text-[13px] text-[var(--text-secondary)]'>
                        Personal
                      </span>
                      <Tooltip.Root>
                        <Tooltip.Trigger asChild>
                          <button
                            type='button'
                            className='rounded-full p-[2px] text-[var(--text-muted)] transition hover:text-[var(--text-primary)]'
                          >
                            <Info className='h-3 w-3' strokeWidth={2} />
                          </button>
                        </Tooltip.Trigger>
                        <Tooltip.Content className='z-[600]'>
                          Private to you and for testing purposes. Used solely for manual runs
                          unless you are the workflow owner.
                        </Tooltip.Content>
                      </Tooltip.Root>
                    </div>
                    <Button onClick={addPersonalVar} variant='ghost' className='h-7 px-2'>
                      <Plus className='mr-1 h-3 w-3' />
                      Add
                    </Button>
                  </div>
                  {filteredPersonalVars.length === 0 && !searchTerm.trim() ? (
                    <div className='text-[13px] text-[var(--text-muted)]'>
                      No personal variables yet
                    </div>
                  ) : (
                    filteredPersonalVars.map((v) => {
                      const originalIndex = personalVars.findIndex((pv) => pv.id === v.id)
                      const isConflict = Boolean(v.key && workspaceKeysSet.has(v.key))
                      return (
                        <VariableRow
                          key={v.id}
                          envKey={v.key}
                          value={v.value}
                          isNew={true}
                          focusedValueIndex={focusedValueIndex}
                          rowIndex={originalIndex + 1000}
                          onKeyChange={(val) => updatePersonalVar(originalIndex, 'key', val)}
                          onValueChange={(val) => updatePersonalVar(originalIndex, 'value', val)}
                          onValueFocus={handleValueFocus}
                          onValueBlur={() => setFocusedValueIndex(null)}
                          onDelete={() => removePersonalVar(originalIndex)}
                          onPromote={() => promoteToWorkspace(originalIndex)}
                          canPromote={!!v.key && !!v.value && !isConflict && !!workspaceId}
                          isConflict={isConflict}
                        />
                      )
                    })
                  )}
                </div>

                {searchTerm.trim() &&
                  filteredPersonalVars.length === 0 &&
                  filteredWorkspaceVars.length === 0 && (
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
                  <Button disabled variant='primary' className='cursor-not-allowed opacity-50'>
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
