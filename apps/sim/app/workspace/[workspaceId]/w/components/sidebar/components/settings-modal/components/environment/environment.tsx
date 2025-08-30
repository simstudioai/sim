'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
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
import { createLogger } from '@/lib/logs/console/logger'
import { useEnvironmentStore } from '@/stores/settings/environment/store'
import type { EnvironmentVariable as StoreEnvironmentVariable } from '@/stores/settings/environment/types'

const logger = createLogger('EnvironmentVariables')

// Constants
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

  // Filter environment variables based on search term
  const filteredEnvVars = useMemo(() => {
    if (!searchTerm.trim()) {
      return envVars.map((envVar, index) => ({ envVar, originalIndex: index }))
    }

    return envVars
      .map((envVar, index) => ({ envVar, originalIndex: index }))
      .filter(({ envVar }) => envVar.key.toLowerCase().includes(searchTerm.toLowerCase()))
  }, [envVars, searchTerm])

  // Derived state
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

    // Workspace diffs
    const before = initialWorkspaceVarsRef.current
    const after = workspaceVars
    const beforeKeys = Object.keys(before)
    const afterKeys = Object.keys(after)
    if (beforeKeys.length !== afterKeys.length) return true
    for (const key of new Set([...beforeKeys, ...afterKeys])) {
      if ((before as any)[key] !== (after as any)[key]) return true
    }

    return false
  }, [envVars, workspaceVars])

  // Intercept close attempts to check for unsaved changes
  const handleModalClose = (open: boolean) => {
    if (!open && hasChanges) {
      setShowUnsavedChanges(true)
      pendingClose.current = true
    } else {
      onOpenChange(open)
    }
  }

  // Initialization effect
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

  // Register close handler with parent
  useEffect(() => {
    if (registerCloseHandler) {
      registerCloseHandler(handleModalClose)
    }
  }, [registerCloseHandler, hasChanges])

  // Scroll effect - only when explicitly adding a new variable
  useEffect(() => {
    if (shouldScrollToBottom && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTo({
        top: scrollContainerRef.current.scrollHeight,
        behavior: 'smooth',
      })
      setShouldScrollToBottom(false)
    }
  }, [shouldScrollToBottom])

  // Variable management functions
  const addEnvVar = () => {
    const newVar = { key: '', value: '', id: Date.now() }
    setEnvVars([...envVars, newVar])
    // Clear search to ensure the new variable is visible
    setSearchTerm('')
    // Trigger scroll to bottom
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

  // Input event handlers
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

    // If we're in a specific input field, check if this looks like environment variable key-value pairs
    if (inputType) {
      // Check if this looks like valid environment variable key-value pairs
      const hasValidEnvVarPattern = lines.some((line) => {
        const equalIndex = line.indexOf('=')
        if (equalIndex === -1 || equalIndex === 0) return false

        const potentialKey = line.substring(0, equalIndex).trim()
        const envVarPattern = /^[A-Za-z_][A-Za-z0-9_]*$/
        return envVarPattern.test(potentialKey)
      })

      // If it doesn't look like env vars, treat as single value paste
      if (!hasValidEnvVarPattern) {
        handleSingleValuePaste(text, index, inputType)
        return
      }
    }

    // Try to parse as key-value pairs
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
        // Only split on = if it looks like a proper environment variable (key=value format)
        const equalIndex = line.indexOf('=')

        // If no = found or = is at the beginning, skip this line
        if (equalIndex === -1 || equalIndex === 0) {
          return null
        }

        const potentialKey = line.substring(0, equalIndex).trim()

        // Check if the potential key looks like an environment variable name
        // Should be letters, numbers, underscores, and not contain spaces, URLs, etc.
        const envVarPattern = /^[A-Za-z_][A-Za-z0-9_]*$/

        // If it doesn't look like an env var name, skip this line
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
      // Scroll to bottom when pasting multiple variables
      setShouldScrollToBottom(true)
    }
  }

  // Dialog management

  const handleCancel = () => {
    setEnvVars(JSON.parse(JSON.stringify(initialVarsRef.current)))
    setShowUnsavedChanges(false)
    if (pendingClose.current) {
      onOpenChange(false)
    }
  }

  const handleSave = async () => {
    try {
      // Close modal immediately for optimistic updates
      setShowUnsavedChanges(false)
      onOpenChange(false)

      // Convert valid env vars to Record<string, string>
      const validVariables = envVars
        .filter((v) => v.key && v.value)
        .reduce(
          (acc, { key, value }) => ({
            ...acc,
            [key]: value,
          }),
          {}
        )

      // Single store update that triggers sync
      useEnvironmentStore.getState().setVariables(validVariables)

      // Workspace diffs commit
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

  // UI rendering
  const renderEnvVarRow = (envVar: UIEnvironmentVariable, originalIndex: number) => {
    const isConflict = !!envVar.key && Object.hasOwn(workspaceVars, envVar.key)
    return (
      <>
        <div key={envVar.id || originalIndex} className={`${GRID_COLS} items-center`}>
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
            className={`h-9 rounded-[8px] border-none bg-muted px-3 font-normal text-sm ring-0 ring-offset-0 placeholder:text-muted-foreground focus:ring-0 focus:ring-offset-0 focus-visible:ring-0 focus-visible:ring-offset-0 ${isConflict ? 'outline-none ring-0 border border-destructive/50 text-destructive' : ''}`}
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
            className={`allow-scroll h-9 rounded-[8px] border-none bg-muted px-3 font-normal text-sm ring-0 ring-offset-0 placeholder:text-muted-foreground focus:ring-0 focus:ring-offset-0 focus-visible:ring-0 focus-visible:ring-offset-0 ${isConflict ? 'outline-none ring-0 border border-destructive/50 text-destructive/80 cursor-not-allowed' : ''}`}
            autoComplete='off'
            autoCorrect='off'
            autoCapitalize='off'
            spellCheck='false'
            name={`env-var-value-${envVar.id || originalIndex}-${Math.random()}`}
          />
          <div className='flex items-center gap-2'>
            <Button
              variant='ghost'
              size='icon'
              onClick={() => removeEnvVar(originalIndex)}
              className='h-9 w-9 rounded-[8px] bg-muted p-0 text-muted-foreground hover:bg-muted/70'
            >
              ×
            </Button>
            <Button
              variant='ghost'
              size='icon'
              title='Make it Workspace Scoped'
              aria-label='Make it Workspace Scoped'
              disabled={!envVar.key || !envVar.value || isConflict || !workspaceId}
              onClick={() => {
                if (!envVar.key || !envVar.value || !workspaceId) return
                setWorkspaceVars((prev) => ({ ...prev, [envVar.key]: envVar.value }))
                setConflicts((prev) => (prev.includes(envVar.key) ? prev : [...prev, envVar.key]))
              }}
              className='h-9 w-9 rounded-[8px] bg-muted p-0 text-muted-foreground hover:bg-muted/70'
            >
              <Share2 className='h-4 w-4' />
            </Button>
          </div>
        </div>
        {isConflict && (
          <div className='col-span-3 -mt-1 mb-2 text-[12px] leading-tight text-destructive/80'>
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
                <div className='text-[13px] font-medium text-foreground'>Workspace Environment</div>
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
                        onBlur={() => {
                          const newKey = pendingKeyValue.trim()
                          if (!renamingKey || renamingKey !== key) return
                          setRenamingKey(null)
                          if (!newKey || newKey === key) return
                          setWorkspaceVars((prev) => {
                            const next = { ...prev }
                            delete next[key]
                            next[newKey] = value
                            return next
                          })
                          setConflicts((prev) => {
                            const withoutOld = prev.filter((k) => k !== key)
                            const personalHasNew =
                              !!useEnvironmentStore.getState().variables[newKey]
                            return personalHasNew && !withoutOld.includes(newKey)
                              ? [...withoutOld, newKey]
                              : withoutOld
                          })
                        }}
                        className='h-9 rounded-[8px] border-none bg-muted px-3 text-sm'
                      />
                      <Input
                        value={value ? '••••••••' : ''}
                        readOnly
                        className='h-9 rounded-[8px] border-none bg-muted px-3 text-sm'
                      />
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
                    </div>
                  ))
                )}
              </div>

              {/* Personal section */}
              <div className='mt-8 mb-2 text-[13px] font-medium text-foreground'>
                Personal Environment
              </div>
              {filteredEnvVars.map(({ envVar, originalIndex }) =>
                renderEnvVarRow(envVar, originalIndex)
              )}
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

              <Button onClick={handleSave} disabled={!hasChanges} className='h-9 rounded-[8px]'>
                Save Changes
              </Button>
            </>
          )}
        </div>
      </div>

      <AlertDialog open={showUnsavedChanges} onOpenChange={setShowUnsavedChanges}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved Changes</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes. Do you want to save them before closing?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className='flex'>
            <AlertDialogCancel onClick={handleCancel} className='h-9 w-full rounded-[8px]'>
              Discard Changes
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleSave}
              className='h-9 w-full rounded-[8px] transition-all duration-200'
            >
              Save Changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
