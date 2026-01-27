import { useEffect, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { useParams } from 'next/navigation'
import {
  Badge,
  Button,
  Combobox,
  type ComboboxOption,
  Input,
  Label,
  Textarea,
} from '@/components/emcn'
import { Trash } from '@/components/emcn/icons/trash'
import { cn } from '@/lib/core/utils/cn'
import { formatDisplayText } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/formatted-text'
import {
  checkTagTrigger,
  TagDropdown,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/tag-dropdown/tag-dropdown'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'
import { useAccessibleReferencePrefixes } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-accessible-reference-prefixes'
import type { Variable } from '@/stores/panel'
import { useVariablesStore } from '@/stores/panel'

interface VariableAssignment {
  id: string
  variableId?: string
  variableName: string
  type: 'string' | 'plain' | 'number' | 'boolean' | 'object' | 'array' | 'json'
  value: string
  isExisting: boolean
}

interface VariablesInputProps {
  blockId: string
  subBlockId: string
  isPreview?: boolean
  previewValue?: VariableAssignment[] | null
  disabled?: boolean
}

const DEFAULT_ASSIGNMENT: Omit<VariableAssignment, 'id'> = {
  variableName: '',
  type: 'string',
  value: '',
  isExisting: false,
}

/**
 * Boolean value options for Combobox
 */
const BOOLEAN_OPTIONS: ComboboxOption[] = [
  { label: 'true', value: 'true' },
  { label: 'false', value: 'false' },
]

/**
 * Parses a value that might be a JSON string or already an array of VariableAssignment.
 * This handles the case where workflows are imported with stringified values.
 */
function parseVariableAssignments(value: unknown): VariableAssignment[] {
  if (!value) return []
  if (Array.isArray(value)) return value as VariableAssignment[]
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        const parsed = JSON.parse(trimmed)
        if (Array.isArray(parsed)) return parsed as VariableAssignment[]
      } catch {
        // Not valid JSON, return empty array
      }
    }
  }
  return []
}

