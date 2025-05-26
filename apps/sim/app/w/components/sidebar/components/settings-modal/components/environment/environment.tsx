'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'
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
import { Label } from '@/components/ui/label'
import { useEnvironmentStore } from '@/stores/settings/environment/store'
import type { EnvironmentVariable as StoreEnvironmentVariable } from '@/stores/settings/environment/types'

// Constants
const GRID_COLS = 'grid grid-cols-[minmax(0,1fr),minmax(0,1fr),40px] gap-4'
const INITIAL_ENV_VAR: UIEnvironmentVariable = { key: '', value: '' }

interface UIEnvironmentVariable extends StoreEnvironmentVariable {
  id?: number
}

interface EnvironmentVariablesProps {
  onOpenChange: (open: boolean) => void
}

export function EnvironmentVariables({ onOpenChange }: EnvironmentVariablesProps) {
  const { variables } = useEnvironmentStore()

  const [envVars, setEnvVars] = useState<UIEnvironmentVariable[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [focusedValueIndex, setFocusedValueIndex] = useState<number | null>(null)
  const [showUnsavedChanges, setShowUnsavedChanges] = useState(false)

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

    return false
  }, [envVars])

  // Initialization effect
  useEffect(() => {
    const existingVars = Object.values(variables)
    const initialVars = existingVars.length ? existingVars : [INITIAL_ENV_VAR]
    initialVarsRef.current = JSON.parse(JSON.stringify(initialVars))
    setEnvVars(JSON.parse(JSON.stringify(initialVars)))
    pendingClose.current = false
  }, [variables])

  // Scroll effect
  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTo({
        top: scrollContainerRef.current.scrollHeight,
        behavior: 'smooth',
      })
    }
  }, [envVars.length])

  // Variable management functions
  const addEnvVar = () => {
    const newVar = { key: '', value: '', id: Date.now() }
    setEnvVars([...envVars, newVar])
    // Clear search to ensure the new variable is visible
    setSearchTerm('')
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
    const containsKeyValuePair = text.includes('=')

    if (inputType && !containsKeyValuePair) {
      handleSingleValuePaste(text, index, inputType)
      return
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
        const [key, ...valueParts] = line.split('=')
        const value = valueParts.join('=').trim()
        return {
          key: key.trim(),
          value,
          id: Date.now() + Math.random(),
        }
      })
      .filter(({ key, value }) => key && value)

    if (parsedVars.length > 0) {
      const existingVars = envVars.filter((v) => v.key || v.value)
      setEnvVars([...existingVars, ...parsedVars])
    }
  }

  // Dialog management
  const handleClose = () => {
    if (hasChanges) {
      setShowUnsavedChanges(true)
      pendingClose.current = true
    } else {
      onOpenChange(false)
    }
  }

  const handleCancel = () => {
    setEnvVars(JSON.parse(JSON.stringify(initialVarsRef.current)))
    setShowUnsavedChanges(false)
    if (pendingClose.current) {
      onOpenChange(false)
    }
  }

  const handleSave = () => {
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
    } catch (error) {
      console.error('Failed to save environment variables:', error)
    }
  }

  // UI rendering
  const renderEnvVarRow = (envVar: UIEnvironmentVariable, originalIndex: number) => (
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
        placeholder='Enter value'
        className='allow-scroll'
        autoComplete='off'
        autoCorrect='off'
        autoCapitalize='off'
        spellCheck='false'
        name={`env-var-value-${envVar.id || originalIndex}-${Math.random()}`}
      />
      <Button
        variant='ghost'
        size='icon'
        onClick={() => removeEnvVar(originalIndex)}
        className='h-10 w-10'
      >
        ×
      </Button>
    </div>
  )

  return (
    <div className='flex h-full flex-col'>
      {/* Fixed Header */}
      <div className='px-6 pt-6'>
        <div className='mb-6 flex items-center justify-between'>
          <h2 className='font-medium text-lg'>Environment Variables</h2>

          {/* Search Input */}
          <div className='relative w-48'>
            <Search className='-translate-y-1/2 absolute top-1/2 left-3 h-4 w-4 text-muted-foreground' />
            <Input
              placeholder='Search...'
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className='h-9 pl-9 text-sm'
            />
          </div>
        </div>

        <div className={`${GRID_COLS} mb-2 px-0.5`}>
          <Label>Key</Label>
          <Label>Value</Label>
          <div />
        </div>
      </div>

      {/* Scrollable Content */}
      <div
        ref={scrollContainerRef}
        className='scrollbar-thin scrollbar-thumb-muted-foreground/20 hover:scrollbar-thumb-muted-foreground/25 scrollbar-track-transparent min-h-0 flex-1 overflow-y-auto px-6'
      >
        <div className='space-y-2 py-2'>
          {filteredEnvVars.map(({ envVar, originalIndex }) =>
            renderEnvVarRow(envVar, originalIndex)
          )}
          {/* Show message when search has no results but there are variables */}
          {searchTerm.trim() && filteredEnvVars.length === 0 && envVars.length > 0 && (
            <div className='py-8 text-center text-muted-foreground text-sm'>
              No environment variables found matching "{searchTerm}"
            </div>
          )}
        </div>
      </div>

      {/* Fixed Footer */}
      <div className='mt-auto border-t px-6 pt-4 pb-6'>
        <div className='flex flex-col gap-4'>
          <Button variant='outline' size='sm' onClick={addEnvVar}>
            Add Variable
          </Button>

          <div className='flex justify-end space-x-2'>
            <Button variant='outline' onClick={handleClose}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={!hasChanges}>
              Save Changes
            </Button>
          </div>
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
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleCancel}>Discard Changes</AlertDialogCancel>
            <AlertDialogAction onClick={handleSave}>Save Changes</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
