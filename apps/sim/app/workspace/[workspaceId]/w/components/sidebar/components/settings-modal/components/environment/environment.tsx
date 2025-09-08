'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Search, Share2 } from 'lucide-react'
import { useParams } from 'next/navigation'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { createLogger } from '@/lib/logs/console/logger'
import { useEnvironmentStore } from '@/stores/settings/environment/store'
import type { EnvironmentVariable as StoreEnvironmentVariable } from '@/stores/settings/environment/types'

const logger = createLogger('EnvironmentVariables')

const GRID_COLS = 'grid grid-cols-[minmax(0,1fr),minmax(0,1fr),88px] gap-4'
const INITIAL_ENV_VAR: UIEnvironmentVariable = { key: '', value: '' }

interface UIEnvironmentVariable extends StoreEnvironmentVariable {
  id?: number
}

interface EnvironmentVariablesProps {
  onOpenChange: (open: boolean) => void
  registerCloseHandler?: (handler: (open: boolean) => void) => void
}

export function EnvironmentVariables({
  onOpenChange,
  registerCloseHandler,
}: EnvironmentVariablesProps) {
  const {
    variables,
    isLoading,
    loadWorkspaceEnvironment,
    upsertWorkspaceEnvironment,
    removeWorkspaceEnvironmentKeys,
  } = useEnvironmentStore()
  const params = useParams()
  const workspaceId = (params?.workspaceId as string) || ''

  const [envVars, setEnvVars] = useState<UIEnvironmentVariable[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [focusedValueIndex, setFocusedValueIndex] = useState<number | null>(null)
  const [showUnsavedChanges, setShowUnsavedChanges] = useState(false)
  const [shouldScrollToBottom, setShouldScrollToBottom] = useState(false)
  const [workspaceVars, setWorkspaceVars] = useState<Record<string, string>>({})
  const [conflicts, setConflicts] = useState<string[]>([])
  const [renamingKey, setRenamingKey] = useState<string | null>(null)
  const [pendingKeyValue, setPendingKeyValue] = useState<string>('')
  const [isWorkspaceLoading, setIsWorkspaceLoading] = useState(true)
  const initialWorkspaceVarsRef = useRef<Record<string, string>>({})

  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const pendingClose = useRef(false)
  const initialVarsRef = useRef<UIEnvironmentVariable[]>([])

  const filteredEnvVars = useMemo(() => {
    if (!searchTerm.trim()) {
      return envVars.map((envVar, index) => ({ envVar, originalIndex: index }))
    }

    return envVars
      .map((envVar, index) => ({ envVar, originalIndex: index }))
      .filter(({ envVar }) => envVar.key.toLowerCase().includes(searchTerm.toLowerCase()))
  }, [envVars, searchTerm])

  const hasChanges = useMemo(() => {
    const initialVars = initialVarsRef.current.filter((v) => v.key || v.value)
    const currentVars = envVars.filter((v) => v.key || v.value)

    const initialMap = new Map(initialVars.map((v) => [v.key, v.value]))
    const currentMap = new Map(currentVars.map((v) => [v.key, v.value]))

    if (initialMap.size !== currentMap.size) return true

    for (const [key, value] of currentMap) {
      const initialValue = initialMap.get(key)
      if (initialValue !== value) return true
    }

    for (const key of initialMap.keys()) {
      if (!currentMap.has(key)) return true
    }

    const before = initialWorkspaceVarsRef.current
    const after = workspaceVars
    const beforeKeys = Object.keys(before)
    const afterKeys = Object.keys(after)
    if (beforeKeys.length !== afterKeys.length) return true
    for (const key of new Set([...beforeKeys, ...afterKeys])) {
      if (before[key] !== after[key]) return true
    }

    return false
  }, [envVars, workspaceVars])

  const hasConflicts = useMemo(() => {
    return envVars.some((envVar) => !!envVar.key && Object.hasOwn(workspaceVars, envVar.key))
  }, [envVars, workspaceVars])

  const handleModalClose = (open: boolean) => {
    if (!open && hasChanges) {
      setShowUnsavedChanges(true)
      pendingClose.current = true
    } else {
      onOpenChange(open)
    }
  }

  useEffect(() => {
    const existingVars = Object.values(variables)
    const initialVars = existingVars.length ? existingVars : [INITIAL_ENV_VAR]
    initialVarsRef.current = JSON.parse(JSON.stringify(initialVars))
    setEnvVars(JSON.parse(JSON.stringify(initialVars)))
    pendingClose.current = false
  }, [variables])

  useEffect(() => {
    let mounted = true
    ;(async () => {
      if (!workspaceId) {
        setIsWorkspaceLoading(false)
        return
      }
      setIsWorkspaceLoading(true)
      try {
        const data = await loadWorkspaceEnvironment(workspaceId)
        if (!mounted) return
        setWorkspaceVars(data.workspace || {})
        initialWorkspaceVarsRef.current = data.workspace || {}
        setConflicts(data.conflicts || [])
      } finally {
        if (mounted) {
          setIsWorkspaceLoading(false)
        }
      }
    })()
    return () => {
      mounted = false
    }
  }, [workspaceId, loadWorkspaceEnvironment])

  useEffect(() => {
    if (registerCloseHandler) {
      registerCloseHandler(handleModalClose)
    }
  }, [registerCloseHandler, hasChanges])

  useEffect(() => {
    if (shouldScrollToBottom && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTo({
        top: scrollContainerRef.current.scrollHeight,
        behavior: 'smooth',
      })
      setShouldScrollToBottom(false)
    }
  }, [shouldScrollToBottom])

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

      setConflicts((prev) => {
        const withoutOld = prev.filter((k) => k !== currentKey)
        const personalHasNew = !!useEnvironmentStore.getState().variables[newKey]
        return personalHasNew && !withoutOld.includes(newKey) ? [...withoutOld, newKey] : withoutOld
      })
    },
    [pendingKeyValue, renamingKey, setWorkspaceVars, setConflicts]
  )
  const addEnvVar = () => {
    const newVar = { key: '', value: '', id: Date.now() }
    setEnvVars([...envVars, newVar])
    setSearchTerm('')
    setShouldScrollToBottom(true)
  }

  const updateEnvVar = (index: number, field: 'key' | 'value', value: string) => {
    const newEnvVars = [...envVars]
    newEnvVars[index][field] = value
    setEnvVars(newEnvVars)
  }

  const removeEnvVar = (index: number) => {
    const newEnvVars = envVars.filter((_, i) => i !== index)
    setEnvVars(newEnvVars.length ? newEnvVars : [INITIAL_ENV_VAR])
  }

  const handleValueFocus = (index: number, e: React.FocusEvent<HTMLInputElement>) => {
    setFocusedValueIndex(index)
    e.target.scrollLeft = 0
  }

  const handleValueClick = (e: React.MouseEvent<HTMLInputElement>) => {
    e.preventDefault()
    e.currentTarget.scrollLeft = 0
  }

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>, index: number) => {
    const text = e.clipboardData.getData('text').trim()
    if (!text) return

    const lines = text.split('\n').filter((line) => line.trim())
    if (lines.length === 0) return

    e.preventDefault()

    const inputType = (e.target as HTMLInputElement).getAttribute('data-input-type') as
      | 'key'
      | 'value'

    if (inputType) {
      const hasValidEnvVarPattern = lines.some((line) => {
        const equalIndex = line.indexOf('=')
        if (equalIndex === -1 || equalIndex === 0) return false

        const potentialKey = line.substring(0, equalIndex).trim()
        const envVarPattern = /^[A-Za-z_][A-Za-z0-9_]*$/
        return envVarPattern.test(potentialKey)
      })

      if (!hasValidEnvVarPattern) {
        handleSingleValuePaste(text, index, inputType)
        return
      }
    }

    handleKeyValuePaste(lines)
  }

  const handleSingleValuePaste = (text: string, index: number, inputType: 'key' | 'value') => {
    const newEnvVars = [...envVars]
    newEnvVars[index][inputType] = text
    setEnvVars(newEnvVars)
  }

  const handleKeyValuePaste = (lines: string[]) => {
    const parsedVars = lines
      .map((line) => {
        const equalIndex = line.indexOf('=')

        if (equalIndex === -1 || equalIndex === 0) {
          return null
        }

        const potentialKey = line.substring(0, equalIndex).trim()

        const envVarPattern = /^[A-Za-z_][A-Za-z0-9_]*$/

        if (!envVarPattern.test(potentialKey)) {
          return null
        }

        const key = potentialKey
        const value = line.substring(equalIndex + 1).trim()

        return {
          key,
          value,
          id: Date.now() + Math.random(),
        }
      })
      .filter((parsed): parsed is NonNullable<typeof parsed> => parsed !== null)
      .filter(({ key, value }) => key && value)

    if (parsedVars.length > 0) {
      const existingVars = envVars.filter((v) => v.key || v.value)
      setEnvVars([...existingVars, ...parsedVars])
      setShouldScrollToBottom(true)
    }
  }

  const handleCancel = () => {
    setEnvVars(JSON.parse(JSON.stringify(initialVarsRef.current)))
    setShowUnsavedChanges(false)
    if (pendingClose.current) {
      onOpenChange(false)
    }
  }

  const handleSave = async () => {
    try {
      setShowUnsavedChanges(false)
      onOpenChange(false)

      const validVariables = envVars
        .filter((v) => v.key && v.value)
        .reduce(
          (acc, { key, value }) => ({
            ...acc,
            [key]: value,
          }),
          {}
        )
      await useEnvironmentStore.getState().saveEnvironmentVariables(validVariables)

      const before = initialWorkspaceVarsRef.current
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
          await upsertWorkspaceEnvironment(workspaceId, toUpsert)
        }
        if (toDelete.length) {
          await removeWorkspaceEnvironmentKeys(workspaceId, toDelete)
        }
      }

      initialWorkspaceVarsRef.current = { ...workspaceVars }
    } catch (error) {
      logger.error('Failed to save environment variables:', error)
    }
  }

  const renderEnvVarRow = (envVar: UIEnvironmentVariable, originalIndex: number) => {
    const isConflict = !!envVar.key && Object.hasOwn(workspaceVars, envVar.key)
    return (
      <>
        <div className={`${GRID_COLS} items-center`}>
          <Input
            data-input-type='key'
            value={envVar.key}
            onChange={(e) => updateEnvVar(originalIndex, 'key', e.target.value)}
            onPaste={(e) => handlePaste(e, originalIndex)}
            placeholder='API_KEY'
            autoComplete='off'
            autoCorrect='off'
            autoCapitalize='off'
            spellCheck='false'
            name={`env-var-key-${envVar.id || originalIndex}-${Math.random()}`}
            className={`h-9 rounded-[8px] border-none px-3 font-normal text-sm ring-0 ring-offset-0 placeholder:text-muted-foreground focus:ring-0 focus:ring-offset-0 focus-visible:ring-0 focus-visible:ring-offset-0 ${isConflict ? 'border border-red-500 bg-[#F6D2D2] outline-none ring-0 disabled:bg-[#F6D2D2] disabled:opacity-100 dark:bg-[#442929] disabled:dark:bg-[#442929]' : 'bg-muted'}`}
          />
          <Input
            data-input-type='value'
            value={envVar.value}
            onChange={(e) => updateEnvVar(originalIndex, 'value', e.target.value)}
            type={focusedValueIndex === originalIndex ? 'text' : 'password'}
            onFocus={(e) => handleValueFocus(originalIndex, e)}
            onClick={handleValueClick}
            onBlur={() => setFocusedValueIndex(null)}
            onPaste={(e) => handlePaste(e, originalIndex)}
            placeholder={isConflict ? 'Workspace override active' : 'Enter value'}
            disabled={isConflict}
            aria-disabled={isConflict}
            className={`allow-scroll h-9 rounded-[8px] border-none px-3 font-normal text-sm ring-0 ring-offset-0 placeholder:text-muted-foreground focus:ring-0 focus:ring-offset-0 focus-visible:ring-0 focus-visible:ring-offset-0 ${isConflict ? 'cursor-not-allowed border border-red-500 bg-[#F6D2D2] outline-none ring-0 disabled:bg-[#F6D2D2] disabled:opacity-100 dark:bg-[#442929] disabled:dark:bg-[#442929]' : 'bg-muted'}`}
            autoComplete='off'
            autoCorrect='off'
            autoCapitalize='off'
            spellCheck='false'
            name={`env-var-value-${envVar.id || originalIndex}-${Math.random()}`}
          />
          <div className='flex items-center justify-end gap-2'>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant='ghost'
                  size='icon'
                  disabled={!envVar.key || !envVar.value || isConflict || !workspaceId}
                  onClick={() => {
                    if (!envVar.key || !envVar.value || !workspaceId) return
                    setWorkspaceVars((prev) => ({ ...prev, [envVar.key]: envVar.value }))
                    setConflicts((prev) =>
                      prev.includes(envVar.key) ? prev : [...prev, envVar.key]
                    )
                    removeEnvVar(originalIndex)
                  }}
                  className='h-9 w-9 rounded-[8px] bg-muted p-0 text-muted-foreground hover:bg-muted/70'
                >
                  <Share2 className='h-4 w-4' />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Make it workspace scoped</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant='ghost'
                  size='icon'
                  onClick={() => removeEnvVar(originalIndex)}
                  className='h-9 w-9 rounded-[8px] bg-muted p-0 text-muted-foreground hover:bg-muted/70'
                >
                  ×
                </Button>
              </TooltipTrigger>
              <TooltipContent>Delete environment variable</TooltipContent>
            </Tooltip>
          </div>
        </div>
        {isConflict && (
          <div className='col-span-3 mt-1 text-[#DC2626] text-[12px] leading-tight dark:text-[#F87171]'>
            Workspace variable with the same name overrides this. Rename your personal key to use
            it.
          </div>
        )}
      </>
    )
  }

  return (
    <div className='relative flex h-full flex-col'>
      {/* Fixed Header */}
      <div className='px-6 pt-4 pb-2'>
        {/* Search Input */}
        {isLoading ? (
          <Skeleton className='h-9 w-56 rounded-[8px]' />
        ) : (
          <div className='flex h-9 w-56 items-center gap-2 rounded-[8px] border bg-transparent pr-2 pl-3'>
            <Search className='h-4 w-4 flex-shrink-0 text-muted-foreground' strokeWidth={2} />
            <Input
              placeholder='Search variables...'
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className='flex-1 border-0 bg-transparent px-0 font-[380] font-sans text-base text-foreground leading-none placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0'
            />
          </div>
        )}
      </div>

      {/* Scrollable Content */}
      <div
        ref={scrollContainerRef}
        className='scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent min-h-0 flex-1 overflow-y-auto px-6'
      >
        <div className='h-full space-y-2 py-2'>
          {isLoading || isWorkspaceLoading ? (
            <>
              {/* Show 3 skeleton rows */}
              {[1, 2, 3].map((index) => (
                <div key={index} className={`${GRID_COLS} items-center`}>
                  <Skeleton className='h-9 rounded-[8px]' />
                  <Skeleton className='h-9 rounded-[8px]' />
                  <Skeleton className='h-9 w-9 rounded-[8px]' />
                </div>
              ))}
            </>
          ) : (
            <>
              {/* Workspace section */}
              <div className='mb-6 space-y-2'>
                <div className='font-medium text-[13px] text-foreground'>Workspace</div>
                {Object.keys(workspaceVars).length === 0 ? (
                  <div className='text-muted-foreground text-sm'>No workspace variables yet.</div>
                ) : (
                  Object.entries(workspaceVars).map(([key, value]) => (
                    <div key={key} className={`${GRID_COLS} items-center`}>
                      <Input
                        value={renamingKey === key ? pendingKeyValue : key}
                        onChange={(e) => {
                          if (renamingKey !== key) setRenamingKey(key)
                          setPendingKeyValue(e.target.value)
                        }}
                        onBlur={() => handleWorkspaceKeyRename(key, value)}
                        className='h-9 rounded-[8px] border-none bg-muted px-3 text-sm'
                      />
                      <Input
                        value={value ? '•'.repeat(value.length) : ''}
                        readOnly
                        className='h-9 rounded-[8px] border-none bg-muted px-3 text-sm'
                      />
                      <div className='flex justify-end'>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant='ghost'
                              size='icon'
                              onClick={() => {
                                setWorkspaceVars((prev) => {
                                  const next = { ...prev }
                                  delete next[key]
                                  return next
                                })
                                setConflicts((prev) => prev.filter((k) => k !== key))
                              }}
                              className='h-9 w-9 rounded-[8px] bg-muted p-0 text-muted-foreground hover:bg-muted/70'
                            >
                              ×
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Delete environment variable</TooltipContent>
                        </Tooltip>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Personal section */}
              <div className='mt-8 mb-2 font-medium text-[13px] text-foreground'> Personal </div>
              {filteredEnvVars.map(({ envVar, originalIndex }) => (
                <div key={envVar.id || originalIndex}>{renderEnvVarRow(envVar, originalIndex)}</div>
              ))}
              {/* Show message when search has no results but there are variables */}
              {searchTerm.trim() && filteredEnvVars.length === 0 && envVars.length > 0 && (
                <div className='flex h-full items-center justify-center text-muted-foreground text-sm'>
                  No environment variables found matching "{searchTerm}"
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className='bg-background'>
        <div className='flex w-full items-center justify-between px-6 py-4'>
          {isLoading ? (
            <>
              <Skeleton className='h-9 w-[117px] rounded-[8px]' />
              <Skeleton className='h-9 w-[108px] rounded-[8px]' />
            </>
          ) : (
            <>
              <Button
                onClick={addEnvVar}
                variant='ghost'
                className='h-9 rounded-[8px] border bg-background px-3 shadow-xs hover:bg-muted focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0'
              >
                <Plus className='h-4 w-4 stroke-[2px]' />
                Add Variable
              </Button>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    onClick={handleSave}
                    disabled={!hasChanges || hasConflicts}
                    className={`h-9 rounded-[8px] ${hasConflicts ? 'cursor-not-allowed opacity-50' : ''}`}
                  >
                    Save Changes
                  </Button>
                </TooltipTrigger>
                {hasConflicts && (
                  <TooltipContent>Resolve all conflicts before saving</TooltipContent>
                )}
              </Tooltip>
            </>
          )}
        </div>
      </div>

      <AlertDialog open={showUnsavedChanges} onOpenChange={setShowUnsavedChanges}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved Changes</AlertDialogTitle>
            <AlertDialogDescription>
              {hasConflicts
                ? 'You have unsaved changes, but conflicts must be resolved before saving. You can discard your changes to close the modal.'
                : 'You have unsaved changes. Do you want to save them before closing?'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className='flex'>
            <AlertDialogCancel onClick={handleCancel} className='h-9 w-full rounded-[8px]'>
              Discard Changes
            </AlertDialogCancel>
            {hasConflicts ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <AlertDialogAction
                    disabled={true}
                    className='h-9 w-full cursor-not-allowed rounded-[8px] opacity-50 transition-all duration-200'
                  >
                    Save Changes
                  </AlertDialogAction>
                </TooltipTrigger>
                <TooltipContent>Resolve all conflicts before saving</TooltipContent>
              </Tooltip>
            ) : (
              <AlertDialogAction
                onClick={handleSave}
                className='h-9 w-full rounded-[8px] transition-all duration-200'
              >
                Save Changes
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