export function VariablesInput({
  blockId,
  subBlockId,
  isPreview = false,
  previewValue,
  disabled = false,
}: VariablesInputProps) {
  const params = useParams()
  const workflowId = params.workflowId as string
  const [storeValue, setStoreValue] = useSubBlockValue<VariableAssignment[]>(blockId, subBlockId)
  const { variables: workflowVariables } = useVariablesStore()
  const accessiblePrefixes = useAccessibleReferencePrefixes(blockId)

  const [showTags, setShowTags] = useState(false)
  const [cursorPosition, setCursorPosition] = useState(0)
  const [activeFieldId, setActiveFieldId] = useState<string | null>(null)
  const [activeSourceBlockId, setActiveSourceBlockId] = useState<string | null>(null)
  const valueInputRefs = useRef<Record<string, HTMLInputElement | HTMLTextAreaElement>>({})
  const overlayRefs = useRef<Record<string, HTMLDivElement>>({})
  const [dragHighlight, setDragHighlight] = useState<Record<string, boolean>>({})
  const [collapsedAssignments, setCollapsedAssignments] = useState<Record<string, boolean>>({})

  const currentWorkflowVariables = Object.values(workflowVariables).filter(
    (v: Variable) => v.workflowId === workflowId
  )

  const rawValue = isPreview ? previewValue : storeValue
  const assignments: VariableAssignment[] = parseVariableAssignments(rawValue)
  const isReadOnly = isPreview || disabled

  const getAvailableVariablesFor = (currentAssignmentId: string) => {
    const otherSelectedIds = new Set(
      assignments
        .filter((a) => a.id !== currentAssignmentId)
        .map((a) => a.variableId)
        .filter((id): id is string => !!id)
    )

    return currentWorkflowVariables.filter((variable) => !otherSelectedIds.has(variable.id))
  }

  const hasNoWorkflowVariables = currentWorkflowVariables.length === 0
  const allVariablesAssigned =
    !hasNoWorkflowVariables && getAvailableVariablesFor('new').length === 0

  useEffect(() => {
    if (!isReadOnly && assignments.length === 0 && currentWorkflowVariables.length > 0) {
      const initialAssignment: VariableAssignment = {
        ...DEFAULT_ASSIGNMENT,
        id: crypto.randomUUID(),
      }
      setStoreValue([initialAssignment])
    }
  }, [currentWorkflowVariables.length, isReadOnly, assignments.length, setStoreValue])

  useEffect(() => {
    if (isReadOnly || assignments.length === 0) return

    const currentVariableIds = new Set(currentWorkflowVariables.map((v) => v.id))
    const validAssignments = assignments.filter((assignment) => {
      if (!assignment.variableId) return true
      return currentVariableIds.has(assignment.variableId)
    })

    if (currentWorkflowVariables.length === 0) {
      setStoreValue([])
    } else if (validAssignments.length !== assignments.length) {
      setStoreValue(validAssignments.length > 0 ? validAssignments : [])
    }
  }, [currentWorkflowVariables, assignments, isReadOnly, setStoreValue])

  const addAssignment = () => {
    if (isReadOnly || allVariablesAssigned) return

    const newAssignment: VariableAssignment = {
      ...DEFAULT_ASSIGNMENT,
      id: crypto.randomUUID(),
    }
    setStoreValue([...assignments, newAssignment])
  }

  const removeAssignment = (id: string) => {
    if (isReadOnly) return

    if (assignments.length === 1) {
      setStoreValue([{ ...DEFAULT_ASSIGNMENT, id: crypto.randomUUID() }])
      return
    }

    setStoreValue(assignments.filter((a) => a.id !== id))
  }

  const updateAssignment = (id: string, updates: Partial<VariableAssignment>) => {
    if (isReadOnly) return
    setStoreValue(assignments.map((a) => (a.id === id ? { ...a, ...updates } : a)))
  }

  const handleVariableSelect = (assignmentId: string, variableId: string) => {
    const selectedVariable = currentWorkflowVariables.find((v) => v.id === variableId)
    if (selectedVariable) {
      updateAssignment(assignmentId, {
        variableId: selectedVariable.id,
        variableName: selectedVariable.name,
        type: selectedVariable.type as any,
        isExisting: true,
      })
    }
  }

  const handleTagSelect = (newValue: string) => {
    if (!activeFieldId) return

    const assignment = assignments.find((a) => a.id === activeFieldId)
    const originalValue = assignment?.value || ''
    const textAfterCursor = originalValue.slice(cursorPosition)

    updateAssignment(activeFieldId, { value: newValue })
    setShowTags(false)

    setTimeout(() => {
      const inputEl = valueInputRefs.current[activeFieldId]
      if (inputEl) {
        inputEl.focus()
        const newCursorPos = newValue.length - textAfterCursor.length
        inputEl.setSelectionRange(newCursorPos, newCursorPos)
      }
    }, 10)
  }

  const handleValueInputChange = (
    assignmentId: string,
    newValue: string,
    selectionStart?: number
  ) => {
    updateAssignment(assignmentId, { value: newValue })

    if (selectionStart !== undefined) {
      setCursorPosition(selectionStart)
      setActiveFieldId(assignmentId)

      const shouldShowTags = checkTagTrigger(newValue, selectionStart)
      setShowTags(shouldShowTags.show)

      if (shouldShowTags.show) {
        const textBeforeCursor = newValue.slice(0, selectionStart)
        const lastOpenBracket = textBeforeCursor.lastIndexOf('<')
        const tagContent = textBeforeCursor.slice(lastOpenBracket + 1)
        const dotIndex = tagContent.indexOf('.')
        const sourceBlock = dotIndex > 0 ? tagContent.slice(0, dotIndex) : null
        setActiveSourceBlockId(sourceBlock)
      }
    }
  }

  const handleDrop = (e: React.DragEvent, assignmentId: string) => {
    e.preventDefault()
    setDragHighlight((prev) => ({ ...prev, [assignmentId]: false }))
    const input = valueInputRefs.current[assignmentId]
    input?.focus()

    if (input) {
      const assignment = assignments.find((a) => a.id === assignmentId)
      const currentValue = assignment?.value || ''
      const dropPosition = (input as any).selectionStart ?? currentValue.length
      const newValue = `${currentValue.slice(0, dropPosition)}<${currentValue.slice(dropPosition)}`
      updateAssignment(assignmentId, { value: newValue })
      setActiveFieldId(assignmentId)
      setCursorPosition(dropPosition + 1)
      setShowTags(true)

      try {
        const data = JSON.parse(e.dataTransfer.getData('application/json'))
        if (data?.connectionData?.sourceBlockId) {
          setActiveSourceBlockId(data.connectionData.sourceBlockId)
        }
      } catch {}

      setTimeout(() => {
        const el = valueInputRefs.current[assignmentId]
        if (el && typeof (el as any).selectionStart === 'number') {
          ;(el as any).selectionStart = dropPosition + 1
          ;(el as any).selectionEnd = dropPosition + 1
        }
      }, 0)
    }
  }

  const handleDragOver = (e: React.DragEvent, assignmentId: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setDragHighlight((prev) => ({ ...prev, [assignmentId]: true }))
  }

  const handleDragLeave = (e: React.DragEvent, assignmentId: string) => {
    e.preventDefault()
    setDragHighlight((prev) => ({ ...prev, [assignmentId]: false }))
  }

  const toggleCollapse = (assignmentId: string) => {
    setCollapsedAssignments((prev) => ({
      ...prev,
      [assignmentId]: !prev[assignmentId],
    }))
  }

  const syncOverlayScroll = (assignmentId: string, scrollLeft: number) => {
    const overlay = overlayRefs.current[assignmentId]
    if (overlay) overlay.scrollLeft = scrollLeft
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      setShowTags(false)
      setActiveSourceBlockId(null)
    }
  }

  if (isPreview && (!assignments || assignments.length === 0)) {
    return (
      <div className='flex flex-col items-center justify-center rounded-md border border-border/40 bg-muted/20 py-8 text-center'>
        <svg
          className='mb-3 h-10 w-10 text-muted-foreground/40'
          fill='none'
          viewBox='0 0 24 24'
          stroke='currentColor'
        >
          <path
            strokeLinecap='round'
            strokeLinejoin='round'
            strokeWidth={1.5}
            d='M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z'
          />
        </svg>
        <p className='mb-1 font-medium text-foreground text-sm'>No variable assignments defined</p>
        <p className='text-muted-foreground text-xs'>
          Add variables in the Variables panel to get started
        </p>
      </div>
    )
  }

  if (!isPreview && hasNoWorkflowVariables && assignments.length === 0) {
    return <p className='text-[var(--text-muted)] text-sm'>No variables available</p>
  }

  return (
    <div className='space-y-[8px]'>
      {assignments.length > 0 && (
        <div className='space-y-[8px]'>
          {assignments.map((assignment, index) => {
            const collapsed = collapsedAssignments[assignment.id] || false
            const availableVars = getAvailableVariablesFor(assignment.id)

            return (
              <div
                key={assignment.id}
                data-assignment-id={assignment.id}
                className={cn(
                  'rounded-[4px] border border-[var(--border-1)]',
                  collapsed ? 'overflow-hidden' : 'overflow-visible'
                )}
              >
                <div
                  className='flex cursor-pointer items-center justify-between rounded-t-[4px] bg-[var(--surface-4)] px-[10px] py-[5px]'
                  onClick={() => toggleCollapse(assignment.id)}
                >
                  <div className='flex min-w-0 flex-1 items-center gap-[8px]'>
                    <span className='block truncate font-medium text-[14px] text-[var(--text-tertiary)]'>
                      {assignment.variableName || `Variable ${index + 1}`}
                    </span>
                    {assignment.variableName && (
                      <Badge variant='type' size='sm'>
                        {assignment.type}
                      </Badge>
                    )}
                  </div>
                  <div
                    className='flex items-center gap-[8px] pl-[8px]'
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Button
                      variant='ghost'
                      onClick={addAssignment}
                      disabled={isReadOnly || allVariablesAssigned}
                      className='h-auto p-0'
                    >
                      <Plus className='h-[14px] w-[14px]' />
                      <span className='sr-only'>Add Variable</span>
                    </Button>
                    <Button
                      variant='ghost'
                      onClick={() => removeAssignment(assignment.id)}
                      disabled={isReadOnly}
                      className='h-auto p-0 text-[var(--text-error)] hover:text-[var(--text-error)]'
                    >
                      <Trash className='h-[14px] w-[14px]' />
                      <span className='sr-only'>Delete Variable</span>
                    </Button>
                  </div>
                </div>

                {!collapsed && (
                  <div className='flex flex-col gap-[8px] border-[var(--border-1)] border-t px-[10px] pt-[6px] pb-[10px]'>
                    <div className='flex flex-col gap-[6px]'>
                      <Label className='text-[13px]'>Variable</Label>
                      <Combobox
                        options={availableVars.map((v) => ({ label: v.name, value: v.id }))}
                        value={assignment.variableId || ''}
                        onChange={(value) => handleVariableSelect(assignment.id, value)}
                        placeholder='Select a variable...'
                        disabled={isReadOnly}
                      />
                    </div>

                    <div className='flex flex-col gap-[6px]'>
                      <Label className='text-[13px]'>Value</Label>
                      {assignment.type === 'boolean' ? (
                        <Combobox
                          options={BOOLEAN_OPTIONS}
                          value={assignment.value ?? ''}
                          onChange={(v) =>
                            !isReadOnly && updateAssignment(assignment.id, { value: v })
                          }
                          placeholder='Select value'
                          disabled={isReadOnly}
                        />
                      ) : assignment.type === 'object' || assignment.type === 'array' ? (
                        <div className='relative'>
                          <Textarea
                            ref={(el) => {
                              if (el) valueInputRefs.current[assignment.id] = el
                            }}
                            value={assignment.value || ''}
                            onChange={(e) =>
                              handleValueInputChange(
                                assignment.id,
                                e.target.value,
                                e.target.selectionStart ?? undefined
                              )
                            }
                            onKeyDown={handleKeyDown}
                            onFocus={() => {
                              if (!isReadOnly && !assignment.value?.trim()) {
                                setActiveFieldId(assignment.id)
                                setCursorPosition(0)
                                setShowTags(true)
                              }
                            }}
                            onScroll={(e) => {
                              const overlay = overlayRefs.current[assignment.id]
                              if (overlay) {
                                overlay.scrollTop = e.currentTarget.scrollTop
                                overlay.scrollLeft = e.currentTarget.scrollLeft
                              }
                            }}
                            placeholder={
                              assignment.type === 'object'
                                ? '{\n  "key": "value"\n}'
                                : '[\n  1, 2, 3\n]'
                            }
                            disabled={isReadOnly}
                            className={cn(
                              'min-h-[120px] font-mono text-sm text-transparent caret-foreground placeholder:text-muted-foreground/50',
                              dragHighlight[assignment.id] && 'ring-2 ring-blue-500 ring-offset-2'
                            )}
                            style={{
                              wordBreak: 'break-word',
                              whiteSpace: 'pre-wrap',
                            }}
                            onDrop={(e) => handleDrop(e, assignment.id)}
                            onDragOver={(e) => handleDragOver(e, assignment.id)}
                            onDragLeave={(e) => handleDragLeave(e, assignment.id)}
                          />
                          <div
                            ref={(el) => {
                              if (el) overlayRefs.current[assignment.id] = el
                            }}
                            className='pointer-events-none absolute inset-0 flex items-start overflow-auto bg-transparent px-3 py-2 font-mono text-sm'
                            style={{ scrollbarWidth: 'none' }}
                          >
                            <div className='w-full whitespace-pre-wrap break-words'>
                              {formatDisplayText(assignment.value || '', {
                                accessiblePrefixes,
                                highlightAll: !accessiblePrefixes,
                              })}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className='relative'>
                          <Input
                            ref={(el) => {
                              if (el) valueInputRefs.current[assignment.id] = el
                            }}
                            name='value'
                            value={assignment.value || ''}
                            onChange={(e) =>
                              handleValueInputChange(
                                assignment.id,
                                e.target.value,
                                e.target.selectionStart ?? undefined
                              )
                            }
                            onKeyDown={handleKeyDown}
                            onFocus={() => {
                              if (!isReadOnly && !assignment.value?.trim()) {
                                setActiveFieldId(assignment.id)
                                setCursorPosition(0)
                                setShowTags(true)
                              }
                            }}
                            onScroll={(e) =>
                              syncOverlayScroll(assignment.id, e.currentTarget.scrollLeft)
                            }
                            onPaste={() =>
                              setTimeout(() => {
                                const input = valueInputRefs.current[assignment.id]
                                if (input)
                                  syncOverlayScroll(
                                    assignment.id,
                                    (input as HTMLInputElement).scrollLeft
                                  )
                              }, 0)
                            }
                            placeholder={`${assignment.type} value`}
                            disabled={isReadOnly}
                            autoComplete='off'
                            className={cn(
                              'allow-scroll w-full overflow-x-auto overflow-y-hidden text-transparent caret-foreground',
                              dragHighlight[assignment.id] && 'ring-2 ring-blue-500 ring-offset-2'
                            )}
                            onDrop={(e) => handleDrop(e, assignment.id)}
                            onDragOver={(e) => handleDragOver(e, assignment.id)}
                            onDragLeave={(e) => handleDragLeave(e, assignment.id)}
                          />
                          <div
                            ref={(el) => {
                              if (el) overlayRefs.current[assignment.id] = el
                            }}
                            className='pointer-events-none absolute inset-0 flex items-center overflow-x-auto bg-transparent px-[8px] py-[6px] font-medium font-sans text-sm'
                            style={{ scrollbarWidth: 'none' }}
                          >
                            <div
                              className='w-full whitespace-pre'
                              style={{ scrollbarWidth: 'none', minWidth: 'fit-content' }}
                            >
                              {formatDisplayText(
                                assignment.value || '',
                                accessiblePrefixes ? { accessiblePrefixes } : { highlightAll: true }
                              )}
                            </div>
                          </div>
                        </div>
                      )}

                      {showTags && activeFieldId === assignment.id && (
                        <TagDropdown
                          visible={showTags}
                          onSelect={handleTagSelect}
                          blockId={blockId}
                          activeSourceBlockId={activeSourceBlockId}
                          inputValue={assignment.value || ''}
                          cursorPosition={cursorPosition}
                          onClose={() => setShowTags(false)}
                          inputRef={
                            {
                              current: valueInputRefs.current[assignment.id] || null,
                            } as React.RefObject<HTMLTextAreaElement | HTMLInputElement>
                          }
                        />
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
