'use client'

import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  ChevronDown,
  Copy,
  Maximize2,
  Minimize2,
  MoreVertical,
  Plus,
  Trash,
} from 'lucide-react'
import Editor from 'react-simple-code-editor'
import { highlight, languages, Tooltip } from '@/components/emcn'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  ScrollArea,
} from '@/components/ui'
import { createLogger } from '@/lib/logs/console/logger'
import { cn, validateName } from '@/lib/utils'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'
import { useVariablesStore } from '@/stores/panel/variables/store'
import type { Variable, VariableType } from '@/stores/panel/variables/types'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

const logger = createLogger('Variables')

const TYPE_CONFIG: Record<VariableType, { icon: string; placeholder: string }> = {
  plain: { icon: 'Abc', placeholder: 'Plain text value' },
  number: { icon: '123', placeholder: '42' },
  boolean: { icon: '0/1', placeholder: 'true' },
  object: { icon: '{}', placeholder: '{\n  "key": "value"\n}' },
  array: { icon: '[]', placeholder: '[\n  1,\n  2,\n  3\n]' },
  string: { icon: 'Abc', placeholder: 'Plain text value' },
}

const VARIABLE_TYPES: Exclude<VariableType, 'string'>[] = [
  'plain',
  'number',
  'boolean',
  'object',
  'array',
]

