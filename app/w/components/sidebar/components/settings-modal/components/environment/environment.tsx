'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
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
import { EnvironmentVariable as StoreEnvironmentVariable } from '@/stores/settings/environment/types'

// Extend the store type with our UI-specific fields
interface UIEnvironmentVariable extends StoreEnvironmentVariable {
  id?: number
}

interface EnvironmentVariablesProps {
  onOpenChange: (open: boolean) => void
}

const GRID_COLS = 'grid grid-cols-[minmax(0,1fr),minmax(0,1fr),40px] gap-4'
const INITIAL_ENV_VAR: UIEnvironmentVariable = { key: '', value: '' }

export function EnvironmentVariables({ onOpenChange }: EnvironmentVariablesProps) {
  const { variables, setVariable, removeVariable } = useEnvironmentStore()
  const [envVars, setEnvVars] = useState<UIEnvironmentVariable[]>([])
  const [focusedValueIndex, setFocusedValueIndex] = useState<number | null>(null)
  const [showUnsavedChanges, setShowUnsavedChanges] = useState(false)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const pendingClose = useRef(false)
  const initialVarsRef = useRef<UIEnvironmentVariable[]>([])

  // Check if there are unsaved changes by comparing with initial state
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

  // Initialize environment variables
  useEffect(() => {
    const existingVars = Object.values(variables)
    const initialVars = existingVars.length ? existingVars : [INITIAL_ENV_VAR]
    initialVarsRef.current = JSON.parse(JSON.stringify(initialVars))
    setEnvVars(JSON.parse(JSON.stringify(initialVars)))
    pendingClose.current = false
  }, [variables])

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

  useEffect(() => {
    if (scrollContainerRef.current) {
      // Smooth scroll to bottom when new variables are added
      scrollContainerRef.current.scrollTo({
        top: scrollContainerRef.current.scrollHeight,
        behavior: 'smooth',
      })
    }
  }, [envVars.length]) // Only trigger on length changes

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

  const addEnvVar = () => {
    const newVar = { key: '', value: '', id: Date.now() }
    setEnvVars([...envVars, newVar])
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

  const handleSave = async () => {
    try {
      const validVars = envVars.filter((v) => v.key && v.value)
      validVars.forEach((v) => setVariable(v.key, v.value))

      const currentKeys = new Set(validVars.map((v) => v.key))
      Object.keys(variables).forEach((key) => {
        if (!currentKeys.has(key)) {
          removeVariable(key)
        }
      })

      // Sync with database
      await useEnvironmentStore.getState().syncWithDatabase()

      setShowUnsavedChanges(false)
      onOpenChange(false)
    } catch (error) {
      console.error('Failed to save environment variables:', error)
      // You might want to show an error notification here
    }
  }

  const renderEnvVarRow = (envVar: UIEnvironmentVariable, index: number) => (
    <div key={envVar.id || index} className={`${GRID_COLS} items-center`}>
      <Input
        data-input-type="key"
        value={envVar.key}
        onChange={(e) => updateEnvVar(index, 'key', e.target.value)}
        onPaste={(e) => handlePaste(e, index)}
        placeholder="e.g. API_KEY"
        autoComplete="off"
      />
      <Input
        data-input-type="value"
        value={envVar.value}
        onChange={(e) => updateEnvVar(index, 'value', e.target.value)}
        type={focusedValueIndex === index ? 'text' : 'password'}
        onFocus={(e) => handleValueFocus(index, e)}
        onClick={handleValueClick}
        onBlur={() => setFocusedValueIndex(null)}
        onPaste={(e) => handlePaste(e, index)}
        placeholder="Enter value"
        className="allow-scroll"
        autoComplete="off"
      />
      <Button variant="ghost" size="icon" onClick={() => removeEnvVar(index)} className="h-10 w-10">
        ×
      </Button>
    </div>
  )

  return (
    <div className="flex flex-col h-full">
      {/* Fixed Header */}
      <div className="px-6 pt-6">
        <h2 className="text-lg font-medium mb-4">Environment Variables</h2>
        <div className={`${GRID_COLS} px-0.5 mb-2`}>
          <Label>Key</Label>
          <Label>Value</Label>
          <div />
        </div>
      </div>

      {/* Scrollable Content */}
      <div
        ref={scrollContainerRef}
        className="flex-1 px-6 overflow-y-auto min-h-0 scrollbar-thin scrollbar-thumb-muted-foreground/20 hover:scrollbar-thumb-muted-foreground/25 scrollbar-track-transparent"
      >
        <div className="space-y-2 py-2">{envVars.map(renderEnvVarRow)}</div>
      </div>

      {/* Fixed Footer */}
      <div className="px-6 pb-6 pt-4 border-t mt-auto">
        <div className="flex flex-col gap-4">
          <Button variant="outline" size="sm" onClick={addEnvVar}>
            Add Variable
          </Button>

          <div className="flex justify-end space-x-2">
            <Button variant="outline" onClick={handleClose}>
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
