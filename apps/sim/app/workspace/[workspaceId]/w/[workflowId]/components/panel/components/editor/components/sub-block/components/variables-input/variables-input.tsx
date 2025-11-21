import { useEffect, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { useParams } from 'next/navigation'
import { Badge, Button, Combobox, Input } from '@/components/emcn'
import { Trash } from '@/components/emcn/icons/trash'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { formatDisplayText } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/formatted-text'
import {
  checkTagTrigger,
  TagDropdown,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/tag-dropdown/tag-dropdown'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'
import { useAccessibleReferencePrefixes } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-accessible-reference-prefixes'
import { useVariablesStore } from '@/stores/panel/variables/store'
import type { Variable } from '@/stores/panel/variables/types'

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

  const value = isPreview ? previewValue : storeValue
  const assignments: VariableAssignment[] = value || []
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

  // Initialize with one empty assignment if none exist and not in preview/disabled mode
  // Also add assignment when first variable is created
  useEffect(() => {
    if (!isReadOnly && assignments.length === 0 && currentWorkflowVariables.length > 0) {
      const initialAssignment: VariableAssignment = {
        ...DEFAULT_ASSIGNMENT,
        id: crypto.randomUUID(),
      }
      setStoreValue([initialAssignment])
    }
  }, [currentWorkflowVariables.length, isReadOnly, assignments.length, setStoreValue])

  // Clean up assignments when their associated variables are deleted
  useEffect(() => {
    if (isReadOnly || assignments.length === 0) return

    const currentVariableIds = new Set(currentWorkflowVariables.map((v) => v.id))
    const validAssignments = assignments.filter((assignment) => {
      // Keep assignments that haven't selected a variable yet
      if (!assignment.variableId) return true
      // Keep assignments whose variable still exists
      return currentVariableIds.has(assignment.variableId)
    })

    // If all variables were deleted, clear all assignments
    if (currentWorkflowVariables.length === 0) {
      setStoreValue([])
    } else if (validAssignments.length !== assignments.length) {
      // Some assignments reference deleted variables, remove them
      setStoreValue(validAssignments.length > 0 ? validAssignments : [])
    }
  }, [currentWorkflowVariables, assignments, isReadOnly, setStoreValue])

  const addAssignment = () => {
    if (isPreview || disabled || allVariablesAssigned) return

    const newAssignment: VariableAssignment = {
      ...DEFAULT_ASSIGNMENT,
      id: crypto.randomUUID(),
    }
    setStoreValue([...(assignments || []), newAssignment])
  }

  const removeAssignment = (id: string) => {
    if (isPreview || disabled) return
    setStoreValue((assignments || []).filter((a) => a.id !== id))
  }

  const updateAssignment = (id: string, updates: Partial<VariableAssignment>) => {
    if (isPreview || disabled) return
    setStoreValue((assignments || []).map((a) => (a.id === id ? { ...a, ...updates } : a)))
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

  const handleTagSelect = (tag: string) => {
    if (!activeFieldId) return

    const assignment = assignments.find((a) => a.id === activeFieldId)
    if (!assignment) return

    const currentValue = assignment.value || ''

    const textBeforeCursor = currentValue.slice(0, cursorPosition)
    const lastOpenBracket = textBeforeCursor.lastIndexOf('<')

    const newValue =
      currentValue.slice(0, lastOpenBracket) + tag + currentValue.slice(cursorPosition)

    updateAssignment(activeFieldId, { value: newValue })
    setShowTags(false)

    setTimeout(() => {
      const inputEl = valueInputRefs.current[activeFieldId]
      if (inputEl) {
        inputEl.focus()
        const newCursorPos = lastOpenBracket + tag.length
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

  if (isPreview && (!assignments || assignments.length === 0)) {
    return (
      <div className='flex flex-col items-center justify-center rounded-md border border-border/40 border-dashed bg-muted/20 py-8 text-center'>
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
      {assignments && assignments.length > 0 && (
        <div className='space-y-[8px]'>
          {assignments.map((assignment, index) => {
            const collapsed = collapsedAssignments[assignment.id] || false
            const availableVars = getAvailableVariablesFor(assignment.id)

            return (
              <div
                key={assignment.id}
                data-assignment-id={assignment.id}
                className={cn(
                  'rounded-[4px] border border-[var(--border-strong)] bg-[#1F1F1F]',
                  collapsed ? 'overflow-hidden' : 'overflow-visible'
                )}
              >
                <div
                  className='flex cursor-pointer items-center justify-between bg-transparent px-[10px] py-[5px]'
                  onClick={() => toggleCollapse(assignment.id)}
                >
                  <div className='flex min-w-0 flex-1 items-center gap-[8px]'>
                    <span className='block truncate font-medium text-[14px] text-[var(--text-tertiary)]'>
                      {assignment.variableName || `Variable ${index + 1}`}
                    </span>
                    {assignment.variableName && (
                      <Badge className='h-[20px] text-[13px]'>{assignment.type}</Badge>
                    )}
                  </div>
                  <div
                    className='flex items-center gap-[8px] pl-[8px]'
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Button
                      variant='ghost'
                      onClick={addAssignment}
                      disabled={isPreview || disabled || allVariablesAssigned}
                      className='h-auto p-0'
                    >
                      <Plus className='h-[14px] w-[14px]' />
                      <span className='sr-only'>Add Variable</span>
                    </Button>
                    <Button
                      variant='ghost'
                      onClick={() => removeAssignment(assignment.id)}
                      disabled={isPreview || disabled || assignments.length === 1}
                      className='h-auto p-0 text-[var(--text-error)] hover:text-[var(--text-error)]'
                    >
                      <Trash className='h-[14px] w-[14px]' />
                      <span className='sr-only'>Delete Variable</span>
                    </Button>
                  </div>
                </div>

                {!collapsed && (
                  <div className='flex flex-col gap-[6px] border-[var(--border-strong)] border-t px-[10px] pt-[6px] pb-[10px]'>
                    <div className='flex flex-col gap-[4px]'>
                      <Label className='text-[13px]'>Variable</Label>
                      <Combobox
                        options={availableVars.map((v) => ({ label: v.name, value: v.id }))}
                        value={assignment.variableId || assignment.variableName || ''}
                        onChange={(value) => handleVariableSelect(assignment.id, value)}
                        placeholder='Select a variable...'
                        disabled={isPreview || disabled}
                      />
                    </div>

                    <div className='space-y-[4px]'>
                      <Label className='text-[13px]'>Value</Label>
                      {assignment.type === 'object' || assignment.type === 'array' ? (
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
                            placeholder={
                              assignment.type === 'object'
                                ? '{\n  "key": "value"\n}'
                                : '[\n  1, 2, 3\n]'
                            }
                            disabled={isPreview || disabled}
                            className={cn(
                              'min-h-[120px] font-mono text-sm text-transparent caret-foreground placeholder:text-muted-foreground/50',
                              dragHighlight[assignment.id] && 'ring-2 ring-blue-500 ring-offset-2'
                            )}
                            style={{
                              fontFamily: 'inherit',
                              lineHeight: 'inherit',
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
                            style={{
                              fontFamily: 'inherit',
                              lineHeight: 'inherit',
                            }}
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
                            placeholder={`${assignment.type} value`}
                            disabled={isPreview || disabled}
                            autoComplete='off'
                            className={cn(
                              'allow-scroll w-full overflow-auto text-transparent caret-foreground',
                              dragHighlight[assignment.id] && 'ring-2 ring-blue-500 ring-offset-2'
                            )}
                            style={{ overflowX: 'auto' }}
                            onDrop={(e) => handleDrop(e, assignment.id)}
                            onDragOver={(e) => handleDragOver(e, assignment.id)}
                            onDragLeave={(e) => handleDragLeave(e, assignment.id)}
                          />
                          <div
                            ref={(el) => {
                              if (el) overlayRefs.current[assignment.id] = el
                            }}
                            className='pointer-events-none absolute inset-0 flex items-center overflow-x-auto bg-transparent px-[8px] py-[6px] font-medium font-sans text-sm'
                            style={{ overflowX: 'auto' }}
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