export function Variables() {
  const { activeWorkflowId } = useWorkflowRegistry()
  const { getVariablesByWorkflowId } = useVariablesStore()
  const {
    collaborativeUpdateVariable,
    collaborativeAddVariable,
    collaborativeDeleteVariable,
    collaborativeDuplicateVariable,
  } = useCollaborativeWorkflow()

  const workflowVariables = activeWorkflowId ? getVariablesByWorkflowId(activeWorkflowId) : []
  const editorRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const [collapsedById, setCollapsedById] = useState<Record<string, boolean>>({})
  const [localNames, setLocalNames] = useState<Record<string, string>>({})
  const [nameErrors, setNameErrors] = useState<Record<string, string>>({})

  const clearLocalState = (variableId: string) => {
    setLocalNames((prev) => {
      const updated = { ...prev }
      delete updated[variableId]
      return updated
    })
    setNameErrors((prev) => {
      const updated = { ...prev }
      delete updated[variableId]
      return updated
    })
  }

  const clearError = (variableId: string) => {
    setNameErrors((prev) => {
      if (!prev[variableId]) return prev
      const updated = { ...prev }
      delete updated[variableId]
      return updated
    })
  }

  const toggleCollapsed = (variableId: string) => {
    setCollapsedById((prev) => ({
      ...prev,
      [variableId]: !prev[variableId],
    }))
  }

  const handleVariableNameChange = (variableId: string, newName: string) => {
    const validatedName = validateName(newName)
    setLocalNames((prev) => ({
      ...prev,
      [variableId]: validatedName,
    }))
    clearError(variableId)
  }

  const isDuplicateName = (variableId: string, name: string): boolean => {
    if (!name.trim()) return false
    return workflowVariables.some((v) => v.id !== variableId && v.name === name.trim())
  }

  const handleVariableNameBlur = (variableId: string) => {
    const localName = localNames[variableId]
    if (localName === undefined) return

    const trimmedName = localName.trim()

    if (!trimmedName) {
      setNameErrors((prev) => ({
        ...prev,
        [variableId]: 'Variable name cannot be empty',
      }))
      return
    }

    if (isDuplicateName(variableId, trimmedName)) {
      setNameErrors((prev) => ({
        ...prev,
        [variableId]: 'Two variables cannot have the same name',
      }))
      return
    }

    collaborativeUpdateVariable(variableId, 'name', trimmedName)
    clearLocalState(variableId)
  }

  const handleVariableNameKeyDown = (
    variableId: string,
    e: React.KeyboardEvent<HTMLInputElement>
  ) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur()
    }
  }

  const handleAddVariable = () => {
    if (!activeWorkflowId) return

    collaborativeAddVariable({
      name: '',
      type: 'string',
      value: '',
      workflowId: activeWorkflowId,
    })
  }

  const getTypeIcon = (type: VariableType) => TYPE_CONFIG[type]?.icon ?? '?'
  const getPlaceholder = (type: VariableType) => TYPE_CONFIG[type]?.placeholder ?? ''

  const handleEditorChange = (variable: Variable, newValue: string) => {
    collaborativeUpdateVariable(variable.id, 'value', newValue)
  }

  const formatValue = (variable: Variable) => {
    if (variable.value === '') return ''
    return typeof variable.value === 'string' ? variable.value : JSON.stringify(variable.value)
  }

  const getValidationStatus = (variable: Variable): string | undefined => {
    if (variable.value === '') return undefined
    switch (variable.type) {
      case 'number':
        return Number.isNaN(Number(variable.value)) ? 'Not a valid number' : undefined
      case 'boolean':
        return !/^(true|false)$/i.test(String(variable.value).trim())
          ? 'Expected "true" or "false"'
          : undefined
      case 'object':
        try {
          const valueToEvaluate = String(variable.value).trim()

          if (!valueToEvaluate.startsWith('{') || !valueToEvaluate.endsWith('}')) {
            return 'Not a valid object format'
          }

          const parsed = new Function(`return ${valueToEvaluate}`)()

          if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return 'Not a valid object'
          }

          return undefined
        } catch (e) {
          logger.info('Object parsing error:', e)
          return 'Invalid object syntax'
        }
      case 'array':
        try {
          const valueToEvaluate = String(variable.value).trim()

          if (!valueToEvaluate.startsWith('[') || !valueToEvaluate.endsWith(']')) {
            return 'Not a valid array format'
          }

          const parsed = new Function(`return ${valueToEvaluate}`)()

          if (!Array.isArray(parsed)) {
            return 'Not a valid array'
          }

          return undefined
        } catch (e) {
          logger.info('Array parsing error:', e)
          return 'Invalid array syntax'
        }
      default:
        return undefined
    }
  }

  useEffect(() => {
    const variableIds = new Set(workflowVariables.map((v) => v.id))
    Object.keys(editorRefs.current).forEach((id) => {
      if (!variableIds.has(id)) {
        delete editorRefs.current[id]
      }
    })
  }, [workflowVariables])

  useEffect(() => {
    setLocalNames((prev) => {
      const variableIds = new Set(workflowVariables.map((v) => v.id))
      const updated = { ...prev }
      let changed = false

      Object.keys(updated).forEach((id) => {
        if (!variableIds.has(id)) {
          delete updated[id]
          changed = true
        } else {
          const variable = workflowVariables.find((v) => v.id === id)
          if (variable && updated[id] === variable.name) {
            delete updated[id]
            changed = true
          }
        }
      })

      return changed ? updated : prev
    })
  }, [workflowVariables])

  return (
    <div className='h-full pt-2'>
      {workflowVariables.length === 0 ? (
        <div className='flex h-full items-center justify-center'>
          <Button
            onClick={handleAddVariable}
            className='h-9 rounded-lg border border-[#E5E5E5] bg-[var(--white)] px-3 py-1.5 font-normal text-muted-foreground text-sm shadow-xs transition-colors hover:text-muted-foreground dark:border-[#414141] dark:bg-[var(--surface-elevated)] dark:hover:text-muted-foreground'
            variant='outline'
          >
            <Plus className='h-4 w-4' />
            Add variable
          </Button>
        </div>
      ) : (
        <ScrollArea className='h-full' hideScrollbar={false}>
          <div className='space-y-4'>
            {workflowVariables.map((variable) => (
              <div key={variable.id} className='space-y-2'>
                {/* Header: Variable name | Variable type | Options dropdown */}
                <div className='space-y-1'>
                  <div className='flex items-center gap-2'>
                    <Input
                      className={cn(
                        'h-9 flex-1 rounded-lg border-none px-3 font-normal text-sm ring-0 ring-offset-0 placeholder:text-muted-foreground focus:ring-0 focus:ring-offset-0 focus-visible:ring-0 focus-visible:ring-offset-0',
                        nameErrors[variable.id]
                          ? 'border border-red-500 bg-[#F6D2D2] outline-none ring-0 focus:border-red-500 dark:bg-[#442929]'
                          : 'bg-secondary/50'
                      )}
                      placeholder='Variable name'
                      value={localNames[variable.id] ?? variable.name}
                      onChange={(e) => handleVariableNameChange(variable.id, e.target.value)}
                      onBlur={() => handleVariableNameBlur(variable.id)}
                      onKeyDown={(e) => handleVariableNameKeyDown(variable.id, e)}
                    />

                    {/* Type selector */}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <div className='flex h-9 w-16 shrink-0 cursor-pointer items-center justify-center rounded-lg bg-secondary/50 px-3'>
                          <span className='font-normal text-sm'>{getTypeIcon(variable.type)}</span>
                          <ChevronDown className='ml-1 h-3 w-3 text-muted-foreground' />
                        </div>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align='end'
                        className='min-w-32 rounded-lg border-[#E5E5E5] bg-[var(--white)] shadow-xs dark:border-[#414141] dark:bg-[var(--surface-elevated)]'
                      >
                        {VARIABLE_TYPES.map((type) => (
                          <DropdownMenuItem
                            key={type}
                            onClick={() => collaborativeUpdateVariable(variable.id, 'type', type)}
                            className='flex cursor-pointer items-center rounded-md px-3 py-2 font-[380] text-card-foreground text-sm hover:bg-secondary/50 focus:bg-secondary/50'
                          >
                            <div className='mr-2 w-5 text-center font-[380] text-sm'>
                              {TYPE_CONFIG[type].icon}
                            </div>
                            <span className='font-[380] capitalize'>{type}</span>
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>

                    {/* Options dropdown */}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant='ghost'
                          size='sm'
                          className='h-9 w-9 shrink-0 rounded-lg bg-secondary/50 p-0 text-muted-foreground hover:bg-secondary/70 focus:ring-0 focus:ring-offset-0 focus-visible:ring-0 focus-visible:ring-offset-0'
                        >
                          <MoreVertical className='h-4 w-4' />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align='end'
                        className='min-w-32 rounded-lg border-[#E5E5E5] bg-[var(--white)] shadow-xs dark:border-[#414141] dark:bg-[var(--surface-elevated)]'
                      >
                        <DropdownMenuItem
                          onClick={() => toggleCollapsed(variable.id)}
                          className='cursor-pointer rounded-md px-3 py-2 font-[380] text-card-foreground text-sm hover:bg-secondary/50 focus:bg-secondary/50'
                        >
                          {(collapsedById[variable.id] ?? false) ? (
                            <Maximize2 className='mr-2 h-4 w-4 text-muted-foreground' />
                          ) : (
                            <Minimize2 className='mr-2 h-4 w-4 text-muted-foreground' />
                          )}
                          {(collapsedById[variable.id] ?? false) ? 'Expand' : 'Collapse'}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => collaborativeDuplicateVariable(variable.id)}
                          className='cursor-pointer rounded-md px-3 py-2 font-[380] text-card-foreground text-sm hover:bg-secondary/50 focus:bg-secondary/50'
                        >
                          <Copy className='mr-2 h-4 w-4 text-muted-foreground' />
                          Duplicate
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => collaborativeDeleteVariable(variable.id)}
                          className='cursor-pointer rounded-md px-3 py-2 font-[380] text-destructive text-sm hover:bg-destructive/10 focus:bg-destructive/10 focus:text-destructive'
                        >
                          <Trash className='mr-2 h-4 w-4' />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  {nameErrors[variable.id] && (
                    <div className='mt-1 text-red-400 text-xs'>{nameErrors[variable.id]}</div>
                  )}
                </div>

                {/* Value area */}
                {!(collapsedById[variable.id] ?? false) && (
                  <div className='relative rounded-lg bg-secondary/50'>
                    {/* Validation indicator */}
                    {variable.value !== '' && getValidationStatus(variable) && (
                      <div className='absolute top-2 right-2 z-10'>
                        <Tooltip.Root>
                          <Tooltip.Trigger asChild>
                            <div className='cursor-help'>
                              <AlertTriangle className='h-3 w-3 text-muted-foreground' />
                            </div>
                          </Tooltip.Trigger>
                          <Tooltip.Content side='bottom' className='max-w-xs'>
                            <p>{getValidationStatus(variable)}</p>
                          </Tooltip.Content>
                        </Tooltip.Root>
                      </div>
                    )}

                    {/* Editor */}
                    <div className='relative overflow-hidden'>
                      <div
                        className='relative min-h-[36px] w-full max-w-full px-3 py-2 font-normal text-sm'
                        ref={(el) => {
                          editorRefs.current[variable.id] = el
                        }}
                        style={{ maxWidth: '100%' }}
                      >
                        {variable.value === '' && (
                          <div className='pointer-events-none absolute inset-0 flex select-none items-start justify-start px-3 py-2 font-[380] text-muted-foreground text-sm leading-normal'>
                            <div style={{ lineHeight: '20px' }}>
                              {getPlaceholder(variable.type)}
                            </div>
                          </div>
                        )}
                        <Editor
                          key={`editor-${variable.id}-${variable.type}`}
                          value={formatValue(variable)}
                          onValueChange={(newValue) => handleEditorChange(variable, newValue)}
                          highlight={(code) =>
                            // Only apply syntax highlighting for non-basic text types
                            variable.type === 'plain' || variable.type === 'string'
                              ? code
                              : highlight(code, languages.javascript, 'javascript')
                          }
                          padding={0}
                          style={{
                            fontFamily: 'inherit',
                            lineHeight: '20px',
                            width: '100%',
                            maxWidth: '100%',
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-all',
                            overflowWrap: 'break-word',
                            minHeight: '20px',
                            overflow: 'hidden',
                          }}
                          className='[&>pre]:!max-w-full [&>pre]:!overflow-hidden [&>pre]:!whitespace-pre-wrap [&>pre]:!break-all [&>pre]:!overflow-wrap-break-word [&>textarea]:!max-w-full [&>textarea]:!overflow-hidden [&>textarea]:!whitespace-pre-wrap [&>textarea]:!break-all [&>textarea]:!overflow-wrap-break-word font-[380] text-foreground text-sm leading-normal focus:outline-none'
                          textareaClassName='focus:outline-none focus:ring-0 bg-transparent resize-none w-full max-w-full whitespace-pre-wrap break-all overflow-wrap-break-word overflow-hidden font-[380] text-foreground'
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {/* Add Variable Button */}
            <Button
              onClick={handleAddVariable}
              className='mt-2 h-9 w-full rounded-lg border border-[#E5E5E5] bg-[var(--white)] px-3 py-1.5 font-[380] text-muted-foreground text-sm shadow-xs transition-colors hover:text-muted-foreground dark:border-[#414141] dark:bg-[var(--surface-elevated)] dark:hover:text-muted-foreground'
              variant='outline'
            >
              <Plus className='h-4 w-4' />
              Add variable
            </Button>
          </div>
        </ScrollArea>
      )}
    </div>
  )
}
